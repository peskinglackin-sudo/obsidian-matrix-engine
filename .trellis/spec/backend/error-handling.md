# Errors, Cancellation, and Degradation

Failures are expected at vault, native-library, provider, queue, index, and UI
boundaries. Handle them as typed, actionable states; an unhandled exception
must not crash Obsidian (`prd.md` section 20.2).

## Error contract

When the first source contracts are created, define one project-owned error
shape containing at least a stable code, safe user message or i18n key,
retryability, operation/context identifiers, and an optional internal cause.
Persist only redacted `last_error_code`, `last_error_message`, retry count, and
attempt timestamps in the manifest.

Do not expose raw SDK/provider exceptions directly to views. Adapters translate
them once; services decide retry/degradation; views render the resulting state.

## Cancellation and stale work

- Thread `AbortSignal` through provider probes, embedding, rerank, searches,
  and other long operations.
- Search interaction cancels the prior request and also checks a request
  generation before publishing results.
- Indexing checks source generation immediately before writing, even if an
  earlier stage already checked it.
- Pause/unload closes queues, requests, workers, listeners, and DB handles.
- Cancellation is not logged or surfaced as an unexpected failure unless
  cleanup itself fails.

## Retry policy

Retry only transient provider failures: HTTP 408, 429, 5xx, or a network
interruption. Use exponential backoff, jitter, and `Retry-After`; respect the
configured retry limit and cancellation signal.

For a suspected batch-size/payload failure, bisect the batch. A single item
that still fails becomes a redacted dead-letter job that the UI can retry. Do
not let one file or item block the entire artifact.

Validation/authentication failures, incompatible dimensions, invalid settings,
and unsupported capabilities require user action or a fallback; blind retries
are forbidden.

## Required degradation

Search modes degrade explicitly according to `prd.md` section 7.5 and FR-011:

- provider unavailable: Exact and Lexical remain available;
- vector index unavailable: Exact and Lexical remain available;
- lexical index unavailable: Exact and Semantic remain available;
- optional reranker unavailable: return the complete non-reranked flow;
- advanced LanceDB capability unavailable: use the slower correct path.

Auto mode and the result area must show which mode actually ran and why a
requested capability was skipped. Never return a silent partial result as if
the requested mode succeeded.

## Recovery

- Stop writes on database lock/directory conflict and offer rebuild guidance.
- Make corruption recoverable by deleting and rebuilding cache artifacts.
- Retain failed jobs and recent safe errors for the status/diagnostics UI.
- Preview the affected scope before repair, lexical rebuild, re-embedding,
  full artifact rebuild, or stale-row cleanup.

## Verification

Cover request cancellation, out-of-order completion, old-generation rejection,
provider failure degradation, dead-letter retry, unload cleanup, per-file
failure isolation, and database rebuild. A happy-path rejection test is not
sufficient: assert the fallback mode and user-visible state.

Concrete Spike owners are `src/core/errors.ts` and
`src/core/lifecycle.ts`. Adapters return project-owned `SafeError`; raw causes
are deliberately not retained by the safe object. `LifecycleRegistry.close()`
releases resources in reverse acquisition order, continues after cleanup
failure, and returns only safe resource IDs/kinds/error codes. Obsidian's
`onunload(): void` starts close without returning a Promise; an authoritative
probe checkpoint must explicitly await the registry before declaring cleanup.

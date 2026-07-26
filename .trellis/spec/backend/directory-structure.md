# Directory and Architecture

## Current repository state

Spike 0 establishes a deliberately shallow product skeleton. The Obsidian
composition root is `src/main.ts`; immutable formal/test identity and every
persistent namespace derive from `src/identity.ts`. Identity behavior is
verified by `tests/identity.test.ts`. New directories remain responsibility-
based and are added only when their Spike implementation exists.

## Required ownership boundaries

Keep these responsibilities separable even if the first implementation uses
only a few files:

- Plugin shell: Obsidian registration, load/unload, command/view wiring.
- Core: settings, secrets, typed events, cancellation, and diagnostics.
- Source pipeline: vault events, extraction, language analysis, diffing,
  embedding batches, writes, and maintenance.
- Provider layer: capability probes and embedding/rerank adapters.
- Storage layer: `VectorStore`, `LexicalStore`, repositories, artifacts, and
  the LanceDB adapter.
- Retrieval pipeline: parse, plan, retrieve, fuse, aggregate, diversify,
  optionally rerank, then hydrate.
- Knowledge discovery: connections, feedback, and later the local ego graph.
- UI: Obsidian views, settings, status, and i18n; UI-specific rules live in
  `../frontend/`.

The evidence is the architecture tree in `prd.md` section 11 and the interfaces
in section 11.1.

## Dependency direction

- Business logic depends on project-owned interfaces, never directly on the
  LanceDB SDK. `LanceDbStore` may implement both `VectorStore` and
  `LexicalStore`, but callers must retain the replaceable boundary required by
  Spike 0's go/no-go decision.
- `QueryParser` produces a `SearchQueryAst`; it must not emit LanceDB SQL.
  Retrievers or storage adapters compile typed queries and filters.
- Provider-specific endpoints and optional capabilities stay behind
  `EmbeddingProvider`, `TokenCounter`, and `RerankProvider`.
- Views consume typed services/results and must not query LanceDB, compile raw
  filters, or own index lifecycle decisions.
- Shared data contracts have one owner. Do not redeclare settings, result,
  capability, score, or artifact shapes in individual views/adapters.

## Lifecycle boundary

The plugin shell is the composition root. It owns startup ordering and must
close provider requests, queues, workers, listeners, and database handles on
unload (`prd.md` section 20.2). Lower layers expose cleanup/cancellation hooks;
they do not register unmanaged global resources.

## Adding source files

Before creating a directory:

1. Name the responsibility and its public contract.
2. Check whether it belongs to the shell, a pipeline stage, an interface, or
   an adapter.
3. Avoid generic `utils` ownership for parsing, hashing, normalization,
   filtering, or retry logic; those behaviors affect fingerprints or safety
   and require an explicit owner.
4. Add a colocated or clearly mapped test path.
5. Update this section with each new owner and its mapped tests.

Current concrete ownership examples:

- `src/main.ts` owns Obsidian load/unload composition; it must not acquire
  storage/provider resources outside a lifecycle owner.
- `src/identity.ts` owns formal/test identity and namespace derivation;
  `tests/identity.test.ts` verifies manifest agreement, deterministic naming,
  SecretStorage-safe IDs, and formal/Spike isolation.
- `src/probe/platform-contract.ts` owns the shared real-Obsidian request,
  checkpoint, state, phase, and version contracts. `src/probe/platform-probe.ts`
  produces evidence inside Obsidian; `spike/platform-runner/operator.ts`
  prepares/finalizes it outside Obsidian. Neither side owns a second schema.
- `spike/local-gpu/process.ts` owns llama-server arguments/process cleanup;
  `spike/local-gpu/build-manifest.ts` and `runtime-metadata.ts` validate build
  and backend evidence; `spike/local-gpu/runner.ts` composes the external gate.
  Tests live in `tests/platform-state.test.ts`,
  `tests/platform-runner.test.ts`, and `tests/local-gpu-runner.test.ts`.

## Avoid

- Importing `@lancedb/lancedb` throughout business services.
- A monolithic `SearchService` that parses, queries, fuses, and renders.
- A single serial queue for control, parsing, embedding, writes, and
  maintenance.
- UI code that knows table names or raw provider response shapes.
- Treating `.trellis/` or `.codex/` as product runtime packages.

## Scenario: stable plugin identity namespace

### 1. Scope / Trigger

Apply to manifest identity, settings, SecretStorage, database/artifact paths,
diagnostics, test builds, localization, renames, and Community submission.

### 2. Signatures

One identity owner exports the immutable formal ID `matrix-engine`, English
name `Matrix Engine`, and namespace builders for settings, secret IDs,
database/artifact directories, and diagnostics. Test builds accept an explicit
non-production ID such as `matrix-engine-spike`; translated names are display
values only.

### 3. Contracts

- Formal manifest and Community identity use `matrix-engine`.
- English display is `Matrix Engine`; Chinese display is `矩阵引擎`.
- Persisted keys and paths derive from the formal/test ID, never a translated
  name or the historical Trellis task slug.
- A parallel Spike build uses a dedicated vault/database and cannot access the
  formal namespace.
- Recheck the Community registry immediately before first submission; the
  2026-07-15 no-conflict check is evidence, not a reservation.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Formal build ID differs from `matrix-engine` | build fails |
| Translated name is used in a persisted key/path | test/lint fails |
| Spike ID is absent or equals formal ID in parallel mode | runner refuses to start |
| Community ID/name becomes occupied before first release | stop and review before submission |
| Post-release display name changes | preserve ID and persisted namespaces |

### 5. Good, Base, and Bad Cases

- Good: `matrix-engine` and `matrix-engine-spike` write isolated databases and
  secrets while both render localized names correctly.
- Base: only the formal build is installed and every namespace comes from one
  identity owner.
- Bad: use `矩阵引擎` in a database path, hardcode several secret prefixes, or
  rename the manifest ID when branding changes.

### 6. Tests Required

- Assert manifest ID/name/minimum/desktop flags and i18n Chinese display.
- Assert namespace builders are deterministic and formal/test IDs are disjoint.
- Install both builds in a disposable vault and prove settings, secrets,
  databases, diagnostics, and artifacts do not cross-read or overwrite.
- Re-run the Community registry conflict check before submission.

### 7. Wrong versus Correct

Wrong: derive storage from a display name or reuse the formal ID for Spike
tests. Correct: derive every persisted namespace from the single immutable
build identity and keep localized names presentation-only.

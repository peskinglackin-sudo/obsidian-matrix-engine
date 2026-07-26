# Cross-Layer Data Flow

Use this guide whenever data crosses three or more of these boundaries:

```text
Vault -> extraction/language analysis -> diff/hash planning
      -> provider and/or storage -> retrieval/fusion/hydration
      -> view/preview/diagnostics
```

## Map the flow first

For every boundary, record:

- input/output type and owner;
- raw, normalized, derived, secret, or remote classification;
- validation and error translation point;
- cancellation and request/source generation;
- persistence and artifact-fingerprint effect;
- safe diagnostic fields and user-visible degradation;
- unit/integration/golden-vault evidence.

## Project-specific invariants

- The vault is the source of truth; LanceDB is a rebuildable cache.
- Raw text survives normalization and is used for exact verification/display.
- `QueryParser` emits an AST, not database SQL; filters compile with binding.
- Provider capability probes determine behavior; optional endpoints and
  advanced indexes always have a correct fallback.
- Revision plus generation protects writes; request generation protects UI.
- Remote requests show destination and rendered-content preview, while secrets
  stay in SecretStorage and content stays out of normal diagnostics.
- Auto/degraded search reports the mode actually executed.
- View code consumes typed results and never owns table/provider contracts.

## High-risk flows

### Configuration to artifact

Trace a changed field through validation, migration, fingerprint planning,
rebuild-impact preview, artifact selection/build, status, and diagnostics.
Connection/query/UI changes must not accidentally trigger re-embedding; changes
to vector space, final document rendering, extraction, analyzer, or schema must
not accidentally reuse an incompatible artifact.

### Vault event to committed rows

Trace event coalescing, read, extraction, language analysis, hashes, embedding,
write gate, commit, manifest, stale cleanup, and UI status. Test rename and
rapid modifications with deliberately out-of-order completion.

### Query to visible result

Trace parse, metadata filter, exact/lexical/vector candidates, raw exact
verification, fusion, aggregation, diversification, optional rerank, hydration,
safe preview, and open/jump behavior. Preserve score kind and match reasons.

### Failure to degradation

Trace provider/native/index failure through adapter error translation, retry or
dead-letter decision, cancellation, fallback mode, diagnostic record, and
localized actionable UI. Assert that usable modes remain available.

## Review test

Mentally remove the feature under test: if the test still passes, it does not
prove the cross-layer behavior. A valid test observes the contract at the far
side of the boundary—for example, an old generation cannot change committed
rows or visible results, rather than only asserting that `abort()` was called.

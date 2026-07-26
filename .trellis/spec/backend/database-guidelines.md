# Storage and Indexing

The storage contract is defined by `prd.md` sections 11.1 and 13–14. LanceDB
is a replaceable implementation detail and the index is a rebuildable cache;
the Obsidian vault is the sole source of truth.

## Data ownership

- The shared source catalog owns model-independent file identity and metadata.
- Each index artifact owns a chunk table and manifest tied to its corpus,
  lexical, embedding-space, and schema fingerprints.
- Retrieval settings such as query template, limits, fusion weights, filters,
  timeouts, and UI settings do not invalidate an artifact. Follow the exact
  include/exclude lists in `prd.md` section 12.8.
- Preserve both raw and normalized fields. Raw text is required for display
  and final exact verification; normalized/derived terms are retrieval inputs.

## Identity and revisions

- Generate and persist `source_id` as a UUID on first observation. Never derive
  it from a path.
- Derive `row_id` from artifact ID, source ID, structural anchor, and chunk
  ordinal as specified in `prd.md` section 13.4.
- Preserve `source_id` across a normal rename. For uncertain offline renames,
  prefer a new source over an unsafe merge.
- Gate every commit with both source revision and latest-wins generation. A
  completed old embedding request must not overwrite a newer edit.

## Write protocol

Rename/update writes use commit-then-cleanup:

1. Create the new source revision.
2. Write or update rows for that revision.
3. Commit and record the write result/version.
4. Mark the old revision stale.
5. Clean stale rows asynchronously.

Never delete the old path before the replacement revision commits. Keep the
write lane single-writer or strictly bounded, and keep control operations
(delete, rename, pause, cancel) ahead of background maintenance.

## Hash-driven work

Own the layered hashes as one contract:

- raw content change: parse again;
- extraction change: chunk again;
- lexical input change: update lexical fields/indexes;
- final rendered embedding input change: embed again;
- metadata projection only: update metadata/scalar fields only.

`embeddingInputHash` is computed from the fully rendered document template,
not from raw content alone. Changes to renderer/tokenizer/extraction/analyzer
versions must have explicit fingerprint consequences.

## Queries and indexes

- Compile structured filter AST nodes with binding/escaping. Never concatenate
  user strings into SQL predicates.
- Exact search may use FTS, ngram, FM, scalar, or a bounded scan for candidates,
  but it must verify against raw source fields before returning a hit.
- Capability-gate FTS tokenizers and scalar/FM/LABEL_LIST indexes. Every
  advanced index needs a correct slower fallback.
- Use flat vector search for small indexes. Enable ANN only after the benchmark
  in `prd.md` section 22.4 meets the Recall gate.
- Select only fields needed for the current phase and hydrate full preview
  content lazily.

## Schema changes and recovery

No production migration implementation exists yet. Until a release policy is
established, schema version changes build a new artifact rather than performing
an opaque in-place rewrite. Database corruption, capability incompatibility,
or irreconcilable directory conflicts must stop writes and offer a rebuild.

Validate schema work with create/upsert/merge/delete/search, rename atomicity,
manifest/row consistency scans, rebuild, non-ASCII paths, plugin reload, and
upgrade cases from `prd.md` sections 22.2 and 22.6.

## Scenario: generation-safe artifact write

### 1. Scope / trigger

Apply this contract to every create, modify, rename, delete, reconciliation, or
rebuild operation that can change source/chunk rows or the artifact manifest.

### 2. Signatures

The domain write boundary must carry `artifactId`, `sourceId`,
`sourceRevision`, and `generation` in its input and return a typed write result
or typed rejection. The storage adapter implements the `upsert` and
`deleteBySourceRevision` operations defined in `prd.md` section 11.1; it must
not infer current generation from a path.

### 3. Contracts

- Accept only work for the current artifact, source revision, and generation.
- Commit replacement rows before making the old revision eligible for cleanup.
- Record the write result/version, then update manifest `indexed_revision` and
  status as one logical operation.
- Cancellation or a stale generation produces no committed rows and does not
  advance the manifest.

### 4. Validation and error matrix

| Condition | Required result |
|---|---|
| Generation is older than current | Reject as stale; do not retry or commit |
| Revision does not match planned source | Reject as conflict; re-plan source |
| Operation is cancelled before commit | Abort with no manifest advance |
| Batch/provider item is permanently invalid | Redacted dead letter; other items continue |
| Transient DB/provider failure | Bounded retry when classified retryable |
| Commit succeeds but cleanup fails | Keep new revision; report/schedule stale cleanup |

### 5. Good, base, and bad cases

- Good: generations 14–16 finish out of order; only generation 16 commits and
  the manifest points to its revision.
- Base: one create writes rows and manifest once, with no stale cleanup needed.
- Bad: a rename deletes the old path first, or generation 14 advances the
  manifest after generation 16 has already committed.

### 6. Tests required

- Control completion order with deferred promises and assert only the latest
  generation changes rows and manifest.
- Inject failure before commit, after commit, and during cleanup; assert the
  exact rows, manifest revision/status, retryability, and diagnostics.
- Cover rename with non-ASCII paths and plugin cancellation/unload.
- Run a manifest-versus-chunk consistency scan after each case.

### 7. Wrong versus correct

Wrong: `delete(oldPath) -> await embed() -> insert(newPath)`, with identity and
freshness inferred from the path. Correct: plan against stable `sourceId`,
write a generation/revision-tagged replacement, verify freshness immediately
before commit, advance the manifest, then asynchronously clean the old
revision.

## Avoid

- Treating LanceDB tables as irreplaceable user data.
- Using path-derived IDs.
- Mixing connection settings into vector-space identity.
- Updating embeddings because only a query template or UI limit changed.
- Enabling an index because the SDK type exposes it without a runtime probe.
- Synchronizing the LanceDB directory across devices without the lock and
  conflict behavior required by `prd.md` section 21.3.

## Spike 0 measured decisions

- `spike/fts/cli.ts` proved whitespace, ngram, positions/phrase, array field,
  add/update/delete, and optimize on the current Node precheck, but its fuzzy
  query did not meet the required behavior. Production keeps a separate
  replaceable `LexicalStore`; LanceDB is not the lexical owner.
- `spike/lexical/analyzer.ts`, `fixtures.ts`, `store.ts`, and `metrics.ts`
  preserve raw/normalized/derived representations and gate 14 groups
  independently. Category queries must depend on their intended source
  representation; `tests/lexical-fixtures.test.ts` asserts this explicitly.
- The fixed 50k benchmark in `spike/ann/runner.ts` found ANN faster but far
  below the recall-tail gates. MVP defaults to flat vector search.
- Manual LanceDB bundles remain runtime experiments. Since the native layout
  lacks official Community install/update acceptance, production LanceDB
  packaging is `no-go`; replace `VectorStore` before MVP freeze unless written
  acceptance changes that evidence.

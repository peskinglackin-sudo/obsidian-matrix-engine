# Matrix Engine MVP architecture

Status: MVP implementation of `prd.md` v2.0, built on the recorded Spike 0
decisions. This document maps the delivered code to the PRD contract and
records what remains open.

## Spike 0 decisions honored

| Spike decision | Consequence in this MVP |
|---|---|
| LanceDB Community packaging: no-go | `VectorStore`/`LexicalStore` are implemented by the pure-TypeScript `LocalArtifactStore` (`src/storage/local-store.ts`); no native binaries ship. The contracts in `src/storage/contracts.ts` keep the backend replaceable if a native backend later passes its distribution gate. |
| LanceDB FTS fuzzy gate failed | Lexical search is plugin-side: analyzer-generated terms feed field-scoped BM25 inverted indexes (`src/storage/bm25.ts`). |
| ANN failed recall gates | Vector search is flat (exact scan) over Float32 embeddings; ANN is deferred to P1 behind the same `VectorStore` contract. |
| Real-device gates still open | Platform runner and GPU runner evidence flows from Spike 0 remain in `src/probe/` and `spike/`, unchanged. |

## Module map (PRD section 11)

| PRD component | Implementation |
|---|---|
| SettingsStore | `src/settings/` — zod schemas (12.x), defaults (24), fingerprints (12.8), versioned load, store with validated updates |
| SecretStore | Obsidian SecretStorage via `MatrixEngineController` (`src/app/controller.ts`); only `secretRef` persists in settings |
| CancellationRegistry / Diagnostics | `src/core/lifecycle.ts`, `SafeError` (`src/core/errors.ts`), redacted diagnostics export on the controller |
| VaultEventCoalescer | `src/pipeline/coalescer.ts` — debounce, latest-wins generations, rename chains (14.2/14.3) |
| MarkdownExtractor / SemanticBlockParser | `src/indexing/extractor.ts`, `src/indexing/chunker.ts` (FR-003/004) |
| LanguageAnalysisService | `src/analysis/` — scripts, segmentation, multilingual analyzer, identifier/path analysis (8.x) |
| IndexDiffPlanner | raw-hash skip + metadata-only touch + per-row embedding carry-over in `src/pipeline/coordinator.ts` (14.4) |
| EmbeddingBatcher | `src/providers/batcher.ts` — item/token/byte limits, bisect on over-limit, dead letters (14.6) |
| IndexWriter | single-writer `IndexCoordinator.commit` path with revision guards (14.3/14.5) |
| MaintenanceScheduler | debounced persistence + optimize bookkeeping in the coordinator/store (14.7, simplified for the JSON backend) |
| ProviderRegistry / providers | `src/providers/http-embedding.ts` (FR-040/041), probe (17.4), retry (14.6), factory |
| RerankProvider | reserved, disabled (`src/providers/rerank.ts`, FR-042) |
| VectorStore / LexicalStore / repositories | `src/storage/` |
| QueryParser / QueryPlanner | `src/query/parser.ts`, `src/query/planner.ts` (9.x, 7.5) |
| Retrievers / Fusion / Aggregation / Hydrator | `src/retrieval/` (15.x) |
| ConnectionsService / feedback | `src/connections/` (16, FR-020/021/022) |
| LookupView / ConnectionsView / Settings / I18nService | `src/ui/`, `src/i18n/` (18/19, zh-CN + en) |

## Retrieval pipeline

```
parseQuery -> planQuery(auto/degradation) -> compileFilters(RowFilter)
  -> ExactRetriever (raw verification, offsets, line ranges)
  -> LexicalRetriever (BM25 over title/aliases/headings/tags/filename/path/body/identifier/ngram)
  -> VectorRetriever (query template -> provider embed -> flat search)
  -> RRF fusion (k=60, weights 1.4/1.0/1.0)
  -> source aggregation (max | top_mean) / diversity (maxResultsPerSource)
  -> hydrate (reasons, snippets, highlight ranges)
```

Timings report `query_embed_ms` separately from database stages (5.3/20.5).
Every degradation appears in the response and the Lookup UI (FR-011).

## Data model

Rows follow PRD section 13 (source catalog / chunk table / manifest) with
stable `source_id` (UUID, never path-derived) and
`row_id = hash(artifact + source + structural_anchor + ordinal)`.
Artifacts persist as JSON (embeddings base64) under the plugin directory;
a corrupt or fingerprint-mismatched artifact is rebuilt from the vault, never
trusted (12.8/20.2). Renames keep the source ID and rewrite path projections
without delete-first (13.4/14.5).

## Deliberate MVP simplifications

- Storage is in-memory with debounced JSON persistence — adequate for the
  MVP scale target and rebuildable by definition; the storage contract is
  the migration point for a P1 on-disk backend.
- Maintenance is persistence + bookkeeping; there is no fragment compaction
  because the JSON backend rewrites whole artifacts.
- Hover uses in-card safe plain-text expansion instead of the native hover
  popover; result snippets never render third-party Markdown (18.4).
- The Lookup filter row is the query syntax itself (folder:/tag:/ext:/
  before:/after:) rather than separate widgets.

## Known open items (beyond MVP code)

- Golden-vault retrieval-quality benchmarks (5.2/22.3) and the ANN recall
  harness remain spike-side; they gate release, not this implementation.
- Real-device packaged-plugin runs (22.6) stay external evidence gates.
- P1 scope (ego graph, full query AST, ANN policy, dashboards) untouched.
- Community submission requires the separate publication checklist in
  `prd.md` 23.5; nothing here publishes anything.

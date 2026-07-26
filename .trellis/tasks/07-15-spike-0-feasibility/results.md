# Spike 0 implementation results

## Decisions

| Area | Result | Evidence / consequence |
|---|---|---|
| Private package baseline | pass | frozen pnpm install, typecheck, lint, tests, build |
| Manual LanceDB bundles | precheck pass | three targets × upgrade versions `0.0.0`/`0.0.1`, one sidecar each, SHA-256 verified |
| Real Obsidian runtime | unverified | machine-producing plugin/operator runner complete; six trusted device/version cells still required |
| Community distribution | no-go | no official/written acceptance; replace `VectorStore` before MVP |
| LanceDB FTS | vector-only candidate | fuzzy gate failed; separate replaceable `LexicalStore` required |
| Reference lexical quality | pass | 14 groups, 420 gating + 60 diagnostics, fixture SHA-256 `8462eee13ddc533c74b035e2906403ddfdfde3a95d69d2a5f59cfad1c04dd3c9` |
| Provider protocol | pass | deterministic local server/error/cancel/redaction coverage |
| Live remote provider | pass | configured endpoint + `text-embedding-3-small` on 2026-07-15 only |
| Local GPU provider | unverified | pinned build/process/backend runner complete; exact model and three trusted GPU cells still required |
| Semantic quality | unverified | scoreable 12-language/6-direction fixture and GPU/CPU workload runner built; no pinned-model device result sets |
| ANN | flat default | all tested ANN configurations failed recall/tail gates |

## ANN scoped result

The fixed 50,000 × 768, 500-query WSL host run used cosine distance, flat
index bypass, a default-parameter cosine IVF-PQ candidate, and two explicit
IVF-PQ configurations. Flat p95 was about 46.93 ms. ANN p95 was about
6.24–18.73 ms, build time was about 32.9–39.5 seconds, reopen time was about
0.51–1.05 ms, and measured index growth was about 3.48–4.23 MB. Aggregate
Recall@10 was only about 0.21–0.32 and minimum per-query Recall@10 was 0.10.
Latency gains cannot override the approved recall gates, so MVP uses flat
search and defers ANN. Flat and every ANN configuration used one cold
preflight, two warmups, and ten timed repetitions against the same 500 queries.

## Open external gates

- Windows x64, macOS arm64, and native Linux x64 glibc in Obsidian 1.11.4 and
  test-time stable: six complete hash-bound runner reports.
- Windows/Linux Vulkan and macOS Metal against the exact pinned model/runtime:
  three complete GPU/offload/parity reports.
- Written Obsidian distribution-owner acceptance would be required to reverse
  the present LanceDB Community packaging no-go.

Missing evidence remains `unverified`; it is not a partial pass.

## External evidence runner implementation

- `src/probe/platform-probe.ts` now produces real Obsidian checkpoints bound
  to the exact bundle content hash and packaged `main.js` hash. It performs
  SecretStorage set/get/list with restore behavior, verified native loading,
  CRUD/vector/path smoke, stable reopen/FTS/repeated cleanup, and controlled
  cleanup failure injection.
- Reload evidence uses one UUID per plugin/controller load. Repeated command
  clicks within one load cannot satisfy the stable reload gate. Finalization
  independently requires phase `complete`, two distinct loads, both verified
  artifact versions, and destroyed disposable profile plus vault.
- Preparation now requires the disposable vault and profile to exist, binds
  their normalized-path hashes without recording raw paths, rejects dirty
  initial state, and enforces `initial -> reloaded -> upgraded -> complete`
  with prior passing checkpoints. Finalization rejects a different nonexistent
  path; simple absence is not accepted as proof that the bound path was
  destroyed.
- The pinned llama.cpp wrappers require a clean exact source commit and record
  Release backend flags, compiler/CMake versions, binary version/revision, and
  binary SHA-256. The runner reads Vulkan/Metal metadata itself, requires an
  explicit listed device, parses exact full GPU offload, and tests batch/order,
  768 finite normalized dimensions, repeat cosine `>= 0.99999`, cancellation,
  timeout, invalid/empty/oversize input, confirmed SIGTERM shutdown, and
  GPU/CPU cosine `>= 0.999`.
- The same pinned GPU/CPU server lifecycles now run the complete semantic
  workload. The Apache-2.0 schema-v2 fixture contains 140 real target
  documents, 480 adjacent distractors, 120 same-language queries, 90
  cross-language queries, 420 query-prefix controls, and 1,240 document-prefix
  controls. Every expected target exists. Fixture SHA-256 is
  `c638678512894a7043da0d781246e344ce7fb3e78651f7328de2c5eee554d004`;
  recipe SHA-256 is
  `9c50ae51eb38c50c97827270ed3e64246c15be825123e1bec3b9ee77d436050f`.
- Final safe reports strict-parse every source and apply an allowlist
  projection. They omit semantic text/vectors, query-level ANN rows, complete
  package lists, raw logs, and arbitrary source fields.
- Safe GPU output omits model/binary paths, raw device identifiers, vectors,
  inputs, and raw logs. Operator procedures are in `docs/platform-runner.md`
  and `docs/local-gpu-runner.md`.

Local verification on 2026-07-16 passed `git diff --check`, typecheck, lint,
63 tests, production build, and all six manual bundle variants (three targets
times two plugin versions). These are prechecks only and do not change either
external gate from `unverified`.

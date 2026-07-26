# Spike 0 Architecture Feasibility

## Goal

Produce reproducible evidence for every architecture-blocking assumption in the Matrix Engine parent program and root PRD, then make explicit packaging, storage, lexical, provider, model-capability, and ANN go/no-go decisions before MVP architecture is frozen.

This child owns Spike 0 only. Negative findings are valid deliverables when evidence-backed; they must not be hidden by an unapproved workaround.

## Background and Confirmed Facts

### Product and repository state

- Parent program: [`../07-15-smart-lookup-enhanced/prd.md`](../07-15-smart-lookup-enhanced/prd.md). Its creation-time Trellis slug is historical metadata, not the product ID.
- Authoritative product contract: [`../../../prd.md`](../../../prd.md), especially sections 5, 6.1, 8.5, 14.6, 17.4, 22, 23, 26, and 27.1.
- The repository began with no product package, source tree, entry point, or product tests. The current execution host is Ubuntu 26.04 x64 under WSL2 with Node 22.22.1 and pnpm 11.1.3; it has no directly runnable Obsidian or exposed real GPU.
- Current development is private on the existing Gitea remote. Creating/configuring/pushing a public GitHub repository or submitting to Community is not authorized in this task.
- `.envrc` is tracked, appears in Git history, and has an uncommitted user change. Its contents have not been read during planning and must remain unprinted and locally preserved.

### Fixed product identity and compatibility

| Contract | Approved value |
|---|---|
| Formal plugin ID | `matrix-engine` |
| English name | `Matrix Engine` |
| Chinese name | `矩阵引擎` |
| Isolated test ID | `matrix-engine-spike` or another explicit non-formal ID |
| Private-development author | `Opus` |
| `authorUrl` / `fundingUrl` | absent during private development |
| Minimum Obsidian | `1.11.4` |
| Desktop only | `true` |
| Supported initial platforms | Windows x64, macOS arm64, Linux x64 glibc |
| Unsupported initial platforms | macOS Intel/x64, Windows ARM64 |
| Original source/fixture license | Apache-2.0 |

- Community registry inspection on 2026-07-15 found no exact `matrix-engine` / `Matrix Engine` conflict (registry ETag `c625bde046f757876f9f5e794d0e4d7de0044d0ea2c3e4e125b9d3489a04c116`); first public submission must recheck.
- Direct `obsidian@1.11.4` and `1.13.1` type inspection confirms synchronous `SecretStorage.setSecret(id, string)`, `getSecret(id)`, and `listSecrets()`. IDs permit lowercase alphanumerics plus dashes. There is no documented delete API; empty-string deletion semantics must not be invented.

### Storage and distribution evidence

- The selected stable backend candidate is `@lancedb/lancedb@0.31.0`; preview/beta and cross-version native mixing are excluded.
- `0.31.0` publishes native artifacts for Windows x64/ARM64, macOS arm64, and Linux x64/ARM64 but not macOS x64. The older `0.22.3` macOS x64 path was explicitly rejected, so macOS Intel support was dropped.
- Target native sidecars are approximately 174 MB (Windows x64), 162 MB (Linux x64 glibc), and 117 MB (macOS arm64), about 452 MB total uncompressed. `NAPI_RS_NATIVE_LIBRARY_PATH` can locate one controlled sidecar but does not solve distribution.
- Obsidian's standard Community release guidance identifies top-level `main.js`, `manifest.json`, and optional `styles.css`; it does not document platform-specific `.node`/`node_modules` installation. Policy forbids a plugin self-update mechanism and requires network/out-of-vault disclosures.
- Official Community one-click installation and standard updates remain an MVP hard requirement. Manual platform bundles can prove runtime feasibility but cannot prove Community distributability. Lack of official documentation or written channel-owner acceptance for the exact sidecar layout is LanceDB packaging no-go and triggers `VectorStore` replacement planning before MVP.

### Provider and model evidence

| Input | Fixed value |
|---|---|
| Local model | `jina-embeddings-v5-text-nano-retrieval-Q8_0.gguf` |
| Model size | 232,883,776 bytes |
| Model SHA-256 | `86b6e6279e9b9e71389f02a082764a2ac2b15a50e37482c26f98d69092f12442` |
| Model repository commit | `59cfaceeeb7d738c404659435af4c0da74d06c96` |
| Architecture / dimension / context | EuroBERT / 768 / 8192 |
| Pooling / quantization | last-token / Q8_0 |
| Tokenizer preset | `jina-v5-nano` |
| Retrieval recipe | `Query: {query}` / `Document: {document}` |
| Model license/scope | CC-BY-NC-4.0; user-supplied non-commercial Spike fixture only |
| llama.cpp | tag `b10018`, commit `22b208b1cacb67bae191b00d795dae7cc819edb8` |
| Live remote model | `text-embedding-3-small` |
| Live remote environment | `OPENAI_BASE_URL` ending `/v1`; `OPENAI_KEY` |

- The local file exactly matches the official Jina LFS object and its GGUF header. It must not be bundled, downloaded, or made a production default.
- The pinned upstream llama.cpp revision contains EuroBERT, last pooling, `/v1/embeddings`, string-array batch tests, and Vulkan/Metal build paths; no Jina fork is required for this text model.
- `OPENAI_BASE_URL` and `OPENAI_KEY` are present but have not been printed, persisted, or used during planning.

## Requirements

### S0-R01 — Reproducible private Spike package

- Establish the smallest TypeScript Obsidian Desktop plugin and separate experiment harness needed for load/unload, native lifecycle, capability, quality, and benchmark evidence.
- Formal artifacts use `matrix-engine`, `Matrix Engine`, `Opus`, `minAppVersion: "1.11.4"`, and `isDesktopOnly: true`; Chinese display is i18n-only.
- One identity owner derives settings, SecretStorage, database, diagnostics, and artifact namespaces. Translated names and the Trellis slug never enter persistent identity.
- Parallel tests use an isolated ID plus disposable vault/database/profile and cannot access formal settings, secrets, databases, diagnostics, or artifacts.
- Provide deterministic locked install, type-check, lint, test, build, per-target package, artifact verification, and report commands.
- Compile-time use of current Obsidian types is not minimum-runtime evidence. APIs newer than `1.11.4` require a correct capability-gated fallback or a reviewed minimum-version increase.

### S0-R02 — Stable LanceDB native/runtime and Community packaging decision

- Pin one exact `@lancedb/lancedb@0.31.0` JS/native/Arrow artifact set. Never mix versions, silently select per-platform versions, use preview/beta, Rosetta, the old macOS x64 artifact, or cross-architecture binaries.
- Create one manual test bundle per supported platform containing exactly one target sidecar, a cryptographic artifact manifest, and required notices.
- Exercise database create/open/write/query/reopen/close plus paths containing spaces, Simplified Chinese, Japanese, and emoji.
- Apply a strict two-version real-device gate to Windows x64, macOS arm64, and native Linux x64 glibc:
  - Obsidian `1.11.4`: install/load, SecretStorage set/get/list, native load, CRUD/query/close, paths, resource cleanup;
  - test-time current stable: the same plus enable, disable, reload, prior-artifact upgrade, reopen, FTS/vector smoke, repeated cleanup, and full runtime metadata.
- SecretStorage tests run in disposable profiles. Snapshot and restore an existing isolated test value. If none existed, report the lack of deletion API and destroy the disposable profile; never claim deletion or use an empty-string workaround.
- A self-contained runner captures OS/arch/libc, Obsidian/Electron/Node ABI, dependency versions, hashes, durations, safe errors, and cleanup. It classifies `pass`, `fail`, `unverified`, or `environment_error`; external operators do not judge results.
- CI, cross-compilation, WSL, Node-only loading, mocks, and static inspection are prechecks only. Missing real app/device evidence remains `unverified`, never pass.
- Reports bind the exact plugin/runner hash and exclude vault content, credentials, usernames, and unnecessary absolute paths.
- Manual runtime pass and Community distribution are separate decisions. Require official documentation or written distribution-owner acceptance for the exact native sidecar install/update path. Without it, record packaging no-go and trigger pre-MVP `VectorStore` replacement.
- Do not implement first-run native download/extraction as an implicit workaround. It would require a separate product decision, signed manifest/integrity design, atomic install/rollback, offline/proxy behavior, disclosure, and channel acceptance.

### S0-R03 — TypeScript FTS capability probe

- Through the lockfile-selected SDK, probe runtime semantics—not only exposed types—for `whitespace`, `ngram`, positions/phrase, fuzzy, and array fields.
- Verify create, add/update, delete/cleanup, rebuild, optimize/maintenance, unindexed-row behavior, search correctness, and typed unsupported-capability errors.
- Produce an explicit decision: LanceDB may implement both stores; LanceDB is vector-only with a separate replaceable `LexicalStore`; or lexical architecture is no-go pending further research.

### S0-R04 — Multilingual lexical prototype and golden corpus

- Preserve separate raw, normalized, and derived representations. The versioned analyzer owns NFKC, case/whitespace handling, secondary accent folding, `Intl.Segmenter`, script-aware ngrams, and identifier terms; its ID/version and derived-field policy enter fingerprints.
- Build Apache-2.0 synthetic manifests covering 14 groups: zh-Hans, zh-Hant, en, ja, ko, es, fr, de, ru, ar, hi, th, Chinese/English mixed, and natural language/code identifiers.
- Each group has at least 30 gating positives across six categories (at least five each): body term/concept; title/heading/key field; phrase/order; applicable normalization equivalent; path/tag/abbreviation/metadata; highest-risk segmentation. Each group covers at least ten distinct targets.
- Add at least 60 shared non-gating diagnostics for identifier splitting, long-note competition, negation, filters, absent targets, misspellings, short/high-frequency terms, distractors, and raw-verification false positives.
- Every query has stable ID, group, category, expected targets, and gating flag. Corpus/query manifests use SHA-256 and remain identical across LanceDB and alternate-store comparison. Inapplicable categories may be replaced by a documented high-risk category without reducing counts.
- Each group independently requires gating Recall@10 = 1.00, zero-result rate = 0, and MRR@10 >= 0.80. Aggregate scores cannot hide failure. Diagnostic queries report false-positive/filter correctness separately; misspellings are non-gating P1 evidence.
- LanceDB failure cannot be hidden by changing answers/analyzer to suit it. If an alternate prototype passes, the decision is vector-only LanceDB plus separate production `LexicalStore`.

### S0-R05 — Provider interoperability, privacy, and mandatory stop behavior

- Maintain one project-owned cancellable `EmbeddingProvider` capability/result/error contract; raw provider/SDK errors never cross the boundary.
- A deterministic protocol server is mandatory and covers custom base URL/model/headers, indexes/order, dimensions, missing optional llama.cpp endpoints, malformed request/response, empty/oversize input, timeout/cancel/network close, 401/403/408/429 + `Retry-After`, 5xx, NaN/Inf, dimension mismatch, and duplicate/missing indexes.
- A live remote probe is independently mandatory. Use only `OPENAI_BASE_URL` and `OPENAI_KEY`; never read fallback variables. Validate an HTTP(S) URL ending exactly `/v1`; request `${OPENAI_BASE_URL}/embeddings` with model exactly `text-embedding-3-small` and short synthetic multilingual input.
- Stop before sending a key to non-loopback plaintext HTTP. Never print/persist the key, Authorization header, inputs, or raw response.
- On any live model, authentication, authorization, quota, rate-limit, protocol, network, timeout, vector, dimension, order, or other error: stop immediately, preserve only a redacted diagnostic, tell the user, and wait. Do not silently retry or change model, endpoint, dimensions, credential variable, or provider.
- A live result certifies only the named endpoint/interface/model/date combination, never all OpenAI-compatible services.
- The local probe pins the fixed Jina model and llama.cpp revision. Verify model size/hash/header before serving; on mismatch/load/pooling/dimension/runtime failure, stop and ask rather than substituting text-small, omni, another quantization, runtime, or model.
- Native GPU is mandatory: Windows/Linux build `GGML_VULKAN=ON` and require Vulkan 1.2+; macOS arm64 builds `GGML_METAL=ON` and uses native Metal, not MoltenVK certification.
- Run `--list-devices`, explicitly choose the expected device, set `--n-gpu-layers all`, and machine-require full `offloaded X/X layers to GPU`. Wrong/missing device/backend, partial/no offload, or `no usable GPU found` is failure; CPU cannot become a passing fallback.
- Under GPU, verify batch count/index/order, 768 finite dimensions, normalization tolerance, repeat tolerance, cancellation, timeout, invalid/empty/oversize classification, and clean shutdown.
- Run identical CPU-only numerical control; every GPU/CPU vector cosine similarity must be >= 0.999. Failure stops that platform probe and does not weaken the threshold.
- Record safe model/runtime/build/device metadata without the local model path. Jina prefixes belong only to an explicit model preset and affect embedding-space/input fingerprints.

### S0-R06 — Flat versus ANN benchmark and default policy

- Benchmark exactly 50,000 fixed-seed normalized 768d vectors and at least 500 SHA-256-bound fixed queries. Use identical query/top-k/filter/metric/data for all configurations and flat index bypass as ground truth.
- Compare flat, pinned-version default ANN, and explicit IVF-PQ parameter combinations. Record partitions/subvectors/bits, query probes/refinement, seed, hashes, hardware/runtime, and all other parameters.
- Per configuration, report one separate cold preflight, two unmeasured warmups, and ten timed repetitions.
- Report query-level Recall@10/20 distributions, latency p50/p95/p99, index size, build/open/first-query time, and environment. Synthetic-vector performance and the smaller real multilingual semantic sanity set are separate claims.
- ANN becomes the 50,000-vector MVP default only when all are true:
  - aggregate Recall@10 >= 0.95;
  - at least 99% of queries have Recall@10 >= 0.80;
  - no query has Recall@10 < 0.50;
  - warmed p95 beats flat by at least 30% and at least 10 ms;
  - both are under vector-stage p95 100 ms;
  - flat p95 is greater than 25 ms.
- Otherwise the valid decision is MVP flat default and ANN deferred to P1/larger-vault policy; insufficient evidence is never ANN pass.

### S0-R06a — Multilingual semantic sanity check

- Keep provider/protocol certification separate from model semantic-quality certification.
- Same-language set: at least 120 queries across zh-Hans, zh-Hant, en, ja, ko, es, fr, de, ru, ar, hi, th; each group has ten distinct concepts, differently worded relevant documents, and at least four topically adjacent distractors per concept.
- Each group independently requires Recall@5 >= 0.90, MRR@10 >= 0.75, and zero-result rate <= 0.10.
- Cross-language set: at least 15 queries in each direction of zh-Hans/en, ja/en, es/en, at least 90 total. Each direction independently requires Recall@10 >= 0.80; one direction cannot certify the reverse.
- Use stable IDs/targets/order and SHA-256 manifests identical across CPU and platform GPU. Correct `Query:`/`Document:` inputs are gating; removed/swapped-prefix runs are non-gating controls.
- Fixtures are authored/reviewed synthetic Apache-2.0 content; no translation API runs during tests.
- Report by language/direction/backend/model hash/runtime/recipe fingerprint. A pass is scoped only to those inputs. A semantic failure preserves protocol-compatible status but marks the affected capability failed/unverified and never substitutes a model.

### S0-R07 — Evidence and architecture decision report

- Generate allowlist-based, schema-versioned, hash-bound JSON as authoritative evidence plus JUnit, concise Markdown, and bounded redacted raw logs.
- Distinguish `pass`, `fail`, `unverified`, `environment_error`, and `unsupported`; distinguish code/product failure from missing environment or dependency/channel limitation.
- Produce evidence-linked decisions for Community packaging, per-platform runtime, `VectorStore`, `LexicalStore`, local/live provider scope, per-language model capability, and flat/ANN default.
- Map each decision to the independently verifiable MVP child tasks it enables or changes, then update the parent task. Do not pre-create the MVP map before evidence.

### S0-R08 — Privacy, licensing, private-repository safety, and cleanup

- Use only synthetic/redistributable fixtures and clean-room implementation. Reports/logs exclude secrets, full inputs/responses, unintended user content, usernames, and unnecessary paths.
- Original source and synthetic fixtures are Apache-2.0. Add `LICENSE` during implementation; produce required NOTICE/third-party notices without relicensing dependencies, models, or external assets.
- Inventory exact JS/native dependencies, sizes, licenses, and distribution obligations.
- Jina nano remains a user-supplied CC-BY-NC-4.0 non-commercial Spike fixture. Never bundle/download/default-recommend it. Any evaluated-model record includes license, exact hashes/revisions, and certification scope.
- Before the first private task commit, preserve the working `.envrc` while removing it from future tracking, ignoring it, and adding a value-free example. Never print, stage, overwrite, delete, report, or package the user's file/value.
- No private commit or generated artifact may contain a secret. Full-history publication audit, rotation of any historically committed credential, public GitHub setup, final public author/support metadata, and public push remain mandatory but deferred to a separately authorized first-public-release phase.
- Every plugin/test run owns and closes listeners, timers, requests, subprocesses, database handles, and temp resources. Cleanup failure is reported and isolated; no test uses a real user vault.

## Acceptance Criteria

- [ ] S0-AC01 — A clean checkout can run the documented frozen install, type-check, lint, test, build, per-target package, artifact verification, and safe report commands.
- [ ] S0-AC01a — Formal/test manifests and i18n match approved identity, author, desktop/minimum fields; deterministic namespace tests and disposable dual-install tests prove formal/test isolation.
- [ ] S0-AC02 — Windows x64, macOS arm64, and native Linux x64 glibc each return `pass` for both real Obsidian `1.11.4` minimum and test-time-stable full lifecycle cells against the exact `0.31.0` artifact. Unsupported platforms cannot produce pass.
- [ ] S0-AC02a — The external runner emits hash-bound JSON and redacted logs without subjective operator judgment or prohibited data.
- [x] S0-AC02b — Official documentation/written channel-owner acceptance proves Community install/update for the exact native layout; otherwise the final decision is LanceDB packaging no-go plus `VectorStore` replacement trigger, regardless of manual runtime results.
- [x] S0-AC03 — Runtime FTS evidence covers all required capabilities/lifecycle semantics and yields an explicit combined, vector-only, or lexical no-go decision.
- [x] S0-AC04 — Lexical manifests contain at least 420 gating positives and 60 diagnostics with required distribution/targets/hashes; every group independently achieves Recall@10 1.00, zero-result 0, and MRR@10 >= 0.80; diagnostics report their appropriate measures.
- [ ] S0-AC05 — Deterministic protocol server, authorized live `text-embedding-3-small`, and pinned real llama.cpp/Jina pair each pass their separate batch/privacy/error gates. Windows/Linux Vulkan and macOS Metal prove full offload and GPU/CPU cosine >= 0.999.
- [x] S0-AC05a — Live remote execution uses only the approved variables/model/path and demonstrates mandatory stop/report behavior on any error without silent retry/substitution.
- [x] S0-AC06 — ANN evidence uses the approved 50,000/500/cold/warmup/repetition protocol and applies every recall-tail/dual-latency/flat-fast threshold exactly to decide flat, ANN, or insufficient.
- [ ] S0-AC06a — Semantic manifests meet the approved 120 same-language/90 cross-language minimums; verification is computed independently per group/direction with prefix controls and scoped partial-failure reporting.
- [ ] S0-AC07 — Final reports make all architecture decisions, map every unmet external cell to a non-pass status, and update the parent with the evidence-shaped MVP child-task map.
- [ ] S0-AC08 — Unload/test completion proves no plugin-owned listener, request, subprocess, database handle, test profile, or temp resource remains unintentionally active.
- [x] S0-AC09 — Repository/package/report license and privacy audit passes: Apache-2.0/third-party notices are correct; Jina is absent from artifacts; no credential or prohibited content/path is present.
- [x] S0-AC09a — Before the first private task commit, `.envrc` remains locally available but is untracked/ignored; a value-free example exists and private commits/build outputs contain no secret.
- [ ] S0-AC10 — The parent task records final decisions and independently verifiable MVP child tasks with explicit prerequisites.

## Out of Scope and Deferred Gates

- Production Exact, Lexical, Semantic, Hybrid, Auto, vault indexing/migrations, Lookup, Connections, Graph, Settings, release UI, P1, and P2.
- Shipping a production plugin merely because a Spike experiment passes.
- Runtime native-binary downloader implementation.
- macOS Intel/x64 and Windows ARM64 certification.
- Public GitHub creation/configuration/push, Community submission, final public author/support/funding metadata, and public release artifacts.
- The future public-release phase must, before any public push, scan the full Git history and release artifacts, remove secret-bearing config from public history as appropriate, rotate every exposed credential, recheck the Community ID/name, establish canonical GitHub with same-commit Gitea mirroring, and bind release artifacts to source commit/SHA-256.

## External Completion Gates

The implementation can progress independently, but Spike 0 cannot be closed without:

- six real Obsidian platform/version reports (three platforms × `1.11.4` and current stable);
- three platform-native GPU reports (Windows Vulkan, Linux Vulkan, macOS Metal);
- an authorized live remote result using the approved environment contract;
- official documentation or written Obsidian distribution-owner acceptance for the exact native sidecar Community install/update path, or a recorded packaging no-go with backend-replacement consequence.

Missing evidence remains `unverified`; it does not justify weakening the contract or inventing a pass.

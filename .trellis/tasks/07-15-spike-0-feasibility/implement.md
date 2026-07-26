# Spike 0 Implementation Plan

## 1. Execution Rules

- Implement inline in the primary session; do not dispatch implementation/check agents.
- Load `trellis-before-dev` and all relevant backend/frontend/shared specs before editing product code.
- Do not run `task.py start` until the user approves the converged `prd.md`, `design.md`, and this plan.
- Do not read, print, stage, overwrite, or delete the user's current `.envrc`.
- Do not create public GitHub resources, public remotes, public pushes, releases, or Community submissions in this task.
- Do not call the live remote embeddings endpoint until the adapter, deterministic protocol tests, redaction tests, and preflight validation all pass.
- On any live `text-embedding-3-small` error, stop the live probe and report to the user before retrying or changing anything.
- Treat missing external devices/app versions/channel confirmation as `unverified`; continue independent work, but do not mark Spike 0 complete.
- Generated binaries, models, databases, reports containing raw logs, and private config remain ignored and uncommitted unless a reviewed safe report is explicitly selected.

## 2. Ordered Implementation Checklist

### Phase A — Private-repository safety and package baseline

- [x] Record pre-edit Git status and preserve unrelated/user changes.
- [x] Remove `.envrc` from future Git tracking without deleting the local working file; add `.envrc` to ignore rules.
- [x] Add `.envrc.example` containing variable names/comments only, with no endpoint/key values.
- [x] Verify `.envrc` cannot be staged by default and does not enter build contexts/reports.
- [x] Add Apache-2.0 `LICENSE` and initial third-party notice structure.
- [x] Create `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `esbuild.config.mjs`, `manifest.json`, and `versions.json`.
- [x] Pin `@lancedb/lancedb@0.31.0`, compatible `apache-arrow`, Obsidian API types, TypeScript, esbuild, Vitest, Zod, and only the additional packages proven necessary by Spike code.
- [x] Set formal manifest fields: ID `matrix-engine`, name `Matrix Engine`, author `Opus`, version `0.0.1`, `minAppVersion: "1.11.4"`, `isDesktopOnly: true`; omit author/funding URLs.
- [x] Add formal/test identity and deterministic namespace builders.
- [x] Add manifest/identity tests, including formal/test isolation and lowercase/dash-only SecretStorage IDs.
- [x] Establish exact scripts and update `.trellis/spec/backend/quality-guidelines.md` with commands after they exist.

Expected initial command surface after the manifest exists:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm package:spike --target <win32-x64|darwin-arm64|linux-x64-gnu>
pnpm verify:artifact --manifest <path>
pnpm spike:report --input <run-dir>
```

The exact names may be adjusted once implemented, but there must be one documented canonical command per action and no duplicate script owner.

Validation gate A:

```bash
git diff --check
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test -- --run
pnpm build
```

### Phase B — Evidence, redaction, and lifecycle foundations

- [x] Implement canonical `EvidenceEnvelope`, status/kind enums, safe error, safe environment, and schema version validation.
- [x] Implement allowlist-based JSON/JUnit/Markdown report writers.
- [x] Implement SHA-256 artifact/fixture/run binding and canonical serialization.
- [x] Implement bounded redacted raw-log capture.
- [x] Add adversarial tests for keys, Authorization headers, document/query text, absolute paths, nested errors, and arbitrary response objects.
- [x] Implement lifecycle registry for listeners, timers, AbortControllers, subprocesses, database handles, and temp resources.
- [x] Add controlled cleanup-order and failure-injection tests.
- [x] Add typed error translation and distinguish cancellation, timeout, environment error, unsupported, unverified, and code failure.

Validation gate B:

```bash
pnpm test -- --run evidence redaction lifecycle errors
pnpm typecheck
pnpm lint
```

### Phase C — Minimal Obsidian Spike plugin and manual native bundles

- [x] Implement minimal `Plugin` composition root and probe controller/view without production search UI.
- [x] Implement `1.11.4`-compatible synchronous SecretStorage probe: set/get/list, prior-value snapshot/restore, disposable-profile limitation reporting.
- [x] Implement LanceDB verified sidecar loader and safe load errors.
- [x] Implement create/open/add/query/close smoke and non-ASCII path cases.
- [x] Implement bundle assembler for exactly one target sidecar per artifact.
- [x] Include exact JS/native/Arrow runtime files and required license notices.
- [x] Generate `artifact-manifest.json` with target, versions, file sizes, SHA-256, source commit, build identity, and allowed runtime matrix.
- [x] Reject unsupported targets, version/hash mismatch, wrong libc, wrong architecture, multiple sidecars, arbitrary native paths, and formal/test namespace collisions.
- [x] Add Node-only bundle/load prechecks while labeling them non-authoritative for real-device support.

Risk/rollback point C:

- Keep native loading in one adapter. If manual load is infeasible, stop product-runtime expansion, preserve evidence, and record LanceDB runtime no-go.
- Manual bundles never become Community artifacts by implication.

Validation gate C:

```bash
pnpm test -- --run identity secret-storage native-loader bundle packaging-smoke
pnpm package:spike --target win32-x64
pnpm package:spike --target darwin-arm64
pnpm package:spike --target linux-x64-gnu
pnpm verify:artifact --manifest <each-artifact-manifest>
```

### Phase D — Real-device runner and version matrix

- [x] Implement Windows PowerShell, macOS shell, and Linux shell entry points around one state-machine/report contract.
- [x] Capture safe OS/arch/libc/Obsidian/Electron/Node ABI/dependency/artifact metadata.
- [x] Implement `1.11.4` minimum cell.
- [x] Implement test-time-current stable full lifecycle/upgrade cell.
- [x] Automate enable/disable/reload/upgrade checks where supported; provide deterministic in-plugin checkpoints where UI action is unavoidable.
- [x] Ensure external operator only initiates/returns results and does not assign pass/fail.
- [x] Assert supported/unsupported architecture behavior.
- [x] Add fixture-based tests for missing app version, wrong artifact, dirty disposable vault, failed cleanup, crash/reload, and incomplete report.
- [x] Produce operator instructions that contain no secrets and collect no user content.

External execution gate D:

- [ ] User/operator returns Windows x64 `1.11.4` and current-stable JSON/log evidence.
- [ ] User/operator returns macOS arm64 `1.11.4` and current-stable JSON/log evidence.
- [ ] User/operator returns native Linux x64 glibc `1.11.4` and current-stable JSON/log evidence.
- [ ] All six cells bind the exact artifact hash and are `pass`.

Do not block independent phases while waiting for reports, but do not close Spike 0 without them.

### Phase E — FTS capability and multilingual lexical prototype

- [x] Implement runtime probes for whitespace, ngram, positions/phrase, fuzzy, and array fields.
- [x] Cover create/add/update/delete/rebuild/optimize/unindexed behavior and safe unsupported errors.
- [x] Implement one versioned multilingual analyzer owner with raw/norm/terms/ngrams/identifier terms/scripts.
- [x] Build Apache-2.0 synthetic lexical corpus and query manifests: 14 groups, at least 420 gating positives, at least 60 diagnostics, required categories/targets.
- [x] Validate fixture schema, stable IDs, target references, category distribution, uniqueness, and SHA-256.
- [x] Implement Recall@10, MRR@10, zero-result, false-positive, and filter-correctness metrics.
- [x] Compare LanceDB-native FTS against any alternate replaceable lexical prototype using identical manifests.
- [x] Generate per-group evidence and explicit `combined`, `vector-only`, or lexical `no-go` decision.

Risk/rollback point E:

- Do not distort analyzer rules or expected targets merely to pass LanceDB.
- If an alternate store is required, keep the adapter boundary and decision report; do not start the production store implementation inside Spike 0.

Validation gate E:

```bash
pnpm test -- --run fts analyzer lexical-fixtures lexical-metrics
pnpm spike:fts
pnpm spike:lexical
pnpm spike:report --kind lexical_quality
```

### Phase F — Generic OpenAI-compatible provider and protocol server

- [x] Implement project-owned provider capability, batch result, and safe error types.
- [x] Implement cancellable OpenAI-compatible adapter without requiring llama.cpp-only endpoints.
- [x] Implement deterministic local protocol server for success and all approved failure cases.
- [x] Cover custom base URL/model/headers, batch indexes/order, dimensions, malformed payloads, missing optional endpoints, empty/oversize input, abort/timeout, 401/403/408/429/Retry-After/5xx/network close, NaN/Inf, dimension mismatch, duplicate/missing indexes.
- [x] Assert retryability classification without making the explicit live probe silently retry.
- [x] Prove redaction of key/Authorization/input/raw response.

Validation gate F:

```bash
pnpm test -- --run provider protocol-server provider-redaction provider-cancellation
```

### Phase G — Live `text-embedding-3-small` probe

Preconditions, all mandatory:

- [x] Gate F passes.
- [x] `OPENAI_BASE_URL` exists, validates as HTTP(S), ends exactly `/v1`, and does not require unsafe userinfo/query/fragment handling.
- [x] `OPENAI_KEY` exists without printing it.
- [x] Non-loopback plaintext HTTP is absent; otherwise stop and ask the user.
- [x] Live request/response logs are redacted by construction.

Execution:

- [x] Send one small synthetic multilingual batch to `${OPENAI_BASE_URL}/embeddings` with model exactly `text-embedding-3-small`.
- [x] Validate status, response object, indexes/order, vector counts, finite values, dimensions/model field, and safe usage metadata.
- [x] Record provider/model/date/interface scope and redacted timings only.

Mandatory stop condition:

On any model availability, auth, quota, rate limit, protocol, network, timeout, dimension, order, invalid-vector, or other error:

1. Stop the live probe immediately.
2. Preserve only the redacted diagnostic.
3. Tell the user what failed.
4. Do not retry, change model, change endpoint, change dimensions, use another key variable, or substitute mock/local evidence until the user directs the next step.

### Phase H — Pinned llama.cpp native-GPU probe

- [ ] Verify local GGUF size/hash/header before build/run.
- [ ] Checkout exact llama.cpp commit and record source hash/state.
- [ ] Build Release Vulkan backend for Windows x64 and Linux x64; build Release Metal backend for macOS arm64.
- [ ] Hash binaries and record compiler/CMake/build flags/version output.
- [x] Implement device preflight: `--list-devices`, expected backend/type, Vulkan >= 1.2, selected device identity.
- [ ] Start loopback-only server with embedding, last pooling, normalization, explicit device, and `--n-gpu-layers all`.
- [x] Machine-parse full X/X GPU offload; fail on warning, wrong device/backend, partial/no offload.
- [ ] Run batch/order/768d/finite/norm/repeat/cancel/timeout/invalid/oversize/shutdown tests.
- [ ] Run identical CPU-only numerical control and require every cosine >= 0.999.
- [ ] Record platform/backend/device evidence without local model path.

External execution gate H:

- [ ] Windows x64 Vulkan passes.
- [ ] macOS arm64 Metal passes.
- [ ] Native Linux x64 Vulkan passes.

WSL without an exposed real GPU cannot satisfy the Linux cell. CPU success cannot satisfy any GPU cell.

### Phase I — Semantic sanity manifests and metrics

- [x] Build/review Apache-2.0 semantic fixtures with stable IDs and expected target sets.
- [x] Enforce at least 120 same-language queries, 12 groups, ten concepts/group, four distractors/concept.
- [x] Enforce at least 90 cross-language queries and 15 per approved direction.
- [x] Implement correct Jina Query/Document recipe and removed/swapped-prefix negative controls.
- [x] Hash manifests and recipe fingerprint.
- [ ] Run identical inputs on CPU control and each approved GPU backend result set.
- [x] Compute per-language Recall@5/MRR@10/zero-result and per-direction Recall@10.
- [ ] Generate scoped capability evidence; preserve partial failures and never substitute models.

Validation gate I:

```bash
pnpm test -- --run semantic-fixtures semantic-metrics recipe-fingerprint
pnpm spike:semantic --input <provider-result-set>
pnpm spike:report --kind semantic_quality
```

### Phase J — Flat versus ANN benchmark

- [x] Generate fixed-seed 50,000 normalized 768d vectors and at least 500 fixed queries.
- [x] Hash/order dataset and query manifests.
- [x] Implement flat ground truth with explicit vector-index bypass.
- [x] Implement default ANN and explicit IVF-PQ parameter grid.
- [x] Record all build/query parameters including probes/refinement as applicable.
- [x] Run one separate cold preflight, two warmups, ten timed repetitions.
- [x] Report query-level Recall@10/20 distribution, p50/p95/p99, build/open/first-query, index size, environment, hashes.
- [x] Apply approved recall-tail and dual latency thresholds exactly.
- [x] Keep the smaller real multilingual embedding sanity set separate from synthetic performance claims.
- [x] Decide `flat default`, `ANN default`, or `insufficient`.

Validation gate J:

```bash
pnpm test -- --run ann-fixtures ann-metrics ann-thresholds
pnpm spike:ann
pnpm spike:report --kind ann_benchmark
```

### Phase K — License, dependency, and Community distribution decisions

- [x] Inventory exact production/test dependencies and native artifacts with licenses and sizes.
- [x] Generate required third-party notices and validate Apache-2.0/Jina scope statements.
- [x] Prove no Jina model is present or downloadable from repository/package.
- [x] Prepare exact native layout and questions for Obsidian distribution-owner review.
- [ ] Obtain official documentation or written confirmation for Community install/update of the sidecar layout.
- [x] If confirmation is absent/rejected, record LanceDB packaging `no-go` and `VectorStore` replacement trigger.
- [x] Do not implement runtime native download as a workaround.

External gate K may remain unverified while code probes finish, but it blocks a LanceDB packaging go decision.

### Phase L — Full check, convergence, and parent update

- [x] Run `trellis-check` and the full established quality command set.
- [x] Regenerate all safe reports from clean inputs.
- [x] Run secret scans over working tree, staged diff, generated artifacts, and private task commit candidates without printing secret values.
- [x] Verify no `.envrc`, key, model, user path/content, raw remote response, temp DB, or native build tree is staged.
- [x] Verify every acceptance criterion maps to a report/check or explicit external `unverified` cell.
- [x] Generate final decision table for packaging, platform runtime, FTS/LexicalStore, local/live providers, model capabilities, ANN.
- [ ] Update parent PRD with results and create the evidence-shaped MVP child-task map.
- [x] Update persistent specs with real source/test paths and exact commands.
- [ ] Ask the user to review decisions before activating any MVP child task.

## 3. Validation Matrix

| Area | Automated evidence | Required external evidence | Completion effect |
|---|---|---|---|
| Package/identity | build, manifest, namespace tests | none | harness foundation |
| Native runtime | bundle/hash/load prechecks | six Obsidian platform/version cells | supported runtime claim |
| Community distribution | layout/policy dossier | official docs/written acceptance | LanceDB packaging go/no-go |
| FTS/lexical | runtime probes + >=480 query manifest | none beyond supported runtime confidence | `LexicalStore` decision |
| Generic provider | deterministic server | none | protocol contract |
| Live remote | adapter/preflight | authorized endpoint/key | named certification |
| Local provider | build/model tests | three real GPU backend cells | local GPU certification |
| Semantic quality | fixture/metrics code | GPU result sets | per-language capability |
| ANN | deterministic benchmark | representative hardware results as scoped | flat/ANN default |
| License/privacy | automated inventory/scans | later public-history gate | safe private output/public readiness |

## 4. Risky Files and Rollback Points

| File/area | Risk | Control/rollback |
|---|---|---|
| `.envrc`, `.gitignore`, index | secret loss/leak or user-file deletion | never read/delete; remove only from tracking; verify local preservation |
| `manifest.json`, identity | namespace collision/migration cost | one owner; tests; formal/test split |
| esbuild/native loader | native code path/version confusion | exact hash/target manifest; isolated adapter; fail closed |
| lockfile | accidental version/platform drift | frozen install; explicit pin; artifact manifest |
| fixtures | biased/easy benchmarks | schema/category/target distribution checks; stable hashes |
| report/redaction | content/key leak | allowlist schemas; adversarial tests; generated outputs ignored by default |
| live provider | cost/privacy/config mutation | one tiny batch; strict preflight; mandatory stop; no silent retry |
| llama.cpp build | driver/backend variability | exact commit/flags/hash; external per-platform result; CPU cannot substitute |
| LanceDB DB dirs | handle leaks or user data impact | disposable paths/vaults; lifecycle registry; no user vault tests |
| Community dossier | false distribution claim | manual vs official gate separated; written acceptance required |

## 5. Stop/Ask Conditions

Stop implementation and ask the user when:

- the live `text-embedding-3-small` probe encounters any error;
- `OPENAI_BASE_URL` is non-loopback plaintext HTTP;
- the pinned Jina model fails hash/header/load/dimension/pooling checks;
- a required GPU backend initializes incorrectly, fails full offload, or violates cosine >= 0.999;
- a requested action would create/push a public GitHub repository or submit Community;
- preserving `.envrc` while safely removing it from tracking cannot be guaranteed;
- an existing user change overlaps a file in a way that cannot be preserved;
- a needed product decision would change approved platform, distribution, privacy, model, or license scope.

Do not stop merely because an external matrix cell is not yet available. Mark it `unverified`, complete independent work, and keep Spike open.

## 6. Definition of Ready for `task.py start`

- [x] `prd.md` has completed the lossless convergence pass.
- [x] `design.md` covers architecture, contracts, compatibility, trade-offs, security, and rollback.
- [x] `implement.md` covers ordered work, commands, gates, external evidence, risks, and stop conditions.
- [x] No repository-answerable open question remains.
- [x] Remaining external gates are explicit and do not hide a missing product decision.
- [x] The user has reviewed all three artifacts and explicitly approved activation.

Inline Codex mode skips `implement.jsonl`/`check.jsonl` curation; Phase 2 loads specs and artifacts through `trellis-before-dev`.

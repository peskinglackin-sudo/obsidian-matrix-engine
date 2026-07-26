# Core Quality and Verification

## Established tooling and commands

`package.json` and `pnpm-lock.yaml` own the exact private Spike package. Use
Node 22 and pnpm 11.1.3. `pnpm-workspace.yaml` is the dependency-build policy:
only esbuild may execute an install script; unnecessary transitive ONNX,
Protobuf, and Sharp build scripts remain blocked.

Canonical Phase A commands are:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm package:spike --target <win32-x64|darwin-arm64|linux-x64-gnu>
pnpm verify:artifact --manifest <path>
pnpm platform:prepare --manifest <path> --vault <path> --profile <path> --cell <cell> --app-version <version> --phase <phase>
pnpm platform:finalize --checkpoints <copied-json> --vault <destroyed-path> --profile <destroyed-path> --output <path>
pnpm spike:fts
pnpm spike:lexical
pnpm spike:provider-live
pnpm spike:semantic
pnpm spike:ann --execute
pnpm spike:licenses
pnpm spike:local-gpu --binary <path> --build-manifest <path> --model <path> --platform <platform> --device <id> --device-name <name> --output <path>
pnpm spike:report
```

`pnpm test` is deterministic single-run Vitest. `pnpm build` produces the
ignored top-level `main.js` required by Obsidian. Do not introduce a second
script owner for these actions. Generated bundles and safe reports remain
ignored; reviewed task results belong in the active task directory.

## Scenario: Spike evidence and architecture decisions

### 1. Scope / Trigger

Apply when changing native packaging, provider protocol/live probes, lexical
quality, local GPU evidence, semantic capability, ANN benchmarks, or final
Spike decisions.

### 2. Signatures

- `parseEvidenceEnvelope(unknown): EvidenceEnvelope` in `spike/evidence/schema.ts`.
- `evaluatePlatformRun(unknown): PlatformEvaluation` in `spike/platform-runner/evaluate.ts`.
- `platformProbeRequestSchema` / `platformProbeStateSchema` in
  `src/probe/platform-contract.ts`; the producer is
  `PlatformProbeController.run()` in `src/probe/platform-probe.ts`.
- `runEmbeddingServer(...)` and `buildServerArgs(...)` in
  `spike/local-gpu/process.ts`; the native entry is
  `spike/local-gpu/runner.ts`.
- `preparePlatformRun(...)` / `finalizePlatformRun(...)` in
  `spike/platform-runner/operations.ts` own the external phase transition and
  cleanup binding; CLI wrappers contain no second state machine.
- `buildSemanticFixtures()` / `buildSemanticWorkload()` and
  `evaluateSemanticResultSet()` in `spike/semantic/` own semantic inputs,
  prefix controls, result binding, and grouped thresholds.
- `projectSafeEvidence(...)` in `spike/report/projection.ts` is the only final
  report projection; `spike/report/cli.ts` parses required source schemas first.
- `OpenAiCompatibleEmbeddingProvider.embed(EmbeddingRequest)` in `src/providers/openai-compatible.ts`.
- Canonical commands are the `pnpm spike:*` scripts listed above.

### 3. Contracts

- Evidence/logs accept allowlisted fields; never arbitrary SDK errors,
  provider responses, content, credentials, URLs, or absolute paths.
- Live configuration reads only `OPENAI_BASE_URL` and `OPENAI_KEY`. The URL
  ends exactly in `/v1`; non-loopback HTTP fails before authorization is sent.
  The model is exactly `text-embedding-3-small`.
- A live failure is terminal: preserve one redacted code and do not retry or
  change endpoint/model/dimensions.
- Real-platform pass requires `executionKind: "obsidian-desktop"`, every
  checkpoint, exact app/runtime/artifact/`main.js` binding, and destruction of
  both the disposable profile and vault. Node/CI evidence is `unverified`.
- Minimum requests use phase `initial`. Current-stable final evidence uses
  phase `complete`, at least two controller-load UUIDs, and verified `0.0.0`
  plus `0.0.1` artifacts. A controller creates its load UUID once; repeated
  button clicks in one plugin load cannot prove reload.
- `prepare` requires the disposable vault/profile to exist, stores only their
  normalized-path SHA-256 values, rejects a dirty initial vault, and permits
  only `initial -> reloaded -> upgraded -> complete`. Every transition binds
  the same target/app/runner/path hashes and requires all prior checkpoints to
  be `pass`. Stable initial/reloaded use `0.0.0`; upgraded/complete use
  `0.0.1`. `finalize` hashes the supplied destroyed paths and rejects a
  different nonexistent path before checking absence.
- The GPU build manifest binds a clean exact llama.cpp source commit, Release
  backend flags, CMake/compiler versions, binary version/revision, and binary
  SHA-256. The runner independently obtains Vulkan metadata with
  `vulkaninfo --summary` or native Metal/macOS metadata; an operator-supplied
  API-version string is not evidence.
- GPU pass requires explicit device ID/name, exact full offload, 768 finite
  normalized vectors, batch association/order, repeat cosine `>= 0.99999`,
  cancel/timeout/input-limit classification, successful SIGTERM shutdown, and
  GPU/CPU cosine `>= 0.999`.
- The GPU and CPU server lifecycles both run the exact semantic workload.
  Every cross-language target must reference a real manifest document;
  correct `Query:`/`Document:` inputs gate independently by 12 languages and
  six directions, while removed/swapped-prefix runs are diagnostics only.
- Final report sources are strict-schema parsed and then allowlist projected.
  Never embed semantic text/vectors, query-level ANN rows, complete package
  records, arbitrary source fields, or raw provider objects in the summary.
- `spike/ann/runner.ts` uses 50,000 fixed-seed normalized 768d vectors, 500
  queries, flat bypass, and the same one-cold/two-warmup/ten-timed protocol for
  flat plus every ANN configuration. Reports name distance, partitions,
  subvectors, bits, probes, and refinement; SDK defaults are recorded as
  explicit default markers rather than silently omitted.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Evidence contains an unknown field | schema rejection |
| Provider has missing/duplicate index, wrong dimension, NaN/Inf | non-retryable safe error |
| HTTP 408/429/5xx in protocol test | retryable classification; no automatic live retry |
| Node/CI runner otherwise passes | `unverified`, never real-device `pass` |
| Minimum phase is not `initial` | finalizer rejects `MINIMUM_CELL_PHASE_INVALID` |
| Stable phase/session/upgrade history is incomplete | finalizer rejects before evaluation |
| Phase is skipped, prior checkpoints fail, or stable artifact version is wrong | `prepare` rejects before overwriting the request |
| A different nonexistent profile/vault is supplied at finalize | `DISPOSABLE_PATH_BINDING_MISMATCH` |
| Disposable profile or vault still exists | finalizer rejects before evaluation |
| Pinned GGUF size/hash/header differs | stop before llama.cpp starts |
| llama.cpp source is dirty/wrong revision or build hash/flags disagree | reject before model serving |
| Vulkan device metadata is absent or below 1.2 | reject before model serving |
| SIGTERM needs SIGKILL or cannot be confirmed | `LLAMA_SERVER_CLEANUP_FAILED`; never claim clean shutdown |
| Same-load repeated probe invocation | one load UUID; reload gate remains unsatisfied |
| Semantic expected target is absent or result IDs/bindings are incomplete | schema/evaluator rejects; no group score |
| Final report source has unknown/raw payload fields | strict parse and allowlist projection prevent propagation |
| ANN is faster but misses any recall/tail gate | `flat-default` |

### 5. Good, Base, and Bad Cases

- Good: deterministic protocol passes, one live synthetic batch emits only a
  shape/timing report, and external GPU/Obsidian runs emit only allowlisted,
  hash-bound reports after cleanup.
- Base: runner and bundles pass locally while external cells stay `unverified`.
- Bad: store a raw response, infer platform support from npm metadata, or
  accept low ANN recall because p95 is faster.

### 6. Tests Required

- `tests/evidence.test.ts`: schema, canonical JSON, SHA-256, bounded logs, and
  JSON/JUnit/Markdown projections.
- `tests/provider.test.ts`: batch order, malformed/index/vector cases,
  cancellation, timeout, close, HTTP classification, and one-call behavior.
- `tests/platform-runner.test.ts`: status separation.
- `tests/platform-state.test.ts`: state schemas, same-load reload prevention,
  final phase/session/upgrade requirements, and rejection of operator status.
- `tests/platform-operations.test.ts`: dirty/missing environments, artifact
  version, sequential phase/checkpoint/runner/path bindings, cleanup, and
  incomplete finalization.
- `tests/local-gpu-runner.test.ts`: full-offload parsing, device/backend/name
  matching, Vulkan API/driver parsing, vector cosine, and server flag/alias
  construction.
- `tests/local-semantic-ann.test.ts`: model/runtime/offload/parity, semantic
  real-target/count/recipe/control/workload/group metrics, and ANN threshold
  edges.
- `tests/final-report.test.ts`: adversarial raw fields do not cross the safe
  report projection.

### 7. Wrong versus Correct

Wrong: generate a new reload UUID for each button click, accept any missing
path as cleanup proof, skip directly from initial to upgraded, count semantic
queries whose targets do not exist, copy arbitrary evidence into a summary, return
`cleanShutdown: true` before the process exits, trust `--api-version` supplied
by an operator, serialize an arbitrary caught object, retry a live 429, or
label Node native load as platform support. Correct: own one UUID per
controller load, bind the exact environment paths and ordered state, validate
every semantic target/result, project only allowlisted summaries, return only
after confirmed SIGTERM exit, machine-read native backend metadata, translate
once to `SafeError`, stop the live probe, and keep external cells explicitly
`unverified`.

## Required development order

1. Complete Spike 0 before freezing business architecture: native LanceDB
   packaging, FTS capabilities, multilingual lexical prototype, both provider
   batch paths, golden-vault seed, and flat/ANN measurements.
2. Define typed boundaries before implementations: settings validation,
   storage/provider interfaces, query/filter AST, result/score contracts, and
   cancellation/error contracts.
3. Implement the correct fallback path before optional accelerators.
4. Add tests at each boundary and update these specs with real file paths.

## Review invariants

- Vault remains the source of truth; artifacts can be rebuilt.
- Exact hits are verified against raw text/metadata.
- Business services do not depend directly on LanceDB.
- Provider/network operations are cancellable and privacy-previewed.
- Generation and revision prevent stale writes.
- Raw and normalized multilingual forms remain distinct.
- Score direction/kind is preserved; different raw scores are not mislabeled
  as a shared similarity percentage.
- Advanced features are capability-gated and have a correct fallback.
- Plugin unload releases every owned resource.

## Test scope

Use the authoritative matrix in `prd.md` section 22:

- Unit: migrations, fingerprints, rendering, Unicode/script/language and
  identifier analyzers, parser/AST, filter compiler, ranges, aggregation, RRF,
  score direction, and cancellation.
- Integration: mock vault lifecycle, metadata fallback, provider mocks,
  LanceDB CRUD/search/index maintenance, rebuild, and degradation.
- Golden vault: all listed language/script groups, mixed identifiers, exact,
  lexical, semantic, cross-language, negative/filter, and long-note cases.
- Packaging: Windows x64, macOS arm64, Linux glibc x64, reload, upgrade,
  schema migration, and non-ASCII paths. macOS x64 and Windows ARM64 are
  explicit initial-release exclusions and must never be reported as passing.
- The plugin minimum is Obsidian `1.11.4`, the first documented
  `SecretStorage` release. Compile-time compatibility with current `obsidian`
  types is not evidence of `1.11.4` runtime compatibility.

Tests for async behavior must control completion order and assert that stale
work cannot commit. Tests for fallback must assert the actual executed mode and
reason, not merely the absence of an exception.

## Quality gates

- Exact title/path/tag/identifier deterministic cases: Hit@1 = 100%.
- Exact phrases: no false positives after raw verification.
- ANN: Recall@10 at least 0.95 against flat ground truth before default use.
- Track Recall, MRR, nDCG, zero-result rate, source diversity, cross-language
  Recall, p50/p95, size, and build time as specified in PRD sections 5 and 22.
- Validate native packaging on every supported target before release.

## Scenario: stable LanceDB platform gate

### 1. Scope / Trigger

Apply whenever the LanceDB version, native artifact set, Obsidian/Electron
runtime, or supported desktop platform list changes.

### 2. Signatures

`pnpm platform:prepare` accepts the exact artifact manifest, disposable vault,
cell, app version, and phase. It writes a validated request binding the
artifact content-set SHA-256 and packaged `main.js` SHA-256. The plugin writes
validated checkpoint state. `pnpm platform:finalize` accepts copied checkpoint
JSON plus the destroyed vault/profile paths and emits the machine evaluation.
Status is `pass`, `fail`, `unverified`, or `environment_error`.

### 3. Contracts

- This Spike pins `@lancedb/lancedb@0.31.0`, the stable npm `latest` observed
  at planning time. Preview/beta, mixed-version, and per-platform version
  selection are forbidden production candidates.
- Initial supported targets are Windows x64, macOS arm64, and Linux x64
  glibc. macOS Intel/x64 and Windows ARM64 are unsupported.
- `manifest.json` must declare `isDesktopOnly: true` and
  `minAppVersion: "1.11.4"`. APIs added later require capability detection and
  a correct fallback unless the reviewed minimum version is raised.
- Every supported platform runs two real app versions: `1.11.4` for minimum
  compatibility and the stable version current at test time for the full
  packaged-plugin lifecycle matrix.
- A future stable-version or platform change reruns the complete capability
  and real-device matrix; package metadata or CI-only loading is not enough.
- Official Obsidian Community one-click install and standard update support is
  mandatory for MVP. Manual sidecar bundles are test/preview artifacts only.
- Native-sidecar delivery needs official documentation or written acceptance
  from the distribution owner. Without it, LanceDB packaging is `no-go` and
  the project replaces `VectorStore` before MVP architecture is frozen.
- A runtime native-binary downloader is not an implicit fallback. It requires
  separate review of signature/hash verification, atomic install, rollback,
  disclosure, and distribution-channel acceptance.
- Linux pass proves native glibc through `process.report`, rather than copying
  `glibc` from the requested target. The stable cell includes verified
  reopen/vector/FTS smoke, repeat cleanup, and a controlled failure-injection
  cleanup followed by another reopen.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Supported real device passes every lifecycle/path check | `pass` |
| Any required lifecycle/path check fails | `fail` |
| Real supported device/report is missing | `unverified`; gate remains closed |
| Harness cannot establish a valid environment | `environment_error`; gate remains closed |
| macOS x64 or Windows ARM64 is requested | reject as unsupported |
| Native/main versions or artifact hash differ | reject before loading |
| Obsidian version is below `1.11.4` | reject as unsupported app version |
| `1.11.4` or current-stable real-device cell is missing | `unverified`; gate remains closed |
| Manual bundle works but Community delivery lacks official acceptance | packaging `no-go`; replace backend |
| Repeated run occurs without a new plugin/controller load | reload remains missing |
| Stable evidence lacks both `0.0.0` and `0.0.1` verified artifacts | upgrade remains missing |
| Disposable vault or profile still exists at finalization | reject; no report pass |

### 5. Good, Base, and Bad Cases

- Good: all three supported real devices return `pass` for their exact
  target-specific `0.31.0` bundles, with both reviewed versions used in each
  stable upgrade cell and all reports bound to `main.js` plus content hashes.
- Base: Windows x64 passes while macOS arm64 is missing; the platform gate is
  incomplete, not partially approved.
- Bad: load the old `0.22.3` macOS x64 binary through Rosetta and label macOS
  Intel supported, or let each OS install a different LanceDB version.

### 6. Tests Required

- Assert the runner rejects version/hash mismatches before native loading.
- Assert enable, disable, reload, upgrade, close, and space/Chinese/Japanese/
  emoji paths on each supported real-device report.
- Assert a real Obsidian `1.11.4` run can load, access `SecretStorage`, open and
  close LanceDB, and use non-ASCII database paths on each platform required by
  the approved version matrix.
- On each supported platform, assert `1.11.4` performs minimum compatibility
  checks and test-time current stable performs enable/disable/reload, prior-
  artifact upgrade, reopen/close, FTS/vector smoke, paths, and cleanup.
- Assert unsupported architectures cannot produce `pass` and CI/Node-only
  reports cannot satisfy a real-device cell.
- Run the full matrix again after every stable LanceDB upgrade.
- Assert a manual sidecar pass cannot satisfy the Community distribution gate,
  and that missing official acceptance produces the backend-replacement result.

### 7. Wrong versus Correct

Wrong: use `npm latest` without a lock, mix a newer JS package with an older
macOS native binary, or infer support from optional dependency metadata.
Correct: pin one stable version and artifact set, verify its hash, and require
the same packaged plugin to pass on every declared supported real device.

## Dependency discipline

Do not add React, Vue, Svelte, SQLite, LangChain, LlamaIndex, or a mandatory
online translation service for MVP/P1. Any dependency or borrowed source needs
bundle, native packaging, privacy, license, and clean-room review per `prd.md`
sections 23.3–23.4.

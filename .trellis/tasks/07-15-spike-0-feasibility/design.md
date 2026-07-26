# Spike 0 Technical Design

## 1. Purpose and Decision Boundary

This design produces reproducible evidence for the architecture decisions that must precede Matrix Engine MVP work. It does not create the production search/indexing architecture by accident.

Spike 0 answers six independent questions:

1. Can the selected stable LanceDB release run safely inside real Obsidian Desktop environments on every declared platform and app-version cell?
2. Can the exact native sidecar layout be installed and updated through an officially accepted Obsidian Community path?
3. Does LanceDB TypeScript FTS meet the approved multilingual lexical contract, or must production use a separate `LexicalStore`?
4. Do the pinned local llama.cpp path and the generic/live OpenAI-compatible paths satisfy their separate provider contracts, privacy rules, and model-quality probes?
5. Does ANN provide enough recall-safe latency benefit at 50,000 vectors to justify becoming the MVP default?
6. What MVP child-task boundaries follow from those decisions?

A negative answer is a valid Spike result when backed by evidence. Spike code must not silently convert a no-go into a product workaround.

## 2. Fixed Inputs

### Product identity

| Field | Formal value | Spike parallel-install value |
|---|---|---|
| Plugin ID | `matrix-engine` | `matrix-engine-spike` |
| English name | `Matrix Engine` | `Matrix Engine Spike` |
| Chinese name | `矩阵引擎` | `矩阵引擎（技术验证）` |
| Private-development author | `Opus` | `Opus` |
| Minimum Obsidian | `1.11.4` | `1.11.4` |
| Desktop only | `true` | `true` |

The Trellis parent-task slug is not a product namespace. One identity module owns manifest identity and derives settings, SecretStorage IDs, database/artifact paths, diagnostics, and report component names. Translated names are presentation-only.

### Dependency and model pins

| Input | Pin |
|---|---|
| LanceDB | `@lancedb/lancedb@0.31.0` stable |
| Obsidian API types | current pinned package selected by the lockfile; runtime compatibility remains `1.11.4` |
| llama.cpp | tag `b10018`, commit `22b208b1cacb67bae191b00d795dae7cc819edb8` |
| Local GGUF | Jina v5 text-nano retrieval Q8_0, 232,883,776 bytes |
| GGUF SHA-256 | `86b6e6279e9b9e71389f02a082764a2ac2b15a50e37482c26f98d69092f12442` |
| Model repository commit | `59cfaceeeb7d738c404659435af4c0da74d06c96` |
| Local vector dimension | 768 |
| Pooling | last-token |
| Jina query/document inputs | `Query: {query}` / `Document: {document}` |
| Live remote model | `text-embedding-3-small` |
| Live remote environment | `OPENAI_BASE_URL` ending `/v1`; `OPENAI_KEY` |

No dependency uses a floating production version. A future stable dependency upgrade is a new candidate and reruns the complete relevant matrix.

## 3. Repository and Package Shape

The initial product layout should be shallow and responsibility-based:

```text
manifest.json                     formal private-development manifest
versions.json                     plugin/app compatibility map
package.json
pnpm-lock.yaml
tsconfig.json
esbuild.config.mjs
LICENSE
README.md

src/
  main.ts                         Obsidian composition root only
  identity.ts                     formal/test identity and namespace builders
  lifecycle.ts                    resource ownership and unload coordination
  native/lancedb-loader.ts        verified sidecar selection/load boundary
  probe/probe-controller.ts       starts approved probes; no product UI
  probe/probe-view.ts             minimal status/export surface
  diagnostics/schema.ts           safe diagnostic/report events

spike/
  cli.ts                          deterministic command entry point
  config/schema.ts                validated, non-secret probe configuration
  evidence/schema.ts              one canonical result envelope
  evidence/write-report.ts        allowlisted JSON/JUnit/Markdown outputs
  evidence/redaction.ts           allowlist, not arbitrary-object denylist
  packaging/                      build/assemble/verify per-platform test bundles
  platform-runner/                disposable-vault real-device state machine
  fts/                            LanceDB runtime capability probes
  lexical/                        analyzer prototype, corpus, metrics
  providers/                      protocol server, clients, live/local probes
  semantic/                       model-quality sanity manifests/metrics
  ann/                            fixed-seed data, flat ground truth, ANN runs
  licenses/                       dependency/native artifact inventory

fixtures/
  lexical/                        Apache-2.0 synthetic corpus/query manifests
  semantic/                       Apache-2.0 synthetic corpus/query manifests
  packaging/                      paths and upgrade-state fixtures

scripts/
  build-llama-cpp.*               pinned checkout/build per backend
  run-platform-probe.*            external operator entry points
  verify-artifact.*               hash and manifest verification

dist/                             generated, ignored
reports/                          generated, ignored except reviewed templates
```

Use pnpm with a committed lockfile for deterministic local development and CI-like checks. The package manager choice does not change the Community release format. Exact scripts are established in `package.json` and then copied into the backend quality spec; planning does not pretend they already exist.

Production-oriented plugin code may depend on project-owned contracts only. Spike harnesses can call adapters directly but must not make their experiment schema the future product API.

## 4. Build and Native Sidecar Strategy

### JavaScript build

- Follow the Obsidian sample-plugin baseline: TypeScript entry, esbuild, CommonJS `main.js`, `es2021` target, `obsidian`/`electron`/Node built-ins external.
- Keep the plugin shell small. It registers the probe surface, creates the lifecycle registry, and delegates work.
- Build formal and isolated Spike manifests from one validated identity source. Formal builds fail if their ID is not `matrix-engine`; parallel test builds fail if their ID equals the formal ID.

### LanceDB test bundle

The Spike produces one manual real-device bundle per supported target:

```text
matrix-engine-spike/
  main.js
  manifest.json
  styles.css                  optional/minimal
  vendor/
    lancedb-js/               exact JS wrapper/runtime dependencies
    native/
      lancedb.<target>.node   exactly one target sidecar
  artifact-manifest.json
  THIRD_PARTY_NOTICES.*
```

The native loader:

1. Validates the runtime platform/architecture/libc against the bundle target.
2. Validates artifact-manifest version and every shipped file SHA-256.
3. Rejects unsupported macOS x64 and Windows ARM64.
4. Resolves the sidecar inside the plugin directory without using a user-supplied arbitrary path.
5. Sets `NAPI_RS_NATIVE_LIBRARY_PATH` only for the controlled load boundary.
6. Loads the pinned LanceDB JS entry after the path is set.
7. Translates all load errors into safe typed results.
8. Clears/isolates temporary process configuration where feasible and owns every opened connection until unload.

The bundle never mixes main/native versions and never contains multiple target sidecars. Manual bundle success proves runtime feasibility only.

### Community distribution gate

The official Community release gate is separate and cannot be satisfied by the manual bundle. The final report requires official documentation or written distribution-owner acceptance for the exact native layout. Without it:

```text
manual real-device result: may pass
Community distribution result: no-go
production LanceDB VectorStore decision: replace before MVP freeze
```

The Spike does not implement a runtime binary downloader. Such a mechanism would require a separate signed-manifest, atomic install, rollback, disclosure, offline, proxy, and channel-acceptance design.

## 5. Evidence Model

One schema owns all evidence envelopes:

```ts
type EvidenceStatus =
  | "pass"
  | "fail"
  | "unverified"
  | "environment_error"
  | "unsupported";

type EvidenceKind =
  | "packaging"
  | "community_distribution"
  | "fts_capability"
  | "lexical_quality"
  | "provider_protocol"
  | "provider_live"
  | "provider_local_gpu"
  | "semantic_quality"
  | "ann_benchmark"
  | "license_audit"
  | "secret_audit";

type EvidenceEnvelope<TSafeDetails> = {
  schemaVersion: 1;
  runId: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
  startedAt: string;
  completedAt: string;
  sourceCommit: string;
  artifactSha256: string;
  fixtureSha256?: string;
  environment: SafeEnvironment;
  decisionCodes: string[];
  details: TSafeDetails;
  error?: SafeError;
};
```

Reports are generated from typed data into JSON, JUnit, and concise Markdown. The JSON is authoritative. Raw logs are separate, redacted, bounded, and hash-bound to the run.

Safe environment fields include OS/version, architecture, libc, Obsidian/Electron/Node ABI, dependency versions, CPU/GPU names, backend/API/driver versions, memory totals, build flags, and executable/artifact hashes. They exclude usernames, full home paths, vault content, secrets, Authorization headers, arbitrary environment dumps, and raw provider responses.

The artifact-manifest and every returned report use SHA-256. External operators do not decide pass/fail; they run the state machine and return its outputs.

## 6. Real-Device State Machine

Required targets:

- Windows x64
- macOS arm64
- Linux x64 glibc

Unsupported initial targets:

- macOS Intel/x64
- Windows ARM64

Each supported target has two app-version cells.

### Obsidian 1.11.4 minimum cell

1. Verify test bundle and hashes.
2. Install into a disposable vault/profile using `matrix-engine-spike`.
3. Load plugin and capture Obsidian/Electron/Node ABI.
4. Exercise `SecretStorage.setSecret/getSecret/listSecrets` with a lowercase/dash-only test ID.
5. If the test ID existed, restore its prior value. If it did not, record the API deletion limitation and destroy the disposable profile; never invent empty-string deletion.
6. Load LanceDB sidecar, create/open database, write/query/close.
7. Repeat database operations for paths containing spaces, Chinese, Japanese, and emoji.
8. Disable/unload; assert plugin-owned handles/listeners/requests are closed.
9. Destroy the disposable profile and record cleanup.

### Test-time current stable cell

Run the full minimum cell plus:

- enable/disable/reload;
- upgrade from the previous test artifact to the current artifact;
- database reopen and state validation;
- FTS/vector smoke;
- repeated unload and failure injection;
- current runtime metadata and cleanup.

CI builds, cross-compilation, Node-only tests, WSL, mocks, and static inspection are prechecks. They cannot produce `pass` for a real-device cell.

## 7. FTS and Lexical Design

### FTS capability probe

Test the lockfile-selected TypeScript SDK at runtime for:

- `whitespace` tokenizer;
- `ngram` tokenizer and min/max lengths;
- positions and phrase query;
- fuzzy match options;
- array-field indexing/search;
- create, add/update, delete, rebuild, optimize/maintenance, and unindexed-row behavior;
- unsupported capability error classification.

The probe distinguishes API exposure from correct semantics. Every advanced capability has a slower correct fallback in the future design; the Spike records whether that fallback must live outside LanceDB.

### Analyzer prototype

One analyzer contract owns raw/norm/derived values and versioning:

```ts
type LexicalAnalysis = {
  raw: string;
  norm: string;
  terms: string[];
  ngrams: string[];
  identifierTerms: string[];
  scripts: string[];
  analyzerId: "unicode-multilingual";
  analyzerVersion: 1;
};
```

NFKC, case folding, whitespace normalization, optional secondary accent folding, `Intl.Segmenter`, script-aware ngrams, and identifier splitting remain distinct operations. Raw text is never overwritten. Analyzer ID/version and derived-field policy participate in the artifact/fixture fingerprint.

### Quality corpus

- 14 groups, 30 gating positive queries per group, at least 420 total.
- Six approved categories with at least five queries each.
- At least ten distinct targets per group.
- At least 60 shared non-gating pressure/negative diagnostics.
- Stable IDs, expected target sets, gating flag, corpus/query SHA-256.

The same inputs compare LanceDB-native FTS and any replaceable lexical prototype. Per-group Recall@10 = 1.00, zero-result rate = 0, and MRR@10 >= 0.80 are hard gates. Negative queries report false positives/filter correctness separately.

Decision outcomes:

- LanceDB meets all gates: it may implement both `VectorStore` and `LexicalStore`, still behind separate interfaces.
- LanceDB fails but alternate prototype passes: LanceDB may remain `VectorStore`; production `LexicalStore` is separate.
- Neither passes: lexical architecture is no-go and planning returns to research before MVP.

## 8. Provider and Semantic Design

### Shared project-owned provider contract

The Spike provider adapter uses the root-PRD `EmbeddingProvider` shape and a project-owned error/capability normalization. It never exposes raw provider errors to reports/UI.

All requests accept `AbortSignal`; timeout and cancellation are different safe result codes. Generic OpenAI-compatible capability probing never requires llama.cpp-only `/props` or `/tokenize`.

### Deterministic protocol server

A local server provides scripted cases for:

- batch ordering and indexes;
- requested/ignored dimensions;
- custom base URL, model, and headers;
- missing optional endpoints;
- malformed payload/response;
- empty/oversize input;
- delay, abort, connection close;
- 401/403, 408, 429 + `Retry-After`, 5xx;
- dimension mismatch, NaN/Inf, duplicate/missing indexes.

Tests assert retry classification, but the live-test stop rule overrides automatic retry for the explicitly authorized real call.

### Live remote probe

Configuration comes only from `OPENAI_BASE_URL` and `OPENAI_KEY`. Validation occurs before request construction:

- URL is HTTP(S), ends exactly in `/v1`, and has no unsafe userinfo/query/fragment use.
- Non-loopback plaintext HTTP stops before sending the key.
- Request path is `${OPENAI_BASE_URL}/embeddings`.
- Model is exactly `text-embedding-3-small`.
- Inputs are short synthetic multilingual strings.

Any live error stops the live probe, writes a redacted diagnostic, and returns control to the user. It does not change the endpoint/model/dimensions/credential variable, silently retry, or substitute the mock.

### Local llama.cpp GPU probe

- Checkout/build exact `b10018` commit.
- Windows/Linux: `GGML_VULKAN=ON`, Vulkan 1.2+, real Vulkan GPU/iGPU.
- macOS arm64: `GGML_METAL=ON`, native Metal GPU; no MoltenVK certification path.
- Run `--list-devices`, explicitly select the expected device, and use `--n-gpu-layers all`.
- Machine-parse full `offloaded X/X layers to GPU`; wrong/partial/no offload fails.
- Bind `127.0.0.1`, serve `/v1/embeddings`, use `--embedding --pooling last` and normalized output.
- Validate fixed model size/hash/header before serving.
- Run batch, ordering, 768d, finite-value, norm, repeat, cancellation, timeout, invalid-input, and shutdown checks.
- Run identical CPU-only numerical control; every GPU/CPU vector cosine similarity is >= 0.999.

CPU-only cannot satisfy certification. GPU failure never becomes a passing CPU fallback.

### Semantic sanity corpus

- At least 120 same-language queries across 12 groups; ten concepts per group, distinct paraphrase and at least four distractors per concept.
- Per group: Recall@5 >= 0.90, MRR@10 >= 0.75, zero-result rate <= 0.10.
- At least 90 cross-language queries: both directions of zh-Hans/en, ja/en, es/en, 15 per direction.
- Per direction: Recall@10 >= 0.80.
- Correct `Query:`/`Document:` recipe plus removed/swapped-prefix negative control.
- Identical hashed manifests for CPU and GPU.

Provider protocol compatibility and model semantic verification are separate evidence kinds. Partial semantic failure restricts capability labels; it does not rewrite the provider result or substitute another model.

## 9. ANN Benchmark Design

### Dataset and ground truth

- Exactly 50,000 fixed-seed normalized vectors at the selected real dimension (768 for the Jina fixture unless a separately scoped candidate is tested).
- At least 500 fixed queries with SHA-256-bound order.
- Flat `bypassVectorIndex` results are ground truth.
- Identical query/top-k/filter/metric/dataset for every run.
- Separate smaller real multilingual embedding set for semantic sanity; synthetic-vector performance is never called model quality.

### Configurations and run protocol

- Flat.
- LanceDB default ANN selected by the pinned version.
- Explicit IVF-PQ parameter grid with recorded partitions/subvectors/bits and query `minimumNprobes`/other tuning.
- One separately reported cold preflight.
- Two unmeasured warmups.
- Ten timed repetitions per configuration.

Report Recall@10/20 query distributions, p50/p95/p99, build/open/first-query time, index size, complete parameters, environment, dataset/query hashes, and run count.

ANN becomes the 50,000-vector MVP default only if:

- aggregate Recall@10 >= 0.95;
- at least 99% of queries have Recall@10 >= 0.80;
- no query has Recall@10 < 0.50;
- warmed p95 improves by at least 30% and 10 ms over flat;
- both remain under root-PRD vector p95 < 100 ms;
- flat p95 is greater than 25 ms.

Otherwise the valid decision is MVP flat default and ANN deferred to P1/larger-vault policy.

## 10. Security, Privacy, and Licensing

### Secrets and private development

- Never enumerate or dump arbitrary environment variables.
- `.envrc` remains unread/unprinted and locally preserved.
- Before the first private task commit, remove `.envrc` from future tracking, ignore it, and add a value-free example without deleting the user's working file.
- Full-history scan, credential rotation, and public GitHub preparation remain a later pre-publication gate.
- Generated reports and bundles exclude `.envrc`, keys, Authorization headers, full provider responses, model paths, usernames, and user vault content.

### Licenses

- Original source and synthetic fixtures: Apache-2.0.
- Repository includes `LICENSE`; audit generates required NOTICE/third-party notices.
- LanceDB and every bundled JS/native dependency are inventoried with exact versions and licenses.
- Jina GGUF: user-supplied CC-BY-NC-4.0 non-commercial Spike fixture, never bundled/downloaded/default-recommended.
- Reference plugins are behavior/documentation references only; no code/style/structure copy.

## 11. Failure, Rollback, and Cleanup

All adapters translate failures to stable safe codes with retryability and context IDs. The state machine distinguishes code failure from missing environment and unsupported scope.

Cleanup ownership:

- Plugin shell owns registered listeners, views, timers, and lifecycle registry.
- LanceDB adapter owns connections/tables and closes them on unload.
- Provider harness owns server subprocesses and abort controllers.
- Platform runner owns disposable vault/profile/temp directories.
- Report writer finalizes only after cleanup status is known.

Never delete an old test database before a replacement/upgrade check commits. A failed cleanup leaves evidence and retains the isolated test directory for explicit inspection; it never touches a user vault.

Rollback points:

- Package baseline can be reverted independently of fixtures/reports.
- Native loader is isolated behind a project boundary; a packaging no-go removes the adapter without changing probe/report contracts.
- Lexical analyzer and LanceDB FTS adapters are separate; a lexical no-go replaces only the adapter.
- ANN is opt-in during Spike; flat remains the always-correct path.
- Live provider failure does not affect mock/local evidence and stops before configuration mutation.

## 12. Decision Report and MVP Task Mapping

The final Markdown decision table is generated from JSON evidence:

| Decision | Possible outcomes | MVP consequence |
|---|---|---|
| Community packaging | go / no-go / unverified | keep or replace `VectorStore` before MVP |
| Manual platform runtime | per-cell pass/fail/unverified | supported-platform claim or blocking evidence |
| LanceDB FTS | go / vector-only / no-go | combined adapter or separate `LexicalStore` |
| llama.cpp protocol/GPU | verified / failed / partial | local provider scope and diagnostics |
| Live remote provider | named target verified / failed / unverified | remote provider certification scope |
| Jina semantic quality | per-language/direction verified/failed | capability badges only; no model substitution |
| ANN | default flat / default ANN / insufficient | retrieval/index policy |

After decisions are signed off, update the parent PRD and create independently verifiable MVP child tasks. Expected categories are plugin/runtime foundation, selected storage/artifact backend, lexical/indexing, provider/embedding, retrieval, UI/settings/i18n, Connections, and release/integration. Actual boundaries follow evidence and are not pre-created now.

## 13. Compatibility and Open External Gates

The design is complete enough to implement the harness, but Spike completion remains externally gated by:

- real Windows x64, macOS arm64, and native Linux x64 glibc devices;
- real Obsidian `1.11.4` plus test-time stable on each;
- Vulkan on Windows/Linux and Metal on macOS arm64;
- an authorized live endpoint using the supplied remote environment contract;
- official documentation or written Obsidian distribution-owner acceptance for native sidecars.

Missing gates produce `unverified`, not an invented pass. Current work remains private on Gitea; public GitHub/Community actions require a later explicit authorization.

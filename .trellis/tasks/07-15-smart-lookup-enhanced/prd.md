# Implement Matrix Engine

## Goal

Turn the authoritative root [`prd.md`](../../../prd.md) into an independently implemented Obsidian Desktop plugin through evidence-gated, independently verifiable child tasks.

This task is the parent program. It owns the source requirements, task map, cross-child contracts, release-stage acceptance, and final integration review. Implementation normally belongs to children; the first implementation-bearing child is Spike 0.

The Trellis directory/id retains its creation-time `smart-lookup-enhanced` slug only for internal history and parent/child link stability. It is not the product/plugin ID.

## Confirmed Program Contracts

- Product identity is plugin ID `matrix-engine`, English name `Matrix Engine`, and Chinese name `矩阵引擎`. Runtime/persistence namespaces never use the historical Trellis slug or translated display name.
- Private development uses manifest author `Opus` without author/funding URL. Final public author/support metadata is deferred to an explicitly authorized public-release phase.
- Initial supported platforms are Windows x64, macOS arm64, and Linux x64 glibc. macOS Intel/x64 and Windows ARM64 are unsupported.
- Minimum Obsidian is `1.11.4`; the plugin is desktop-only.
- Original source and synthetic fixtures use Apache-2.0. Third-party dependencies/models/assets retain separate licenses.
- The user-supplied Jina v5 text-nano GGUF is a CC-BY-NC-4.0 non-commercial Spike fixture only, not a bundled/downloaded/default production model.
- Official Obsidian Community one-click installation and standard updates remain mandatory MVP release requirements. Manual platform bundles are Spike/preview evidence only.
- Current development remains private on existing Gitea. No public GitHub creation/push or Community submission is authorized now. When explicitly authorized later, public GitHub becomes the Community/release/default-branch/issue authority and Gitea remains a private mirror; same-version tags resolve to the same commit and releases bind source commit plus artifact SHA-256.
- The vault is the source of truth; indexes are rebuildable artifacts.
- Exact, lexical, semantic, hybrid, and Connections are distinct capabilities. Multilingual quality is assessed per language/direction, not hidden by aggregate scores.
- MVP/P1 excludes React, Vue, Svelte, SQLite, LangChain, LlamaIndex, and mandatory online translation.
- Omnisearch and Smart Connections are behavior/documentation references only; implementation is clean-room.

## Requirements

### R-001 — Preserve the product contract

- Treat the root PRD as authoritative for product, architecture, privacy, quality, and release behavior.
- Resolve ambiguities in reviewed task artifacts; never silently weaken requirements.
- When evidence contradicts the product contract, return to planning and update the authoritative documents before implementation continues.

### R-002 — Retire architecture risks before MVP freeze

- Complete Spike 0 before committing MVP to a storage/retrieval backend.
- Require explicit evidence-linked decisions for Community/native packaging, supported platform runtime, `VectorStore`, `LexicalStore`, local/live provider scope, model multilingual capability, and flat/ANN default.
- Keep storage, lexical, provider, and retrieval contracts replaceable wherever evidence remains conditional.
- Missing external evidence is `unverified`, not pass.

### R-003 — Deliver through independently verifiable children

- Keep this parent as the requirement/task-map/integration owner; do not activate it for ordinary child implementation.
- Create MVP children only after Spike decisions determine their real boundaries.
- Give each child a testable goal, explicit prerequisites, independently reviewable acceptance, and converged `prd.md`/`design.md`/`implement.md` before activation.
- Record dependency ordering in child artifacts; tree position alone is not a dependency.
- Keep P1/P2 out of MVP children.

### R-004 — Maintain one owner for shared contracts

- Give identity/namespaces, settings/profile/artifact schemas, fingerprints, multilingual raw/norm/derived data, provider capability/results, query/filter/result/score types, errors/cancellation, lifecycle/revision/generation, diagnostics/redaction, i18n, and safe preview exactly one owning contract.
- Require cross-layer validation whenever a shared contract changes.
- Update persistent specs with real source/test paths and exact commands as implementation creates them.

### R-005 — Make claims evidence-based and safe

- Back every platform, packaging, quality, provider, performance, privacy, and license claim with reproducible commands and machine-readable evidence.
- Distinguish manual packaged-plugin runtime from official Community install/update viability; only the latter satisfies MVP distribution acceptance.
- Use synthetic/redistributable fixtures and exclude credentials, unintended content, and sensitive paths from reports/artifacts.
- Before the first private task commit, safely stop tracking the locally preserved `.envrc`, ignore it, provide a value-free example, and verify no private commit/artifact contains secrets.
- Defer full-history publication audit, exposed-credential rotation, public GitHub, final public metadata, and Community submission to a separately authorized public-release phase; they remain mandatory before public push.

### R-006 — Integrate and finish the approved release stage

- After children complete, trace configuration to artifact, vault event to committed rows, query to visible result, and failure to explicit degradation.
- Verify all root-PRD acceptance mappings, supported platform/version cells, multilingual thresholds, privacy/license behavior, rebuild/recovery, accessibility/i18n, and lifecycle cleanup.
- Resolve cross-child drift and rerun the full union quality gate.
- Archive the parent only when all in-scope children and integration work are complete and reviewed.

## Acceptance Criteria

- [x] AC-001 — Parent-program plus evidence-gated child delivery was explicitly approved on 2026-07-15.
- [x] AC-002 — Parent `design.md` defines ownership, evidence gates, compatibility, cross-child integration, and rollback.
- [x] AC-003 — Parent `implement.md` defines Spike-first sequencing, evidence-shaped child creation, integration review, and finish conditions.
- [x] AC-004 — Spike 0 child has converged `prd.md`, `design.md`, and `implement.md` mapping approved requirements to executable checks and explicit external gates.
- [x] AC-005 — The user reviewed and explicitly approved the final Spike 0 planning artifacts before the child was activated on 2026-07-15.
- [ ] AC-006 — Spike 0 completes with evidence-linked architecture decisions and updates this parent with the resulting MVP child-task map.
- [ ] AC-007 — Every approved release-stage child completes its independent acceptance and persistent spec updates.
- [ ] AC-008 — Parent integration review passes the full root-PRD release-stage contract with no required work remaining.

## Out of Scope for the Current Child

- Full MVP business functionality is not implemented inside Spike 0.
- P1 and P2 remain outside the first implementation delivery.
- Public GitHub/Community actions and final public identity/support metadata are not authorized in the current private-development phase.

## Spike 0 Interim Architecture Decisions (2026-07-15)

The child remains open for mandatory external real-device/GPU evidence, but
the independently executable portions already fix these MVP boundaries:

- Community packaging for `@lancedb/lancedb@0.31.0` is `no-go` unless the
  Obsidian distribution owner later provides written acceptance for the exact
  native layout and standard update path. Manual bundle success is not enough;
  the MVP `VectorStore` must be replaced before architecture freeze.
- LanceDB's current-host FTS probe passed whitespace, ngram, positions/phrase,
  array, and lifecycle capabilities but failed the approved fuzzy behavior.
  MVP uses a separate replaceable `LexicalStore`.
- The reference lexical contract passes 14 groups with 420 gating positives
  and 60 diagnostics; fixture SHA-256 is
  `8462eee13ddc533c74b035e2906403ddfdfde3a95d69d2a5f59cfad1c04dd3c9`.
- The generic provider protocol and one authorized live
  `text-embedding-3-small` batch passed. The claim is scoped only to the
  configured endpoint/model/date and does not certify other compatible APIs.
- The fixed 50k/768d/500-query ANN benchmark found strong latency improvement
  but unacceptable recall/tails. MVP defaults to flat vector search; ANN is
  deferred. Fixture SHA-256 is
  `b1b1643ea894d76e9600a639d4f6c5e8a2725dcaefb245c49251b7ec50a9080e`.
- Local Jina/llama.cpp multilingual capability remains `unverified` because
  the pinned user-supplied model and three trusted GPU result sets are absent.
  The semantic fixture SHA-256 is
  `c638678512894a7043da0d781246e344ce7fb3e78651f7328de2c5eee554d004`
  and its recipe SHA-256 is
  `9c50ae51eb38c50c97827270ed3e64246c15be825123e1bec3b9ee77d436050f`.
- Six trusted Obsidian platform/version cells and three native-GPU cells remain
  mandatory; missing reports are `unverified`, never partial pass.
- The private Spike package now contains machine-producing runners for both
  external gates. Real Obsidian evidence is bound to the target artifact and
  packaged `main.js`, requires distinct plugin-load sessions, both `0.0.0` and
  `0.0.1` upgrade artifacts in stable cells, and destroyed disposable
  profile/vault. Native GPU evidence is bound to the clean pinned llama.cpp
  build manifest, native Vulkan/Metal metadata, explicit device/full offload,
  behavior/error checks, repeat tolerance, clean shutdown, and GPU/CPU parity.
  It also runs the same scoreable semantic fixture and prefix controls through
  the bound GPU and CPU server lifecycles. Platform preparation binds hashed
  disposable vault/profile paths and ordered phase transitions, so another
  absent path cannot masquerade as cleanup evidence.
  Local code/build/package prechecks passed on 2026-07-16, but this does not
  change the nine external cells from `unverified`.

Do not create or activate the evidence-shaped MVP child map until the user has
reviewed these decisions and the remaining external Spike gates are resolved
or explicitly dispositioned.

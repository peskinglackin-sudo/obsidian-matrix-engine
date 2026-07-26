# Matrix Engine Program Design

## Purpose

This parent task turns the root Matrix Engine PRD into an evidence-gated sequence of independently verifiable child tasks. The parent owns the authoritative requirement set, task map, cross-child contracts, release-stage acceptance, and final integration review. It is not the normal code implementation target.

## Delivery Architecture

    Parent: Matrix Engine program
      |
      +-- Spike 0 architecture feasibility (current child)
      |     -> packaging / backend / lexical / provider / ANN decisions
      |
      +-- MVP children created only from approved Spike evidence
      |     -> runtime/plugin foundation
      |     -> selected storage/artifact backend
      |     -> source/indexing and lexical pipeline
      |     -> embedding providers and model capability
      |     -> retrieval pipeline
      |     -> Lookup/Settings/i18n
      |     -> Connections
      |     -> integration/release readiness
      |
      +-- P1/P2 children created only after MVP review

The listed MVP categories are expected ownership areas, not pre-approved task boundaries. Spike results may merge, split, replace, or reorder them.

## Parent-Owned Contracts

- Product identity: matrix-engine, Matrix Engine, 矩阵引擎.
- Vault as source of truth; indexes are rebuildable artifacts.
- Exact, lexical, semantic, hybrid, and Connections remain distinct capabilities.
- Multilingual quality is measured per language/direction; aggregate scores cannot hide failure.
- Provider secrets/privacy and remote-content preview remain explicit trust boundaries.
- Windows x64, macOS arm64, and Linux x64 glibc are initial targets; macOS x64 and Windows ARM64 are unsupported.
- Obsidian minimum is 1.11.4; official Community one-click install/update is an MVP release gate.
- Original source/fixtures are Apache-2.0; third-party/model licensing remains separate.
- Current development is private on Gitea; public GitHub/Community actions require later explicit authorization.

## Evidence Gate

| Decision | Required parent action |
|---|---|
| Community/native packaging | Keep selected backend or create replacement-backend child first |
| Platform runtime | Freeze supported matrix or return to product scope review |
| LanceDB FTS | Combined adapter, separate LexicalStore, or more research |
| Local/remote providers | Scope certified providers/capabilities and degraded behavior |
| Model multilingual quality | Scope badges/promises by tested language/direction |
| ANN | Freeze flat or ANN default policy |

No MVP implementation child may assume a conditional Spike outcome. Every child records its prerequisite decision/report explicitly; tree position alone is not a dependency.

## Cross-Child Integration

The parent verifies shared contracts have one owner:

- identity/namespaces;
- settings/profile/artifact schemas and fingerprints;
- errors, cancellation, diagnostics, and redaction;
- raw/normalized/derived multilingual text;
- provider capability/result contracts;
- query/filter/result/score contracts;
- lifecycle cleanup and source revision/generation;
- i18n and safe preview.

Each child owns tests at its boundary. Final integration traces configuration to artifact, vault event to committed rows, query to visible result, and failure to user-visible degradation.

## Compatibility and Migration

- Pre-release schema changes build new artifacts rather than preserving experimental caches.
- Plugin ID remains stable across display-name changes.
- Dependency/backend upgrades rerun their capability, packaging, and migration gates.
- Unsupported platforms cannot be promoted by package metadata or CI alone.
- A child discovering a root-PRD defect returns the program to planning before implementation continues.

## Rollback

- Spike adapters/harnesses remain removable without defining production architecture.
- Backend, lexical store, provider, and ANN choices stay behind parent-owned contracts.
- A child can be reverted/archived independently when its acceptance boundary is clear.
- The parent is not archived until every in-scope child is integrated, cross-child acceptance passes, required specs are updated, and the user reviews the final result.

## Program Completion

The parent is complete only when the approved release stage is implemented and verified, all child dependencies/decisions are recorded, final integration passes, privacy/license/release gates are satisfied, and no required work remains.

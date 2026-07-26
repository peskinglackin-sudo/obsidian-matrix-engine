# Matrix Engine Program Plan

## Rules

- Keep the parent in planning/coordination; activate implementation-bearing children, not the parent, unless direct integration work is later identified.
- Implement/check inline in the primary session.
- Create children only when their requirements, prerequisites, and independent acceptance boundary are known.
- Do not pre-create backend-dependent MVP children before Spike 0 decisions.
- Every complex child has converged prd.md, design.md, and implement.md plus user approval before task activation.

## Ordered Program Checklist

### 1. Spike 0

- [x] Create parent and Spike 0 child.
- [x] Converge product identity, platform, Obsidian, dependency, model, quality, privacy, license, and private-hosting decisions.
- [x] Review and approve the Spike child planning artifacts.
- [x] Activate and implement the repository-executable portion of Spike 0; keep the child open for mandatory external cells.
- [ ] Collect all required external real-device, GPU, live-provider, and distribution-channel evidence.
- [ ] Approve the final architecture decision report.

### 2. Evidence-shaped MVP task map

- [ ] Update the parent PRD with Spike decisions and source report hashes.
- [ ] Create only independently verifiable MVP children.
- [ ] Put explicit prerequisites in each child artifact.
- [ ] Ensure one child owns each shared contract and no contract is duplicated.
- [ ] Order children by real dependency: foundation/contracts before adapters/pipelines; integration/release last.

Expected categories to evaluate after Spike:

1. Plugin/runtime foundation and identity.
2. Selected storage/artifact backend.
3. Source ingestion, chunking, multilingual lexical indexing.
4. Local/remote embedding providers and model presets.
5. Exact/lexical/vector/hybrid retrieval.
6. Lookup, Settings, diagnostics, i18n, accessibility.
7. Current note/selection Connections.
8. Full integration, packaging, privacy, quality, and Community readiness.

### 3. MVP execution

- [ ] Plan, review, activate, implement, and check one eligible child at a time.
- [ ] After each child, update real source/test paths in .trellis/spec/.
- [ ] Preserve vault-as-source-of-truth, rebuildability, cancellation, generation safety, and explicit degradation throughout.
- [ ] Run cross-layer data-flow checks whenever a shared contract changes.
- [ ] Do not begin P1/P2 work under an MVP child.

### 4. Parent integration review

- [ ] Verify every root-PRD MVP requirement maps to implemented evidence.
- [ ] Trace configuration -> artifact -> indexing -> retrieval -> UI.
- [ ] Verify provider-offline and index-unavailable degradation.
- [ ] Verify three-platform/two-Obsidian-version release matrix for the selected backend.
- [ ] Verify multilingual lexical/semantic/Hybrid thresholds and Connections.
- [ ] Verify secrets, remote preview, logs, licenses, accessibility, i18n, rebuild, and unload.
- [ ] Verify official Community install/update and public-release security gates when that phase is explicitly authorized.
- [ ] Resolve all cross-child drift and rerun the full quality gate.

### 5. Finish

- [ ] Update parent and persistent specs with final decisions/contracts.
- [ ] Confirm no required child or integration work remains.
- [ ] Commit through the approved private/public workflow for the current phase.
- [ ] Archive completed children, then the parent.

## Validation and Stop Conditions

- Each child defines exact commands after its toolchain exists.
- The parent uses the union of child quality gates plus integration/release checks.
- Stop and return to planning when evidence changes a root requirement, platform/backend choice, trust boundary, or child dependency.
- Missing external evidence is unverified; it does not become pass.
- Public hosting/release/Community actions require explicit user authorization at execution time.

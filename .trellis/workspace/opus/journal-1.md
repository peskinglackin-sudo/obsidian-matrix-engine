# Journal - opus (Part 1)

> AI development session journal
> Started: 2026-07-15

---



## Session 1: Bootstrap project-specific Trellis specs

**Date**: 2026-07-15
**Task**: Bootstrap project-specific Trellis specs
**Branch**: `main`

### Summary

Replaced generic backend, frontend, and shared Trellis templates with PRD-backed Obsidian plugin guidance; documented the no-product-source evidence boundary and verified placeholders, links, indexes, task metadata, and generation-safe storage contracts.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `9adecb9` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Implement Spike 0 feasibility harness

**Date**: 2026-07-16
**Task**: Implement Spike 0 feasibility harness
**Branch**: `main`

### Summary

Built and verified the private Matrix Engine package, evidence/privacy/native/provider/lexical/GPU/semantic/ANN harnesses, completed one authorized text-embedding-3-small live probe, selected separate LexicalStore and flat vector default, recorded LanceDB Community packaging no-go, and left required real Obsidian/GPU cells unverified with Spike 0 in progress.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `8faec8f` | (see git log) |
| `2c059d8` | (see git log) |
| `455f12d` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Add strict external evidence runners

**Date**: 2026-07-16
**Task**: Spike 0 architecture feasibility
**Branch**: `main`

### Summary

Implemented hash-bound real-Obsidian checkpoint production/finalization and a
pinned llama.cpp native-GPU build/process runner. Reload and upgrade evidence
is machine-enforced, disposable profile/vault destruction is required, and
GPU evidence requires native backend metadata, exact full offload, provider
behavior checks, clean shutdown, and GPU/CPU parity. External device cells
remain unverified.

### Main Changes

- Added the localized Obsidian Spike probe controller/view and shared schemas.
- Added platform prepare/finalize CLI plus shell/PowerShell operator wrappers.
- Added clean pinned llama.cpp build manifests and native GPU runner.
- Added regression tests and executable backend/frontend specs.
- Verified 55 tests, production build, and six target/version bundle variants.

### Testing

- `git diff --check`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test -- --run` (55 tests)
- `pnpm build`
- 3 targets × plugin versions `0.0.0` and `0.0.1`: package + verify
- Shell syntax passed; PowerShell syntax was not locally runnable because
  `pwsh` is absent and remains part of the Windows external run.

### Status

[OK] **Repository implementation complete; external gates unverified**

### Next Steps

- Run six real Obsidian cells and three native-GPU cells using the operator
  documents. Do not archive Spike 0 until all mandatory evidence is returned.


## Session 4: Close repository-executable Spike evidence gaps

**Date**: 2026-07-16
**Task**: Spike 0 architecture feasibility
**Branch**: `main`

### Summary

Made external evidence fail-closed across phase transitions and bound cleanup
paths, replaced the unscoreable semantic placeholder fixture with a real
12-language/6-direction matrix and GPU/CPU workload, completed the symmetric
ANN protocol with reopen/index-size measurements, and allowlist-projected the
final report. External device cells remain unverified.

### Main Changes

- Added platform transition/dirty-vault/crash/cleanup binding operations and
  fixture tests.
- Added real semantic target references, prefix controls, strict result-set
  evaluation, and local GPU workload integration.
- Re-ran the 50,000 × 768, 500-query ANN benchmark with symmetric flat/ANN
  cold, warmup, and timed runs plus build/open/index-size metadata.
- Added strict schemas and an adversarial allowlist projection for final
  evidence summaries.
- Updated executable specs, task checklists, parent decisions, and operator
  documentation without changing any external cell to pass.

### Testing

- `git diff --check`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test -- --run` (63 tests)
- `pnpm build`
- `pnpm spike:semantic`, `pnpm spike:licenses`, and `pnpm spike:report`
- 3 targets × plugin versions `0.0.0` and `0.0.1`: package + verify
- Safe secret/model/report scan excluding `.envrc` content

### Status

[OK] **Repository-executable gaps closed; external gates unverified**

### Next Steps

- Run six real Obsidian cells and three native-GPU/semantic cells with the
  newly bound artifacts. Do not archive Spike 0 or create the MVP child map
  until the mandatory reports are returned and reviewed.

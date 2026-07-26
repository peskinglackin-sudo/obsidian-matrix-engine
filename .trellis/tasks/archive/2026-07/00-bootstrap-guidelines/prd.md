# Bootstrap Project Development Guidelines

## Goal

Replace the generic Trellis spec scaffolding with concise, project-specific
guidance for the Smart Lookup Enhanced Obsidian plugin.

## Scope

- Spec directories:
  - `.trellis/spec/backend/`
  - `.trellis/spec/frontend/`
  - `.trellis/spec/guides/`
- Project evidence:
  - `prd.md`
  - `AGENTS.md`
  - the current repository and CodeGraph index
- Out of scope:
  - product implementation;
  - choosing a final product source layout before Spike 0;
  - representing `.trellis/` or `.codex/` workflow code as plugin code.

## Architecture Context

The repository currently contains the v2.0 product/architecture PRD but no
product `src/`, package manifest, or product tests. The PRD fixes important
contracts for an Obsidian desktop plugin: native TypeScript UI, replaceable
storage/provider boundaries, LanceDB as rebuildable cache, multilingual exact /
lexical / semantic / hybrid retrieval, generation-safe indexing, local-first
privacy, explicit degradation, and a cross-platform Spike 0.

The specs must document those current contracts while explicitly identifying
which filesystem, tooling, and implementation patterns remain unproven. Future
implementation tasks must update the specs with real source/test paths as those
patterns become established.

## Files to Update

- Every `index.md` and topic guide under the three spec directories above.
- This task PRD and task metadata where needed for an accurate scope record.

## Rules

- Use `prd.md` sections and current repository inspection as evidence.
- Remove template prose, empty headings, and unrelated upstream Trellis cases.
- Do not invent product source examples, commands, or package conventions.
- Keep `backend/` as plugin core/storage/retrieval runtime guidance and
  `frontend/` as native Obsidian UI guidance until real package boundaries
  justify another structure.
- Ensure each index matches its final guide set and provides a practical
  pre-development checklist.

## Acceptance Criteria

- [x] Backend guides describe architecture, storage/indexing, failures,
      diagnostics/privacy, and verification using project-document evidence.
- [x] Frontend guides describe native Obsidian UI ownership, lifecycle, state,
      type boundaries, safety, accessibility, i18n, and verification.
- [x] Shared guides cover this project's cross-layer and single-owner risks.
- [x] The absence of product source/tests is documented instead of concealed by
      hypothetical examples.
- [x] No template placeholder or unrelated upstream-project advice remains in
      `.trellis/spec/`.
- [x] Index files match the final spec file set and internal links resolve.

# Plugin Core and Retrieval Runtime Guidelines

This layer covers the non-visual TypeScript runtime of the Obsidian desktop
plugin: source ingestion, language analysis, providers, storage, retrieval,
connections, diagnostics, and lifecycle management.

## Evidence status

The repository currently contains a reviewed product/architecture contract in
`prd.md`, but no product source tree, package manifest, or tests. The guides in
this directory therefore distinguish requirements already fixed by the PRD
from conventions that must be confirmed during Spike 0. Do not cite
`.trellis/scripts/` or `.codex/` as product implementation examples; those
files are workflow tooling.

## Guides

| Guide | Use it when |
|---|---|
| [Directory and architecture](./directory-structure.md) | Adding a module or deciding ownership/import direction |
| [Storage and indexing](./database-guidelines.md) | Changing LanceDB schemas, artifacts, IDs, indexes, or writes |
| [Errors, cancellation, and degradation](./error-handling.md) | Handling provider, vault, index, or lifecycle failures |
| [Diagnostics and privacy](./logging-guidelines.md) | Adding timings, logs, health data, or diagnostic export |
| [Quality and verification](./quality-guidelines.md) | Planning tests, Spike 0 probes, packaging, or review |

## Pre-development checklist

1. Read `prd.md` sections 11–17 and 20–23 for the current contract.
2. Read every guide above that touches the change.
3. Search for existing product code before creating a new abstraction or
   directory. If no implementation exists, record the chosen path in this
   spec as part of the same task.
4. Keep the vault as the source of truth and all index artifacts rebuildable.
5. Map cancellation, degradation, privacy, and artifact-fingerprint impact
   before implementation.

## Contract precedence

If source code later disagrees with this bootstrap spec, do not silently copy
either side. Check whether the PRD was superseded, resolve the discrepancy in
the active task, and update this spec with the resulting real source examples.

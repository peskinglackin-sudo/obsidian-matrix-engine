# Shared Thinking Guides

Use these guides for changes that cross the plugin core/UI split or risk
duplicating a contract. They supplement the layer-specific pre-development
checklists.

| Guide | Read it when |
|---|---|
| [Code ownership and reuse](./code-reuse-thinking-guide.md) | Adding/changing a type, hash, analyzer, filter, state projection, utility, or constant |
| [Cross-layer data flow](./cross-layer-thinking-guide.md) | A feature spans vault, parsing, provider, storage, retrieval, diagnostics, or UI |

## Mandatory triggers

Read both guides when changing:

- profile fields, artifact fingerprints, schemas, or migrations;
- provider requests, secrets, logging, or remote-content preview;
- query/filter/result types or search-mode degradation;
- source revision/generation, cancellation, or lifecycle cleanup;
- raw/normalized multilingual text and analyzer versions.

Before changing a value or contract, search for every definition and consumer.
Because `.codegraph/` exists, use CodeGraph first for symbol relationships and
blast radius, then verify claims against current source and tests.

## Evidence rule

At bootstrap, `prd.md` is the only product contract and no product source
exists. After implementation begins, every persistent rule in `.trellis/spec/`
must point to a real project source/test path or an explicitly current project
document. Do not use `.trellis/scripts/` as evidence for product conventions.

# Community native-sidecar distribution dossier

## Candidate layout

The private Spike creates one target-specific manual bundle with top-level
`main.js` and `manifest.json`, a bundled LanceDB JavaScript entry, exactly one
`vendor/native/*.node` sidecar, an SHA-256 artifact manifest, and notices.
Supported candidates are Windows x64, macOS arm64, and Linux x64 glibc.

## Evidence boundary

These bundles prove only manual runtime feasibility. Obsidian's documented
Community release assets are top-level `main.js`, `manifest.json`, and optional
`styles.css`; current reviewed documentation does not establish installation
or update behavior for this platform-specific sidecar layout. The plugin must
not self-download or self-update native code as an implicit workaround.

## Questions requiring written distribution-owner acceptance

1. May a Community plugin release contain target-specific `.node` sidecars and
   supporting JavaScript under `vendor/`?
2. Can the standard installer select exactly one correct platform artifact for
   Windows x64, macOS arm64, or Linux x64 glibc?
3. Does standard update preserve atomicity and rollback for a roughly
   117–174 MB native sidecar?
4. How must hashes, licenses, architecture rejection, and Electron/Node ABI
   compatibility be represented?
5. Is a single roughly 452 MB multi-platform release acceptable if target
   selection is unavailable?

## Current decision

No official documentation or written acceptance answers these questions for
the exact layout. Therefore Community packaging is `no-go` for
`@lancedb/lancedb@0.31.0`, even though manual bundles can be generated and the
Linux Node-only native precheck passed. Matrix Engine must replace the
production `VectorStore` before MVP architecture is frozen unless the
distribution owner later accepts the exact standard install/update path.

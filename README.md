# Matrix Engine（矩阵引擎）

Local-first multilingual retrieval and knowledge discovery for Obsidian
Desktop: exact, lexical, semantic, and hybrid search plus current-note
connections. Private development repository; see `prd.md` for the product
contract and `docs/mvp-architecture.md` for the implementation map.

多语言本地优先检索插件：精准 / 词法 / 语义 / 混合检索与当前笔记知识关联。

## Capabilities

- **Exact search** verified against raw text with char offsets and line
  ranges — index structures only propose candidates.
- **Multilingual lexical search**: plugin-side analyzer (Intl.Segmenter +
  CJK/Thai character ngrams + identifier expansion) feeding field-weighted
  BM25. No language-specific tokenizer required.
- **Semantic search** through a local llama.cpp server or any
  OpenAI-compatible embeddings service; cross-language capability is only
  claimed after the built-in verification passes.
- **Hybrid** ranking via Reciprocal Rank Fusion, source aggregation, and
  per-source diversity. Auto mode picks the pipeline from the query shape
  and always shows what actually ran.
- **Connections** for the active note and current selection with
  explainable edges (semantic / wikilink / backlink / shared tag), pin and
  hide feedback.
- **Incremental indexing**: event coalescing with latest-wins generations,
  layered hashes so nothing re-embeds without an input change, rename
  without data loss, dead-letter retry, pause/resume, full rebuild.
- **Privacy**: local-first by default; remote endpoints show a trust label
  and a full send preview; API keys live in Obsidian SecretStorage only.
- UI in English and 简体中文.

## Requirements

- Obsidian Desktop ≥ 1.11.4 (SecretStorage floor; desktop only).
- Optional for semantic search: a llama.cpp server with embeddings enabled
  (`llama-server --embedding …`) or an OpenAI-compatible endpoint. Exact
  and lexical search work with no model configured.

## Development

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test   # 269 tests
pnpm build                                  # bundles main.js
```

`main.js`, `manifest.json`, and `styles.css` form the plugin payload. Spike
harnesses live under `spike/` and `src/probe/` (see
`.trellis/tasks/07-15-spike-0-feasibility/results.md` for the recorded
architecture decisions: pure-TS storage backend, plugin-side lexical index,
flat vector search).

## License

Apache-2.0 for original source and fixtures (`LICENSE`,
`THIRD_PARTY_NOTICES.md`). Third-party models and services keep their own
licenses; nothing is downloaded automatically.

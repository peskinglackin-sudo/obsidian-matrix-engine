# State Management

No state library is selected and React/Vue/Svelte are excluded for MVP/P1.
Use explicit typed state owned by services and views; do not add a global state
dependency before real interaction complexity justifies it.

## State categories

| Category | Owner | Examples |
|---|---|---|
| Persisted configuration | `SettingsStore` | profiles, active profile, language, UI, maintenance, privacy |
| Secrets | Obsidian SecretStorage via `SecretStore` | API keys; settings retain only `secretRef` |
| Rebuildable durable cache | storage/artifact services | source catalog, chunks, manifests, indexes |
| Shared runtime state | typed services/event bus | provider/artifact health, queue state, cancellation, diagnostics |
| View-local state | owning view | current query draft, expanded row, focus, selected result, open tab |
| Derived state | selectors/planners | actual mode, filtered results, rebuild impact, connection evidence |

The vault, not UI state or LanceDB, is the source of truth for note content.

## Persisted settings

Validate and migrate loaded settings before exposing them. Update profiles by
stable ID; never rely on array position. A settings edit is a draft until its
validation, privacy preview, and rebuild-impact preview succeed.

Do not persist transient query progress, selected rows, raw errors, provider
responses, or full query history by default. Do not store secret material in
`PluginSettings` or `data.json`.

## Async state

Represent request identity/generation alongside loading/data/error/degradation
state. Only the current generation may publish. Cancellation caused by a newer
request transitions cleanly without erasing newer state.

Index status is a projection of manifest, queue, provider, artifact, and
maintenance services. Do not maintain an independent boolean such as
`isIndexed` in each view.

## Profile and artifact separation

Keep Provider, Embedding Recipe, Corpus, Lexical, Index Artifact, and Retrieval
Profile as separate typed entities (`prd.md` section 12). UI changes to query
template, limits, fusion weights, filters, timeouts, concurrency, or display
settings must not masquerade as artifact changes. Use the fingerprint planner
to derive rebuild impact.

## Avoid

- One mutable global object shared by all views.
- Duplicating artifact/provider status in several views.
- Mutating persisted settings on each keystroke without a validated draft.
- Encoding server/index truth solely in DOM state.
- Deriving embedding compatibility from model name alone.

# View and Component Patterns

Use native Obsidian view/setting APIs and small DOM rendering helpers. No
product implementation exists yet, so update this guide with concrete symbols
after the first vertical slice.

## View lifecycle

- Register views and commands from the plugin shell.
- Build and tear down DOM/listeners within the owning Obsidian lifecycle.
- On close/unload, cancel active work and detach all listeners/subscriptions.
- Rendering must be idempotent for the current typed state; do not encode
  durable state only in DOM attributes or child order.

## Lookup view

Follow `prd.md` section 18.1:

- Keep mode, result type, retrieval profile, and index status visible.
- Keep filters structured (folder, path, tag, extension, date, more); never
  turn raw field text into an SQL predicate in the UI.
- Show actual executed mode, rank reason, title, breadcrumb, optional language,
  location, snippet/highlight, and actions.
- Hydrate only first-paint fields; load expanded preview content on demand.
- Support keyboard selection, Enter to open, and Cmd/Ctrl+Enter for a new pane.
- Paginate or virtualize long result sets.

Every async state needs a deliberate rendering: idle, loading, partial or
degraded, empty, success, cancelled/replaced, and actionable error. Never leave
stale results visually associated with a new query.

## Connections and graph

Connections is a result list first: current source/selection, auto-update,
related notes, evidence, pin/hide/open/drag. Semantic Graph is P1, loads a
bounded ego graph on demand, distinguishes edge kinds, and remains secondary to
the actionable list (`prd.md` sections 18.2–18.3).

## Settings

Use the five PRD tabs: Overview, Models, Indexing, Retrieval, Advanced. Present
simple controls first and advanced artifact/profile details only when needed.

Before applying a configuration change, show exactly one impact category:
`No rebuild`, `Rebuild lexical indexes`, `Re-embed affected chunks`, or
`Build new artifact`. Provider tests must show destination, model, fields,
rendered example, and local/remote status before sending.

## Safe text and preview

- Render result snippets as escaped plain text with project-controlled `<mark>`
  elements for highlights.
- Expanded preview uses a restricted Markdown subset.
- Do not execute third-party code-block processors, load external resources,
  or automatically expand embeds/transclusions.
- Opening the original note is the path to full rendering.

Never set `innerHTML` from vault, query, provider, error, or translation data.
If the eventual renderer uses a reviewed sanitization API, document it here
with its source and tests.

## Localization and accessibility

- Every user-visible label, status, error, tooltip, and ARIA label uses an
  i18n key; English is the missing-key fallback.
- Format dates, numbers, percentages, and plurals through `Intl`.
- All operations must be keyboard accessible and focus-visible.
- Do not encode status by color alone; preserve light/dark theme contrast.
- Apply `dir="auto"` to user-content blocks so mixed and RTL text render safely.

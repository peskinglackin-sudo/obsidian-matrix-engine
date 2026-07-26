# UI Directory and Ownership

## Current repository state

The plugin shell exists at `src/main.ts`. The private Spike diagnostic view is
`src/probe/probe-view.ts`; it renders typed progress from
`PlatformProbeController` and releases its subscription in `onClose`.
Localized strings live in `src/i18n/en.json` and `src/i18n/zh-CN.json`, with
typed lookup/fallback in `src/i18n/translate.ts`; persistent identity remains
in `src/identity.ts`. No interactive product lookup UI exists yet. Treat other
names below as ownership boundaries, not mandatory folder names.

## Required UI ownership

- Plugin shell registers commands, leaves, item views, setting tabs, and
  lifecycle cleanup.
- Lookup view owns search controls and result presentation, but calls a typed
  retrieval service for execution.
- Connections view owns current-note/selection presentation and actions, but
  calls `ConnectionsService` for computation.
- Settings view edits validated draft profiles and previews rebuild/privacy
  effects; it does not directly mutate tables or secrets.
- Index status/diagnostics surfaces render typed health and safe errors.
- I18n service loads `src/i18n/en.json` and `src/i18n/zh-CN.json`, performs
  English fallback, and formats locale-sensitive values.
- Safe preview has a dedicated rendering policy; it is not an unrestricted
  invocation of the full Obsidian Markdown/plugin pipeline.

## Dependency direction

Views depend on UI-facing service contracts and shared domain types. They must
not import LanceDB, compile provider payloads, concatenate filter predicates,
or own artifact fingerprint logic. Core services must not import concrete view
classes or DOM nodes.

Keep user actions thin: parse DOM input into a typed command, call a service,
and render the returned state. Keep query parsing, filtering, fusion, and
storage out of event handlers.

## First implementation rule

Start with the smallest feature-oriented layout that supports the Spike 0 or
MVP slice. Do not create empty directories for every box in the PRD diagram.
When source exists, update this guide with:

- actual paths for the plugin shell, each registered view, settings, i18n, and
  safe preview;
- where shared domain types and UI-facing service interfaces live;
- at least two representative UI test paths;
- the exact cleanup/lifecycle pattern used by Obsidian components.

The current concrete cleanup pattern is the Spike view's owned unsubscribe:
`onOpen()` subscribes, `onClose()` invokes the returned disposer, and rendering
uses `text`/DOM primitives only. `tests/identity.test.ts` asserts the English
and `zh-CN` resource key sets remain identical. Product views must add direct
view/async tests when they are introduced; the Spike diagnostic surface does
not count as product lookup UI acceptance.

## Avoid

- A global `components/` bucket without feature ownership.
- Duplicated search-result or profile types inside individual views.
- Direct database/provider imports in UI directories.
- Hard-coded user strings in TypeScript.
- Adding a UI framework contrary to `prd.md` section 23.3.
- Treating `.codex/` agent configuration as part of the plugin UI.

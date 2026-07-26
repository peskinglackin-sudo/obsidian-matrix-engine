# UI Quality and Verification

## Current tooling state

TypeScript, ESLint, Vitest, and esbuild are configured in the root package.
Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. The only UI is
the private Spike diagnostic view at `src/probe/probe-view.ts`; it uses native
Obsidian/DOM APIs and localized text. Playwright remains only a P1 candidate.

## Review checklist

- No hard-coded user-visible strings; English and `zh-CN` resources stay in
  sync and missing keys fall back to English.
- Every operation is keyboard accessible, focus-visible, and labeled.
- Color is not the sole status cue; snippets support dark/light themes and
  user content uses `dir="auto"`.
- Query changes cancel prior work and reject stale completions.
- Loading, empty, degraded, failed, and offline states remain understandable.
- Exact/Lexical remain usable when semantic/provider work is unavailable.
- Result snippets are escaped; preview cannot execute third-party processors,
  fetch external resources, or expand embeds automatically.
- Long lists paginate/virtualize and full content hydrates lazily.
- Views release every listener, timer, observer, request, and subscription.
- Secret values, full documents, and query history do not leak into DOM
  diagnostics, settings, or exports.

## Test layers

- Pure tests: state reducers/projections, rebuild-impact display, score/reason
  formatting, i18n fallback, locale formatting, and safe highlight ranges.
- View tests: Lookup, Connections, Settings, error/degradation states, long
  lists, RTL/mixed text, keyboard navigation, focus, and safe preview.
- Async tests: debounce, cancellation, out-of-order completion, rapid active
  note/selection changes, close, and unload.
- Integration tests: commands/open behavior, drag/copy link, settings + secret
  references, provider privacy preview, and index maintenance actions.

Use realistic multilingual fixtures from the golden vault, including CJK,
Arabic/RTL, combining marks, emoji, non-ASCII paths, code identifiers, and
malicious-looking Markdown/HTML. Assert visible behavior and absence of unsafe
side effects, not only snapshots.

## Performance checks

Keep lookup first render within the PRD target (p95 below 50 ms in the stated
reference conditions), render only required fields, and measure `render_ms`
separately from retrieval/hydration. Test long-note competition and large
result sets; do not optimize with ANN or virtualized complexity without the
relevant measurements.

## Release checks

UI acceptance includes Obsidian enable/disable/reload/upgrade on every supported
desktop package, native dependency failure/degradation, non-ASCII paths, safe
database rebuild, and both bundled locales. Packaging success is part of UI
quality because a desktop-only native plugin that cannot load has no usable UI.

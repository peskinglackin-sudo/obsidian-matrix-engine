# Subscriptions and Async Effects

This project does not use React/Vue/Svelte, so “hooks” means lifecycle-bound
subscriptions and asynchronous UI effects, not framework hook functions.

## Ownership

The view or plugin shell that starts an effect owns its cleanup. For every
vault/workspace event, DOM listener, timer, queue subscription, observer,
provider request, or search request, register a matching cleanup action in the
same scope.

Prefer Obsidian's lifecycle registration helpers when they provide automatic
cleanup. Otherwise keep an explicit disposer/`AbortController` and invoke it
when the view closes or plugin unloads.

## Search effects

Interactive search uses all three protections from `prd.md` section 18.1:

1. Debounce input to avoid unnecessary work.
2. Abort the previous request when a newer query starts.
3. Compare request generation before publishing results.

Abort alone is not sufficient because an adapter may finish after cancellation
or return from a non-cancellable phase. Generation alone is not sufficient
because old work would still waste provider/DB capacity.

Search activity has priority over indexing maintenance. Do not schedule heavy
rendering or maintenance directly from every keystroke.

## Vault and current-note effects

- Coalesce rapid create/modify/rename/delete/metadata changes by path before
  dispatching indexing work.
- Connections auto-update reacts to the active note or selection through the
  typed service boundary and cancels superseded computations.
- Avoid feedback loops: rendering status must not itself modify persisted
  settings or re-enqueue indexing.

## Error/cancellation rendering

Expected cancellation caused by a newer input should not flash an error. A
real failure renders the typed, localized, actionable error or explicit
degradation state from the service. Preserve usable Exact/Lexical results when
semantic work fails.

## Verification

Use controlled promises/fake time to test debounce, cancellation, completion
out of order, view close, plugin unload, and rapid active-note changes. Assert
that no old generation mutates visible state and no listener continues after
its owner is destroyed.

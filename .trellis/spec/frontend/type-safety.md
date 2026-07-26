# Type Safety and Boundary Validation

TypeScript types document internal contracts; runtime validation protects
settings, imports, provider responses, database rows, and other external or
persisted boundaries. `zod` is the PRD-selected MVP validator, subject to the
first package setup.

## Single contract owners

Define each shared shape once and import it across adapters, services, and
views. This includes:

- `PluginSettings` and all profile/artifact descriptors;
- `SearchQueryAst` and structured filter nodes;
- provider/LanceDB capabilities and provider batch results;
- `SearchResult`, `SearchScore`, match reasons, and knowledge edges;
- diagnostics, health, error, cancellation, and rebuild-impact states.

Do not use view-local casts to reinterpret raw objects. Parse `unknown` at the
boundary, normalize it into a domain type, and pass only the domain type inward.

## Settings and migrations

- Treat persisted settings and raw import/export as `unknown`.
- Validate a versioned schema, migrate in ordered steps, then apply defaults.
- Keep unknown/invalid values out of active services and produce a safe,
  actionable migration error.
- Store only secret references, never secret values.

## Tagged state

Use discriminated unions for modes and state machines: search mode, score kind,
artifact state, provider state, result type, loading/degraded/error state, and
rebuild impact. Exhaustively handle them so adding a new variant fails at
compile time instead of silently falling through.

Preserve `SearchScore.rawKind` and direction. A distance, BM25 value, RRF score,
and rerank score are not interchangeable percentages.

## IDs, locale, and raw/norm fields

Use named fields/domain aliases for source, row, artifact, profile, and request
IDs so unrelated strings are not casually interchanged. Validate BCP 47 locale
values and use `und`/optional metadata for unknown language rather than lying
with a default.

Keep raw and normalized text visibly distinct in types. Exact verification and
display accept raw values; lexical planning consumes normalized/derived terms.

## DOM and i18n boundaries

Narrow `EventTarget` before reading element fields. Treat translation values
and vault text as text, not markup. I18n keys should be typed or otherwise
checked against English resources; debug mode reports missing keys and runtime
falls back to English.

## Avoid

- `any` at settings, provider, database, event, or view-service boundaries.
- `as SearchResult` or similar assertions over unvalidated payloads.
- Duplicating backend result types in UI files.
- Optional chaining that silently converts an invalid required contract into
  an empty UI.
- A single numeric `score` without its kind and direction semantics.

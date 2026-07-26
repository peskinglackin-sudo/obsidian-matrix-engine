# Code Ownership and Reuse

The main reuse risk in this project is not repeated syntax; it is several
layers owning slightly different versions of a retrieval, indexing, privacy,
or state contract.

## Before adding anything shared

1. Use CodeGraph to find definitions, callers, imports, and affected flows.
2. Search source, tests, `prd.md`, and specs for the concept and literal value.
3. Identify the one layer that should own the behavior.
4. Reuse or extend its contract; do not introduce a second owner for
   convenience.
5. Add/update boundary tests and the relevant spec if the convention changed.

## Contracts that require one owner

- Settings/profile/artifact schemas, defaults, migrations, and fingerprint
  input classification.
- Query AST, filter AST, compilation/binding, and exact-verification policy.
- Raw/normalized fields, Unicode/script analysis, identifier analysis, and
  analyzer/version behavior.
- Provider capability normalization, retry classification, cancellation, and
  secret handling.
- Search result, score kind/direction, match reasons, aggregation, and
  degradation state.
- Source revision/generation, stable IDs, write protocol, and maintenance
  health projection.
- I18n lookup/fallback/formatting, safe preview, diagnostics schema, and
  redaction/export policy.

## Extract by responsibility

Extract a shared helper when the operation has one stable meaning and repeated
callers. Give safety- or fingerprint-sensitive logic an explicit domain owner,
not a generic `utils` home. Examples include template rendering, hash planning,
filter compilation, score normalization, and redaction.

Keep code local when it is a small presentation detail with one caller or when
the apparently similar operations have different trust/fingerprint semantics.
Raw display normalization and lexical normalization, for example, must not be
collapsed simply because both manipulate strings.

## Change-impact checklist

For a shared contract change, verify all affected surfaces:

- persisted settings/schema and migration;
- artifact fingerprint and rebuild-impact preview;
- source/parser/provider/storage/retrieval consumers;
- UI rendering, i18n, accessibility, and diagnostics;
- unit, integration, golden-vault, benchmark, and packaging fixtures.

## Avoid

- Repeating literal default weights, limits, index names, or error codes.
- View-local casts of raw payload fields.
- Separate “UI versions” of domain result/profile types.
- Two normalization or hashing implementations with the same advertised name.
- Premature framework-like abstraction before two real use sites establish the
  stable contract.
- Reusing a helper across different trust boundaries without reviewing its
  validation and redaction behavior.

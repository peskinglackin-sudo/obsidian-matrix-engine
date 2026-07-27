/**
 * Query AST (PRD 9.2).
 *
 * The parser produces this AST only; retrievers and the filter compiler
 * consume it. Nothing here emits storage-level predicates directly.
 */

export type TermNode = Readonly<{ text: string }>;
export type PhraseNode = Readonly<{ text: string }>;

export type FieldClauseField = "title" | "file" | "id";
export type FieldClause = Readonly<{ field: FieldClauseField; value: string }>;

export type MetadataFilterNode =
  | Readonly<{ kind: "folder"; value: string }>
  | Readonly<{ kind: "path"; value: string }>
  | Readonly<{ kind: "ext"; value: string }>
  | Readonly<{ kind: "tag"; value: string }>
  | Readonly<{ kind: "before"; value: number }>
  | Readonly<{ kind: "after"; value: number }>;

export type SearchModeHint = "auto" | "exact" | "lexical" | "semantic" | "hybrid";

export type SearchQueryAst = Readonly<{
  raw: string;
  positiveTerms: readonly TermNode[];
  exactPhrases: readonly PhraseNode[];
  excludedTerms: readonly TermNode[];
  fieldClauses: readonly FieldClause[];
  filters: readonly MetadataFilterNode[];
  modeHint?: SearchModeHint;
  languageHint?: string;
}>;

export function hasContentQuery(ast: SearchQueryAst): boolean {
  return ast.positiveTerms.length > 0 || ast.exactPhrases.length > 0 || ast.fieldClauses.length > 0;
}

export function isMetadataOnly(ast: SearchQueryAst): boolean {
  return !hasContentQuery(ast) && ast.filters.length > 0;
}

/**
 * Text normalization (PRD 8.2).
 *
 * Raw text is never overwritten: callers keep the raw form for display and
 * final exact verification. These helpers produce the retrieval-normalized
 * form used for lexical recall and the accent-folded secondary form.
 */

export function normalizeLexical(text: string, nfkc: boolean): string {
  const unified = (nfkc ? text.normalize("NFKC") : text).toLowerCase();
  return collapseWhitespace(unified);
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function foldAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

/** Case-insensitive fold for exact matching that must not change lengths per code point run. */
export function foldForExactComparison(text: string, caseSensitive: boolean): string {
  return caseSensitive ? text : text.toLowerCase();
}

import { isCompoundIdentifier } from "../analysis/identifier";
import type { SearchQueryAst } from "../query/ast";
import type { ExactCandidateInput, ExactField, LexicalStore, RowFilter, ChunkReader } from "../storage/contracts";

/**
 * ExactRetriever (PRD 7.1, 15.2).
 *
 * Candidates come from the store's raw scans; every hit is then verified
 * against the raw field or raw chunk text with the user's case policy, and
 * char offsets/line ranges are computed from the verified position. Index
 * structures never decide final truth.
 */

export type ExactNeedle = Readonly<{ phrase: string; fields: readonly ExactField[] }>;

export type ExactHit = Readonly<{
  sourceId: string;
  rowId?: string;
  field: ExactField;
  phrase: string;
  /** Verified char offset within the chunk text (text hits) or the matched field value. */
  offset: number;
  /** Verified line number within the source for text hits. */
  line?: number;
  matchLength: number;
}>;

const FIELD_PRIORITY: Readonly<Record<ExactField, number>> = {
  title: 0,
  alias: 1,
  filename: 2,
  path: 3,
  text: 4,
  tag: 5
};

/** Needles derived from the AST (PRD 7.1 defaults). */
export function collectNeedles(ast: SearchQueryAst, mode: "auto" | "explicit_exact"): readonly ExactNeedle[] {
  const needles: ExactNeedle[] = [];
  for (const phrase of ast.exactPhrases) {
    needles.push({ phrase: phrase.text, fields: ["text", "title", "alias", "filename", "path", "tag"] });
  }
  for (const clause of ast.fieldClauses) {
    if (clause.field === "title") needles.push({ phrase: clause.value, fields: ["title", "alias"] });
    else if (clause.field === "file") needles.push({ phrase: clause.value, fields: ["filename", "path"] });
    else needles.push({ phrase: clause.value, fields: ["text", "title", "filename"] });
  }
  for (const term of ast.positiveTerms) {
    const precise = term.text.includes("/") || term.text.includes("::") || isCompoundIdentifier(term.text);
    if (mode === "explicit_exact" || precise) {
      needles.push({ phrase: term.text, fields: ["text", "title", "alias", "filename", "path", "tag"] });
    }
  }
  return needles;
}

export class ExactRetriever {
  readonly #store: LexicalStore;
  readonly #chunks: ChunkReader;

  constructor(store: LexicalStore, chunks: ChunkReader) {
    this.#store = store;
    this.#chunks = chunks;
  }

  async retrieve(input: Readonly<{
    needles: readonly ExactNeedle[];
    caseSensitive: boolean;
    limit: number;
    filter?: RowFilter;
  }>): Promise<readonly ExactHit[]> {
    const hits: ExactHit[] = [];
    const seen = new Set<string>();
    for (const needle of input.needles) {
      if (needle.phrase.length === 0) continue;
      const candidateInput: ExactCandidateInput = {
        phrase: needle.phrase,
        caseSensitive: input.caseSensitive,
        fields: needle.fields,
        limit: input.limit * 2,
        ...(input.filter === undefined ? {} : { filter: input.filter })
      };
      const candidates = await this.#store.exactCandidates(candidateInput);
      for (const candidate of candidates) {
        const verified = this.#verify(candidate.sourceId, candidate.rowId, candidate.field, needle.phrase, input.caseSensitive);
        if (verified === undefined) continue;
        const key = `${verified.sourceId}|${verified.rowId ?? ""}|${verified.field}|${needle.phrase}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push(verified);
      }
    }
    hits.sort((left, right) => {
      const fieldOrder = FIELD_PRIORITY[left.field] - FIELD_PRIORITY[right.field];
      if (fieldOrder !== 0) return fieldOrder;
      return left.offset - right.offset;
    });
    return Object.freeze(hits.slice(0, input.limit));
  }

  #verify(sourceId: string, rowId: string | undefined, field: ExactField, phrase: string, caseSensitive: boolean): ExactHit | undefined {
    if (field === "text" && rowId !== undefined) {
      const chunk = this.#chunks.getChunk(rowId);
      if (chunk === undefined) return undefined;
      const position = findVerified(chunk.textRaw, phrase, caseSensitive);
      if (position === undefined) return undefined;
      const linesBefore = countLines(chunk.textRaw, position);
      return Object.freeze({
        sourceId,
        rowId,
        field,
        phrase,
        offset: position,
        line: chunk.lineStart + linesBefore,
        matchLength: phrase.length
      });
    }
    // Source-level fields were scanned against the raw value already; the
    // store reported the offset of the first occurrence. Re-verify defensively.
    return Object.freeze({ sourceId, ...(rowId === undefined ? {} : { rowId }), field, phrase, offset: 0, matchLength: phrase.length });
  }
}

/**
 * Verified raw-position search. Uses simple folding when it preserves
 * offsets; falls back to a per-position comparison when case folding
 * changes string length (e.g. Turkish dotted I).
 */
export function findVerified(haystackRaw: string, phrase: string, caseSensitive: boolean): number | undefined {
  if (caseSensitive) {
    const index = haystackRaw.indexOf(phrase);
    return index >= 0 ? index : undefined;
  }
  const foldedHaystack = haystackRaw.toLowerCase();
  const foldedPhrase = phrase.toLowerCase();
  if (foldedHaystack.length === haystackRaw.length) {
    const index = foldedHaystack.indexOf(foldedPhrase);
    return index >= 0 ? index : undefined;
  }
  for (let start = 0; start + phrase.length <= haystackRaw.length; start += 1) {
    if (haystackRaw.slice(start, start + phrase.length).toLowerCase() === foldedPhrase) return start;
  }
  return undefined;
}

function countLines(text: string, before: number): number {
  let count = 0;
  for (let index = 0; index < before; index += 1) {
    if (text[index] === "\n") count += 1;
  }
  return count;
}

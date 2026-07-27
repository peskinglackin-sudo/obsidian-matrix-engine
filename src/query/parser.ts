import type { FieldClause, MetadataFilterNode, PhraseNode, SearchModeHint, SearchQueryAst, TermNode } from "./ast";

/**
 * MVP query syntax parser (PRD 9.1).
 *
 *   "exact phrase"   -excluded        folder:research  path:projects
 *   file:design      ext:md           tag:ai           title:embedding
 *   before:2026-01-01 after:2025-01-01 id:IndexProfile
 *   exact:/lexical:/semantic:/hybrid: mode prefixes
 *
 * Tokens with unknown prefixes (e.g. std::vector) stay ordinary terms.
 * Invalid filter values fall back to plain terms so nothing disappears
 * silently.
 */

const MODE_PREFIX = /^(auto|exact|lexical|semantic|hybrid):\s*/iu;
const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const FILTER_KEYS = new Set(["folder", "path", "file", "ext", "tag", "title", "before", "after", "id"]);

type RawToken = Readonly<{ text: string; negated: boolean; quoted: boolean; key?: string; value?: string }>;

export function parseQuery(raw: string): SearchQueryAst {
  let working = raw.trim();
  let modeHint: SearchModeHint | undefined;
  const modeMatch = MODE_PREFIX.exec(working);
  if (modeMatch !== null) {
    modeHint = (modeMatch[1] ?? "auto").toLowerCase() as SearchModeHint;
    working = working.slice(modeMatch[0].length);
  }

  const positiveTerms: TermNode[] = [];
  const exactPhrases: PhraseNode[] = [];
  const excludedTerms: TermNode[] = [];
  const fieldClauses: FieldClause[] = [];
  const filters: MetadataFilterNode[] = [];

  for (const token of scanTokens(working)) {
    if (token.quoted) {
      if (token.text.length === 0) continue;
      if (token.negated) excludedTerms.push({ text: token.text });
      else exactPhrases.push({ text: token.text });
      continue;
    }
    if (token.key !== undefined && token.value !== undefined && !token.negated) {
      if (applyKeyedToken(token.key, token.value, fieldClauses, filters)) continue;
    }
    if (token.text.length === 0) continue;
    if (token.negated) excludedTerms.push({ text: token.text });
    else positiveTerms.push({ text: token.text });
  }

  return Object.freeze({
    raw,
    positiveTerms: Object.freeze(positiveTerms),
    exactPhrases: Object.freeze(exactPhrases),
    excludedTerms: Object.freeze(excludedTerms),
    fieldClauses: Object.freeze(fieldClauses),
    filters: Object.freeze(filters),
    ...(modeHint === undefined ? {} : { modeHint })
  });
}

function applyKeyedToken(key: string, value: string, fieldClauses: FieldClause[], filters: MetadataFilterNode[]): boolean {
  if (value.length === 0) return true;
  switch (key) {
    case "folder":
      filters.push({ kind: "folder", value });
      return true;
    case "path":
      filters.push({ kind: "path", value });
      return true;
    case "ext":
      filters.push({ kind: "ext", value: value.replace(/^\./u, "").toLowerCase() });
      return true;
    case "tag":
      filters.push({ kind: "tag", value: value.replace(/^#/u, "") });
      return true;
    case "before":
    case "after": {
      const timestamp = parseDate(value, key === "before");
      if (timestamp === undefined) return false;
      filters.push(key === "before" ? { kind: "before", value: timestamp } : { kind: "after", value: timestamp });
      return true;
    }
    case "file":
      fieldClauses.push({ field: "file", value });
      return true;
    case "title":
      fieldClauses.push({ field: "title", value });
      return true;
    case "id":
      fieldClauses.push({ field: "id", value });
      return true;
    default:
      return false;
  }
}

function parseDate(value: string, endOfDay: boolean): number | undefined {
  const match = DATE_VALUE.exec(value);
  if (match === null) return undefined;
  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const base = Date.UTC(year, month - 1, day);
  return endOfDay ? base : base + 24 * 60 * 60 * 1000 - 1;
}

function scanTokens(input: string): readonly RawToken[] {
  const tokens: RawToken[] = [];
  let index = 0;
  const length = input.length;
  while (index < length) {
    while (index < length && /\s/u.test(input[index] ?? "")) index += 1;
    if (index >= length) break;

    let negated = false;
    if (input[index] === "-" && index + 1 < length && !/\s/u.test(input[index + 1] ?? "")) {
      negated = true;
      index += 1;
    }

    if (input[index] === '"') {
      const closing = input.indexOf('"', index + 1);
      const end = closing < 0 ? length : closing;
      tokens.push(Object.freeze({ text: input.slice(index + 1, end).trim(), negated, quoted: true }));
      index = closing < 0 ? length : closing + 1;
      continue;
    }

    const start = index;
    let seenColon = false;
    while (index < length && !/\s/u.test(input[index] ?? "")) {
      const char = input[index];
      if (char === '"' && !seenColon) break;
      if (char === ":") seenColon = true;
      index += 1;
    }
    let text = input.slice(start, index);

    const colon = text.indexOf(":");
    if (colon > 0 && FILTER_KEYS.has(text.slice(0, colon).toLowerCase())) {
      const key = text.slice(0, colon).toLowerCase();
      let value = text.slice(colon + 1);
      if (value.startsWith('"')) {
        // Quoted filter value: tag:"my tag"
        const rest = input.slice(index);
        if (!value.endsWith('"') || value.length < 2) {
          const closing = rest.indexOf('"');
          if (closing >= 0) {
            value = `${value.slice(1)}${rest.slice(0, closing)}`;
            index += closing + 1;
          } else {
            value = value.slice(1);
          }
        } else {
          value = value.slice(1, -1);
        }
      }
      tokens.push(Object.freeze({ text, negated, quoted: false, key, value: value.trim() }));
      continue;
    }

    if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) text = text.slice(1, -1);
    tokens.push(Object.freeze({ text, negated, quoted: false }));
  }
  return tokens;
}

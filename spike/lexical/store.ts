import { analyzeText } from "./analyzer";
import type { LexicalDocument, LexicalQuery } from "./fixtures";
import type { QueryResult } from "./metrics";

export function runReferenceLexical(documents: readonly LexicalDocument[], queries: readonly LexicalQuery[]): readonly QueryResult[] {
  const indexed = documents.map((document) => {
    const analyzed = analyzeText([document.title, document.body, document.path, ...document.tags].join(" "));
    return { id: document.id, group: document.group, normalized: analyzed.normalized, terms: new Set([...analyzed.terms, ...analyzed.ngrams, ...analyzed.identifierTerms]) };
  });
  return queries.map((query) => {
    const analyzed = analyzeText(query.text);
    const needles = [...analyzed.terms, ...analyzed.ngrams, ...analyzed.identifierTerms];
    const ranked = indexed.filter((document) => document.group === query.group).map((document) => ({ id: document.id, score: query.category === "phrase-order" ? (document.normalized.includes(analyzed.normalized) ? needles.length + 1 : 0) : needles.filter((term) => document.terms.has(term)).length })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map(({ id }) => id);
    return Object.freeze({ queryId: query.id, rankedTargetIds: Object.freeze(ranked) });
  });
}

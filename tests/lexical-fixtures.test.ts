import { describe, expect, it } from "vitest";
import { analyzeText } from "../spike/lexical/analyzer";
import { buildLexicalFixtures, LEXICAL_CATEGORIES, LEXICAL_GROUPS } from "../spike/lexical/fixtures";
import { evaluateLexical } from "../spike/lexical/metrics";
import { runReferenceLexical } from "../spike/lexical/store";
describe("multilingual lexical fixtures", () => {
  it("meets every distribution and identity gate", () => {
    const fixtures = buildLexicalFixtures();
    expect(fixtures.documents).toHaveLength(140); expect(fixtures.queries.filter((query) => query.gating)).toHaveLength(420); expect(fixtures.queries.filter((query) => !query.gating).length).toBeGreaterThanOrEqual(60); expect(fixtures.sha256).toMatch(/^[a-f0-9]{64}$/u);
    for (const group of LEXICAL_GROUPS) { const queries = fixtures.queries.filter((query) => query.gating && query.group === group); expect(queries).toHaveLength(30); expect(new Set(queries.flatMap((query) => query.expectedTargets)).size).toBeGreaterThanOrEqual(10); for (const category of LEXICAL_CATEGORIES) expect(queries.filter((query) => query.category === category)).toHaveLength(5); }
  });
  it("passes hard gates independently with the replaceable reference store", () => { const fixtures = buildLexicalFixtures(); const groups = evaluateLexical(fixtures.queries, runReferenceLexical(fixtures.documents, fixtures.queries)); expect(groups).toHaveLength(14); expect(groups.every((group) => group.pass)).toBe(true); });
  it("binds category queries to the intended source representation", () => {
    const fixtures = buildLexicalFixtures();
    for (const query of fixtures.queries.filter(({ gating }) => gating)) {
      const document = fixtures.documents.find(({ id }) => id === query.expectedTargets[0]);
      if (document === undefined) throw new Error("Expected lexical target is missing");
      if (query.category === "title-key") expect(document.title).toContain(query.text);
      if (query.category === "body" || query.category === "phrase-order" || query.category === "segmentation-risk") expect(document.body).toContain(query.text);
      if (query.category === "metadata") expect(`${document.path} ${document.tags.join(" ")}`).toContain(query.text);
      if (query.category === "normalization") { expect(document.body).not.toContain(query.text); expect(analyzeText(document.body).normalized).toContain(query.text); }
    }
  });
  it("preserves raw, normalized, ngram, identifier and script representations", () => { const value = analyzeText("检索Engine vector_store Café"); expect(value.raw).toContain("Engine"); expect(value.normalized).toContain("engine"); expect(value.ngrams).toContain("检索"); expect(value.identifierTerms).toContain("vector"); expect(value.scripts).toEqual(expect.arrayContaining(["Han", "Latin"])); });
});

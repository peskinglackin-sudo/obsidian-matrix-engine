import { describe, expect, it } from "vitest";

import { isMetadataOnly } from "../src/query/ast";
import { compileFilters } from "../src/query/filter-compiler";
import { parseQuery } from "../src/query/parser";
import { planQuery, type PipelineCapabilities } from "../src/query/planner";

const ALL_READY: PipelineCapabilities = { embeddingReady: true, lexicalReady: true, storeReady: true };

describe("query parser (PRD 9.1)", () => {
  it("parses plain terms", () => {
    const ast = parseQuery("vector database design");
    expect(ast.positiveTerms.map(({ text }) => text)).toEqual(["vector", "database", "design"]);
    expect(ast.exactPhrases).toHaveLength(0);
  });

  it("parses quoted phrases", () => {
    const ast = parseQuery('"embedding dimension" other');
    expect(ast.exactPhrases).toEqual([{ text: "embedding dimension" }]);
    expect(ast.positiveTerms).toEqual([{ text: "other" }]);
  });

  it("parses exclusions for terms and phrases", () => {
    const ast = parseQuery('results -excluded -"bad phrase"');
    expect(ast.excludedTerms.map(({ text }) => text)).toEqual(["excluded", "bad phrase"]);
  });

  it("parses metadata filters", () => {
    const ast = parseQuery("folder:research path:projects ext:.MD tag:#ai");
    expect(ast.filters).toEqual([
      { kind: "folder", value: "research" },
      { kind: "path", value: "projects" },
      { kind: "ext", value: "md" },
      { kind: "tag", value: "ai" }
    ]);
  });

  it("parses date filters as UTC ranges", () => {
    const ast = parseQuery("before:2026-01-01 after:2025-01-01");
    const before = ast.filters.find((filter) => filter.kind === "before");
    const after = ast.filters.find((filter) => filter.kind === "after");
    expect(before?.value).toBe(Date.UTC(2026, 0, 1));
    expect(after?.value).toBe(Date.UTC(2025, 0, 1) + 24 * 60 * 60 * 1000 - 1);
  });

  it("keeps invalid dates as terms instead of dropping them", () => {
    const ast = parseQuery("before:notadate");
    expect(ast.filters).toHaveLength(0);
    expect(ast.positiveTerms).toEqual([{ text: "before:notadate" }]);
  });

  it("parses field clauses for file, title, and id", () => {
    const ast = parseQuery("file:design.md title:embedding id:IndexProfile");
    expect(ast.fieldClauses).toEqual([
      { field: "file", value: "design.md" },
      { field: "title", value: "embedding" },
      { field: "id", value: "IndexProfile" }
    ]);
  });

  it("keeps unknown prefixes like std::vector as terms", () => {
    const ast = parseQuery("std::vector map:entry");
    expect(ast.positiveTerms.map(({ text }) => text)).toEqual(["std::vector", "map:entry"]);
  });

  it("parses mode shortcuts and keeps the rest of the query", () => {
    const ast = parseQuery("semantic:如何维护增量索引");
    expect(ast.modeHint).toBe("semantic");
    expect(ast.positiveTerms).toEqual([{ text: "如何维护增量索引" }]);
    expect(parseQuery("exact:IndexProfileService").modeHint).toBe("exact");
    expect(parseQuery("lexical:vector database").positiveTerms).toHaveLength(2);
  });

  it("supports quoted filter values", () => {
    const ast = parseQuery('tag:"my tag" rest');
    expect(ast.filters).toEqual([{ kind: "tag", value: "my tag" }]);
    expect(ast.positiveTerms).toEqual([{ text: "rest" }]);
  });

  it("treats filter-only queries as metadata-only", () => {
    expect(isMetadataOnly(parseQuery("folder:research ext:md"))).toBe(true);
    expect(isMetadataOnly(parseQuery("folder:research term"))).toBe(false);
  });
});

describe("filter compiler (PRD 21.4)", () => {
  it("compiles AST filters into a structured RowFilter", () => {
    const filter = compileFilters(parseQuery("folder:research path:proj tag:ai ext:md before:2026-01-01 after:2025-01-01"));
    expect(filter.folders).toEqual(["research"]);
    expect(filter.pathContains).toEqual(["proj"]);
    expect(filter.tags).toEqual(["ai"]);
    expect(filter.extensions).toEqual(["md"]);
    expect(filter.mtimeBefore).toBe(Date.UTC(2026, 0, 1));
    expect(filter.mtimeAfter).toBeGreaterThan(Date.UTC(2025, 0, 1));
  });

  it("merges with a base filter and keeps source exclusions", () => {
    const filter = compileFilters(parseQuery("tag:extra"), { tags: ["base"], excludeSourceIds: ["s9"] });
    expect(filter.tags).toEqual(["base", "extra"]);
    expect(filter.excludeSourceIds).toEqual(["s9"]);
  });
});

describe("query planner (PRD 7.5)", () => {
  it("plans exact+lexical for quoted phrases, paths, and identifiers", () => {
    for (const raw of ['"exact phrase"', "file:design.md", "src/main.ts", "IndexProfileService"]) {
      const plan = planQuery(parseQuery(raw), "auto", ALL_READY);
      expect(plan.runExact).toBe(true);
      expect(plan.runLexical).toBe(true);
      expect(plan.runSemantic).toBe(false);
      expect(plan.executedLabel).toBe("exact+lexical");
    }
  });

  it("plans reduced-weight semantic for one to three short words", () => {
    const plan = planQuery(parseQuery("vector database"), "auto", ALL_READY);
    expect(plan.runSemantic).toBe(true);
    expect(plan.semanticWeightFactor).toBe(0.5);
    expect(plan.executedLabel).toBe("hybrid");
  });

  it("plans full hybrid for natural language questions", () => {
    const question = planQuery(parseQuery("how to avoid recomputing all vectors after rename"), "auto", ALL_READY);
    expect(question.runSemantic).toBe(true);
    expect(question.semanticWeightFactor).toBe(1);
    const cjk = planQuery(parseQuery("如何维护增量向量索引"), "auto", ALL_READY);
    expect(cjk.runSemantic).toBe(true);
    expect(cjk.semanticWeightFactor).toBe(1);
  });

  it("plans metadata scan for filter-only queries", () => {
    const plan = planQuery(parseQuery("folder:research"), "auto", ALL_READY);
    expect(plan.metadataOnly).toBe(true);
    expect(plan.executedLabel).toBe("metadata");
  });

  it("degrades to exact+lexical when the model is unavailable (PRD 7.5, FR-011)", () => {
    const plan = planQuery(parseQuery("natural language question about indexing"), "auto", { ...ALL_READY, embeddingReady: false });
    expect(plan.runSemantic).toBe(false);
    expect(plan.runLexical).toBe(true);
    expect(plan.degraded).toContain("semantic_unavailable");
    expect(plan.executedLabel).toBe("exact+lexical");
  });

  it("degrades explicit semantic mode to exact+lexical with a visible reason", () => {
    const plan = planQuery(parseQuery("semantic:concept search"), "auto", { ...ALL_READY, embeddingReady: false });
    expect(plan.runExact).toBe(true);
    expect(plan.runLexical).toBe(true);
    expect(plan.runSemantic).toBe(false);
    expect(plan.degraded).toContain("semantic_unavailable");
  });

  it("degrades to exact+semantic when the lexical index is unavailable", () => {
    const plan = planQuery(parseQuery("short words"), "auto", { ...ALL_READY, lexicalReady: false });
    expect(plan.runLexical).toBe(false);
    expect(plan.runExact).toBe(true);
    expect(plan.runSemantic).toBe(true);
    expect(plan.degraded).toContain("lexical_unavailable");
  });

  it("honors explicit modes from settings", () => {
    expect(planQuery(parseQuery("term"), "exact", ALL_READY).executedLabel).toBe("exact");
    expect(planQuery(parseQuery("term"), "lexical", ALL_READY).executedLabel).toBe("lexical");
    expect(planQuery(parseQuery("term"), "semantic", ALL_READY).executedLabel).toBe("semantic");
    expect(planQuery(parseQuery("term"), "hybrid", ALL_READY).executedLabel).toBe("hybrid");
  });

  it("reports an empty store", () => {
    const plan = planQuery(parseQuery("term"), "auto", { ...ALL_READY, storeReady: false });
    expect(plan.degraded).toContain("store_empty");
  });
});

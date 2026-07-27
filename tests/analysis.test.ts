import { describe, expect, it } from "vitest";

import { analyzeText, type AnalyzerOptions } from "../src/analysis/analyzer";
import { analyzePath, expandIdentifier, extractIdentifierTerms, isCompoundIdentifier, splitIdentifier } from "../src/analysis/identifier";
import { collapseWhitespace, foldAccents, normalizeLexical } from "../src/analysis/normalize";
import { fallbackSegments, segmentWords } from "../src/analysis/segmenter";
import { analyzeLanguage, containsNoSpaceScript } from "../src/analysis/scripts";

const OPTIONS: AnalyzerOptions = {
  useIntlSegmenter: true,
  cjkNgramMin: 2,
  cjkNgramMax: 3,
  normalizeNfkc: true,
  accentFoldSecondary: true,
  identifierSplitting: true
};

describe("normalization (PRD 8.2)", () => {
  it("applies NFKC, casefold, and whitespace unification", () => {
    expect(normalizeLexical("ＡＢＣ　１２３\n\tＸ", true)).toBe("abc 123 x");
  });

  it("keeps composed characters when NFKC is disabled", () => {
    expect(normalizeLexical("Ｃafé", false)).toBe("ｃafé");
  });

  it("folds accents into a secondary form without touching base letters", () => {
    expect(foldAccents("café résumé naïve")).toBe("cafe resume naive");
    expect(foldAccents("häuser")).toBe("hauser");
  });

  it("collapses interior whitespace", () => {
    expect(collapseWhitespace("  a  b \n c ")).toBe("a b c");
  });
});

describe("script classification (PRD 8.3)", () => {
  it("detects Japanese via kana", () => {
    const metadata = analyzeLanguage("日本語のテキストです");
    expect(metadata.primaryLanguage).toBe("ja");
    expect(metadata.scripts).toContain("Hiragana");
    expect(metadata.languages).toContain("ja");
  });

  it("treats Han-only text as Chinese", () => {
    const metadata = analyzeLanguage("向量数据库设计");
    expect(metadata.primaryLanguage).toBe("zh");
    expect(metadata.mixed).toBe(false);
  });

  it("detects Korean, Thai, Arabic, and Hebrew", () => {
    expect(analyzeLanguage("한국어 텍스트").primaryLanguage).toBe("ko");
    expect(analyzeLanguage("ภาษาไทย").primaryLanguage).toBe("th");
    expect(analyzeLanguage("نص عربي").primaryLanguage).toBe("ar");
    expect(analyzeLanguage("טקסט עברי").primaryLanguage).toBe("he");
  });

  it("marks mixed Chinese/English content", () => {
    const metadata = analyzeLanguage("使用 embedding 模型进行检索");
    expect(metadata.mixed).toBe(true);
    expect(metadata.scripts).toContain("Han");
    expect(metadata.scripts).toContain("Latin");
  });

  it("returns und for Latin text instead of guessing", () => {
    const metadata = analyzeLanguage("incremental vector indexing");
    expect(metadata.primaryLanguage).toBe("und");
    expect(metadata.confidence).toBeUndefined();
  });

  it("identifies no-space scripts", () => {
    expect(containsNoSpaceScript("向量")).toBe(true);
    expect(containsNoSpaceScript("ไทย")).toBe(true);
    expect(containsNoSpaceScript("plain latin")).toBe(false);
  });
});

describe("segmentation", () => {
  it("segments space languages with offsets", () => {
    const segments = segmentWords("vector database design", true);
    expect(segments.map(({ text }) => text)).toEqual(["vector", "database", "design"]);
    expect(segments[0]?.index).toBe(0);
    expect(segments[1]?.index).toBe(7);
  });

  it("falls back to letter/number runs when Intl is disabled", () => {
    const segments = segmentWords("foo_bar 123 baz", false);
    expect(segments.map(({ text }) => text)).toEqual(["foo_bar", "123", "baz"]);
  });

  it("keeps fallback offsets aligned to the input", () => {
    const segments = fallbackSegments("a bb  ccc");
    expect(segments).toEqual([
      { text: "a", index: 0 },
      { text: "bb", index: 2 },
      { text: "ccc", index: 6 }
    ]);
  });
});

describe("identifier analysis (PRD 8.4.6)", () => {
  it("splits camel case, snake case, and scoped identifiers", () => {
    expect(splitIdentifier("IndexProfileService")).toEqual(["Index", "Profile", "Service"]);
    expect(splitIdentifier("index_profile_service")).toEqual(["index", "profile", "service"]);
    expect(splitIdentifier("std::vector")).toEqual(["std", "vector"]);
    expect(splitIdentifier("HTTPServer")).toEqual(["HTTP", "Server"]);
  });

  it("expands identifiers into the PRD variants", () => {
    const variants = expandIdentifier("IndexProfileService");
    for (const expected of ["indexprofileservice", "index", "profile", "service", "index_profile_service", "index-profile-service"]) {
      expect(variants).toContain(expected);
    }
  });

  it("does not expand plain words", () => {
    expect(isCompoundIdentifier("embedding")).toBe(false);
    expect(extractIdentifierTerms("plain words only")).toEqual([]);
  });

  it("extracts identifiers embedded in prose", () => {
    const terms = extractIdentifierTerms("Call IndexProfileService.rebuild() next");
    expect(terms).toContain("indexprofileservice");
    expect(terms).toContain("rebuild");
  });

  it("analyzes paths into segments, stem, extension, and full path", () => {
    const terms = analyzePath("Projects/Design/Spec.md");
    for (const expected of ["projects", "design", "spec.md", "spec", "md", "projects/design/spec.md"]) {
      expect(terms).toContain(expected);
    }
  });
});

describe("multilingual analyzer (PRD 8.4)", () => {
  it("produces lowercase word terms for space languages", () => {
    const analysis = analyzeText("Incremental Vector Indexing", OPTIONS);
    expect(analysis.terms).toEqual(["incremental", "vector", "indexing"]);
    expect(analysis.ngrams).toHaveLength(0);
  });

  it("keeps duplicate terms so BM25 term frequency survives", () => {
    const analysis = analyzeText("vector vector store", OPTIONS);
    expect(analysis.terms).toEqual(["vector", "vector", "store"]);
  });

  it("emits accent-folded secondary terms", () => {
    const analysis = analyzeText("Café Résumé", OPTIONS);
    expect(analysis.terms).toEqual(["café", "résumé"]);
    expect(analysis.secondaryTerms).toEqual(["cafe", "resume"]);
  });

  it("generates Han bigrams and trigrams", () => {
    const analysis = analyzeText("向量数据库", OPTIONS);
    for (const expected of ["向量", "量数", "数据", "据库", "向量数", "数据库"]) {
      expect(analysis.ngrams).toContain(expected);
    }
  });

  it("keeps short CJK runs as whole tokens", () => {
    const analysis = analyzeText("图", OPTIONS);
    expect(analysis.ngrams).toContain("图");
  });

  it("spans kanji/kana runs for Japanese", () => {
    const analysis = analyzeText("日本語テキスト", OPTIONS);
    expect(analysis.ngrams).toContain("日本");
    expect(analysis.ngrams).toContain("語テ");
  });

  it("produces Hangul syllable bigrams", () => {
    const analysis = analyzeText("한국어", OPTIONS);
    expect(analysis.ngrams).toContain("한국");
    expect(analysis.ngrams).toContain("국어");
  });

  it("generates Thai character ngrams", () => {
    const analysis = analyzeText("ภาษาไทย", OPTIONS);
    expect(analysis.ngrams.length).toBeGreaterThan(0);
    expect(analysis.ngrams).toContain("ภา");
  });

  it("separates Latin tokens inside CJK text", () => {
    const analysis = analyzeText("使用 embedding 模型", OPTIONS);
    expect(analysis.terms).toContain("embedding");
    expect(analysis.ngrams).toContain("模型");
  });

  it("expands identifiers from raw casing before lowercasing", () => {
    const analysis = analyzeText("see IndexProfileService for details", OPTIONS);
    expect(analysis.identifierTerms).toContain("index_profile_service");
  });

  it("normalizes full-width characters via NFKC", () => {
    const analysis = analyzeText("ＡＩ　Ｍｏｄｅｌ", OPTIONS);
    expect(analysis.terms).toEqual(["ai", "model"]);
  });
});

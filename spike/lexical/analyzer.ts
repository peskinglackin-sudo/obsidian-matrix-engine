export const ANALYZER_ID = "matrix-engine-multilingual" as const;
export const ANALYZER_VERSION = 1 as const;

export type AnalyzedText = Readonly<{
  raw: string;
  normalized: string;
  terms: readonly string[];
  ngrams: readonly string[];
  identifierTerms: readonly string[];
  scripts: readonly string[];
}>;

const MARKS = /\p{M}+/gu;
const WORDS = /[\p{L}\p{N}]+/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const IDENTIFIER_PARTS = /(?<=[\p{Ll}\d])(?=\p{Lu})|[\s_./:\\-]+/gu;

export function analyzeText(raw: string, locale = "und"): AnalyzedText {
  const normalized = raw.normalize("NFKC").toLocaleLowerCase(locale === "und" ? undefined : locale).replace(/\s+/gu, " ").trim();
  const accentFolded = normalized.normalize("NFKD").replace(MARKS, "").normalize("NFKC");
  const segmented = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(locale, { granularity: "word" }).segment(normalized)].filter(({ isWordLike }) => isWordLike).map(({ segment }) => segment)
    : normalized.match(WORDS) ?? [];
  const identifierTerms = raw.split(IDENTIFIER_PARTS).map((part) => part.normalize("NFKC").toLowerCase()).filter(Boolean);
  const ngrams = new Set<string>();
  for (const term of segmented) {
    const chars = Array.from(term);
    if (CJK.test(term)) {
      for (let size = 1; size <= Math.min(3, chars.length); size += 1) {
        for (let index = 0; index + size <= chars.length; index += 1) ngrams.add(chars.slice(index, index + size).join(""));
      }
    }
  }
  const scripts = new Set<string>();
  const scriptTests = { Han: /\p{Script=Han}/u, Latin: /\p{Script=Latin}/u, Arabic: /\p{Script=Arabic}/u, Cyrillic: /\p{Script=Cyrillic}/u, Devanagari: /\p{Script=Devanagari}/u, Thai: /\p{Script=Thai}/u, Hangul: /\p{Script=Hangul}/u, Japanese: /[\p{Script=Hiragana}\p{Script=Katakana}]/u };
  for (const [name, pattern] of Object.entries(scriptTests)) if (pattern.test(normalized)) scripts.add(name);
  return Object.freeze({ raw, normalized, terms: Object.freeze([...new Set([...segmented, accentFolded].filter(Boolean))]), ngrams: Object.freeze([...ngrams]), identifierTerms: Object.freeze([...new Set(identifierTerms)]), scripts: Object.freeze([...scripts]) });
}

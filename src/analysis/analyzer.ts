import { extractIdentifierTerms } from "./identifier";
import { foldAccents, normalizeLexical } from "./normalize";
import { segmentWords } from "./segmenter";

/**
 * Default multilingual lexical analyzer (PRD 8.4).
 *
 * One pipeline covers space-separated scripts, CJK, and no-space scripts:
 * word segmentation for terms, character ngrams for no-space recall, accent
 * folding into a secondary field, and identifier expansion from raw text
 * (camel boundaries require the original casing).
 */

export const ANALYZER_ID = "unicode-multilingual";
export const ANALYZER_VERSION = 1;

export type AnalyzerOptions = Readonly<{
  useIntlSegmenter: boolean;
  cjkNgramMin: number;
  cjkNgramMax: number;
  normalizeNfkc: boolean;
  accentFoldSecondary: boolean;
  identifierSplitting: boolean;
}>;

export type AnalyzedText = Readonly<{
  terms: readonly string[];
  secondaryTerms: readonly string[];
  ngrams: readonly string[];
  identifierTerms: readonly string[];
}>;

const NGRAM_RUN_CLASSES: readonly RegExp[] = [
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu,
  /\p{Script=Hangul}+/gu,
  /\p{Script=Thai}+/gu,
  /\p{Script=Lao}+/gu,
  /\p{Script=Myanmar}+/gu,
  /\p{Script=Khmer}+/gu
];

export function analyzeText(rawText: string, options: AnalyzerOptions): AnalyzedText {
  const normalized = normalizeLexical(rawText, options.normalizeNfkc);
  const segments = segmentWords(normalized, options.useIntlSegmenter);

  const terms: string[] = [];
  const secondaryTerms: string[] = [];
  for (const segment of segments) {
    terms.push(segment.text);
    if (options.accentFoldSecondary) {
      const folded = foldAccents(segment.text);
      if (folded !== segment.text && folded.length > 0) secondaryTerms.push(folded);
    }
  }

  return Object.freeze({
    terms: Object.freeze(terms),
    secondaryTerms: Object.freeze(secondaryTerms),
    ngrams: Object.freeze(collectNgrams(normalized, options.cjkNgramMin, options.cjkNgramMax)),
    identifierTerms: Object.freeze(options.identifierSplitting ? [...extractIdentifierTerms(rawText)] : [])
  });
}

function collectNgrams(normalized: string, min: number, max: number): string[] {
  const ngrams: string[] = [];
  for (const runClass of NGRAM_RUN_CLASSES) {
    for (const match of normalized.matchAll(runClass)) {
      emitRunNgrams(match[0], min, max, ngrams);
    }
  }
  return ngrams;
}

function emitRunNgrams(run: string, min: number, max: number, out: string[]): void {
  const chars = Array.from(run);
  if (chars.length < min) {
    out.push(run);
    return;
  }
  for (let size = min; size <= max; size += 1) {
    if (chars.length < size) break;
    for (let start = 0; start + size <= chars.length; start += 1) {
      out.push(chars.slice(start, start + size).join(""));
    }
  }
}

/** Space-joined field content for storage or debugging. */
export function joinTerms(analysis: AnalyzedText): Readonly<{ lexical: string; ngrams: string; identifiers: string }> {
  return Object.freeze({
    lexical: [...analysis.terms, ...analysis.secondaryTerms].join(" "),
    ngrams: analysis.ngrams.join(" "),
    identifiers: analysis.identifierTerms.join(" ")
  });
}

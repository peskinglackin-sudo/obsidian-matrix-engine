/**
 * Unicode script classification (PRD 8.3).
 *
 * MVP retrieval routing keys off script and segmentation behavior, not
 * precise language identification. Specific-language detection stays a
 * pluggable enhancement and must not block retrieval.
 */

export type ScriptCode =
  | "Latin"
  | "Han"
  | "Hiragana"
  | "Katakana"
  | "Hangul"
  | "Cyrillic"
  | "Arabic"
  | "Devanagari"
  | "Thai"
  | "Hebrew"
  | "Other";

export type LanguageMetadata = Readonly<{
  primaryLanguage: string;
  languages: readonly string[];
  scripts: readonly ScriptCode[];
  confidence?: number;
  mixed: boolean;
}>;

const SCRIPT_MATCHERS: readonly (readonly [ScriptCode, RegExp])[] = [
  ["Latin", /\p{Script=Latin}/u],
  ["Han", /\p{Script=Han}/u],
  ["Hiragana", /\p{Script=Hiragana}/u],
  ["Katakana", /\p{Script=Katakana}/u],
  ["Hangul", /\p{Script=Hangul}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Arabic", /\p{Script=Arabic}/u],
  ["Devanagari", /\p{Script=Devanagari}/u],
  ["Thai", /\p{Script=Thai}/u],
  ["Hebrew", /\p{Script=Hebrew}/u]
];

const OTHER_LETTER = /\p{L}/u;

export function classifyScriptCounts(text: string): ReadonlyMap<ScriptCode, number> {
  const counts = new Map<ScriptCode, number>();
  for (const char of text) {
    const script = classifyChar(char);
    if (script === undefined) continue;
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  return counts;
}

function classifyChar(char: string): ScriptCode | undefined {
  for (const [script, matcher] of SCRIPT_MATCHERS) {
    if (matcher.test(char)) return script;
  }
  return OTHER_LETTER.test(char) ? "Other" : undefined;
}

/**
 * Script-driven language heuristic. Only script-unambiguous mappings are
 * emitted; everything else stays `und` so the UI never over-promises.
 */
export function analyzeLanguage(text: string): LanguageMetadata {
  const counts = classifyScriptCounts(text);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const scripts = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([script]) => script);
  if (total === 0) {
    return Object.freeze({ primaryLanguage: "und", languages: Object.freeze([]), scripts: Object.freeze([]), mixed: false });
  }

  const has = (script: ScriptCode): boolean => (counts.get(script) ?? 0) > 0;
  const languages: string[] = [];
  if (has("Hiragana") || has("Katakana")) languages.push("ja");
  if (has("Hangul")) languages.push("ko");
  if (has("Han") && !has("Hiragana") && !has("Katakana")) languages.push("zh");
  if (has("Thai")) languages.push("th");
  if (has("Hebrew")) languages.push("he");
  if (has("Arabic")) languages.push("ar");

  const primary = pickPrimary(languages, counts);
  const primaryCount = primaryScriptCount(primary, counts);
  const significantScripts = scripts.filter((script) => (counts.get(script) ?? 0) / total >= 0.1);

  return Object.freeze({
    primaryLanguage: primary,
    languages: Object.freeze(languages),
    scripts: Object.freeze(scripts),
    ...(primary === "und" ? {} : { confidence: primaryCount / total }),
    mixed: significantScripts.length > 1
  });
}

function pickPrimary(languages: readonly string[], counts: ReadonlyMap<ScriptCode, number>): string {
  let best: { language: string; count: number } | undefined;
  for (const language of languages) {
    const count = primaryScriptCount(language, counts);
    if (best === undefined || count > best.count) best = { language, count };
  }
  return best?.language ?? "und";
}

function primaryScriptCount(language: string, counts: ReadonlyMap<ScriptCode, number>): number {
  const get = (script: ScriptCode): number => counts.get(script) ?? 0;
  switch (language) {
    case "ja":
      return get("Hiragana") + get("Katakana") + get("Han");
    case "ko":
      return get("Hangul");
    case "zh":
      return get("Han");
    case "th":
      return get("Thai");
    case "he":
      return get("Hebrew");
    case "ar":
      return get("Arabic");
    default:
      return 0;
  }
}

const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Khmer}]/u;

/** Whether the text contains scripts written without word-separating spaces. */
export function containsNoSpaceScript(text: string): boolean {
  return NO_SPACE_SCRIPT.test(text);
}

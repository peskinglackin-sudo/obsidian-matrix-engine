/**
 * Built-in cross-language capability probe (PRD 8.6).
 *
 * A tiny paired set produces a capability hint only - it never replaces a
 * full benchmark, and the UI must keep saying so. A pair passes when the
 * translated pair is closer than its same-language distractor.
 */

export type MultilingualPair = Readonly<{
  languageA: string;
  languageB: string;
  textA: string;
  textB: string;
  distractorB: string;
}>;

export const BUILTIN_MULTILINGUAL_PAIRS: readonly MultilingualPair[] = Object.freeze([
  Object.freeze({
    languageA: "zh",
    languageB: "en",
    textA: "如何为笔记建立增量向量索引",
    textB: "how to build an incremental vector index for notes",
    distractorB: "a recipe for tomato soup with fresh basil"
  }),
  Object.freeze({
    languageA: "ja",
    languageB: "en",
    textA: "ノートの意味検索と埋め込みモデル",
    textB: "semantic search and embedding models for notes",
    distractorB: "the weather forecast for next Tuesday"
  }),
  Object.freeze({
    languageA: "es",
    languageB: "en",
    textA: "búsqueda semántica multilingüe en las notas",
    textB: "multilingual semantic search across notes",
    distractorB: "instructions for assembling a bookshelf"
  })
]);

export type MultilingualTestResult = Readonly<{
  verified: boolean;
  score: number;
  testedPairs: readonly (readonly [string, string])[];
}>;

export type PairEmbedder = (texts: readonly string[], signal?: AbortSignal) => Promise<readonly Float32Array[] | null>;

export async function testMultilingualCapability(
  embed: PairEmbedder,
  pairs: readonly MultilingualPair[] = BUILTIN_MULTILINGUAL_PAIRS,
  signal?: AbortSignal
): Promise<MultilingualTestResult | null> {
  const texts: string[] = [];
  for (const pair of pairs) texts.push(pair.textA, pair.textB, pair.distractorB);
  const vectors = await embed(texts, signal);
  if (vectors?.length !== texts.length) return null;

  let passed = 0;
  pairs.forEach((_, index) => {
    const anchor = vectors[index * 3];
    const translation = vectors[index * 3 + 1];
    const distractor = vectors[index * 3 + 2];
    if (anchor === undefined || translation === undefined || distractor === undefined) return;
    if (cosine(anchor, translation) > cosine(anchor, distractor)) passed += 1;
  });
  const score = pairs.length === 0 ? 0 : passed / pairs.length;
  return Object.freeze({
    verified: pairs.length > 0 && passed === pairs.length,
    score,
    testedPairs: Object.freeze(pairs.map((pair) => Object.freeze([pair.languageA, pair.languageB] as const)))
  });
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const va = a[index] ?? 0;
    const vb = b[index] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

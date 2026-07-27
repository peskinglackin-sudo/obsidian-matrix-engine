import { hashCanonical } from "../core/hash";
import type { CorpusProfile, EmbeddingRecipe, IndexArtifactDescriptor, LexicalProfile } from "./types";

/**
 * Artifact fingerprint membership (PRD 12.8).
 *
 * Only inputs that change the physical rows of an index artifact may enter a
 * fingerprint. Connection parameters, query templates, candidate limits,
 * fusion weights, filters, and UI settings are explicitly excluded.
 */

export const ARTIFACT_SCHEMA_VERSION = 1;

export function computeEmbeddingSpaceId(recipe: EmbeddingRecipe): string {
  return hashCanonical({
    kind: "embedding_space",
    modelSignature: recipe.modelSignature,
    dimension: recipe.dimension,
    pooling: recipe.pooling ?? null,
    normalize: recipe.normalize,
    metric: recipe.metric
  });
}

export function computeEmbeddingFingerprint(recipe: EmbeddingRecipe): string {
  return hashCanonical({
    kind: "embedding_recipe",
    spaceId: computeEmbeddingSpaceId(recipe),
    documentTemplate: recipe.documentTemplate,
    templateRendererVersion: recipe.templateRendererVersion,
    tokenizerPolicyVersion: recipe.tokenizerPolicyVersion,
    maxInputTokens: recipe.maxInputTokens ?? null
  });
}

export function computeCorpusFingerprint(corpus: CorpusProfile): string {
  return hashCanonical({
    kind: "corpus",
    extractionVersion: corpus.extractionVersion,
    chunkStrategy: corpus.chunkStrategy,
    chunkSizeTokens: corpus.chunkSizeTokens,
    chunkOverlapTokens: corpus.chunkOverlapTokens,
    minChunkTokens: corpus.minChunkTokens,
    includeCode: corpus.includeCode,
    includeFrontmatterFields: [...corpus.includeFrontmatterFields].sort()
  });
}

export function computeLexicalFingerprint(lexical: LexicalProfile): string {
  return hashCanonical({
    kind: "lexical",
    analyzerId: lexical.analyzerId,
    analyzerVersion: lexical.analyzerVersion,
    useIntlSegmenter: lexical.useIntlSegmenter,
    cjkNgramMin: lexical.cjkNgramMin,
    cjkNgramMax: lexical.cjkNgramMax,
    normalizeNfkc: lexical.normalizeNfkc,
    accentFoldSecondary: lexical.accentFoldSecondary,
    preserveStopWords: lexical.preserveStopWords,
    identifierSplitting: lexical.identifierSplitting,
    nativeTokenizer: lexical.nativeTokenizer ?? null,
    customDictionaryHash: lexical.customDictionaryHash ?? null
  });
}

export function computeArtifactFingerprint(input: Readonly<{
  corpusFingerprint: string;
  lexicalFingerprint: string;
  embeddingFingerprint: string;
  schemaVersion: number;
}>): string {
  return hashCanonical({ kind: "artifact", ...input });
}

export function buildArtifactDescriptor(input: Readonly<{
  artifactId: string;
  corpus: CorpusProfile;
  lexical: LexicalProfile;
  recipe: EmbeddingRecipe;
  now: number;
}>): IndexArtifactDescriptor {
  const corpusFingerprint = computeCorpusFingerprint(input.corpus);
  const lexicalFingerprint = computeLexicalFingerprint(input.lexical);
  const embeddingFingerprint = computeEmbeddingFingerprint(input.recipe);
  return {
    id: input.artifactId,
    corpusProfileId: input.corpus.id,
    lexicalProfileId: input.lexical.id,
    embeddingRecipeId: input.recipe.id,
    corpusFingerprint,
    lexicalFingerprint,
    embeddingSpaceId: computeEmbeddingSpaceId(input.recipe),
    artifactFingerprint: computeArtifactFingerprint({
      corpusFingerprint,
      lexicalFingerprint,
      embeddingFingerprint,
      schemaVersion: ARTIFACT_SCHEMA_VERSION
    }),
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    sourceTableName: `sources_${input.artifactId}`,
    chunkTableName: `chunks_${input.artifactId}`,
    manifestTableName: `manifest_${input.artifactId}`,
    state: "building",
    createdAt: input.now,
    updatedAt: input.now
  };
}

import type { PluginSettings } from "./types";
import { SETTINGS_VERSION } from "./types";

/**
 * Default configuration (PRD section 24).
 *
 * The default provider targets a local llama.cpp server; model ID and
 * dimension stay unset until the user confirms them via Test connection,
 * so semantic search starts disabled while exact/lexical search work.
 */

export const DEFAULT_PROVIDER_ID = "default-local-provider";
export const DEFAULT_RECIPE_ID = "default-recipe";
export const DEFAULT_CORPUS_ID = "default-corpus";
export const DEFAULT_LEXICAL_ID = "default-lexical";
export const DEFAULT_RETRIEVAL_ID = "default-retrieval";
export const DEFAULT_ARTIFACT_ID = "default-artifact";

export function createDefaultSettings(): PluginSettings {
  return {
    version: SETTINGS_VERSION,
    activeRetrievalProfileId: DEFAULT_RETRIEVAL_ID,
    providerProfiles: [
      {
        id: DEFAULT_PROVIDER_ID,
        name: "Local llama.cpp",
        kind: "llama_cpp",
        baseUrl: "http://127.0.0.1:8080/v1",
        timeoutMs: 30000,
        maxRetries: 3,
        concurrency: 1,
        maxBatchItems: 16
      }
    ],
    embeddingRecipes: [
      {
        id: DEFAULT_RECIPE_ID,
        name: "Default embedding recipe",
        providerProfileId: DEFAULT_PROVIDER_ID,
        modelId: "",
        modelSignature: "",
        dimension: 0,
        normalize: true,
        metric: "cosine",
        documentTemplate: "{title}\n{heading_path}\n{content}",
        queryTemplate: "{query}",
        templateRendererVersion: 1,
        tokenizerPolicyVersion: 1,
        multilingual: { declared: false, verified: false, testedPairs: [] },
        recipeVersion: 1
      }
    ],
    corpusProfiles: [
      {
        id: DEFAULT_CORPUS_ID,
        name: "Whole vault",
        includes: [],
        excludes: [],
        fileTypes: ["md", "txt"],
        extractionVersion: 1,
        chunkStrategy: "heading_blocks",
        chunkSizeTokens: 512,
        chunkOverlapTokens: 64,
        minChunkTokens: 24,
        includeCode: true,
        includeFrontmatterFields: []
      }
    ],
    lexicalProfiles: [
      {
        id: DEFAULT_LEXICAL_ID,
        name: "Unicode multilingual",
        analyzerId: "unicode-multilingual",
        analyzerVersion: 1,
        useIntlSegmenter: true,
        cjkNgramMin: 2,
        cjkNgramMax: 3,
        normalizeNfkc: true,
        accentFoldSecondary: true,
        preserveStopWords: true,
        identifierSplitting: true
      }
    ],
    indexArtifacts: [],
    retrievalProfiles: [
      {
        id: DEFAULT_RETRIEVAL_ID,
        name: "Default retrieval",
        artifactId: DEFAULT_ARTIFACT_ID,
        mode: "auto",
        limit: 20,
        exactCandidateLimit: 50,
        lexicalCandidateLimit: 80,
        semanticCandidateLimit: 80,
        fusion: {
          method: "rrf",
          rrfK: 60,
          exactWeight: 1.4,
          lexicalWeight: 1.0,
          semanticWeight: 1.0
        },
        sourceAggregation: "max",
        maxResultsPerSource: 2
      }
    ],
    language: {
      uiLocale: "auto",
      debugMissingTranslations: false
    },
    ui: {
      lookupResultType: "blocks",
      autoSubmit: true,
      connectionsAutoUpdate: true,
      connectionsLimit: 12,
      advancedSectionsExpanded: false,
      safePlainTextPreview: true
    },
    maintenance: {
      autoOptimize: true,
      modifiedRowsThreshold: 500,
      staleRowsThreshold: 200,
      minIntervalMinutes: 30,
      idleOnly: true
    },
    privacy: {
      requireRemoteSendPreview: true,
      redactDiagnostics: true,
      debugLogging: false
    }
  };
}

import { z } from "zod";

/**
 * Persistent configuration model (PRD section 12).
 *
 * Logical configuration is split into provider connections, embedding
 * recipes, corpus scope, lexical analysis, physical index artifacts, and
 * retrieval behavior. Connection parameters never enter artifact
 * fingerprints; fingerprint membership is owned by settings/fingerprint.ts.
 */

export const SETTINGS_VERSION = 1;

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SECRET_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const BCP47_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

export const profileIdSchema = z.string().regex(PROFILE_ID_PATTERN, "Profile IDs use lowercase alphanumerics and dashes");

const nameSchema = z.string().min(1).max(120);

export function validateProviderBaseUrl(value: string): URL {
  const url = new URL(value);
  const plainPath = url.pathname.replace(/\/$/u, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || !plainPath.endsWith("/v1") || url.pathname !== plainPath) {
    throw new TypeError("Provider base URL must be HTTP(S) without credentials, query, or fragment, and end exactly in /v1");
  }
  return url;
}

export function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase());
}

export type EndpointTrust = "local" | "remote_https" | "remote_plaintext";

export function classifyEndpoint(baseUrl: string): EndpointTrust {
  const url = validateProviderBaseUrl(baseUrl);
  if (isLoopbackHost(url.hostname)) return "local";
  return url.protocol === "https:" ? "remote_https" : "remote_plaintext";
}

const baseUrlSchema = z.string().refine((value) => {
  try {
    validateProviderBaseUrl(value);
    return true;
  } catch {
    return false;
  }
}, "Provider base URL must be HTTP(S) without credentials, query, or fragment, and end exactly in /v1");

const headersSchema = z
  .record(z.string().min(1).max(80), z.string().max(1024))
  .refine((headers) => Object.keys(headers).every((key) => !["authorization", "proxy-authorization", "cookie"].includes(key.toLowerCase())), "Credential headers must use the secret reference, not plain settings");

export const embeddingCapabilityOverridesSchema = z.strictObject({
  batchInput: z.boolean().optional(),
  maxBatchItems: z.number().int().positive().optional(),
  maxInputTokens: z.number().int().positive().optional(),
  requestedDimensions: z.boolean().optional(),
  tokenCounter: z.boolean().optional(),
  modelList: z.boolean().optional(),
  serverNormalization: z.enum(["none", "l2", "unknown"]).optional(),
  rerank: z.boolean().optional()
});

export const providerProfileSchema = z.strictObject({
  id: profileIdSchema,
  name: nameSchema,
  kind: z.enum(["openai_compatible", "llama_cpp"]),
  baseUrl: baseUrlSchema,
  secretRef: z.string().regex(SECRET_REF_PATTERN).optional(),
  headers: headersSchema.optional(),
  timeoutMs: z.number().int().min(1000).max(600000),
  maxRetries: z.number().int().min(0).max(10),
  concurrency: z.number().int().min(1).max(16),
  maxBatchItems: z.number().int().min(1).max(2048).optional(),
  maxBatchTokens: z.number().int().min(1).optional(),
  maxPayloadBytes: z.number().int().min(1024).optional(),
  capabilityOverrides: embeddingCapabilityOverridesSchema.optional()
});

export const multilingualCapabilitySchema = z.strictObject({
  declared: z.boolean(),
  verified: z.boolean(),
  testedPairs: z.array(z.tuple([z.string().min(2), z.string().min(2)])),
  benchmarkVersion: z.string().min(1).optional(),
  score: z.number().min(0).max(1).optional()
});

export const embeddingRecipeSchema = z.strictObject({
  id: profileIdSchema,
  name: nameSchema,
  providerProfileId: profileIdSchema,
  modelId: z.string().max(200),
  modelSignature: z.string().max(300),
  dimension: z.number().int().min(0).max(16384),
  pooling: z.string().max(60).optional(),
  normalize: z.boolean(),
  metric: z.enum(["cosine", "dot", "l2"]),
  documentTemplate: z.string().min(1).max(4000),
  queryTemplate: z.string().min(1).max(4000),
  templateRendererVersion: z.number().int().positive(),
  tokenizerPolicyVersion: z.number().int().positive(),
  maxInputTokens: z.number().int().positive().optional(),
  multilingual: multilingualCapabilitySchema,
  recipeVersion: z.number().int().positive()
});

export const corpusProfileSchema = z.strictObject({
  id: profileIdSchema,
  name: nameSchema,
  includes: z.array(z.string().min(1).max(512)),
  excludes: z.array(z.string().min(1).max(512)),
  fileTypes: z.array(z.enum(["md", "txt"])).min(1),
  extractionVersion: z.number().int().positive(),
  chunkStrategy: z.enum(["heading_blocks", "semantic_blocks"]),
  chunkSizeTokens: z.number().int().min(32).max(8192),
  chunkOverlapTokens: z.number().int().min(0).max(2048),
  minChunkTokens: z.number().int().min(1).max(2048),
  includeCode: z.boolean(),
  includeFrontmatterFields: z.array(z.string().min(1).max(120))
});

export const lexicalProfileSchema = z.strictObject({
  id: profileIdSchema,
  name: nameSchema,
  analyzerId: z.string().min(1).max(80),
  analyzerVersion: z.number().int().positive(),
  useIntlSegmenter: z.boolean(),
  cjkNgramMin: z.number().int().min(1).max(4),
  cjkNgramMax: z.number().int().min(1).max(6),
  normalizeNfkc: z.boolean(),
  accentFoldSecondary: z.boolean(),
  preserveStopWords: z.boolean(),
  identifierSplitting: z.boolean(),
  nativeTokenizer: z.string().min(1).max(80).optional(),
  customDictionaryHash: z.string().min(1).max(128).optional()
}).refine((profile) => profile.cjkNgramMin <= profile.cjkNgramMax, "cjkNgramMin must not exceed cjkNgramMax");

export const indexArtifactDescriptorSchema = z.strictObject({
  id: profileIdSchema,
  corpusProfileId: profileIdSchema,
  lexicalProfileId: profileIdSchema,
  embeddingRecipeId: profileIdSchema,
  corpusFingerprint: z.string().min(1),
  lexicalFingerprint: z.string().min(1),
  embeddingSpaceId: z.string().min(1),
  artifactFingerprint: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  sourceTableName: z.string().min(1),
  chunkTableName: z.string().min(1),
  manifestTableName: z.string().min(1),
  state: z.enum(["building", "ready", "stale", "failed"]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});

export const retrievalProfileSchema = z.strictObject({
  id: profileIdSchema,
  name: nameSchema,
  artifactId: profileIdSchema,
  mode: z.enum(["auto", "exact", "lexical", "semantic", "hybrid"]),
  limit: z.number().int().min(1).max(200),
  exactCandidateLimit: z.number().int().min(1).max(1000),
  lexicalCandidateLimit: z.number().int().min(1).max(1000),
  semanticCandidateLimit: z.number().int().min(1).max(1000),
  fusion: z.strictObject({
    method: z.enum(["rrf", "weighted_rrf"]),
    rrfK: z.number().int().min(1).max(1000),
    exactWeight: z.number().min(0).max(100),
    lexicalWeight: z.number().min(0).max(100),
    semanticWeight: z.number().min(0).max(100)
  }),
  sourceAggregation: z.enum(["max", "top_mean"]),
  maxResultsPerSource: z.number().int().min(1).max(50),
  rerankerProfileId: profileIdSchema.optional()
});

export const languageSettingsSchema = z.strictObject({
  uiLocale: z.union([z.literal("auto"), z.string().regex(BCP47_PATTERN)]),
  debugMissingTranslations: z.boolean()
});

export const uiSettingsSchema = z.strictObject({
  lookupResultType: z.enum(["blocks", "sources"]),
  autoSubmit: z.boolean(),
  connectionsAutoUpdate: z.boolean(),
  connectionsLimit: z.number().int().min(1).max(100),
  advancedSectionsExpanded: z.boolean(),
  safePlainTextPreview: z.boolean()
});

export const maintenanceSettingsSchema = z.strictObject({
  autoOptimize: z.boolean(),
  modifiedRowsThreshold: z.number().int().min(1),
  staleRowsThreshold: z.number().int().min(1),
  minIntervalMinutes: z.number().int().min(1).max(10080),
  idleOnly: z.boolean()
});

export const privacySettingsSchema = z.strictObject({
  requireRemoteSendPreview: z.boolean(),
  redactDiagnostics: z.boolean(),
  debugLogging: z.boolean()
});

export const pluginSettingsSchema = z.strictObject({
  version: z.literal(SETTINGS_VERSION),
  activeRetrievalProfileId: profileIdSchema,
  providerProfiles: z.array(providerProfileSchema),
  embeddingRecipes: z.array(embeddingRecipeSchema),
  corpusProfiles: z.array(corpusProfileSchema),
  lexicalProfiles: z.array(lexicalProfileSchema),
  indexArtifacts: z.array(indexArtifactDescriptorSchema),
  retrievalProfiles: z.array(retrievalProfileSchema),
  language: languageSettingsSchema,
  ui: uiSettingsSchema,
  maintenance: maintenanceSettingsSchema,
  privacy: privacySettingsSchema
}).superRefine((settings, context) => {
  for (const [field, profiles] of [
    ["providerProfiles", settings.providerProfiles],
    ["embeddingRecipes", settings.embeddingRecipes],
    ["corpusProfiles", settings.corpusProfiles],
    ["lexicalProfiles", settings.lexicalProfiles],
    ["indexArtifacts", settings.indexArtifacts],
    ["retrievalProfiles", settings.retrievalProfiles]
  ] as const) {
    const seen = new Set<string>();
    for (const profile of profiles) {
      if (seen.has(profile.id)) context.addIssue({ code: "custom", message: `Duplicate ID in ${field}: ${profile.id}`, path: [field] });
      seen.add(profile.id);
    }
  }
  const providerIds = new Set(settings.providerProfiles.map((profile) => profile.id));
  for (const recipe of settings.embeddingRecipes) {
    if (!providerIds.has(recipe.providerProfileId)) context.addIssue({ code: "custom", message: `Embedding recipe ${recipe.id} references unknown provider ${recipe.providerProfileId}`, path: ["embeddingRecipes"] });
  }
  const recipeIds = new Set(settings.embeddingRecipes.map((recipe) => recipe.id));
  const corpusIds = new Set(settings.corpusProfiles.map((corpus) => corpus.id));
  const lexicalIds = new Set(settings.lexicalProfiles.map((lexical) => lexical.id));
  for (const artifact of settings.indexArtifacts) {
    if (!recipeIds.has(artifact.embeddingRecipeId)) context.addIssue({ code: "custom", message: `Artifact ${artifact.id} references unknown recipe`, path: ["indexArtifacts"] });
    if (!corpusIds.has(artifact.corpusProfileId)) context.addIssue({ code: "custom", message: `Artifact ${artifact.id} references unknown corpus`, path: ["indexArtifacts"] });
    if (!lexicalIds.has(artifact.lexicalProfileId)) context.addIssue({ code: "custom", message: `Artifact ${artifact.id} references unknown lexical profile`, path: ["indexArtifacts"] });
  }
  if (!settings.retrievalProfiles.some((profile) => profile.id === settings.activeRetrievalProfileId)) {
    context.addIssue({ code: "custom", message: "Active retrieval profile does not exist", path: ["activeRetrievalProfileId"] });
  }
});

export type ProviderProfile = z.infer<typeof providerProfileSchema>;
export type EmbeddingCapabilityOverrides = z.infer<typeof embeddingCapabilityOverridesSchema>;
export type MultilingualCapability = z.infer<typeof multilingualCapabilitySchema>;
export type EmbeddingRecipe = z.infer<typeof embeddingRecipeSchema>;
export type CorpusProfile = z.infer<typeof corpusProfileSchema>;
export type LexicalProfile = z.infer<typeof lexicalProfileSchema>;
export type IndexArtifactDescriptor = z.infer<typeof indexArtifactDescriptorSchema>;
export type RetrievalProfile = z.infer<typeof retrievalProfileSchema>;
export type LanguageSettings = z.infer<typeof languageSettingsSchema>;
export type UiSettings = z.infer<typeof uiSettingsSchema>;
export type MaintenanceSettings = z.infer<typeof maintenanceSettingsSchema>;
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;
export type PluginSettings = z.infer<typeof pluginSettingsSchema>;
export type SearchMode = RetrievalProfile["mode"];

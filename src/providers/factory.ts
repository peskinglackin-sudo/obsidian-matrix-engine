import type { QueryEmbedder } from "../retrieval/service";
import type { EmbeddingRecipe, ProviderProfile } from "../settings/types";
import { EmbeddingBatcher, type BatchLimits } from "./batcher";
import { HttpEmbeddingProvider } from "./http-embedding";
import type { RetryOptions } from "./retry";
import { withRetry } from "./retry";

/**
 * Provider assembly from settings profiles.
 *
 * Connection parameters (base URL, key, headers, timeouts) come from the
 * ProviderProfile; the embedding space identity (model, dimension) comes
 * from the EmbeddingRecipe. Secrets are passed in by the caller from
 * SecretStorage and never read from plain settings (PRD 17.5).
 */

export function createEmbeddingProvider(
  profile: ProviderProfile,
  recipe: Pick<EmbeddingRecipe, "modelId" | "dimension">,
  secret: string | undefined,
  fetchImpl?: typeof fetch
): HttpEmbeddingProvider {
  return new HttpEmbeddingProvider({
    kind: profile.kind,
    baseUrl: profile.baseUrl,
    model: recipe.modelId,
    ...(secret === undefined || secret.length === 0 ? {} : { apiKey: secret }),
    ...(profile.headers === undefined ? {} : { headers: profile.headers }),
    timeoutMs: profile.timeoutMs,
    ...(recipe.dimension > 0 ? { expectedDimension: recipe.dimension } : {}),
    ...(fetchImpl === undefined ? {} : { fetchImpl })
  });
}

export function retryOptionsFor(profile: ProviderProfile): RetryOptions {
  return Object.freeze({
    maxRetries: profile.maxRetries,
    baseDelayMs: 500,
    maxDelayMs: 30000
  });
}

export function batchLimitsFor(profile: ProviderProfile): BatchLimits {
  return Object.freeze({
    maxItems: profile.maxBatchItems ?? 16,
    ...(profile.maxBatchTokens === undefined ? {} : { maxTokens: profile.maxBatchTokens }),
    ...(profile.maxPayloadBytes === undefined ? {} : { maxPayloadBytes: profile.maxPayloadBytes })
  });
}

export function createDocumentBatcher(provider: HttpEmbeddingProvider, profile: ProviderProfile): EmbeddingBatcher {
  return new EmbeddingBatcher(
    (texts, signal) => provider.embed(texts, { purpose: "document", ...(signal === undefined ? {} : { signal }) }),
    batchLimitsFor(profile),
    retryOptionsFor(profile)
  );
}

/** Query embedder for the SearchService: retries transient failures, returns null on any final failure. */
export function createQueryEmbedder(provider: HttpEmbeddingProvider, profile: ProviderProfile): QueryEmbedder {
  const retry = retryOptionsFor(profile);
  return async (renderedQuery, signal) => {
    const result = await withRetry(
      () => provider.embed([renderedQuery], { purpose: "query", ...(signal === undefined ? {} : { signal }) }),
      { ...retry, maxRetries: Math.min(retry.maxRetries, 1), ...(signal === undefined ? {} : { signal }) }
    );
    if (!result.ok) return null;
    return result.value.vectors[0] ?? null;
  };
}

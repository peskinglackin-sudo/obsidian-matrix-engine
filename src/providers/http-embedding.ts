import { z } from "zod";

import { toSafeError, type SafeError } from "../core/errors";

/**
 * Production embedding provider for OpenAI-compatible services (FR-041)
 * and llama.cpp servers (FR-040).
 *
 * llama.cpp mode tolerates model-name echo differences and can consult the
 * optional root /health endpoint; generic services are never required to
 * implement llama-specific endpoints (PRD 17.4). Authorization values stay
 * out of every error and log path.
 */

export type ProviderKind = "openai_compatible" | "llama_cpp";

export type HttpEmbeddingProviderOptions = Readonly<{
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Readonly<Record<string, string>>;
  timeoutMs: number;
  expectedDimension?: number;
  fetchImpl?: typeof fetch;
}>;

export type EmbeddingVectors = Readonly<{
  model: string;
  dimensions: number;
  vectors: readonly Float32Array[];
  usage?: Readonly<{ inputTokens?: number; totalTokens?: number }>;
}>;

export type ProviderResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: SafeError }>;

export type EmbedOptions = Readonly<{
  purpose: "document" | "query";
  signal?: AbortSignal;
}>;

const responseSchema = z.object({
  data: z.array(z.object({
    embedding: z.array(z.number()),
    index: z.number().int().nonnegative()
  })),
  model: z.string().optional(),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional()
  }).optional()
});

const MAX_BATCH_ITEMS_HARD = 512;
const MAX_INPUT_CHARS = 32768;

export class HttpEmbeddingProvider {
  readonly kind: ProviderKind;
  readonly #embeddingsUrl: URL;
  readonly #rootUrl: URL;
  readonly #modelsUrl: URL;
  readonly #options: HttpEmbeddingProviderOptions;
  readonly #fetch: typeof fetch;

  constructor(options: HttpEmbeddingProviderOptions) {
    const base = new URL(options.baseUrl);
    if (!base.pathname.endsWith("/v1") || base.search !== "" || base.hash !== "" || base.username !== "" || base.password !== "") {
      throw new TypeError("Embedding base URL must end in /v1 without credentials, query, or fragment");
    }
    this.kind = options.kind;
    this.#options = options;
    this.#embeddingsUrl = new URL(`${base.pathname}/embeddings`, base);
    this.#modelsUrl = new URL(`${base.pathname}/models`, base);
    this.#rootUrl = new URL(base.pathname.replace(/\/v1$/u, "/"), base);
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async embed(inputs: readonly string[], options: EmbedOptions): Promise<ProviderResult<EmbeddingVectors>> {
    if (inputs.length === 0 || inputs.length > MAX_BATCH_ITEMS_HARD || inputs.some((input) => input.length === 0 || input.length > MAX_INPUT_CHARS)) {
      return failure("PROVIDER_INPUT_INVALID", "invalid_input", "error.provider.input", false);
    }
    const timeout = AbortSignal.timeout(this.#options.timeoutMs);
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
    try {
      const response = await this.#fetch(this.#embeddingsUrl, {
        method: "POST",
        signal,
        headers: this.#headers(),
        body: JSON.stringify({
          model: this.#options.model.length > 0 ? this.#options.model : "default",
          input: inputs,
          encoding_format: "float"
        })
      });
      if (!response.ok) return { ok: false, error: httpError(response.status, response.headers.get("retry-after")) };
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.data.length !== inputs.length) {
        return failure("PROVIDER_RESPONSE_INVALID", "provider", "error.provider.response", false);
      }
      if (this.kind === "openai_compatible" && this.#options.model.length > 0 && parsed.data.model !== undefined && !parsed.data.model.startsWith(this.#options.model)) {
        return failure("PROVIDER_MODEL_MISMATCH", "provider", "error.provider.model", false);
      }
      const dimension = parsed.data.data[0]?.embedding.length ?? 0;
      const expected = this.#options.expectedDimension;
      if (dimension === 0 || (expected !== undefined && expected > 0 && dimension !== expected)) {
        return failure("PROVIDER_VECTOR_INVALID", "provider", "error.provider.vector", false);
      }
      const seen = new Set<number>();
      const vectors: Float32Array[] = new Array<Float32Array>(inputs.length);
      for (const item of parsed.data.data) {
        if (item.index >= inputs.length || seen.has(item.index) || item.embedding.length !== dimension || item.embedding.some((value) => !Number.isFinite(value))) {
          return failure("PROVIDER_VECTOR_INVALID", "provider", "error.provider.vector", false);
        }
        seen.add(item.index);
        vectors[item.index] = Float32Array.from(item.embedding);
      }
      return {
        ok: true,
        value: Object.freeze({
          model: parsed.data.model ?? this.#options.model,
          dimensions: dimension,
          vectors: Object.freeze(vectors),
          ...(parsed.data.usage === undefined ? {} : {
            usage: Object.freeze({
              ...(parsed.data.usage.prompt_tokens === undefined ? {} : { inputTokens: parsed.data.usage.prompt_tokens }),
              ...(parsed.data.usage.total_tokens === undefined ? {} : { totalTokens: parsed.data.usage.total_tokens })
            })
          })
        })
      };
    } catch (error: unknown) {
      if (signal.aborted) {
        const userCancelled = options.signal?.aborted === true;
        return {
          ok: false,
          error: Object.freeze({
            code: userCancelled ? "OPERATION_CANCELLED" : "PROVIDER_TIMEOUT",
            category: userCancelled ? "cancelled" : "timeout",
            messageKey: userCancelled ? "error.operation.cancelled" : "error.provider.timeout",
            retryable: !userCancelled
          })
        };
      }
      const safe = toSafeError(error, "PROVIDER_NETWORK_FAILURE");
      return { ok: false, error: safe.code === "PROVIDER_NETWORK_FAILURE" ? Object.freeze({ ...safe, category: "provider", retryable: true, messageKey: "error.provider.network" }) : safe };
    }
  }

  /** Optional llama.cpp /health; generic services report "unsupported" (PRD 17.4). */
  async health(signal?: AbortSignal): Promise<"ok" | "unavailable" | "unsupported"> {
    if (this.kind !== "llama_cpp") return "unsupported";
    try {
      const response = await this.#fetch(new URL("health", this.#rootUrl), { method: "GET", signal: signal ?? AbortSignal.timeout(this.#options.timeoutMs) });
      return response.ok ? "ok" : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  async listModels(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.#fetch(this.#modelsUrl, { method: "GET", signal: signal ?? AbortSignal.timeout(this.#options.timeoutMs), headers: this.#headers() });
      return response.ok;
    } catch {
      return false;
    }
  }

  #headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.#options.apiKey === undefined || this.#options.apiKey.length === 0 ? {} : { authorization: `Bearer ${this.#options.apiKey}` }),
      ...this.#options.headers
    };
  }
}

export type EmbeddingProbeReport = Readonly<{
  reachable: boolean;
  dimensions?: number;
  batchInput: boolean;
  serverNormalization: "none" | "l2" | "unknown";
  modelList: boolean;
  health: "ok" | "unavailable" | "unsupported";
  actualModel?: string;
  error?: SafeError;
}>;

/** Capability probe (PRD 17.4): detects dimension, batch support, and normalization. */
export async function probeEmbeddingProvider(provider: HttpEmbeddingProvider, signal?: AbortSignal): Promise<EmbeddingProbeReport> {
  const health = await provider.health(signal);
  const modelList = await provider.listModels(signal);
  const batch = await provider.embed(["capability probe", "second probe input"], { purpose: "query", ...(signal === undefined ? {} : { signal }) });
  if (!batch.ok) {
    const single = await provider.embed(["capability probe"], { purpose: "query", ...(signal === undefined ? {} : { signal }) });
    if (!single.ok) {
      return Object.freeze({ reachable: false, batchInput: false, serverNormalization: "unknown", modelList, health, error: single.error });
    }
    return Object.freeze({
      reachable: true,
      dimensions: single.value.dimensions,
      batchInput: false,
      serverNormalization: normalizationOf(single.value.vectors[0]),
      modelList,
      health,
      actualModel: single.value.model
    });
  }
  return Object.freeze({
    reachable: true,
    dimensions: batch.value.dimensions,
    batchInput: true,
    serverNormalization: normalizationOf(batch.value.vectors[0]),
    modelList,
    health,
    actualModel: batch.value.model
  });
}

function normalizationOf(vector: Float32Array | undefined): "none" | "l2" | "unknown" {
  if (vector === undefined || vector.length === 0) return "unknown";
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  return Math.abs(norm - 1) < 0.01 ? "l2" : "none";
}

function failure(code: string, category: SafeError["category"], messageKey: string, retryable: boolean): Readonly<{ ok: false; error: SafeError }> {
  return { ok: false, error: Object.freeze({ code, category, messageKey, retryable }) };
}

function httpError(status: number, retryAfter: string | null): SafeError {
  const mapping: Record<number, SafeError["category"]> = { 401: "authentication", 403: "authorization", 408: "timeout", 429: "rate_limit", 413: "invalid_input" };
  const retryable = status === 408 || status === 429 || status >= 500;
  const seconds = retryAfter === null ? undefined : Number.parseInt(retryAfter, 10);
  return Object.freeze({
    code: `PROVIDER_HTTP_${String(status)}`,
    category: mapping[status] ?? "provider",
    messageKey: "error.provider.http",
    retryable,
    ...(seconds !== undefined && Number.isFinite(seconds) && seconds >= 0 ? { retryAfterMs: seconds * 1000 } : {})
  });
}

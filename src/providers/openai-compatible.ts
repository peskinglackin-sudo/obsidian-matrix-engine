import { z } from "zod";
import { toSafeError, type SafeError } from "../core/errors";
import type { EmbeddingProvider, EmbeddingProviderResult, EmbeddingRequest } from "./embedding";

const responseSchema = z.strictObject({
  object: z.literal("list").optional(),
  data: z.array(z.strictObject({ object: z.literal("embedding").optional(), embedding: z.array(z.number()), index: z.number().int().nonnegative() })),
  model: z.string().min(1),
  usage: z.strictObject({ prompt_tokens: z.number().int().nonnegative().optional(), total_tokens: z.number().int().nonnegative().optional() }).optional()
});

export function validateEmbeddingBaseUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || !url.pathname.endsWith("/v1") || url.pathname !== url.pathname.replace(/\/$/u, "")) {
    throw new TypeError("Embedding base URL must be HTTP(S), contain no credentials/query/fragment, and end exactly in /v1");
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !loopback) throw new TypeError("Plaintext HTTP is permitted only for loopback protocol tests");
  return url;
}

function httpError(status: number, retryAfter: string | null): SafeError {
  const mapping: Record<number, SafeError["category"]> = { 401: "authentication", 403: "authorization", 408: "timeout", 429: "rate_limit" };
  const retryable = status === 408 || status === 429 || status >= 500;
  const seconds = retryAfter === null ? undefined : Number.parseInt(retryAfter, 10);
  return Object.freeze({ code: `PROVIDER_HTTP_${String(status)}`, category: mapping[status] ?? "provider", messageKey: "error.provider.http", retryable, ...(seconds !== undefined && Number.isFinite(seconds) && seconds >= 0 ? { retryAfterMs: seconds * 1000 } : {}) });
}

export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly capabilities;
  readonly #url: URL;
  readonly #model: string;
  readonly #key: string;
  readonly #headers: Readonly<Record<string, string>>;

  constructor(options: Readonly<{ baseUrl: string; apiKey: string; model: string; dimensions: number; headers?: Readonly<Record<string, string>> }>) {
    this.#url = new URL("embeddings", `${validateEmbeddingBaseUrl(options.baseUrl).toString()}/`);
    if (options.apiKey.length === 0 || options.model.length === 0 || !Number.isSafeInteger(options.dimensions) || options.dimensions <= 0) throw new TypeError("Embedding provider configuration is invalid");
    this.#key = options.apiKey; this.#model = options.model; this.#headers = Object.freeze({ ...options.headers });
    this.capabilities = Object.freeze({ batch: true as const, cancellable: true as const, dimensions: options.dimensions });
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingProviderResult> {
    if (request.inputs.length === 0 || request.inputs.length > 128 || request.inputs.some((input) => input.length === 0 || input.length > 8192)) return { ok: false, error: { code: "PROVIDER_INPUT_INVALID", category: "invalid_input", messageKey: "error.provider.input", retryable: false } };
    const timeout = AbortSignal.timeout(request.timeoutMs);
    const signal = request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout]);
    try {
      const response = await fetch(this.#url, { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${this.#key}`, ...this.#headers }, body: JSON.stringify({ model: this.#model, input: request.inputs, encoding_format: "float" }) });
      if (!response.ok) return { ok: false, error: httpError(response.status, response.headers.get("retry-after")) };
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.model !== this.#model || parsed.data.data.length !== request.inputs.length) return { ok: false, error: { code: "PROVIDER_RESPONSE_INVALID", category: "provider", messageKey: "error.provider.response", retryable: false } };
      const seen = new Set<number>();
      for (const item of parsed.data.data) {
        if (item.index >= request.inputs.length || seen.has(item.index) || item.embedding.length !== this.capabilities.dimensions || item.embedding.some((value) => !Number.isFinite(value))) return { ok: false, error: { code: "PROVIDER_VECTOR_INVALID", category: "provider", messageKey: "error.provider.vector", retryable: false } };
        seen.add(item.index);
      }
      if (seen.size !== request.inputs.length) return { ok: false, error: { code: "PROVIDER_INDEX_INVALID", category: "provider", messageKey: "error.provider.index", retryable: false } };
      const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index);
      return { ok: true, value: Object.freeze({ model: parsed.data.model, dimensions: this.capabilities.dimensions, vectors: Object.freeze(ordered.map(({ embedding }) => Object.freeze(embedding))), ...(parsed.data.usage === undefined ? {} : { usage: Object.freeze({ inputTokens: parsed.data.usage.prompt_tokens, totalTokens: parsed.data.usage.total_tokens }) }) }) };
    } catch (error: unknown) {
      const aborted = signal.aborted;
      return { ok: false, error: aborted ? { code: request.signal?.aborted === true ? "OPERATION_CANCELLED" : "PROVIDER_TIMEOUT", category: request.signal?.aborted === true ? "cancelled" : "timeout", messageKey: request.signal?.aborted === true ? "error.operation.cancelled" : "error.provider.timeout", retryable: request.signal?.aborted !== true } : toSafeError(error, "PROVIDER_NETWORK_FAILURE") };
    }
  }
}

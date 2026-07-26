import { describe, expect, it, vi } from "vitest";

import { EmbeddingBatcher, planBatches, type BatchItem } from "../src/providers/batcher";
import { createEmbeddingProvider, createQueryEmbedder } from "../src/providers/factory";
import { HttpEmbeddingProvider, probeEmbeddingProvider } from "../src/providers/http-embedding";
import { BUILTIN_MULTILINGUAL_PAIRS, testMultilingualCapability } from "../src/providers/multilingual-test";
import { RERANK_DISABLED } from "../src/providers/rerank";
import { withRetry } from "../src/providers/retry";
import type { SafeError } from "../src/core/errors";

const IMMEDIATE_RETRY = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5, sleep: () => Promise.resolve(), random: () => 0.5 };

function embeddingResponse(vectors: readonly (readonly number[])[], model = "test-model"): Response {
  return new Response(JSON.stringify({
    object: "list",
    model,
    data: vectors.map((embedding, index) => ({ object: "embedding", embedding, index })),
    usage: { prompt_tokens: 3, total_tokens: 3 }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function providerWith(fetchImpl: typeof fetch, kind: "openai_compatible" | "llama_cpp" = "openai_compatible", model = "test-model"): HttpEmbeddingProvider {
  return new HttpEmbeddingProvider({ kind, baseUrl: "http://127.0.0.1:8080/v1", model, timeoutMs: 2000, fetchImpl });
}

describe("retry policy (PRD 14.6)", () => {
  const transient: SafeError = { code: "PROVIDER_HTTP_500", category: "provider", messageKey: "error.provider.http", retryable: true };
  const permanent: SafeError = { code: "PROVIDER_HTTP_401", category: "authentication", messageKey: "error.provider.http", retryable: false };

  it("retries transient errors with backoff and succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(() => {
      attempts += 1;
      return Promise.resolve(attempts < 3 ? { ok: false as const, error: transient } : { ok: true as const, value: "done" });
    }, IMMEDIATE_RETRY);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it("does not retry permanent errors", async () => {
    let attempts = 0;
    const result = await withRetry(() => {
      attempts += 1;
      return Promise.resolve({ ok: false as const, error: permanent });
    }, IMMEDIATE_RETRY);
    expect(result.ok).toBe(false);
    expect(attempts).toBe(1);
  });

  it("respects Retry-After via retryAfterMs", async () => {
    const delays: number[] = [];
    const rateLimited: SafeError = { ...transient, code: "PROVIDER_HTTP_429", category: "rate_limit", retryAfterMs: 4 };
    let attempts = 0;
    await withRetry(() => {
      attempts += 1;
      return Promise.resolve(attempts < 2 ? { ok: false as const, error: rateLimited } : { ok: true as const, value: 1 });
    }, { ...IMMEDIATE_RETRY, sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    } });
    expect(delays[0]).toBeGreaterThanOrEqual(4);
  });

  it("stops on abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await withRetry(() => Promise.resolve({ ok: true as const, value: 1 }), { ...IMMEDIATE_RETRY, signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("cancelled");
  });
});

describe("HttpEmbeddingProvider", () => {
  it("embeds batches and returns Float32 vectors in order", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(embeddingResponse([[1, 0], [0, 1]]));
    const provider = providerWith(fetchImpl);
    const result = await provider.embed(["a", "b"], { purpose: "document" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dimensions).toBe(2);
      expect([...(result.value.vectors[0] ?? [])]).toEqual([1, 0]);
      expect(result.value.usage?.inputTokens).toBe(3);
    }
  });

  it("tolerates model echo differences in llama.cpp mode (FR-040)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(embeddingResponse([[1, 0]], "loaded-gguf-model"));
    const provider = providerWith(fetchImpl, "llama_cpp", "requested");
    const result = await provider.embed(["a"], { purpose: "query" });
    expect(result.ok).toBe(true);
  });

  it("rejects model mismatch for openai_compatible services", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(embeddingResponse([[1, 0]], "another-model"));
    const provider = providerWith(fetchImpl);
    const result = await provider.embed(["a"], { purpose: "query" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_MODEL_MISMATCH");
  });

  it("maps HTTP status codes to safe error categories with Retry-After", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("busy", { status: 429, headers: { "retry-after": "2" } }));
    const provider = providerWith(fetchImpl);
    const result = await provider.embed(["a"], { purpose: "query" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("rate_limit");
      expect(result.error.retryable).toBe(true);
      expect(result.error.retryAfterMs).toBe(2000);
    }
  });

  it("rejects dimension mismatches against the recipe", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(embeddingResponse([[1, 0, 0]]));
    const provider = new HttpEmbeddingProvider({ kind: "openai_compatible", baseUrl: "http://127.0.0.1:8080/v1", model: "test-model", timeoutMs: 1000, expectedDimension: 2, fetchImpl: fetchImpl });
    const result = await provider.embed(["a"], { purpose: "document" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_VECTOR_INVALID");
  });

  it("reports cancellation vs timeout distinctly", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: unknown, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const provider = providerWith(fetchImpl);
    const controller = new AbortController();
    const pending = provider.embed(["a"], { purpose: "query", signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OPERATION_CANCELLED");
  });

  it("probes capabilities: dimension, batch, normalization, health (PRD 17.4)", async () => {
    const unit = [0.6, 0.8];
    const fetchImpl = vi.fn().mockImplementation((url: URL) => {
      const path = url.pathname;
      if (path.endsWith("/health")) return Promise.resolve(new Response("{}", { status: 200 }));
      if (path.endsWith("/models")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      return Promise.resolve(embeddingResponse([unit, unit]));
    });
    const provider = providerWith(fetchImpl, "llama_cpp", "");
    const report = await probeEmbeddingProvider(provider);
    expect(report.reachable).toBe(true);
    expect(report.dimensions).toBe(2);
    expect(report.batchInput).toBe(true);
    expect(report.serverNormalization).toBe("l2");
    expect(report.health).toBe("ok");
    expect(report.modelList).toBe(true);
  });

  it("marks health unsupported for generic services", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(embeddingResponse([[1, 0]]));
    const provider = providerWith(fetchImpl);
    expect(await provider.health()).toBe("unsupported");
  });
});

describe("EmbeddingBatcher (PRD 14.6)", () => {
  const items = (count: number, tokens = 10): BatchItem[] => Array.from({ length: count }, (_, index) => ({ id: `i${String(index)}`, text: `text ${String(index)}`, estimatedTokens: tokens }));

  it("plans batches under item, token, and byte limits simultaneously", () => {
    const plan = planBatches(items(5, 30), { maxItems: 3, maxTokens: 70 });
    expect(plan.map((batch) => batch.length)).toEqual([2, 2, 1]);
    const bytePlan = planBatches(items(4), { maxItems: 10, maxPayloadBytes: 14 });
    expect(bytePlan.length).toBeGreaterThan(1);
  });

  it("embeds all items across batches", async () => {
    const batcher = new EmbeddingBatcher(
      (texts) => Promise.resolve({ ok: true, value: { model: "m", dimensions: 2, vectors: texts.map(() => new Float32Array([1, 0])) } }),
      { maxItems: 2 },
      IMMEDIATE_RETRY
    );
    const outcome = await batcher.run(items(5));
    expect(outcome.embedded.size).toBe(5);
    expect(outcome.failed.size).toBe(0);
    expect(outcome.requests).toBe(3);
  });

  it("bisects suspected overlimit batches and dead-letters single failures", async () => {
    const poison = new Set(["text 2"]);
    const batcher = new EmbeddingBatcher(
      (texts) => {
        if (texts.some((text) => poison.has(text))) {
          return Promise.resolve({ ok: false, error: { code: "PROVIDER_HTTP_413", category: "invalid_input", messageKey: "error.provider.http", retryable: false } });
        }
        return Promise.resolve({ ok: true, value: { model: "m", dimensions: 2, vectors: texts.map(() => new Float32Array([1, 0])) } });
      },
      { maxItems: 8 },
      IMMEDIATE_RETRY
    );
    const outcome = await batcher.run(items(5));
    expect(outcome.embedded.size).toBe(4);
    expect(outcome.failed.size).toBe(1);
    expect(outcome.failed.get("i2")?.code).toBe("PROVIDER_HTTP_413");
  });

  it("retries transient failures before giving up", async () => {
    let calls = 0;
    const batcher = new EmbeddingBatcher(
      (texts) => {
        calls += 1;
        if (calls === 1) return Promise.resolve({ ok: false, error: { code: "PROVIDER_HTTP_500", category: "provider", messageKey: "error.provider.http", retryable: true } });
        return Promise.resolve({ ok: true, value: { model: "m", dimensions: 2, vectors: texts.map(() => new Float32Array([1, 0])) } });
      },
      { maxItems: 8 },
      IMMEDIATE_RETRY
    );
    const outcome = await batcher.run(items(3));
    expect(outcome.embedded.size).toBe(3);
    expect(calls).toBe(2);
  });

  it("fails remaining items as cancelled on abort", async () => {
    const controller = new AbortController();
    const batcher = new EmbeddingBatcher(
      (texts) => {
        controller.abort();
        return Promise.resolve({ ok: true, value: { model: "m", dimensions: 2, vectors: texts.map(() => new Float32Array([1, 0])) } });
      },
      { maxItems: 1 },
      IMMEDIATE_RETRY
    );
    const outcome = await batcher.run(items(3), controller.signal);
    expect(outcome.embedded.size).toBe(1);
    expect([...outcome.failed.values()].every((error) => error.category === "cancelled")).toBe(true);
  });
});

describe("multilingual capability probe (PRD 8.6)", () => {
  it("verifies when translations are closer than distractors", async () => {
    const vectorFor = (text: string): Float32Array => {
      if (text.includes("向量") || text.includes("vector index")) return new Float32Array([1, 0, 0]);
      if (text.includes("ノート") || text.includes("semantic search and embedding")) return new Float32Array([0, 1, 0]);
      if (text.includes("semántica") || text.includes("multilingual semantic")) return new Float32Array([0, 0, 1]);
      return new Float32Array([0.5, -0.5, 0.2]);
    };
    const result = await testMultilingualCapability((texts) => Promise.resolve(texts.map(vectorFor)));
    expect(result?.verified).toBe(true);
    expect(result?.score).toBe(1);
    expect(result?.testedPairs).toEqual(BUILTIN_MULTILINGUAL_PAIRS.map((pair) => [pair.languageA, pair.languageB]));
  });

  it("reports unverified when the model cannot separate pairs", async () => {
    const result = await testMultilingualCapability((texts) => Promise.resolve(texts.map(() => new Float32Array([1, 1, 1]))));
    expect(result?.verified).toBe(false);
  });

  it("returns null when embedding fails", async () => {
    expect(await testMultilingualCapability(() => Promise.resolve(null))).toBeNull();
  });
});

describe("factory", () => {
  it("builds a query embedder that returns null on failure (FR-011)", async () => {
    const failing = createQueryEmbedder(
      providerWith(() => Promise.resolve(new Response("no", { status: 500 }))),
      { id: "p", name: "p", kind: "openai_compatible", baseUrl: "http://127.0.0.1:8080/v1", timeoutMs: 1000, maxRetries: 0, concurrency: 1 }
    );
    expect(await failing("query text")).toBeNull();
  });

  it("builds providers from profiles with secrets applied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(embeddingResponse([[1, 0]]));
    const provider = createEmbeddingProvider(
      { id: "p", name: "p", kind: "openai_compatible", baseUrl: "http://127.0.0.1:8080/v1", timeoutMs: 1000, maxRetries: 0, concurrency: 1 },
      { modelId: "test-model", dimension: 2 },
      "secret-key",
      fetchImpl
    );
    await provider.embed(["a"], { purpose: "query" });
    const call = fetchImpl.mock.calls[0] as [URL, { headers: Record<string, string> }];
    expect(call[1].headers.authorization).toBe("Bearer secret-key");
  });

  it("keeps the rerank slot disabled but callable (FR-042)", async () => {
    expect((await RERANK_DISABLED.probe()).available).toBe(false);
    expect(await RERANK_DISABLED.rerank("q", [], { topN: 5 })).toEqual([]);
  });
});

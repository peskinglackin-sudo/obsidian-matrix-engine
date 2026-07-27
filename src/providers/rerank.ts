/**
 * Rerank contract reservation (FR-042).
 *
 * The MVP retrieval flow runs complete without any reranker; this
 * interface exists so P2 can add llama.cpp /v1/rerank or generic rerank
 * adapters without rewriting the pipeline. Default: disabled.
 */

export type RerankCapabilities = Readonly<{
  available: boolean;
  maxDocuments?: number;
}>;

export type RerankDocument = Readonly<{
  id: string;
  text: string;
}>;

export type RerankResult = Readonly<{
  id: string;
  score: number;
}>;

export interface RerankProvider {
  probe(signal?: AbortSignal): Promise<RerankCapabilities>;
  rerank(
    query: string,
    documents: readonly RerankDocument[],
    options: Readonly<{ topN: number; signal?: AbortSignal }>
  ): Promise<readonly RerankResult[]>;
}

/** Placeholder used while rerank stays disabled; keeps call sites honest. */
export const RERANK_DISABLED: RerankProvider = Object.freeze({
  probe: () => Promise.resolve(Object.freeze({ available: false })),
  rerank: () => Promise.resolve(Object.freeze([]))
});

import type { SafeError } from "../core/errors";

export type EmbeddingCapabilities = Readonly<{ batch: true; cancellable: true; dimensions: number }>;
export type EmbeddingBatchResult = Readonly<{ model: string; dimensions: number; vectors: readonly (readonly number[])[]; usage?: Readonly<{ inputTokens?: number; totalTokens?: number }> }>;
export type EmbeddingRequest = Readonly<{ inputs: readonly string[]; signal?: AbortSignal; timeoutMs: number }>;
export type EmbeddingProviderResult = Readonly<{ ok: true; value: EmbeddingBatchResult }> | Readonly<{ ok: false; error: SafeError }>;
export interface EmbeddingProvider {
  readonly capabilities: EmbeddingCapabilities;
  embed(request: EmbeddingRequest): Promise<EmbeddingProviderResult>;
}

import type { SafeError } from "../core/errors";
import type { EmbeddingVectors, ProviderResult } from "./http-embedding";
import { withRetry, type RetryOptions } from "./retry";

/**
 * EmbeddingBatcher (PRD 14.6).
 *
 * Batches respect max items, estimated tokens, and payload bytes at the
 * same time. A failed batch that looks like an input-size limit is
 * bisected; items that still fail alone become dead letters with their
 * error preserved for UI retry. Transient errors retry with backoff.
 */

export type BatchItem = Readonly<{
  id: string;
  text: string;
  estimatedTokens: number;
}>;

export type BatchLimits = Readonly<{
  maxItems: number;
  maxTokens?: number;
  maxPayloadBytes?: number;
}>;

export type BatchOutcome = Readonly<{
  embedded: ReadonlyMap<string, Float32Array>;
  failed: ReadonlyMap<string, SafeError>;
  requests: number;
}>;

export type EmbedBatchFn = (texts: readonly string[], signal?: AbortSignal) => Promise<ProviderResult<EmbeddingVectors>>;

const OVERLIMIT_CODES = new Set(["PROVIDER_HTTP_413", "PROVIDER_HTTP_400", "PROVIDER_INPUT_INVALID"]);

export class EmbeddingBatcher {
  readonly #embed: EmbedBatchFn;
  readonly #limits: BatchLimits;
  readonly #retry: RetryOptions;

  constructor(embed: EmbedBatchFn, limits: BatchLimits, retry: RetryOptions) {
    this.#embed = embed;
    this.#limits = limits;
    this.#retry = retry;
  }

  async run(items: readonly BatchItem[], signal?: AbortSignal): Promise<BatchOutcome> {
    const embedded = new Map<string, Float32Array>();
    const failed = new Map<string, SafeError>();
    let requests = 0;

    for (const group of planBatches(items, this.#limits)) {
      const spent = await this.#runGroup(group, embedded, failed, signal);
      requests += spent;
      if (signal?.aborted === true) {
        const cancelled: SafeError = Object.freeze({ code: "OPERATION_CANCELLED", category: "cancelled", messageKey: "error.operation.cancelled", retryable: false });
        for (const item of items) {
          if (!embedded.has(item.id) && !failed.has(item.id)) failed.set(item.id, cancelled);
        }
        break;
      }
    }
    return Object.freeze({ embedded, failed, requests });
  }

  async #runGroup(group: readonly BatchItem[], embedded: Map<string, Float32Array>, failed: Map<string, SafeError>, signal?: AbortSignal): Promise<number> {
    if (group.length === 0) return 0;
    let requests = 0;
    const result = await withRetry(async () => {
      requests += 1;
      return this.#embed(group.map(({ text }) => text), signal);
    }, { ...this.#retry, ...(signal === undefined ? {} : { signal }) });

    if (result.ok) {
      group.forEach((item, index) => {
        const vector = result.value.vectors[index];
        if (vector === undefined) failed.set(item.id, Object.freeze({ code: "PROVIDER_VECTOR_INVALID", category: "provider", messageKey: "error.provider.vector", retryable: false }));
        else embedded.set(item.id, vector);
      });
      return requests;
    }

    if (group.length > 1 && OVERLIMIT_CODES.has(result.error.code)) {
      // Suspected size limit: bisect (PRD 14.6).
      const middle = Math.ceil(group.length / 2);
      requests += await this.#runGroup(group.slice(0, middle), embedded, failed, signal);
      requests += await this.#runGroup(group.slice(middle), embedded, failed, signal);
      return requests;
    }

    for (const item of group) failed.set(item.id, result.error);
    return requests;
  }
}

export function planBatches(items: readonly BatchItem[], limits: BatchLimits): readonly (readonly BatchItem[])[] {
  const batches: BatchItem[][] = [];
  let current: BatchItem[] = [];
  let tokens = 0;
  let bytes = 0;
  for (const item of items) {
    const itemBytes = utf8Length(item.text);
    const wouldOverflow =
      current.length >= limits.maxItems ||
      (limits.maxTokens !== undefined && current.length > 0 && tokens + item.estimatedTokens > limits.maxTokens) ||
      (limits.maxPayloadBytes !== undefined && current.length > 0 && bytes + itemBytes > limits.maxPayloadBytes);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      tokens = 0;
      bytes = 0;
    }
    current.push(item);
    tokens += item.estimatedTokens;
    bytes += itemBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function utf8Length(text: string): number {
  let length = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
}

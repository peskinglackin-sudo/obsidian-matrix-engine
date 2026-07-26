import type { SafeError } from "../core/errors";

/**
 * Retry policy (PRD 14.6): only transient failures retry (408, 429, 5xx,
 * network interruptions), with exponential backoff, jitter, and
 * Retry-After respected when present.
 */

export type RetryOptions = Readonly<{
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  signal?: AbortSignal;
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
}>;

export type RetryResult<T> = Readonly<{ ok: true; value: T; attempts: number }> | Readonly<{ ok: false; error: SafeError; attempts: number }>;

export function isRetryableError(error: SafeError): boolean {
  return error.retryable && (error.category === "timeout" || error.category === "rate_limit" || error.category === "provider" || error.category === "environment");
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: SafeError }>>,
  options: RetryOptions
): Promise<RetryResult<T>> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let attempts = 0;
  let lastError: SafeError = Object.freeze({ code: "RETRY_NOT_ATTEMPTED", category: "internal", messageKey: "error.internal.failure", retryable: false });

  while (attempts <= options.maxRetries) {
    if (options.signal?.aborted === true) {
      return Object.freeze({ ok: false, error: cancelledError(), attempts });
    }
    attempts += 1;
    const result = await operation(attempts);
    if (result.ok) return Object.freeze({ ok: true, value: result.value, attempts });
    lastError = result.error;
    if (!isRetryableError(result.error) || attempts > options.maxRetries) break;

    const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempts - 1));
    const jittered = exponential * (0.5 + random() * 0.5);
    const delay = result.error.retryAfterMs !== undefined ? Math.min(Math.max(result.error.retryAfterMs, jittered), options.maxDelayMs) : jittered;
    try {
      await sleep(delay, options.signal);
    } catch {
      return Object.freeze({ ok: false, error: cancelledError(), attempts });
    }
  }
  return Object.freeze({ ok: false, error: lastError, attempts });
}

function cancelledError(): SafeError {
  return Object.freeze({ code: "OPERATION_CANCELLED", category: "cancelled", messageKey: "error.operation.cancelled", retryable: false });
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type ErrorCategory =
  | "cancelled"
  | "timeout"
  | "environment"
  | "unsupported"
  | "unverified"
  | "invalid_input"
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "provider"
  | "storage"
  | "internal";

export type SafeError = Readonly<{
  code: string;
  category: ErrorCategory;
  messageKey: string;
  retryable: boolean;
  operationId?: string;
  retryAfterMs?: number;
}>;

const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/u;
const SAFE_MESSAGE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/u;
const SAFE_OPERATION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/u;

export class MatrixEngineError extends Error {
  readonly safe: SafeError;

  constructor(safe: SafeError) {
    validateSafeError(safe);
    super(safe.messageKey);
    this.name = "MatrixEngineError";
    this.safe = Object.freeze({ ...safe });
  }
}

export function validateSafeError(error: SafeError): void {
  if (!SAFE_CODE_PATTERN.test(error.code)) {
    throw new TypeError("Safe error code is invalid");
  }
  if (!SAFE_MESSAGE_KEY_PATTERN.test(error.messageKey)) {
    throw new TypeError("Safe error message key is invalid");
  }
  if (error.operationId !== undefined && !SAFE_OPERATION_ID_PATTERN.test(error.operationId)) {
    throw new TypeError("Safe error operation ID is invalid");
  }
  if (error.retryAfterMs !== undefined && (!Number.isSafeInteger(error.retryAfterMs) || error.retryAfterMs < 0)) {
    throw new TypeError("Safe error retry delay is invalid");
  }
}

export function toSafeError(error: unknown, fallbackCode = "INTERNAL_FAILURE"): SafeError {
  if (error instanceof MatrixEngineError) {
    return error.safe;
  }
  if (isAbortError(error)) {
    return Object.freeze({
      code: "OPERATION_CANCELLED",
      category: "cancelled",
      messageKey: "error.operation.cancelled",
      retryable: false
    });
  }

  return Object.freeze({
    code: fallbackCode,
    category: "internal",
    messageKey: "error.internal.failure",
    retryable: false
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

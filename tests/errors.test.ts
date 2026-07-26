import { describe, expect, it } from "vitest";

import { MatrixEngineError, toSafeError } from "../src/core/errors";

describe("safe error translation", () => {
  it("preserves only project-owned safe fields", () => {
    const error = new MatrixEngineError({
      code: "PROVIDER_TIMEOUT",
      category: "timeout",
      messageKey: "error.provider.timeout",
      retryable: true,
      retryAfterMs: 1000
    });

    expect(toSafeError(error)).toEqual({
      code: "PROVIDER_TIMEOUT",
      category: "timeout",
      messageKey: "error.provider.timeout",
      retryable: true,
      retryAfterMs: 1000
    });
    expect(JSON.stringify(toSafeError(error))).not.toContain("secret");
  });

  it("does not expose arbitrary nested errors", () => {
    const raw = { message: "key=secret", response: { data: "private document" } };

    expect(toSafeError(raw, "PROVIDER_FAILURE")).toEqual({
      code: "PROVIDER_FAILURE",
      category: "internal",
      messageKey: "error.internal.failure",
      retryable: false
    });
  });
});

import { z } from "zod";

const safeLogEventSchema = z.strictObject({
  timestamp: z.iso.datetime({ offset: true }),
  level: z.enum(["error", "warn", "info", "debug"]),
  event: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/u),
  component: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u),
  operationId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u).optional(),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u).optional(),
  durationMs: z.number().nonnegative().optional(),
  count: z.number().int().nonnegative().optional()
});

export type SafeLogEvent = z.infer<typeof safeLogEventSchema>;

export class BoundedSafeLog {
  readonly #maxBytes: number;
  readonly #lines: string[] = [];
  #bytes = 0;
  #dropped = 0;

  constructor(maxBytes = 64 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) {
      throw new TypeError("Safe log byte limit must be an integer of at least 256");
    }
    this.#maxBytes = maxBytes;
  }

  capture(input: unknown): boolean {
    const parsed = safeLogEventSchema.safeParse(input);
    if (!parsed.success) {
      this.#dropped += 1;
      return false;
    }
    const line = `${JSON.stringify(parsed.data)}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.#bytes + bytes > this.#maxBytes) {
      this.#dropped += 1;
      return false;
    }
    this.#lines.push(line);
    this.#bytes += bytes;
    return true;
  }

  snapshot(): Readonly<{ text: string; bytes: number; dropped: number }> {
    return Object.freeze({ text: this.#lines.join(""), bytes: this.#bytes, dropped: this.#dropped });
  }
}

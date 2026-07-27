import { createHash } from "node:crypto";

/**
 * Stable content hashing for fingerprints and layered index hashes.
 * Canonical form sorts object keys, preserves array order, and rejects
 * values that cannot round-trip deterministically (PRD 12.8, 14.4).
 */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return serialize(value, new Set());
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`Canonical JSON rejects ${typeof value} values`);
  }

  const objectValue: object = value;
  if (seen.has(objectValue)) throw new TypeError("Canonical JSON rejects circular references");
  seen.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      return `[${objectValue.map((item) => serialize(item, seen)).join(",")}]`;
    }
    const entries = Object.entries(objectValue as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${serialize(item, seen)}`);
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(objectValue);
  }
}

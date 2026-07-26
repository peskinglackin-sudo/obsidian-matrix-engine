import { describe, expect, it } from "vitest";

import { canonicalJson, hashCanonical, sha256Hex } from "../src/core/hash";

describe("canonical hashing", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("skips undefined object values but keeps null", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("normalizes negative zero", () => {
    expect(canonicalJson({ value: -0 })).toBe('{"value":0}');
  });

  it("rejects non-finite numbers, functions, and cycles", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalJson({ value: () => 1 })).toThrow(TypeError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(TypeError);
  });

  it("hashes identical structures identically regardless of key order", () => {
    expect(hashCanonical({ x: 1, y: [true, "z"] })).toBe(hashCanonical({ y: [true, "z"], x: 1 }));
  });

  it("produces stable sha-256 output", () => {
    expect(sha256Hex("matrix-engine")).toBe(sha256Hex("matrix-engine"));
    expect(sha256Hex("matrix-engine")).toHaveLength(64);
  });

  it("escapes keys and strings safely", () => {
    expect(canonicalJson({ 'a"b': "c\nd" })).toBe('{"a\\"b":"c\\nd"}');
  });
});

import { describe, expect, it } from "vitest";

import { projectSafeEvidence } from "../spike/report/projection";

describe("safe final report projection", () => {
  it("drops raw text, vectors, query rows, package lists, and arbitrary fields", () => {
    const unsafe = "PROHIBITED_RAW_VALUE";
    const sources = {
      fts: { lancedbVersion: "0.31.0", authoritativeScope: "precheck", checks: [], rawLog: unsafe },
      lexical: { fixtureSha256: "a".repeat(64), documentCount: 1, queryCount: 1, groups: [{ pass: true, rawQuery: unsafe }] },
      live: { model: "text-embedding-3-small", testedAt: "2026-07-15T00:00:00Z", dimensions: 1536, vectorCount: 1, vectorShapeSha256: "b".repeat(64), vector: [unsafe] },
      semantic: { sha256: "c".repeat(64), recipeSha256: "d".repeat(64), documents: [{ text: unsafe }], distractors: [], sameLanguage: [{ text: unsafe }], crossLanguage: [], prefixControls: { queries: [], documents: [] }, vectors: [unsafe] },
      ann: { fixtureSha256: "e".repeat(64), fixture: { vectorCount: 50_000 }, flat: { latency: {} }, configurations: [{ id: "flat", indexParameters: {}, queryParameters: {}, buildMs: 1, openMs: 1, coldFirstQueryMs: 1, dataSizeBeforeIndex: 1, indexSizeBytes: 1, indexAndDataSizeBytes: 2, latency: {}, evaluation: {}, queryResults: [unsafe] }] },
      licenses: { generatedFromLockfile: true, packageCount: 1, nativeArtifacts: [], modelFixture: {}, sourceAndSyntheticFixturesLicense: "Apache-2.0", packages: [unsafe] }
    };
    const evidence = projectSafeEvidence(sources);
    const json = JSON.stringify(evidence);
    expect(json).not.toContain(unsafe);
    expect(json).not.toContain("queryResults");
    expect(json).not.toContain("packages");
    expect(json).not.toContain("vectors");
    expect(evidence.semantic).toMatchObject({ documentCount: 1, sameLanguageQueryCount: 1 });
  });
});

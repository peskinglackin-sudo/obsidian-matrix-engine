import { describe, expect, it } from "vitest";
import { evaluateAnn } from "../spike/ann/evaluate";
import { evaluateLocalGpu, LLAMA_COMMIT, MODEL_SHA256, MODEL_SIZE } from "../spike/local-gpu/evaluate";
import { evaluateSemanticResultSet } from "../spike/semantic/evaluate";
import { buildSemanticFixtures, DIRECTIONS, LANGUAGES } from "../spike/semantic/fixtures";
import { retrievalMetrics } from "../spike/semantic/metrics";
import { buildSemanticWorkload } from "../spike/semantic/runner";
describe("local GPU hard gate", () => {
  const valid = { platform: "linux-x64", backend: "vulkan", modelSize: MODEL_SIZE, modelSha256: MODEL_SHA256, llamaCommit: LLAMA_COMMIT, deviceListed: true, explicitlySelected: true, apiVersion: "1.3", offloadedLayers: 24, totalLayers: 24, vectorDimensions: 768, allFinite: true, normalized: true, minimumCosine: 0.9995, cleanShutdown: true, batchOrder: true, repeatMinimumCosine: 0.999999, cancellation: true, timeout: true, invalidInput: true, emptyInput: true, oversizeInput: true };
  it("passes only exact model/runtime/full-offload/parity evidence", () => { expect(evaluateLocalGpu(valid)).toMatchObject({ status: "pass" }); expect(evaluateLocalGpu({ ...valid, offloadedLayers: 23 })).toMatchObject({ status: "fail", decisionCodes: ["GPU_OFFLOAD_INCOMPLETE"] }); expect(evaluateLocalGpu({ ...valid, minimumCosine: 0.998 })).toMatchObject({ status: "fail", decisionCodes: ["GPU_CPU_PARITY_FAILED"] }); });
});
describe("semantic manifests", () => {
  it("meets every approved count, target, concept, distractor, direction and recipe-control gate", () => {
    const fixtures = buildSemanticFixtures();
    const documentIds = new Set(fixtures.documents.map(({ id }) => id));
    expect(fixtures.sameLanguage).toHaveLength(120);
    expect(fixtures.crossLanguage).toHaveLength(90);
    expect(fixtures.documents).toHaveLength(140);
    expect(fixtures.distractors).toHaveLength(480);
    expect(fixtures.prefixControls.queries).toHaveLength(420);
    expect(fixtures.prefixControls.documents).toHaveLength(1240);
    expect([...fixtures.sameLanguage, ...fixtures.crossLanguage].every(({ expectedTargets }) => expectedTargets.every((id) => documentIds.has(id)))).toBe(true);
    expect(fixtures.sameLanguage.every(({ text }) => text.startsWith("Query: "))).toBe(true);
    expect(fixtures.documents.every(({ text }) => text.startsWith("Document: "))).toBe(true);
    for (const language of LANGUAGES) expect(fixtures.sameLanguage.filter((query) => query.language === language)).toHaveLength(10);
    for (const direction of DIRECTIONS) expect(fixtures.crossLanguage.filter((query) => query.direction === direction)).toHaveLength(15);
    expect(fixtures.recipeSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(fixtures.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });
  it("computes recall, reciprocal rank and zero-result independently", () => { const queries = [{ id: "a", expectedTargets: ["x"] }, { id: "b", expectedTargets: ["y"] }]; expect(retrievalMetrics(queries, [{ queryId: "a", rankedTargetIds: ["z", "x"] }, { queryId: "b", rankedTargetIds: [] }], 5)).toEqual({ count: 2, recall: 0.5, mrrAt10: 0.25, zeroResultRate: 0.5 }); });
  it("evaluates every language and direction independently and rejects incomplete result sets", () => {
    const fixtures = buildSemanticFixtures();
    const gatingQueries = [...fixtures.sameLanguage, ...fixtures.crossLanguage];
    const perfect = gatingQueries.map((query) => ({ queryId: query.id, rankedTargetIds: [...query.expectedTargets] }));
    const control = (kind: "query-prefix-removed" | "query-prefix-swapped" | "document-prefix-removed" | "document-prefix-swapped") => ({ kind, results: perfect });
    const resultSet = {
      schemaVersion: 1, fixtureSha256: fixtures.sha256, recipeSha256: fixtures.recipeSha256,
      modelSha256: MODEL_SHA256, llamaCommit: LLAMA_COMMIT, backend: "vulkan", platform: "linux-x64",
      gatingResults: perfect,
      controls: [control("query-prefix-removed"), control("query-prefix-swapped"), control("document-prefix-removed"), control("document-prefix-swapped")]
    };
    expect(evaluateSemanticResultSet(resultSet)).toMatchObject({ status: "pass", decisionCodes: ["SEMANTIC_THRESHOLDS_PASS"] });
    expect(() => evaluateSemanticResultSet({ ...resultSet, gatingResults: perfect.slice(1) })).toThrow(/GATING_RESULTS_INVALID/u);
    expect(() => evaluateSemanticResultSet({ ...resultSet, fixtureSha256: "a".repeat(64) })).toThrow(/FIXTURE_BINDING_INVALID/u);
  });
  it("builds a deterministic semantic workload without exposing vectors or missing source items", () => {
    const first = buildSemanticWorkload();
    const second = buildSemanticWorkload();
    expect(first.inputs).toEqual(second.inputs);
    expect(first.inputs).toHaveLength(2490);
    expect(first.inputs.every((text) => text.startsWith("Query: ") || text.startsWith("Document: ") || text.length > 0)).toBe(true);
  });
});
describe("ANN policy", () => {
  const good = Array.from({ length: 500 }, (_, index) => ({ id: String(index), recallAt10: index < 5 ? 0.8 : 0.96 }));
  it("requires all dual recall and latency thresholds", () => { expect(evaluateAnn(good, { flatP95Ms: 50, annP95Ms: 30 })).toMatchObject({ decision: "ann-default" }); expect(evaluateAnn(good, { flatP95Ms: 25, annP95Ms: 10 })).toMatchObject({ decision: "flat-default" }); expect(evaluateAnn([], { flatP95Ms: 50, annP95Ms: 30 })).toMatchObject({ decision: "insufficient" }); expect(evaluateAnn([{ id: "bad", recallAt10: Number.NaN }, ...good], { flatP95Ms: 50, annP95Ms: 30 })).toMatchObject({ decision: "insufficient", decisionCodes: ["ANN_EVIDENCE_INVALID"] }); });
});

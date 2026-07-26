import { z } from "zod";

import { LLAMA_COMMIT, MODEL_SHA256 } from "../local-gpu/evaluate";
import { buildSemanticFixtures, DIRECTIONS, LANGUAGES } from "./fixtures";
import { retrievalMetrics } from "./metrics";

const rankedResultSchema = z.strictObject({
  queryId: z.string().min(1),
  rankedTargetIds: z.array(z.string().min(1)).max(100)
});

const controlKindSchema = z.enum(["query-prefix-removed", "query-prefix-swapped", "document-prefix-removed", "document-prefix-swapped"]);

export const semanticResultSetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  fixtureSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  recipeSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  modelSha256: z.literal(MODEL_SHA256),
  llamaCommit: z.literal(LLAMA_COMMIT),
  backend: z.enum(["cpu", "vulkan", "metal"]),
  platform: z.enum(["windows-x64", "macos-arm64", "linux-x64"]),
  gatingResults: z.array(rankedResultSchema),
  controls: z.array(z.strictObject({ kind: controlKindSchema, results: z.array(rankedResultSchema) })).length(4)
});

export type SemanticEvaluation = Readonly<{
  status: "pass" | "fail";
  decisionCodes: readonly string[];
  sameLanguage: readonly Readonly<{ language: string; recallAt5: number; mrrAt10: number; zeroResultRate: number; pass: boolean }>[];
  crossLanguage: readonly Readonly<{ direction: string; recallAt10: number; pass: boolean }>[];
  controls: readonly Readonly<{ kind: string; recallAt10: number; mrrAt10: number; zeroResultRate: number }>[];
}>;

function assertExactResultIds(actual: readonly Readonly<{ queryId: string }>[], expected: readonly string[], code: string): void {
  const ids = actual.map(({ queryId }) => queryId);
  if (new Set(ids).size !== ids.length || ids.length !== expected.length || expected.some((id) => !ids.includes(id))) throw new Error(code);
}

export function evaluateSemanticResultSet(input: unknown): SemanticEvaluation {
  const value = semanticResultSetSchema.parse(input);
  const fixture = buildSemanticFixtures();
  if (value.fixtureSha256 !== fixture.sha256 || value.recipeSha256 !== fixture.recipeSha256) throw new Error("SEMANTIC_FIXTURE_BINDING_INVALID");
  const gatingQueries = [...fixture.sameLanguage, ...fixture.crossLanguage];
  assertExactResultIds(value.gatingResults, gatingQueries.map(({ id }) => id), "SEMANTIC_GATING_RESULTS_INVALID");
  const controlsByKind = new Map(value.controls.map((control) => [control.kind, control.results]));
  if (controlsByKind.size !== 4) throw new Error("SEMANTIC_CONTROL_KIND_DUPLICATE");

  const sameLanguage = LANGUAGES.map((language) => {
    const queries = fixture.sameLanguage.filter((query) => query.language === language);
    const metrics = retrievalMetrics(queries, value.gatingResults, 5);
    const pass = metrics.recall >= 0.9 && metrics.mrrAt10 >= 0.75 && metrics.zeroResultRate <= 0.1;
    return Object.freeze({ language, recallAt5: metrics.recall, mrrAt10: metrics.mrrAt10, zeroResultRate: metrics.zeroResultRate, pass });
  });
  const crossLanguage = DIRECTIONS.map((direction) => {
    const queries = fixture.crossLanguage.filter((query) => query.direction === direction);
    const metrics = retrievalMetrics(queries, value.gatingResults, 10);
    return Object.freeze({ direction, recallAt10: metrics.recall, pass: metrics.recall >= 0.8 });
  });

  const expectedByKind = {
    "query-prefix-removed": fixture.prefixControls.queries.filter(({ kind }) => kind === "query-prefix-removed").map(({ sourceId }) => sourceId),
    "query-prefix-swapped": fixture.prefixControls.queries.filter(({ kind }) => kind === "query-prefix-swapped").map(({ sourceId }) => sourceId),
    "document-prefix-removed": gatingQueries.map(({ id }) => id),
    "document-prefix-swapped": gatingQueries.map(({ id }) => id)
  } as const;
  const controls = controlKindSchema.options.map((kind) => {
    const results = controlsByKind.get(kind);
    if (results === undefined) throw new Error("SEMANTIC_CONTROL_KIND_MISSING");
    assertExactResultIds(results, expectedByKind[kind], "SEMANTIC_CONTROL_RESULTS_INVALID");
    const metrics = retrievalMetrics(gatingQueries, results, 10);
    return Object.freeze({ kind, recallAt10: metrics.recall, mrrAt10: metrics.mrrAt10, zeroResultRate: metrics.zeroResultRate });
  });
  const pass = sameLanguage.every((group) => group.pass) && crossLanguage.every((group) => group.pass);
  return Object.freeze({
    status: pass ? "pass" : "fail",
    decisionCodes: Object.freeze([pass ? "SEMANTIC_THRESHOLDS_PASS" : "SEMANTIC_THRESHOLDS_FAILED"]),
    sameLanguage: Object.freeze(sameLanguage),
    crossLanguage: Object.freeze(crossLanguage),
    controls: Object.freeze(controls)
  });
}

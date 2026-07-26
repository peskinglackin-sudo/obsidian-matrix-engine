export type AnnQueryResult = Readonly<{ id: string; recallAt10: number; recallAt20?: number }>;
export type AnnTiming = Readonly<{ flatP95Ms: number; annP95Ms: number }>;
export function evaluateAnn(results: readonly AnnQueryResult[], timing: AnnTiming) {
  if (results.length < 500) return Object.freeze({ decision: "insufficient" as const, decisionCodes: Object.freeze(["ANN_QUERY_COUNT_INSUFFICIENT"]) });
  if (![timing.flatP95Ms, timing.annP95Ms].every((value) => Number.isFinite(value) && value >= 0) || results.some(({ recallAt10, recallAt20 }) => !Number.isFinite(recallAt10) || recallAt10 < 0 || recallAt10 > 1 || (recallAt20 !== undefined && (!Number.isFinite(recallAt20) || recallAt20 < 0 || recallAt20 > 1)))) {
    return Object.freeze({ decision: "insufficient" as const, decisionCodes: Object.freeze(["ANN_EVIDENCE_INVALID"]) });
  }
  const aggregate = results.reduce((sum, item) => sum + item.recallAt10, 0) / results.length;
  const tail80 = results.filter(({ recallAt10 }) => recallAt10 >= 0.8).length / results.length;
  const minimum = Math.min(...results.map(({ recallAt10 }) => recallAt10));
  const improvementMs = timing.flatP95Ms - timing.annP95Ms;
  const improvementRatio = improvementMs / timing.flatP95Ms;
  const pass = aggregate >= 0.95 && tail80 >= 0.99 && minimum >= 0.5 && improvementRatio >= 0.3 && improvementMs >= 10 && timing.annP95Ms < 100 && timing.flatP95Ms < 100 && timing.flatP95Ms > 25;
  return Object.freeze({ decision: pass ? "ann-default" as const : "flat-default" as const, aggregateRecallAt10: aggregate, queryFractionAtLeast80: tail80, minimumRecallAt10: minimum, improvementMs, improvementRatio, decisionCodes: Object.freeze([pass ? "ANN_THRESHOLDS_PASS" : "ANN_THRESHOLDS_NOT_MET"]) });
}

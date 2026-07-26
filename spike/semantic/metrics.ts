type RankedResult = Readonly<{ queryId: string; rankedTargetIds: readonly string[] }>;
type ExpectedQuery = Readonly<{ id: string; expectedTargets: readonly string[] }>;
export function retrievalMetrics(queries: readonly ExpectedQuery[], results: readonly RankedResult[], recallK: number) {
  if (queries.length === 0) throw new Error("SEMANTIC_QUERY_GROUP_EMPTY");
  const byId = new Map(results.map((result) => [result.queryId, result.rankedTargetIds]));
  let recallHits = 0; let reciprocal = 0; let zeros = 0;
  for (const query of queries) {
    const ranked = byId.get(query.id) ?? [];
    if (ranked.length === 0) zeros += 1;
    if (ranked.slice(0, recallK).some((id) => query.expectedTargets.includes(id))) recallHits += 1;
    const rank = ranked.slice(0, 10).findIndex((id) => query.expectedTargets.includes(id));
    if (rank >= 0) reciprocal += 1 / (rank + 1);
  }
  return Object.freeze({ count: queries.length, recall: recallHits / queries.length, mrrAt10: reciprocal / queries.length, zeroResultRate: zeros / queries.length });
}

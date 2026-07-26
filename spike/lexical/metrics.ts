import { LEXICAL_GROUPS, type LexicalQuery } from "./fixtures";

export type QueryResult = Readonly<{ queryId: string; rankedTargetIds: readonly string[] }>;
export function evaluateLexical(queries: readonly LexicalQuery[], results: readonly QueryResult[]) {
  const byId = new Map(results.map((result) => [result.queryId, result.rankedTargetIds]));
  return LEXICAL_GROUPS.map((group) => {
    const gating = queries.filter((query) => query.gating && query.group === group);
    let hit = 0; let reciprocal = 0; let zero = 0;
    for (const query of gating) {
      const ranked = byId.get(query.id) ?? [];
      if (ranked.length === 0) zero += 1;
      const rank = ranked.slice(0, 10).findIndex((id) => query.expectedTargets.includes(id));
      if (rank >= 0) { hit += 1; reciprocal += 1 / (rank + 1); }
    }
    const metrics = { group, count: gating.length, recallAt10: hit / gating.length, mrrAt10: reciprocal / gating.length, zeroResultRate: zero / gating.length };
    return Object.freeze({ ...metrics, pass: gating.length >= 30 && metrics.recallAt10 === 1 && metrics.mrrAt10 >= 0.8 && metrics.zeroResultRate === 0 });
  });
}

import type { LexicalHit, VectorHit } from "../storage/contracts";
import type { ExactHit } from "./exact";

/**
 * Candidate fusion (PRD 15.5-15.7).
 *
 * Reciprocal Rank Fusion over per-retriever rankings:
 *   score(d) = sum(weight_i / (k + rank_i(d)))
 * Raw BM25 scores, vector distances, and exact priorities are never mixed
 * linearly. Verified exact hits carry a higher weight but cannot override
 * every other signal without rank support.
 */

export type FusionWeights = Readonly<{
  rrfK: number;
  exactWeight: number;
  lexicalWeight: number;
  semanticWeight: number;
}>;

export type FusedCandidate = Readonly<{
  /** rowId for block-level candidates; `source:<id>` for source-only exact hits. */
  key: string;
  rowId?: string;
  sourceId: string;
  rrfScore: number;
  exactRank?: number;
  lexicalRank?: number;
  semanticRank?: number;
  exactHit?: ExactHit;
  lexicalHit?: LexicalHit;
  semanticHit?: VectorHit;
}>;

type Mutable = {
  key: string;
  rowId?: string;
  sourceId: string;
  rrfScore: number;
  exactRank?: number;
  lexicalRank?: number;
  semanticRank?: number;
  exactHit?: ExactHit;
  lexicalHit?: LexicalHit;
  semanticHit?: VectorHit;
};

export function fuseCandidates(input: Readonly<{
  exact?: readonly ExactHit[];
  lexical?: readonly LexicalHit[];
  semantic?: readonly VectorHit[];
  weights: FusionWeights;
}>): readonly FusedCandidate[] {
  const candidates = new Map<string, Mutable>();
  const k = input.weights.rrfK;

  const upsert = (key: string, sourceId: string, rowId: string | undefined): Mutable => {
    let candidate = candidates.get(key);
    if (candidate === undefined) {
      candidate = { key, sourceId, rrfScore: 0, ...(rowId === undefined ? {} : { rowId }) };
      candidates.set(key, candidate);
    }
    return candidate;
  };

  if (input.exact !== undefined) {
    input.exact.forEach((hit, index) => {
      const key = hit.rowId ?? `source:${hit.sourceId}`;
      const candidate = upsert(key, hit.sourceId, hit.rowId);
      if (candidate.exactRank === undefined) {
        candidate.exactRank = index + 1;
        candidate.exactHit = hit;
        candidate.rrfScore += input.weights.exactWeight / (k + index + 1);
      }
    });
  }
  if (input.lexical !== undefined) {
    input.lexical.forEach((hit, index) => {
      const candidate = upsert(hit.rowId, hit.sourceId, hit.rowId);
      if (candidate.lexicalRank === undefined) {
        candidate.lexicalRank = index + 1;
        candidate.lexicalHit = hit;
        candidate.rrfScore += input.weights.lexicalWeight / (k + index + 1);
      }
    });
  }
  if (input.semantic !== undefined) {
    input.semantic.forEach((hit, index) => {
      const candidate = upsert(hit.rowId, hit.sourceId, hit.rowId);
      if (candidate.semanticRank === undefined) {
        candidate.semanticRank = index + 1;
        candidate.semanticHit = hit;
        candidate.rrfScore += input.weights.semanticWeight / (k + index + 1);
      }
    });
  }

  const fused = [...candidates.values()];
  fused.sort((left, right) => right.rrfScore - left.rrfScore);
  return Object.freeze(fused.map((candidate) => Object.freeze({ ...candidate })));
}

export type SourceAggregate = Readonly<{
  sourceId: string;
  score: number;
  bestCandidate: FusedCandidate;
  blockCount: number;
}>;

/** Source aggregation (PRD 15.6): max or mean of the top blocks. */
export function aggregateBySource(candidates: readonly FusedCandidate[], method: "max" | "top_mean"): readonly SourceAggregate[] {
  const groups = new Map<string, FusedCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.sourceId);
    if (group === undefined) groups.set(candidate.sourceId, [candidate]);
    else group.push(candidate);
  }
  const aggregates: SourceAggregate[] = [];
  for (const [sourceId, group] of groups) {
    const sorted = [...group].sort((left, right) => right.rrfScore - left.rrfScore);
    const best = sorted[0];
    if (best === undefined) continue;
    const score = method === "max"
      ? best.rrfScore
      : sorted.slice(0, 3).reduce((sum, candidate) => sum + candidate.rrfScore, 0) / Math.min(sorted.length, 3);
    aggregates.push(Object.freeze({ sourceId, score, bestCandidate: best, blockCount: group.length }));
  }
  aggregates.sort((left, right) => right.score - left.score);
  return Object.freeze(aggregates);
}

/** Source diversity (PRD 15.7): cap blocks per source, preserving rank order. */
export function diversifyBySource(candidates: readonly FusedCandidate[], maxPerSource: number): readonly FusedCandidate[] {
  const counts = new Map<string, number>();
  const output: FusedCandidate[] = [];
  for (const candidate of candidates) {
    const count = counts.get(candidate.sourceId) ?? 0;
    if (count >= maxPerSource) continue;
    counts.set(candidate.sourceId, count + 1);
    output.push(candidate);
  }
  return Object.freeze(output);
}

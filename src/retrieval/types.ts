import type { DegradeReason, QueryPlan } from "../query/planner";
import type { ExactField, LexicalField } from "../storage/contracts";

/**
 * Retrieval result contracts (PRD 15.8, 15.9, FR-013).
 *
 * Scores keep their raw kind; different modes are never collapsed into a
 * fake "similarity percent". Every result carries at least one reason.
 */

export type SearchScore = Readonly<{
  rawValue: number;
  rawKind: "exact" | "cosine_distance" | "dot_similarity" | "l2_distance" | "bm25" | "rrf" | "rerank";
  rankScore: number;
  displayValue?: number;
}>;

export type MatchReason =
  | Readonly<{ kind: "exact_phrase"; phrase: string; field: ExactField; line?: number }>
  | Readonly<{ kind: "matched_title" }>
  | Readonly<{ kind: "matched_alias" }>
  | Readonly<{ kind: "matched_filename" }>
  | Readonly<{ kind: "matched_path" }>
  | Readonly<{ kind: "matched_tag"; tag: string }>
  | Readonly<{ kind: "lexical"; rank: number; fields: readonly LexicalField[]; terms: readonly string[] }>
  | Readonly<{ kind: "semantic"; rank: number }>
  | Readonly<{ kind: "hybrid"; exactRank?: number; lexicalRank?: number; semanticRank?: number }>
  | Readonly<{ kind: "metadata_filter" }>
  | Readonly<{ kind: "shared_wikilink"; target: string }>
  | Readonly<{ kind: "shared_tag"; tag: string }>;

export type SearchResultType = "block" | "source";

export type SearchResult = Readonly<{
  id: string;
  sourceId: string;
  artifactId: string;
  path: string;
  filename: string;
  title: string;
  folder: string;
  resultType: SearchResultType;
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
  snippet?: string;
  /** [start, end) highlight ranges within the snippet for verified exact matches. */
  snippetHighlights?: readonly (readonly [number, number])[];
  headingPath?: readonly string[];
  score: SearchScore;
  reasons: readonly MatchReason[];
  languages: readonly string[];
  metadata: Readonly<Record<string, unknown>>;
}>;

export type SearchTimings = Readonly<{
  queryParseMs: number;
  queryEmbedMs?: number;
  exactMs?: number;
  lexicalMs?: number;
  vectorMs?: number;
  fusionMs: number;
  hydrateMs: number;
  totalMs: number;
}>;

export type SearchResponse = Readonly<{
  results: readonly SearchResult[];
  plan: QueryPlan;
  timings: SearchTimings;
  degraded: readonly DegradeReason[];
  resultType: "blocks" | "sources";
}>;

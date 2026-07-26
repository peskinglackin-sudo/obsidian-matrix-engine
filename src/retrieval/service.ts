import { analyzeText, type AnalyzerOptions } from "../analysis/analyzer";
import { renderTemplate, queryTemplateVariables } from "../indexing/hashes";
import { hasContentQuery, type SearchQueryAst } from "../query/ast";
import { compileFilters } from "../query/filter-compiler";
import { parseQuery } from "../query/parser";
import { planQuery, type DegradeReason, type QueryPlan } from "../query/planner";
import type { RetrievalProfile, SearchMode } from "../settings/types";
import type {
  ArtifactStats,
  ChunkReader,
  ChunkRecord,
  LexicalField,
  LexicalHit,
  LexicalStore,
  RowFilter,
  SourceReader,
  VectorHit,
  VectorMetric,
  VectorStore
} from "../storage/contracts";
import { sourceMatchesFilter } from "../storage/filter";
import { collectNeedles, ExactRetriever } from "./exact";
import { aggregateBySource, diversifyBySource, fuseCandidates, type FusedCandidate } from "./fusion";
import { hydrateBlockResult, hydrateSourceResult, type HydrateDeps } from "./hydrate";
import type { SearchResponse, SearchResult, SearchTimings } from "./types";

/**
 * SearchService: the retrieval pipeline orchestrator (PRD 15.1).
 *
 *   parse -> plan -> prefilter -> exact/lexical/vector -> RRF fusion ->
 *   source aggregation/diversity -> hydrate
 *
 * Model latency (queryEmbedMs) is timed separately from database stages
 * (PRD 5.3/20.5). Degradation reasons stay visible on the response.
 */

export type QueryEmbedder = (renderedQuery: string, signal?: AbortSignal) => Promise<Float32Array | null>;

export type RetrievalStore = LexicalStore & VectorStore & ChunkReader & SourceReader & Readonly<{ stats(): ArtifactStats }>;

export type SearchServiceDeps = Readonly<{
  store: RetrievalStore;
  artifactId: string;
  analyzerOptions: () => AnalyzerOptions;
  fieldWeights?: () => Readonly<Record<LexicalField, number>>;
  embedQuery?: QueryEmbedder;
  queryTemplate: () => string;
  metric: () => VectorMetric;
  embeddingReady: () => boolean;
}>;

export type SearchOptions = Readonly<{
  mode: SearchMode;
  resultType: "blocks" | "sources";
  limit: number;
  profile: Pick<RetrievalProfile, "exactCandidateLimit" | "lexicalCandidateLimit" | "semanticCandidateLimit" | "fusion" | "sourceAggregation" | "maxResultsPerSource">;
  baseFilter?: RowFilter;
  caseSensitive?: boolean;
  signal?: AbortSignal;
}>;

export const DEFAULT_FIELD_WEIGHTS: Readonly<Record<LexicalField, number>> = Object.freeze({
  title: 6.0,
  aliases: 5.0,
  headings: 3.5,
  tags: 3.0,
  filename: 2.5,
  path: 1.5,
  body: 1.0,
  identifier: 4.0,
  ngram: 1.0
});

export class SearchService {
  readonly #deps: SearchServiceDeps;
  readonly #exact: ExactRetriever;

  constructor(deps: SearchServiceDeps) {
    this.#deps = deps;
    this.#exact = new ExactRetriever(deps.store, deps.store);
  }

  async search(rawQuery: string, options: SearchOptions): Promise<SearchResponse> {
    const startedAt = performance.now();
    const ast = parseQuery(rawQuery);
    const queryParseMs = performance.now() - startedAt;
    throwIfAborted(options.signal);

    const stats = this.#deps.store.stats();
    const embeddingReady = this.#deps.embeddingReady() && this.#deps.embedQuery !== undefined;
    const plan = planQuery(ast, options.mode, {
      embeddingReady,
      lexicalReady: stats.chunks > 0,
      storeReady: stats.chunks > 0 || stats.sources > 0
    });
    const degraded: DegradeReason[] = [...plan.degraded];
    const filter = compileFilters(ast, options.baseFilter);

    if (plan.metadataOnly) {
      return this.#metadataScan(ast, plan, filter, options, queryParseMs, startedAt);
    }
    if (!hasContentQuery(ast)) {
      return emptyResponse(plan, options.resultType, queryParseMs, startedAt);
    }

    const timings: Partial<Record<"queryEmbedMs" | "exactMs" | "lexicalMs" | "vectorMs", number>> = {};

    const exactHits = plan.runExact ? await this.#runExact(ast, plan, filter, options, timings) : undefined;
    throwIfAborted(options.signal);
    const lexicalHits = plan.runLexical ? await this.#runLexical(ast, filter, options, timings) : undefined;
    throwIfAborted(options.signal);
    const semanticHits = plan.runSemantic ? await this.#runSemantic(ast, filter, options, timings, degraded) : undefined;
    throwIfAborted(options.signal);

    const fusionStart = performance.now();
    const fused = fuseCandidates({
      ...(exactHits === undefined ? {} : { exact: exactHits }),
      ...(lexicalHits === undefined ? {} : { lexical: lexicalHits }),
      ...(semanticHits === undefined ? {} : { semantic: semanticHits }),
      weights: {
        rrfK: options.profile.fusion.rrfK,
        exactWeight: options.profile.fusion.exactWeight,
        lexicalWeight: options.profile.fusion.lexicalWeight,
        semanticWeight: options.profile.fusion.semanticWeight * plan.semanticWeightFactor
      }
    });
    const excluded = this.#exclusionPredicate(ast);
    const visible = fused.filter((candidate) => !excluded(candidate));
    const fusionMs = performance.now() - fusionStart;
    throwIfAborted(options.signal);

    const hydrateStart = performance.now();
    const hydrateDeps: HydrateDeps = { chunks: this.#deps.store, sources: this.#deps.store, artifactId: this.#deps.artifactId };
    let results: SearchResult[];
    if (options.resultType === "sources") {
      results = aggregateBySource(visible, options.profile.sourceAggregation)
        .slice(0, options.limit)
        .map((aggregate) => hydrateSourceResult(aggregate, hydrateDeps))
        .filter((result): result is SearchResult => result !== undefined);
    } else {
      results = diversifyBySource(visible, options.profile.maxResultsPerSource)
        .slice(0, options.limit)
        .map((candidate) => hydrateBlockResult(candidate, hydrateDeps))
        .filter((result): result is SearchResult => result !== undefined);
    }
    const hydrateMs = performance.now() - hydrateStart;

    return Object.freeze({
      results: Object.freeze(results),
      plan,
      timings: finalizeTimings(queryParseMs, timings, fusionMs, hydrateMs, startedAt),
      degraded: Object.freeze(dedupe(degraded)),
      resultType: options.resultType
    });
  }

  async #runExact(
    ast: SearchQueryAst,
    plan: QueryPlan,
    filter: RowFilter,
    options: SearchOptions,
    timings: Partial<Record<"exactMs", number>>
  ): Promise<ReturnType<ExactRetriever["retrieve"]>> {
    const start = performance.now();
    const needles = collectNeedles(ast, resolveExactMode(ast, plan) ? "explicit_exact" : "auto");
    const hits = await this.#exact.retrieve({
      needles,
      caseSensitive: options.caseSensitive ?? false,
      limit: options.profile.exactCandidateLimit,
      filter
    });
    timings.exactMs = performance.now() - start;
    return hits;
  }

  async #runLexical(
    ast: SearchQueryAst,
    filter: RowFilter,
    options: SearchOptions,
    timings: Partial<Record<"lexicalMs", number>>
  ): Promise<readonly LexicalHit[]> {
    const start = performance.now();
    const analyzerOptions = this.#deps.analyzerOptions();
    const contentText = queryContentText(ast);
    const analysis = analyzeText(contentText, analyzerOptions);
    const excludedTerms: string[] = [];
    for (const excluded of ast.excludedTerms) {
      const excludedAnalysis = analyzeText(excluded.text, analyzerOptions);
      excludedTerms.push(...excludedAnalysis.terms, ...excludedAnalysis.ngrams);
    }
    const hits = await this.#deps.store.lexicalSearch({
      terms: [...analysis.terms, ...analysis.secondaryTerms],
      ngrams: analysis.ngrams,
      identifierTerms: analysis.identifierTerms,
      excludedTerms,
      limit: options.profile.lexicalCandidateLimit,
      fieldWeights: this.#deps.fieldWeights?.() ?? DEFAULT_FIELD_WEIGHTS,
      filter
    });
    timings.lexicalMs = performance.now() - start;
    return hits;
  }

  async #runSemantic(
    ast: SearchQueryAst,
    filter: RowFilter,
    options: SearchOptions,
    timings: Partial<Record<"queryEmbedMs" | "vectorMs", number>>,
    degraded: DegradeReason[]
  ): Promise<readonly VectorHit[] | undefined> {
    const embed = this.#deps.embedQuery;
    if (embed === undefined) {
      degraded.push("semantic_unavailable");
      return undefined;
    }
    const rendered = renderTemplate(this.#deps.queryTemplate(), queryTemplateVariables(queryContentText(ast)));
    const embedStart = performance.now();
    const vector = await embed(rendered.text, options.signal);
    timings.queryEmbedMs = performance.now() - embedStart;
    if (vector === null) {
      degraded.push("semantic_unavailable");
      return undefined;
    }
    const searchStart = performance.now();
    const hits = await this.#deps.store.vectorSearch({
      vector,
      limit: options.profile.semanticCandidateLimit,
      metric: this.#deps.metric(),
      filter
    });
    timings.vectorMs = performance.now() - searchStart;
    return hits;
  }

  #metadataScan(
    ast: SearchQueryAst,
    plan: QueryPlan,
    filter: RowFilter,
    options: SearchOptions,
    queryParseMs: number,
    startedAt: number
  ): SearchResponse {
    const hydrateStart = performance.now();
    const results: SearchResult[] = [];
    for (const source of this.#deps.store.listSources()) {
      if (!sourceMatchesFilter(source, filter)) continue;
      results.push(Object.freeze({
        id: `source:${source.sourceId}`,
        sourceId: source.sourceId,
        artifactId: this.#deps.artifactId,
        path: source.pathRaw,
        filename: source.filenameRaw,
        title: source.titleRaw,
        folder: source.folderRaw,
        resultType: "source" as const,
        score: Object.freeze({ rawValue: 0, rawKind: "exact" as const, rankScore: 0 }),
        reasons: Object.freeze([Object.freeze({ kind: "metadata_filter" as const })]),
        languages: source.languages,
        metadata: Object.freeze({})
      }));
      if (results.length >= options.limit) break;
    }
    const hydrateMs = performance.now() - hydrateStart;
    return Object.freeze({
      results: Object.freeze(results),
      plan,
      timings: finalizeTimings(queryParseMs, {}, 0, hydrateMs, startedAt),
      degraded: plan.degraded,
      resultType: "sources"
    });
  }

  #exclusionPredicate(ast: SearchQueryAst): (candidate: FusedCandidate) => boolean {
    if (ast.excludedTerms.length === 0) return () => false;
    const needles = ast.excludedTerms.map(({ text }) => text.toLowerCase());
    return (candidate) => {
      if (candidate.rowId === undefined) return false;
      const chunk = this.#deps.store.getChunk(candidate.rowId);
      if (chunk === undefined) return false;
      return containsExcluded(chunk, needles);
    };
  }
}

function containsExcluded(chunk: ChunkRecord, needles: readonly string[]): boolean {
  const haystack = chunk.textRaw.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function resolveExactMode(ast: SearchQueryAst, plan: QueryPlan): boolean {
  return (ast.modeHint ?? plan.requestedMode) === "exact";
}

function queryContentText(ast: SearchQueryAst): string {
  const parts: string[] = [];
  for (const phrase of ast.exactPhrases) parts.push(phrase.text);
  for (const term of ast.positiveTerms) parts.push(term.text);
  for (const clause of ast.fieldClauses) parts.push(clause.value);
  return parts.join(" ");
}

function emptyResponse(plan: QueryPlan, resultType: "blocks" | "sources", queryParseMs: number, startedAt: number): SearchResponse {
  return Object.freeze({
    results: Object.freeze([]),
    plan,
    timings: finalizeTimings(queryParseMs, {}, 0, 0, startedAt),
    degraded: plan.degraded,
    resultType
  });
}

function finalizeTimings(
  queryParseMs: number,
  partial: Partial<Record<"queryEmbedMs" | "exactMs" | "lexicalMs" | "vectorMs", number>>,
  fusionMs: number,
  hydrateMs: number,
  startedAt: number
): SearchTimings {
  return Object.freeze({
    queryParseMs,
    ...(partial.queryEmbedMs === undefined ? {} : { queryEmbedMs: partial.queryEmbedMs }),
    ...(partial.exactMs === undefined ? {} : { exactMs: partial.exactMs }),
    ...(partial.lexicalMs === undefined ? {} : { lexicalMs: partial.lexicalMs }),
    ...(partial.vectorMs === undefined ? {} : { vectorMs: partial.vectorMs }),
    fusionMs,
    hydrateMs,
    totalMs: performance.now() - startedAt
  });
}

function dedupe(reasons: readonly DegradeReason[]): DegradeReason[] {
  return [...new Set(reasons)];
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException("Search aborted", "AbortError");
}

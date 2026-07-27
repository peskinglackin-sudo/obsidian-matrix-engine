import { analyzeText, type AnalyzerOptions } from "../analysis/analyzer";
import { estimateTokens } from "../indexing/chunker";
import { queryTemplateVariables, renderTemplate } from "../indexing/hashes";
import type { QueryEmbedder, RetrievalStore } from "../retrieval/service";
import { DEFAULT_FIELD_WEIGHTS } from "../retrieval/service";
import type { VectorMetric } from "../storage/contracts";
import type { ConnectionFeedbackStore } from "./feedback";

/**
 * ConnectionsService (PRD 16, FR-020/021).
 *
 * Current-note connections search neighbors of the note's representative
 * block vectors, aggregate by source, exclude the note itself, and fuse
 * wikilink/backlink/shared-tag signals with explainable edges. Selection
 * connections embed the selection transiently - nothing is written to the
 * index. Without embeddings the service falls back to lexical similarity
 * and says so.
 */

export type ConnectionEdge =
  | Readonly<{ kind: "semantic"; score: number }>
  | Readonly<{ kind: "wikilink"; target: string }>
  | Readonly<{ kind: "backlink"; from: string }>
  | Readonly<{ kind: "shared_tag"; tag: string }>
  | Readonly<{ kind: "lexical"; score: number }>;

export type ConnectionItem = Readonly<{
  sourceId: string;
  path: string;
  filename: string;
  title: string;
  folder: string;
  score: number;
  pinned: boolean;
  edges: readonly ConnectionEdge[];
  evidenceRowId?: string;
  evidenceSnippet?: string;
  evidenceLineStart?: number;
  evidenceLineEnd?: number;
}>;

export type ConnectionsResult = Readonly<{
  items: readonly ConnectionItem[];
  mode: "semantic" | "lexical_fallback" | "links_only";
  truncatedSelection: boolean;
}>;

const REPRESENTATIVE_BLOCKS = 4;
const NEIGHBORS_PER_BLOCK = 24;
const WIKILINK_BONUS = 0.2;
const BACKLINK_BONUS = 0.15;
const SHARED_TAG_BONUS = 0.05;
const SHARED_TAG_CAP = 2;
const SELECTION_TOKEN_BUDGET = 512;

export type ConnectionsDeps = Readonly<{
  store: RetrievalStore;
  analyzerOptions: () => AnalyzerOptions;
  metric: () => VectorMetric;
  queryTemplate: () => string;
  embedQuery?: QueryEmbedder;
  feedback: ConnectionFeedbackStore;
}>;

export class ConnectionsService {
  readonly #deps: ConnectionsDeps;

  constructor(deps: ConnectionsDeps) {
    this.#deps = deps;
  }

  /** FR-020: connections for the active note. */
  async forSource(sourceId: string, limit: number, signal?: AbortSignal): Promise<ConnectionsResult> {
    const store = this.#deps.store;
    const source = store.getSource(sourceId);
    if (source === undefined) return Object.freeze({ items: Object.freeze([]), mode: "links_only", truncatedSelection: false });

    const scores = new Map<string, number>();
    const edges = new Map<string, ConnectionEdge[]>();
    const evidence = new Map<string, string>();

    const chunks = store.chunksForSource(sourceId);
    const withVectors = chunks
      .filter((chunk) => chunk.embedding !== undefined)
      .sort((left, right) => right.textRaw.length - left.textRaw.length)
      .slice(0, REPRESENTATIVE_BLOCKS);

    let mode: ConnectionsResult["mode"] = "links_only";
    if (withVectors.length > 0) {
      mode = "semantic";
      for (const chunk of withVectors) {
        const embedding = chunk.embedding;
        if (embedding === undefined) continue;
        throwIfAborted(signal);
        const hits = await store.vectorSearch({
          vector: embedding,
          limit: NEIGHBORS_PER_BLOCK,
          metric: this.#deps.metric(),
          filter: { excludeSourceIds: [sourceId] }
        });
        for (const hit of hits) {
          const semantic = clamp01(hit.rankScore);
          if (semantic > (scores.get(hit.sourceId) ?? 0)) {
            scores.set(hit.sourceId, semantic);
            addEdge(edges, hit.sourceId, { kind: "semantic", score: semantic }, "semantic");
            evidence.set(hit.sourceId, hit.rowId);
          }
        }
      }
    } else {
      // Lexical fallback (FR-011 spirit): title + headings as query terms.
      const analysis = analyzeText([source.titleRaw, ...source.headings].join(" "), this.#deps.analyzerOptions());
      if (analysis.terms.length > 0 || analysis.ngrams.length > 0) {
        mode = "lexical_fallback";
        const hits = await store.lexicalSearch({
          terms: [...analysis.terms, ...analysis.secondaryTerms],
          ngrams: analysis.ngrams,
          identifierTerms: analysis.identifierTerms,
          excludedTerms: [],
          limit: NEIGHBORS_PER_BLOCK * 2,
          fieldWeights: DEFAULT_FIELD_WEIGHTS,
          filter: { excludeSourceIds: [sourceId] }
        });
        const maxScore = hits[0]?.rankScore ?? 1;
        for (const hit of hits) {
          const normalized = maxScore === 0 ? 0 : clamp01(hit.rankScore / maxScore) * 0.6;
          if (normalized > (scores.get(hit.sourceId) ?? 0)) {
            scores.set(hit.sourceId, normalized);
            addEdge(edges, hit.sourceId, { kind: "lexical", score: normalized }, "lexical");
            evidence.set(hit.sourceId, hit.rowId);
          }
        }
      }
    }

    this.#applyLinkSignals(sourceId, scores, edges);
    return Object.freeze({
      items: this.#finalize(sourceId, scores, edges, evidence, limit),
      mode,
      truncatedSelection: false
    });
  }

  /** FR-021: connections for the current selection; never indexed. */
  async forSelection(selection: string, activeSourceId: string | undefined, limit: number, signal?: AbortSignal): Promise<ConnectionsResult> {
    const { text, truncated } = truncateToBudget(selection, SELECTION_TOKEN_BUDGET);
    const scores = new Map<string, number>();
    const edges = new Map<string, ConnectionEdge[]>();
    const evidence = new Map<string, string>();
    const filter = activeSourceId === undefined ? undefined : { excludeSourceIds: [activeSourceId] };

    let mode: ConnectionsResult["mode"] = "lexical_fallback";
    const embed = this.#deps.embedQuery;
    if (embed !== undefined) {
      const rendered = renderTemplate(this.#deps.queryTemplate(), queryTemplateVariables(text));
      const vector = await embed(rendered.text, signal);
      if (vector !== null) {
        mode = "semantic";
        const hits = await this.#deps.store.vectorSearch({
          vector,
          limit: NEIGHBORS_PER_BLOCK * 2,
          metric: this.#deps.metric(),
          ...(filter === undefined ? {} : { filter })
        });
        for (const hit of hits) {
          const semantic = clamp01(hit.rankScore);
          if (semantic > (scores.get(hit.sourceId) ?? 0)) {
            scores.set(hit.sourceId, semantic);
            addEdge(edges, hit.sourceId, { kind: "semantic", score: semantic }, "semantic");
            evidence.set(hit.sourceId, hit.rowId);
          }
        }
      }
    }
    if (mode === "lexical_fallback") {
      const analysis = analyzeText(text, this.#deps.analyzerOptions());
      throwIfAborted(signal);
      const hits = await this.#deps.store.lexicalSearch({
        terms: [...analysis.terms, ...analysis.secondaryTerms],
        ngrams: analysis.ngrams,
        identifierTerms: analysis.identifierTerms,
        excludedTerms: [],
        limit: NEIGHBORS_PER_BLOCK * 2,
        fieldWeights: DEFAULT_FIELD_WEIGHTS,
        ...(filter === undefined ? {} : { filter })
      });
      const maxScore = hits[0]?.rankScore ?? 1;
      for (const hit of hits) {
        const normalized = maxScore === 0 ? 0 : clamp01(hit.rankScore / maxScore) * 0.6;
        if (normalized > (scores.get(hit.sourceId) ?? 0)) {
          scores.set(hit.sourceId, normalized);
          addEdge(edges, hit.sourceId, { kind: "lexical", score: normalized }, "lexical");
          evidence.set(hit.sourceId, hit.rowId);
        }
      }
    }

    return Object.freeze({
      items: this.#finalize(activeSourceId, scores, edges, evidence, limit),
      mode,
      truncatedSelection: truncated
    });
  }

  #applyLinkSignals(sourceId: string, scores: Map<string, number>, edges: Map<string, ConnectionEdge[]>): void {
    const store = this.#deps.store;
    const source = store.getSource(sourceId);
    if (source === undefined) return;
    const ownTargets = new Set(source.links.map(normalizeLinkTarget));
    const ownNames = linkNamesFor(source.pathRaw, source.titleRaw);
    const ownTags = new Set(source.tags.map((tag) => tag.toLowerCase()));

    for (const candidate of store.listSources()) {
      if (candidate.sourceId === sourceId) continue;
      const candidateNames = linkNamesFor(candidate.pathRaw, candidate.titleRaw);
      if ([...candidateNames].some((name) => ownTargets.has(name))) {
        bump(scores, candidate.sourceId, WIKILINK_BONUS);
        addEdge(edges, candidate.sourceId, { kind: "wikilink", target: candidate.titleRaw }, "wikilink");
      }
      const candidateTargets = new Set(candidate.links.map(normalizeLinkTarget));
      if ([...ownNames].some((name) => candidateTargets.has(name))) {
        bump(scores, candidate.sourceId, BACKLINK_BONUS);
        addEdge(edges, candidate.sourceId, { kind: "backlink", from: candidate.titleRaw }, "backlink");
      }
      if (ownTags.size > 0) {
        let shared = 0;
        for (const tag of candidate.tags) {
          if (ownTags.has(tag.toLowerCase()) && shared < SHARED_TAG_CAP) {
            shared += 1;
            addEdge(edges, candidate.sourceId, { kind: "shared_tag", tag }, `tag:${tag.toLowerCase()}`);
          }
        }
        if (shared > 0) bump(scores, candidate.sourceId, SHARED_TAG_BONUS * shared);
      }
    }
  }

  #finalize(
    excludeSourceId: string | undefined,
    scores: Map<string, number>,
    edges: Map<string, ConnectionEdge[]>,
    evidence: Map<string, string>,
    limit: number
  ): readonly ConnectionItem[] {
    const store = this.#deps.store;
    const feedback = this.#deps.feedback;
    const items: ConnectionItem[] = [];
    for (const [sourceId, score] of scores) {
      if (sourceId === excludeSourceId) continue;
      if (feedback.isHidden(sourceId)) continue;
      const source = store.getSource(sourceId);
      if (source === undefined) continue;
      const evidenceRowId = evidence.get(sourceId);
      const chunk = evidenceRowId === undefined ? undefined : store.getChunk(evidenceRowId);
      items.push(Object.freeze({
        sourceId,
        path: source.pathRaw,
        filename: source.filenameRaw,
        title: source.titleRaw,
        folder: source.folderRaw,
        score,
        pinned: feedback.isPinned(sourceId),
        edges: Object.freeze([...(edges.get(sourceId) ?? [])]),
        ...(evidenceRowId === undefined ? {} : { evidenceRowId }),
        ...(chunk === undefined ? {} : {
          evidenceSnippet: chunk.textRaw.length > 200 ? `${chunk.textRaw.slice(0, 200)}…` : chunk.textRaw,
          evidenceLineStart: chunk.lineStart,
          evidenceLineEnd: chunk.lineEnd
        })
      }));
    }
    items.sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.score - left.score;
    });
    return Object.freeze(items.slice(0, limit));
  }
}

const edgeKeys = new WeakMap<ConnectionEdge[], Set<string>>();

function addEdge(edges: Map<string, ConnectionEdge[]>, sourceId: string, edge: ConnectionEdge, dedupeKey: string): void {
  let list = edges.get(sourceId);
  if (list === undefined) {
    list = [];
    edges.set(sourceId, list);
  }
  let keys = edgeKeys.get(list);
  if (keys === undefined) {
    keys = new Set<string>();
    edgeKeys.set(list, keys);
  }
  if (keys.has(dedupeKey)) {
    if (edge.kind === "semantic" || edge.kind === "lexical") {
      const index = list.findIndex((candidate) => candidate.kind === edge.kind);
      if (index >= 0) list[index] = edge;
    }
    return;
  }
  keys.add(dedupeKey);
  list.push(edge);
}

function bump(scores: Map<string, number>, sourceId: string, amount: number): void {
  scores.set(sourceId, (scores.get(sourceId) ?? 0) + amount);
}

function normalizeLinkTarget(target: string): string {
  const withoutAnchor = target.split("#")[0] ?? target;
  const name = withoutAnchor.split("/").at(-1) ?? withoutAnchor;
  return name.replace(/\.md$/iu, "").toLowerCase().trim();
}

function linkNamesFor(pathRaw: string, titleRaw: string): ReadonlySet<string> {
  const names = new Set<string>();
  const filename = pathRaw.split("/").at(-1) ?? pathRaw;
  names.add(filename.replace(/\.[^.]+$/u, "").toLowerCase());
  names.add(titleRaw.toLowerCase().trim());
  return names;
}

function truncateToBudget(text: string, budgetTokens: number): Readonly<{ text: string; truncated: boolean }> {
  if (estimateTokens(text) <= budgetTokens) return Object.freeze({ text, truncated: false });
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(chars.slice(0, middle).join("")) <= budgetTokens) low = middle;
    else high = middle - 1;
  }
  return Object.freeze({ text: chars.slice(0, low).join(""), truncated: true });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException("Connections aborted", "AbortError");
}

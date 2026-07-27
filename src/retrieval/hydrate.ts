import type { ChunkReader, SourceReader } from "../storage/contracts";
import type { ExactHit } from "./exact";
import type { FusedCandidate, SourceAggregate } from "./fusion";
import type { MatchReason, SearchResult, SearchScore } from "./types";

/**
 * ResultHydrator (PRD 15.1, FR-013).
 *
 * Builds display results from fused candidates: source metadata, snippet
 * windows around verified exact matches, and at least one match reason per
 * result. Snippets are raw text; escaping happens at render time.
 */

const SNIPPET_BEFORE = 60;
const SNIPPET_LENGTH = 240;

export type HydrateDeps = Readonly<{
  chunks: ChunkReader;
  sources: SourceReader;
  artifactId: string;
}>;

export function hydrateBlockResult(candidate: FusedCandidate, deps: HydrateDeps): SearchResult | undefined {
  const source = deps.sources.getSource(candidate.sourceId);
  if (source === undefined) return undefined;
  const chunk = candidate.rowId === undefined ? undefined : deps.chunks.getChunk(candidate.rowId);
  const { snippet, highlights } = buildSnippet(chunk?.textRaw, candidate.exactHit);
  const reasons = buildReasons(candidate);

  return Object.freeze({
    id: candidate.key,
    sourceId: source.sourceId,
    artifactId: deps.artifactId,
    path: source.pathRaw,
    filename: source.filenameRaw,
    title: source.titleRaw,
    folder: source.folderRaw,
    resultType: "block",
    ...(chunk === undefined ? {} : {
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      headingPath: chunk.headingPathRaw
    }),
    ...(snippet === undefined ? {} : { snippet }),
    ...(highlights === undefined ? {} : { snippetHighlights: highlights }),
    score: scoreFor(candidate),
    reasons,
    languages: chunk?.languageCodes ?? source.languages,
    metadata: Object.freeze({})
  });
}

export function hydrateSourceResult(aggregate: SourceAggregate, deps: HydrateDeps): SearchResult | undefined {
  const source = deps.sources.getSource(aggregate.sourceId);
  if (source === undefined) return undefined;
  const best = aggregate.bestCandidate;
  const chunk = best.rowId === undefined ? undefined : deps.chunks.getChunk(best.rowId);
  const { snippet, highlights } = buildSnippet(chunk?.textRaw, best.exactHit);

  return Object.freeze({
    id: `source:${source.sourceId}`,
    sourceId: source.sourceId,
    artifactId: deps.artifactId,
    path: source.pathRaw,
    filename: source.filenameRaw,
    title: source.titleRaw,
    folder: source.folderRaw,
    resultType: "source",
    ...(chunk === undefined ? {} : {
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      headingPath: chunk.headingPathRaw
    }),
    ...(snippet === undefined ? {} : { snippet }),
    ...(highlights === undefined ? {} : { snippetHighlights: highlights }),
    score: Object.freeze({ ...scoreFor(best), rankScore: aggregate.score, rawValue: aggregate.score }),
    reasons: buildReasons(best),
    languages: chunk?.languageCodes ?? source.languages,
    metadata: Object.freeze({ blockCount: aggregate.blockCount })
  });
}

function scoreFor(candidate: FusedCandidate): SearchScore {
  return Object.freeze({ rawValue: candidate.rrfScore, rawKind: "rrf", rankScore: candidate.rrfScore });
}

function buildReasons(candidate: FusedCandidate): readonly MatchReason[] {
  const reasons: MatchReason[] = [];
  if (candidate.exactHit !== undefined) reasons.push(exactReason(candidate.exactHit));
  if (candidate.lexicalHit !== undefined && candidate.lexicalRank !== undefined) {
    reasons.push(Object.freeze({
      kind: "lexical",
      rank: candidate.lexicalRank,
      fields: candidate.lexicalHit.matchedFields,
      terms: candidate.lexicalHit.matchedTerms
    }));
  }
  if (candidate.semanticRank !== undefined) {
    reasons.push(Object.freeze({ kind: "semantic", rank: candidate.semanticRank }));
  }
  const signalCount = [candidate.exactRank, candidate.lexicalRank, candidate.semanticRank].filter((rank) => rank !== undefined).length;
  if (signalCount >= 2) {
    reasons.push(Object.freeze({
      kind: "hybrid",
      ...(candidate.exactRank === undefined ? {} : { exactRank: candidate.exactRank }),
      ...(candidate.lexicalRank === undefined ? {} : { lexicalRank: candidate.lexicalRank }),
      ...(candidate.semanticRank === undefined ? {} : { semanticRank: candidate.semanticRank })
    }));
  }
  return Object.freeze(reasons);
}

function exactReason(hit: ExactHit): MatchReason {
  switch (hit.field) {
    case "title":
      return Object.freeze({ kind: "matched_title" });
    case "alias":
      return Object.freeze({ kind: "matched_alias" });
    case "filename":
      return Object.freeze({ kind: "matched_filename" });
    case "path":
      return Object.freeze({ kind: "matched_path" });
    case "tag":
      return Object.freeze({ kind: "matched_tag", tag: hit.phrase });
    case "text":
      return Object.freeze({ kind: "exact_phrase", phrase: hit.phrase, field: hit.field, ...(hit.line === undefined ? {} : { line: hit.line }) });
  }
}

function buildSnippet(textRaw: string | undefined, exactHit: ExactHit | undefined): Readonly<{ snippet?: string; highlights?: readonly (readonly [number, number])[] }> {
  if (textRaw === undefined) return Object.freeze({});
  if (exactHit?.field === "text") {
    const start = Math.max(0, exactHit.offset - SNIPPET_BEFORE);
    const end = Math.min(textRaw.length, start + SNIPPET_LENGTH);
    const snippet = `${start > 0 ? "…" : ""}${textRaw.slice(start, end)}${end < textRaw.length ? "…" : ""}`;
    const prefix = start > 0 ? 1 : 0;
    const highlightStart = exactHit.offset - start + prefix;
    const highlightEnd = Math.min(highlightStart + exactHit.matchLength, snippet.length);
    return Object.freeze({ snippet, highlights: Object.freeze([Object.freeze([highlightStart, highlightEnd] as const)]) });
  }
  const snippet = textRaw.length > SNIPPET_LENGTH ? `${textRaw.slice(0, SNIPPET_LENGTH)}…` : textRaw;
  return Object.freeze({ snippet });
}

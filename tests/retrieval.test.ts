import { describe, expect, it } from "vitest";

import { analyzeText, type AnalyzerOptions } from "../src/analysis/analyzer";
import { analyzePath } from "../src/analysis/identifier";
import { findVerified } from "../src/retrieval/exact";
import { aggregateBySource, diversifyBySource, fuseCandidates } from "../src/retrieval/fusion";
import { SearchService, DEFAULT_FIELD_WEIGHTS, type SearchOptions } from "../src/retrieval/service";
import { MemoryStorageAdapter } from "../src/storage/adapter";
import type { ChunkRecord, SourceRecord } from "../src/storage/contracts";
import { LocalArtifactStore } from "../src/storage/local-store";

const NOW = 1700000000000;

const ANALYZER: AnalyzerOptions = {
  useIntlSegmenter: true,
  cjkNgramMin: 2,
  cjkNgramMax: 3,
  normalizeNfkc: true,
  accentFoldSecondary: true,
  identifierSplitting: true
};

const PROFILE: SearchOptions["profile"] = {
  exactCandidateLimit: 50,
  lexicalCandidateLimit: 80,
  semanticCandidateLimit: 80,
  fusion: { method: "rrf", rrfK: 60, exactWeight: 1.4, lexicalWeight: 1.0, semanticWeight: 1.0 },
  sourceAggregation: "max",
  maxResultsPerSource: 2
};

function buildSource(sourceId: string, path: string, title: string, extra?: Partial<SourceRecord>): SourceRecord {
  const filename = path.split("/").at(-1) ?? path;
  const folder = path.split("/").slice(0, -1).join("/");
  return {
    sourceId,
    pathRaw: path,
    pathNorm: path.toLowerCase(),
    filenameRaw: filename,
    filenameNorm: filename.toLowerCase(),
    folderRaw: folder,
    folderNorm: folder.toLowerCase(),
    extension: filename.split(".").at(-1) ?? "md",
    titleRaw: title,
    titleNorm: title.toLowerCase(),
    aliases: [],
    tags: [],
    headings: [],
    links: [],
    frontmatterJson: "{}",
    ctime: NOW,
    mtime: NOW,
    size: 100,
    rawContentHash: `raw-${sourceId}`,
    metadataProjectionHash: `meta-${sourceId}`,
    sourceRevision: 1,
    primaryLanguage: "und",
    languages: [],
    scripts: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...extra
  };
}

function buildChunk(rowId: string, source: SourceRecord, text: string, options?: Partial<ChunkRecord>): ChunkRecord {
  const analysis = analyzeText(text, ANALYZER);
  const titleAnalysis = analyzeText(source.titleRaw, ANALYZER);
  return {
    rowId,
    artifactId: "artifact-a",
    sourceId: source.sourceId,
    sourceRevision: source.sourceRevision,
    structuralAnchor: `h:${rowId}`,
    chunkOrdinal: 0,
    headingPathRaw: [],
    blockType: "heading_block",
    textRaw: text,
    lexicalTerms: [...analysis.terms, ...analysis.secondaryTerms],
    lexicalNgrams: [...analysis.ngrams],
    identifierTerms: [...analysis.identifierTerms],
    titleTerms: [...titleAnalysis.terms],
    aliasTerms: [],
    headingTerms: [],
    tagTerms: source.tags.map((tag) => tag.toLowerCase()),
    pathTerms: [...analyzePath(source.pathRaw)],
    languageCodes: [],
    scriptCodes: [],
    lineStart: 0,
    lineEnd: text.split("\n").length - 1,
    charStart: 0,
    charEnd: text.length,
    rawChunkHash: `chunk-${rowId}`,
    extractionHash: "extract",
    lexicalInputHash: `lex-${rowId}`,
    embeddingInputHash: `embed-${rowId}`,
    embedding: undefined,
    mtime: source.mtime,
    folderNorm: source.folderNorm,
    pathNorm: source.pathNorm,
    extension: source.extension,
    tags: source.tags,
    createdAt: NOW,
    updatedAt: NOW,
    ...options
  };
}

function seededStore(): LocalArtifactStore {
  const store = new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp", dimension: 3, adapter: new MemoryStorageAdapter(), now: () => NOW });
  const s1 = buildSource("s1", "notes/vector-database.md", "Vector Database Design", { tags: ["ai"] });
  const s2 = buildSource("s2", "notes/chinese-notes.md", "中文向量笔记");
  const s3 = buildSource("s3", "recipes/cooking.md", "Cooking Notes");
  store.commitSource({
    source: s1,
    chunks: [
      buildChunk("r1", s1, "The embedding dimension must match the vector database configuration.", { embedding: new Float32Array([1, 0, 0]) }),
      buildChunk("r2", s1, "Incremental vector indexing strategy avoids recomputing all vectors.", { embedding: new Float32Array([0.9, 0.2, 0]), chunkOrdinal: 1, structuralAnchor: "h:r2" })
    ]
  });
  store.commitSource({
    source: s2,
    chunks: [buildChunk("r3", s2, "向量数据库的增量索引设计说明。IndexProfileService 负责配置。", { embedding: new Float32Array([0.8, 0.3, 0]) })]
  });
  store.commitSource({
    source: s3,
    chunks: [buildChunk("r4", s3, "A recipe for tomato soup with fresh basil.", { embedding: new Float32Array([0, 1, 0]) })]
  });
  return store;
}

function makeService(store: LocalArtifactStore, embedVector: Float32Array | null | "unavailable" = new Float32Array([1, 0, 0])) {
  return new SearchService({
    store,
    artifactId: "artifact-a",
    analyzerOptions: () => ANALYZER,
    ...(embedVector === "unavailable" ? {} : { embedQuery: () => Promise.resolve(embedVector) }),
    queryTemplate: () => "{query}",
    metric: () => "cosine",
    embeddingReady: () => embedVector !== "unavailable"
  });
}

describe("findVerified", () => {
  it("verifies case-insensitive matches with stable offsets", () => {
    expect(findVerified("Hello Embedding Dimension", "embedding dimension", false)).toBe(6);
    expect(findVerified("Hello Embedding", "embedding", true)).toBeUndefined();
    expect(findVerified("向量数据库设计", "数据库", false)).toBe(2);
    expect(findVerified("abc", "missing", false)).toBeUndefined();
  });
});

describe("RRF fusion (PRD 15.5)", () => {
  const exactHit = { sourceId: "s1", rowId: "r1", field: "text" as const, phrase: "p", offset: 0, matchLength: 1 };
  const lexicalHit = (rowId: string, sourceId: string, score: number) => ({ rowId, sourceId, rawValue: score, rankScore: score, matchedFields: [], matchedTerms: [] });
  const vectorHit = (rowId: string, sourceId: string, score: number) => ({ rowId, sourceId, rawValue: 1 - score, rankScore: score });

  it("computes weighted reciprocal rank scores", () => {
    const fused = fuseCandidates({
      exact: [exactHit],
      lexical: [lexicalHit("r1", "s1", 5), lexicalHit("r2", "s1", 3)],
      semantic: [vectorHit("r2", "s1", 0.9), vectorHit("r1", "s1", 0.8)],
      weights: { rrfK: 60, exactWeight: 1.4, lexicalWeight: 1.0, semanticWeight: 1.0 }
    });
    const r1 = fused.find(({ key }) => key === "r1");
    const r2 = fused.find(({ key }) => key === "r2");
    expect(r1?.rrfScore).toBeCloseTo(1.4 / 61 + 1 / 61 + 1 / 62, 10);
    expect(r2?.rrfScore).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(fused[0]?.key).toBe("r1");
    expect(r1?.exactRank).toBe(1);
    expect(r1?.semanticRank).toBe(2);
  });

  it("keeps source-only exact hits as source candidates", () => {
    const fused = fuseCandidates({
      exact: [{ sourceId: "s9", field: "title", phrase: "t", offset: 0, matchLength: 1 }],
      weights: { rrfK: 60, exactWeight: 1.4, lexicalWeight: 1, semanticWeight: 1 }
    });
    expect(fused[0]?.key).toBe("source:s9");
    expect(fused[0]?.rowId).toBeUndefined();
  });

  it("aggregates by source with max and top_mean", () => {
    const fused = fuseCandidates({
      lexical: [lexicalHit("r1", "s1", 5), lexicalHit("r2", "s1", 4), lexicalHit("r3", "s2", 3)],
      weights: { rrfK: 60, exactWeight: 1.4, lexicalWeight: 1, semanticWeight: 1 }
    });
    const max = aggregateBySource(fused, "max");
    expect(max[0]?.sourceId).toBe("s1");
    expect(max[0]?.score).toBeCloseTo(1 / 61, 10);
    expect(max[0]?.blockCount).toBe(2);
    const mean = aggregateBySource(fused, "top_mean");
    expect(mean[0]?.score).toBeCloseTo((1 / 61 + 1 / 62) / 2, 10);
  });

  it("caps results per source (PRD 15.7)", () => {
    const fused = fuseCandidates({
      lexical: [lexicalHit("r1", "s1", 5), lexicalHit("r2", "s1", 4), lexicalHit("r5", "s1", 3.5), lexicalHit("r3", "s2", 3)],
      weights: { rrfK: 60, exactWeight: 1.4, lexicalWeight: 1, semanticWeight: 1 }
    });
    const diversified = diversifyBySource(fused, 2);
    expect(diversified.filter(({ sourceId }) => sourceId === "s1")).toHaveLength(2);
    expect(diversified.some(({ sourceId }) => sourceId === "s2")).toBe(true);
  });
});

describe("SearchService end to end (PRD 15.1)", () => {
  it("finds exact phrases with verified offsets and reasons", async () => {
    const service = makeService(seededStore());
    const response = await service.search('"embedding dimension"', { mode: "auto", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(response.results.length).toBeGreaterThan(0);
    const top = response.results[0];
    expect(top?.sourceId).toBe("s1");
    expect(top?.reasons.some((reason) => reason.kind === "exact_phrase")).toBe(true);
    expect(top?.snippet).toContain("embedding dimension");
    expect(top?.snippetHighlights?.[0]).toBeDefined();
    const highlight = top?.snippetHighlights?.[0];
    if (highlight !== undefined && top?.snippet !== undefined) {
      expect(top.snippet.slice(highlight[0], highlight[1]).toLowerCase()).toBe("embedding dimension");
    }
    expect(response.plan.executedLabel).toBe("exact+lexical");
  });

  it("does not return false positives for phrases that only match case-insensitively in exact case mode", async () => {
    const service = makeService(seededStore());
    const response = await service.search('"EMBEDDING DIMENSION"', { mode: "auto", resultType: "blocks", limit: 10, profile: PROFILE, caseSensitive: true });
    expect(response.results.some((result) => result.reasons.some((reason) => reason.kind === "exact_phrase"))).toBe(false);
  });

  it("runs hybrid search with semantic ranks for question queries", async () => {
    const service = makeService(seededStore());
    const response = await service.search("how to avoid recomputing all vectors after a rename", { mode: "auto", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(response.plan.executedLabel).toBe("hybrid");
    expect(response.timings.queryEmbedMs).toBeDefined();
    expect(response.timings.vectorMs).toBeDefined();
    expect(response.results.some((result) => result.reasons.some((reason) => reason.kind === "semantic"))).toBe(true);
  });

  it("finds CJK content lexically via ngrams", async () => {
    const service = makeService(seededStore(), "unavailable");
    const response = await service.search("增量索引", { mode: "lexical", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(response.results[0]?.sourceId).toBe("s2");
  });

  it("matches identifiers through expansion", async () => {
    const service = makeService(seededStore(), "unavailable");
    const response = await service.search("index_profile_service", { mode: "lexical", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(response.results[0]?.sourceId).toBe("s2");
  });

  it("degrades to exact+lexical when the embedder is unavailable (FR-011)", async () => {
    const service = makeService(seededStore(), "unavailable");
    const response = await service.search("natural language question about vector indexing", { mode: "auto", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(response.degraded).toContain("semantic_unavailable");
    expect(response.plan.executedLabel).toBe("exact+lexical");
    expect(response.results.length).toBeGreaterThan(0);
  });

  it("degrades visibly when the embedder fails at query time", async () => {
    const service = makeService(seededStore(), null);
    const response = await service.search("how to design incremental vector indexing strategies", { mode: "auto", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(response.degraded).toContain("semantic_unavailable");
    expect(response.results.length).toBeGreaterThan(0);
  });

  it("aggregates into source results with block counts", async () => {
    const service = makeService(seededStore(), "unavailable");
    const response = await service.search("vector", { mode: "lexical", resultType: "sources", limit: 10, profile: PROFILE });
    const s1 = response.results.find((result) => result.sourceId === "s1");
    expect(s1?.resultType).toBe("source");
    expect(s1?.metadata.blockCount).toBe(2);
  });

  it("performs metadata-only scans (PRD 7.5)", async () => {
    const service = makeService(seededStore(), "unavailable");
    const response = await service.search("folder:recipes", { mode: "auto", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(response.plan.metadataOnly).toBe(true);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.sourceId).toBe("s3");
    expect(response.results[0]?.reasons[0]?.kind).toBe("metadata_filter");
  });

  it("applies filters from the query", async () => {
    const service = makeService(seededStore(), "unavailable");
    const response = await service.search("vector folder:notes", { mode: "lexical", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(response.results.every((result) => result.folder === "notes")).toBe(true);
  });

  it("excludes results containing excluded terms", async () => {
    const service = makeService(seededStore(), "unavailable");
    const withCooking = await service.search("notes", { mode: "lexical", resultType: "blocks", limit: 10, profile: PROFILE });
    const withoutCooking = await service.search("notes -tomato", { mode: "lexical", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(withCooking.results.some((result) => result.sourceId === "s3")).toBe(true);
    expect(withoutCooking.results.some((result) => result.sourceId === "s3")).toBe(false);
  });

  it("honors abort signals", async () => {
    const service = makeService(seededStore());
    const controller = new AbortController();
    controller.abort();
    await expect(service.search("anything", { mode: "auto", resultType: "blocks", limit: 10, profile: PROFILE, signal: controller.signal })).rejects.toThrow(/aborted/iu);
  });

  it("reports stage timings separately from model latency (PRD 5.3)", async () => {
    const service = makeService(seededStore());
    const response = await service.search("how do incremental updates interact with embedding recompute", { mode: "hybrid", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(response.timings.queryParseMs).toBeGreaterThanOrEqual(0);
    expect(response.timings.fusionMs).toBeGreaterThanOrEqual(0);
    expect(response.timings.hydrateMs).toBeGreaterThanOrEqual(0);
    expect(response.timings.totalMs).toBeGreaterThanOrEqual(response.timings.fusionMs);
  });

  it("returns empty results for empty queries without running retrievers", async () => {
    const service = makeService(seededStore());
    const response = await service.search("   ", { mode: "auto", resultType: "blocks", limit: 10, profile: PROFILE });
    expect(response.results).toHaveLength(0);
    expect(response.timings.exactMs).toBeUndefined();
  });
});

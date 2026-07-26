import { describe, expect, it } from "vitest";

import { MemoryStorageAdapter } from "../src/storage/adapter";
import { FieldIndex } from "../src/storage/bm25";
import type { ChunkRecord, SourceRecord } from "../src/storage/contracts";
import { rowMatchesFilter, sourceMatchesFilter } from "../src/storage/filter";
import { LocalArtifactStore } from "../src/storage/local-store";

const NOW = 1700000000000;

const DEFAULT_WEIGHTS = {
  title: 6.0,
  aliases: 5.0,
  headings: 3.5,
  tags: 3.0,
  filename: 2.5,
  path: 1.5,
  body: 1.0,
  identifier: 4.0,
  ngram: 1.0
} as const;

function makeSource(overrides: Partial<SourceRecord> & Pick<SourceRecord, "sourceId" | "pathRaw">): SourceRecord {
  const filename = overrides.pathRaw.split("/").at(-1) ?? overrides.pathRaw;
  return {
    pathNorm: overrides.pathRaw.toLowerCase(),
    filenameRaw: filename,
    filenameNorm: filename.toLowerCase(),
    folderRaw: overrides.pathRaw.split("/").slice(0, -1).join("/"),
    folderNorm: overrides.pathRaw.split("/").slice(0, -1).join("/").toLowerCase(),
    extension: "md",
    titleRaw: "Untitled",
    titleNorm: "untitled",
    aliases: [],
    tags: [],
    headings: [],
    links: [],
    frontmatterJson: "{}",
    ctime: NOW,
    mtime: NOW,
    size: 100,
    rawContentHash: "raw",
    metadataProjectionHash: "meta",
    sourceRevision: 1,
    primaryLanguage: "und",
    languages: [],
    scripts: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function makeChunk(overrides: Partial<ChunkRecord> & Pick<ChunkRecord, "rowId" | "sourceId">): ChunkRecord {
  return {
    artifactId: "artifact-a",
    sourceRevision: 1,
    structuralAnchor: `h:${overrides.rowId}`,
    chunkOrdinal: 0,
    headingPathRaw: [],
    blockType: "heading_block",
    textRaw: "",
    lexicalTerms: [],
    lexicalNgrams: [],
    identifierTerms: [],
    titleTerms: [],
    aliasTerms: [],
    headingTerms: [],
    tagTerms: [],
    pathTerms: [],
    languageCodes: [],
    scriptCodes: [],
    lineStart: 0,
    lineEnd: 0,
    charStart: 0,
    charEnd: 0,
    rawChunkHash: "chunk",
    extractionHash: "extract",
    lexicalInputHash: "lex",
    embeddingInputHash: "embed",
    embedding: undefined,
    mtime: NOW,
    folderNorm: "",
    pathNorm: "",
    extension: "md",
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function newStore(): LocalArtifactStore {
  return new LocalArtifactStore({
    artifactId: "artifact-a",
    artifactFingerprint: "fp-1",
    dimension: 4,
    adapter: new MemoryStorageAdapter(),
    now: () => NOW
  });
}

describe("FieldIndex BM25", () => {
  it("ranks rarer terms higher and respects term frequency", () => {
    const index = new FieldIndex();
    index.addDocument("d1", ["vector", "database", "vector"]);
    index.addDocument("d2", ["vector", "notes"]);
    index.addDocument("d3", ["unrelated", "content"]);
    const scores = new Map<string, number>();
    index.score(["vector"], 1, scores);
    expect(scores.get("d1") ?? 0).toBeGreaterThan(scores.get("d2") ?? 0);
    expect(scores.has("d3")).toBe(false);

    const rare = new Map<string, number>();
    index.score(["notes"], 1, rare);
    const common = new Map<string, number>();
    index.score(["vector"], 1, common);
    expect(rare.get("d2") ?? 0).toBeGreaterThan(common.get("d2") ?? 0);
  });

  it("removes documents cleanly", () => {
    const index = new FieldIndex();
    index.addDocument("d1", ["term"]);
    index.removeDocument("d1");
    const scores = new Map<string, number>();
    index.score(["term"], 1, scores);
    expect(scores.size).toBe(0);
    expect(index.documentCount).toBe(0);
  });
});

describe("row filters (PRD 21.4)", () => {
  const chunk = makeChunk({ rowId: "r1", sourceId: "s1", folderNorm: "projects/ai", pathNorm: "projects/ai/note.md", tags: ["AI/ML"], extension: "md", mtime: 500 });

  it("matches folder prefixes on normalized form", () => {
    expect(rowMatchesFilter(chunk, { folders: ["Projects"] })).toBe(true);
    expect(rowMatchesFilter(chunk, { folders: ["projects/ai"] })).toBe(true);
    expect(rowMatchesFilter(chunk, { folders: ["other"] })).toBe(false);
  });

  it("matches nested tags case-insensitively", () => {
    expect(rowMatchesFilter(chunk, { tags: ["ai"] })).toBe(true);
    expect(rowMatchesFilter(chunk, { tags: ["#ai/ml"] })).toBe(true);
    expect(rowMatchesFilter(chunk, { tags: ["ml"] })).toBe(false);
  });

  it("applies path, extension, mtime, and source exclusions", () => {
    expect(rowMatchesFilter(chunk, { pathContains: ["ai/note"] })).toBe(true);
    expect(rowMatchesFilter(chunk, { extensions: ["txt"] })).toBe(false);
    expect(rowMatchesFilter(chunk, { mtimeBefore: 400 })).toBe(false);
    expect(rowMatchesFilter(chunk, { mtimeAfter: 400 })).toBe(true);
    expect(rowMatchesFilter(chunk, { excludeSourceIds: ["s1"] })).toBe(false);
  });

  it("filters sources with the same semantics", () => {
    const source = makeSource({ sourceId: "s1", pathRaw: "Projects/AI/Note.md", tags: ["ai"], mtime: 500 });
    expect(sourceMatchesFilter(source, { folders: ["projects"] })).toBe(true);
    expect(sourceMatchesFilter(source, { tags: ["ai"] })).toBe(true);
    expect(sourceMatchesFilter(source, { excludeSourceIds: ["s1"] })).toBe(false);
  });
});

describe("LocalArtifactStore commits and revision guards (PRD 14.3/14.5)", () => {
  it("commits rows and rejects stale generations", () => {
    const store = newStore();
    const source = makeSource({ sourceId: "s1", pathRaw: "a.md", sourceRevision: 2 });
    const result = store.commitSource({
      source,
      chunks: [makeChunk({ rowId: "r1", sourceId: "s1", sourceRevision: 2, lexicalTerms: ["hello"] })]
    });
    expect(result.status).toBe("committed");

    const stale = store.commitSource({
      source: makeSource({ sourceId: "s1", pathRaw: "a.md", sourceRevision: 1 }),
      chunks: [makeChunk({ rowId: "r1", sourceId: "s1", sourceRevision: 1, lexicalTerms: ["old"] })]
    });
    expect(stale.status).toBe("stale_rejected");
    expect(store.getChunk("r1")?.lexicalTerms).toEqual(["hello"]);
  });

  it("replaces rows of older revisions and deletes vanished anchors", () => {
    const store = newStore();
    store.commitSource({
      source: makeSource({ sourceId: "s1", pathRaw: "a.md", sourceRevision: 1 }),
      chunks: [
        makeChunk({ rowId: "r1", sourceId: "s1", sourceRevision: 1 }),
        makeChunk({ rowId: "r2", sourceId: "s1", sourceRevision: 1 })
      ]
    });
    const result = store.commitSource({
      source: makeSource({ sourceId: "s1", pathRaw: "a.md", sourceRevision: 2 }),
      chunks: [makeChunk({ rowId: "r1", sourceId: "s1", sourceRevision: 2 })]
    });
    expect(result.deleted).toBe(1);
    expect(store.getChunk("r2")).toBeUndefined();
    expect(store.chunksForSource("s1")).toHaveLength(1);
  });

  it("deletes sources completely", () => {
    const store = newStore();
    store.commitSource({
      source: makeSource({ sourceId: "s1", pathRaw: "a.md" }),
      chunks: [makeChunk({ rowId: "r1", sourceId: "s1", lexicalTerms: ["term"] })]
    });
    store.deleteSource("s1");
    expect(store.getSourceByPath("a.md")).toBeUndefined();
    expect(store.getChunk("r1")).toBeUndefined();
    expect(store.stats().chunks).toBe(0);
  });

  it("renames sources keeping the source ID and rows (PRD 13.4)", () => {
    const store = newStore();
    store.commitSource({
      source: makeSource({ sourceId: "s1", pathRaw: "old/a.md" }),
      chunks: [makeChunk({ rowId: "r1", sourceId: "s1", pathNorm: "old/a.md", folderNorm: "old" })]
    });
    const renamed = store.renameSource("s1", {
      pathRaw: "new/b.md",
      pathNorm: "new/b.md",
      filenameRaw: "b.md",
      filenameNorm: "b.md",
      folderRaw: "new",
      folderNorm: "new",
      pathTerms: ["new", "b.md", "b", "md", "new/b.md"]
    }, 2);
    expect(renamed).toBe(true);
    expect(store.getSourceByPath("new/b.md")?.sourceId).toBe("s1");
    expect(store.getSourceByPath("old/a.md")).toBeUndefined();
    expect(store.getChunk("r1")?.pathNorm).toBe("new/b.md");
    expect(store.getChunk("r1")?.sourceRevision).toBe(2);
  });

  it("guards embedding attachment with the input hash", () => {
    const store = newStore();
    store.commitSource({
      source: makeSource({ sourceId: "s1", pathRaw: "a.md" }),
      chunks: [makeChunk({ rowId: "r1", sourceId: "s1", embeddingInputHash: "hash-a" })]
    });
    expect(store.attachEmbedding("r1", "hash-old", new Float32Array([1, 0, 0, 0]))).toBe(false);
    expect(store.attachEmbedding("r1", "hash-a", new Float32Array([1, 0, 0, 0]))).toBe(true);
    expect(store.getChunk("r1")?.embedding).toHaveLength(4);
  });
});

describe("LocalArtifactStore search", () => {
  function seedStore(): LocalArtifactStore {
    const store = newStore();
    store.commitSource({
      source: makeSource({ sourceId: "s1", pathRaw: "notes/vector.md", titleRaw: "Vector Database" }),
      chunks: [makeChunk({
        rowId: "r1",
        sourceId: "s1",
        textRaw: "Vector database design with embeddings.",
        lexicalTerms: ["vector", "database", "design", "with", "embeddings"],
        titleTerms: ["vector", "database"],
        pathTerms: ["notes", "vector.md", "vector", "md", "notes/vector.md"],
        pathNorm: "notes/vector.md",
        folderNorm: "notes",
        embedding: new Float32Array([1, 0, 0, 0])
      })]
    });
    store.commitSource({
      source: makeSource({ sourceId: "s2", pathRaw: "notes/chinese.md", titleRaw: "中文笔记" }),
      chunks: [makeChunk({
        rowId: "r2",
        sourceId: "s2",
        textRaw: "向量数据库设计说明。",
        lexicalTerms: ["向量", "数据库", "设计", "说明"],
        lexicalNgrams: ["向量", "量数", "数据", "据库", "设计", "说明"],
        pathNorm: "notes/chinese.md",
        folderNorm: "notes",
        embedding: new Float32Array([0.9, 0.1, 0, 0])
      })]
    });
    store.commitSource({
      source: makeSource({ sourceId: "s3", pathRaw: "other/misc.md", titleRaw: "Misc" }),
      chunks: [makeChunk({
        rowId: "r3",
        sourceId: "s3",
        textRaw: "Unrelated content about cooking.",
        lexicalTerms: ["unrelated", "content", "about", "cooking"],
        pathNorm: "other/misc.md",
        folderNorm: "other",
        embedding: new Float32Array([0, 1, 0, 0])
      })]
    });
    return store;
  }

  it("performs flat cosine vector search with ranking", async () => {
    const store = seedStore();
    const hits = await store.vectorSearch({ vector: new Float32Array([1, 0, 0, 0]), limit: 2, metric: "cosine" });
    expect(hits.map(({ rowId }) => rowId)).toEqual(["r1", "r2"]);
    expect(hits[0]?.rawValue).toBeCloseTo(0, 5);
    expect(hits[0]?.rankScore).toBeCloseTo(1, 5);
  });

  it("applies filters to vector search", async () => {
    const store = seedStore();
    const hits = await store.vectorSearch({ vector: new Float32Array([1, 0, 0, 0]), limit: 10, metric: "cosine", filter: { folders: ["other"] } });
    expect(hits.map(({ rowId }) => rowId)).toEqual(["r3"]);
  });

  it("supports dot and l2 metrics with correct rank direction", async () => {
    const store = seedStore();
    const dot = await store.vectorSearch({ vector: new Float32Array([1, 0, 0, 0]), limit: 3, metric: "dot" });
    expect(dot[0]?.rowId).toBe("r1");
    const l2 = await store.vectorSearch({ vector: new Float32Array([0, 1, 0, 0]), limit: 3, metric: "l2" });
    expect(l2[0]?.rowId).toBe("r3");
    expect(l2[0]?.rawValue).toBeLessThan(l2[1]?.rawValue ?? Number.POSITIVE_INFINITY);
  });

  it("ranks title matches above body matches via field weights", async () => {
    const store = seedStore();
    const hits = await store.lexicalSearch({
      terms: ["vector"],
      ngrams: [],
      identifierTerms: [],
      excludedTerms: [],
      limit: 10,
      fieldWeights: DEFAULT_WEIGHTS
    });
    expect(hits[0]?.rowId).toBe("r1");
    expect(hits[0]?.matchedFields).toContain("title");
  });

  it("finds CJK content through ngrams", async () => {
    const store = seedStore();
    const hits = await store.lexicalSearch({
      terms: [],
      ngrams: ["数据", "据库"],
      identifierTerms: [],
      excludedTerms: [],
      limit: 10,
      fieldWeights: DEFAULT_WEIGHTS
    });
    expect(hits.map(({ rowId }) => rowId)).toEqual(["r2"]);
  });

  it("honors excluded terms", async () => {
    const store = seedStore();
    const hits = await store.lexicalSearch({
      terms: ["content", "vector"],
      ngrams: [],
      identifierTerms: [],
      excludedTerms: ["cooking"],
      limit: 10,
      fieldWeights: DEFAULT_WEIGHTS
    });
    expect(hits.some(({ rowId }) => rowId === "r3")).toBe(false);
  });

  it("returns exact candidates from raw text and source fields", async () => {
    const store = seedStore();
    const textHits = await store.exactCandidates({ phrase: "database design", caseSensitive: false, fields: ["text"], limit: 10 });
    expect(textHits[0]?.rowId).toBe("r1");
    const titleHits = await store.exactCandidates({ phrase: "Vector Database", caseSensitive: true, fields: ["title"], limit: 10 });
    expect(titleHits[0]?.sourceId).toBe("s1");
    const cjkHits = await store.exactCandidates({ phrase: "数据库设计", caseSensitive: false, fields: ["text"], limit: 10 });
    expect(cjkHits[0]?.rowId).toBe("r2");
  });

  it("respects case sensitivity in exact candidates", async () => {
    const store = seedStore();
    const miss = await store.exactCandidates({ phrase: "VECTOR DATABASE", caseSensitive: true, fields: ["text", "title"], limit: 10 });
    expect(miss).toHaveLength(0);
    const hit = await store.exactCandidates({ phrase: "VECTOR DATABASE", caseSensitive: false, fields: ["title"], limit: 10 });
    expect(hit.length).toBeGreaterThan(0);
  });
});

describe("LocalArtifactStore persistence", () => {
  it("round-trips sources, manifest, chunks, and embeddings", async () => {
    const adapter = new MemoryStorageAdapter();
    const store = new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp-1", dimension: 4, adapter, now: () => NOW });
    store.commitSource({
      source: makeSource({ sourceId: "s1", pathRaw: "a.md" }),
      chunks: [makeChunk({ rowId: "r1", sourceId: "s1", lexicalTerms: ["hello"], embedding: new Float32Array([0.25, -1, 0.5, 3]) })]
    });
    await store.persist();
    expect(store.dirty).toBe(false);

    const reloaded = new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp-1", dimension: 4, adapter, now: () => NOW });
    const result = await reloaded.load();
    expect(result.status).toBe("loaded");
    expect(reloaded.getChunk("r1")?.embedding?.[3]).toBe(3);
    expect(reloaded.manifestFor("s1")?.status).toBe("indexed");
    const hits = await reloaded.lexicalSearch({ terms: ["hello"], ngrams: [], identifierTerms: [], excludedTerms: [], limit: 5, fieldWeights: DEFAULT_WEIGHTS });
    expect(hits).toHaveLength(1);
  });

  it("reports empty when no file exists", async () => {
    const result = await newStore().load();
    expect(result.status).toBe("empty");
  });

  it("rebuilds on corrupt payloads instead of failing", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.write("artifact-artifact-a.json", "{not json");
    const store = new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp-1", dimension: 4, adapter, now: () => NOW });
    const result = await store.load();
    expect(result.status).toBe("rebuilt");
    expect(result.error).toBeDefined();
    expect(store.stats().chunks).toBe(0);
  });

  it("rebuilds on fingerprint mismatch (PRD 12.8)", async () => {
    const adapter = new MemoryStorageAdapter();
    const original = new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp-1", dimension: 4, adapter, now: () => NOW });
    original.commitSource({ source: makeSource({ sourceId: "s1", pathRaw: "a.md" }), chunks: [] });
    await original.persist();

    const changed = new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp-2", dimension: 4, adapter, now: () => NOW });
    const result = await changed.load();
    expect(result.status).toBe("rebuilt");
    expect(changed.listSources()).toHaveLength(0);
  });

  it("destroys the persisted artifact", async () => {
    const adapter = new MemoryStorageAdapter();
    const store = new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp-1", dimension: 4, adapter, now: () => NOW });
    store.commitSource({ source: makeSource({ sourceId: "s1", pathRaw: "a.md" }), chunks: [] });
    await store.persist();
    await store.destroy();
    expect(await adapter.read("artifact-artifact-a.json")).toBeNull();
    expect(store.listSources()).toHaveLength(0);
  });

  it("tracks stats for the status view (FR-060)", () => {
    const store = newStore();
    store.commitSource({
      source: makeSource({ sourceId: "s1", pathRaw: "a.md" }),
      chunks: [
        makeChunk({ rowId: "r1", sourceId: "s1", embedding: new Float32Array([1, 0, 0, 0]) }),
        makeChunk({ rowId: "r2", sourceId: "s1" })
      ]
    });
    store.markSourceSeen("s2", 1);
    store.markSourceFailed("s3", 1, { code: "X_FAILED", category: "internal", messageKey: "error.internal.failure", retryable: false });
    const stats = store.stats();
    expect(stats.sources).toBe(1);
    expect(stats.chunks).toBe(2);
    expect(stats.chunksWithEmbedding).toBe(1);
    expect(stats.pendingSources).toBe(1);
    expect(stats.failedSources).toBe(1);
  });
});

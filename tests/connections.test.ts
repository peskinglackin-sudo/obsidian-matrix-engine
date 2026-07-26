import { describe, expect, it } from "vitest";

import { analyzeText, type AnalyzerOptions } from "../src/analysis/analyzer";
import { analyzePath } from "../src/analysis/identifier";
import { ConnectionFeedbackStore } from "../src/connections/feedback";
import { ConnectionsService } from "../src/connections/service";
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

function source(sourceId: string, path: string, title: string, extra?: Partial<SourceRecord>): SourceRecord {
  const filename = path.split("/").at(-1) ?? path;
  return {
    sourceId,
    pathRaw: path,
    pathNorm: path.toLowerCase(),
    filenameRaw: filename,
    filenameNorm: filename.toLowerCase(),
    folderRaw: path.split("/").slice(0, -1).join("/"),
    folderNorm: path.split("/").slice(0, -1).join("/").toLowerCase(),
    extension: "md",
    titleRaw: title,
    titleNorm: title.toLowerCase(),
    aliases: [],
    tags: [],
    headings: [],
    links: [],
    frontmatterJson: "{}",
    ctime: NOW,
    mtime: NOW,
    size: 10,
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

function chunk(rowId: string, record: SourceRecord, text: string, embedding?: Float32Array): ChunkRecord {
  const analysis = analyzeText(text, ANALYZER);
  const titleAnalysis = analyzeText(record.titleRaw, ANALYZER);
  return {
    rowId,
    artifactId: "artifact-a",
    sourceId: record.sourceId,
    sourceRevision: record.sourceRevision,
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
    tagTerms: record.tags.map((tag) => tag.toLowerCase()),
    pathTerms: [...analyzePath(record.pathRaw)],
    languageCodes: [],
    scriptCodes: [],
    lineStart: 0,
    lineEnd: 3,
    charStart: 0,
    charEnd: text.length,
    rawChunkHash: rowId,
    extractionHash: "x",
    lexicalInputHash: rowId,
    embeddingInputHash: `${rowId}-embed`,
    embedding,
    mtime: NOW,
    folderNorm: record.folderNorm,
    pathNorm: record.pathNorm,
    extension: "md",
    tags: record.tags,
    createdAt: NOW,
    updatedAt: NOW
  };
}

async function seeded() {
  const store = new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp", dimension: 3, adapter: new MemoryStorageAdapter(), now: () => NOW });
  const current = source("cur", "notes/current.md", "Current Note", { tags: ["ai"], links: ["Linked Note"] });
  const linked = source("lnk", "notes/linked-note.md", "Linked Note");
  const similar = source("sim", "notes/similar.md", "Similar Topic", { tags: ["ai"] });
  const backlinker = source("bak", "notes/backlinker.md", "Backlinker", { links: ["Current Note"] });
  const unrelated = source("unr", "recipes/soup.md", "Soup");

  store.commitSource({ source: current, chunks: [chunk("c1", current, "Vector index design and retrieval quality.", new Float32Array([1, 0, 0]))] });
  store.commitSource({ source: linked, chunks: [chunk("l1", linked, "Linked note content about something else.", new Float32Array([0, 0, 1]))] });
  store.commitSource({ source: similar, chunks: [chunk("s1", similar, "Vector index maintenance and retrieval quality tuning.", new Float32Array([0.95, 0.05, 0]))] });
  store.commitSource({ source: backlinker, chunks: [chunk("b1", backlinker, "Notes that reference the current note.", new Float32Array([0, 1, 0]))] });
  store.commitSource({ source: unrelated, chunks: [chunk("u1", unrelated, "Tomato soup recipe.", new Float32Array([-1, 0, 0]))] });

  const feedback = new ConnectionFeedbackStore(new MemoryStorageAdapter());
  await feedback.load();
  const service = new ConnectionsService({
    store,
    analyzerOptions: () => ANALYZER,
    metric: () => "cosine",
    queryTemplate: () => "{query}",
    embedQuery: (text) => Promise.resolve(text.includes("similar") ? new Float32Array([0.9, 0.1, 0]) : new Float32Array([1, 0, 0])),
    feedback
  });
  return { store, service, feedback };
}

describe("ConnectionsService current note (FR-020)", () => {
  it("ranks semantically similar sources and excludes the current note", async () => {
    const { service } = await seeded();
    const result = await service.forSource("cur", 10);
    expect(result.mode).toBe("semantic");
    expect(result.items.some(({ sourceId }) => sourceId === "cur")).toBe(false);
    expect(result.items[0]?.sourceId).toBe("sim");
    expect(result.items[0]?.edges.some((edge) => edge.kind === "semantic")).toBe(true);
    expect(result.items[0]?.evidenceSnippet).toContain("maintenance");
  });

  it("adds wikilink, backlink, and shared tag edges with explanations", async () => {
    const { service } = await seeded();
    const result = await service.forSource("cur", 10);
    const linked = result.items.find(({ sourceId }) => sourceId === "lnk");
    expect(linked?.edges.some((edge) => edge.kind === "wikilink")).toBe(true);
    const backlinker = result.items.find(({ sourceId }) => sourceId === "bak");
    expect(backlinker?.edges.some((edge) => edge.kind === "backlink")).toBe(true);
    const similar = result.items.find(({ sourceId }) => sourceId === "sim");
    expect(similar?.edges.some((edge) => edge.kind === "shared_tag")).toBe(true);
  });

  it("falls back to lexical similarity when no embeddings exist", async () => {
    const store = new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp", dimension: 3, adapter: new MemoryStorageAdapter(), now: () => NOW });
    const a = source("a", "a.md", "Vector Retrieval");
    const b = source("b", "b.md", "Vector Retrieval Extras");
    store.commitSource({ source: a, chunks: [chunk("a1", a, "vector retrieval design")] });
    store.commitSource({ source: b, chunks: [chunk("b1", b, "vector retrieval tuning guide")] });
    const feedback = new ConnectionFeedbackStore(new MemoryStorageAdapter());
    const service = new ConnectionsService({
      store,
      analyzerOptions: () => ANALYZER,
      metric: () => "cosine",
      queryTemplate: () => "{query}",
      feedback
    });
    const result = await service.forSource("a", 10);
    expect(result.mode).toBe("lexical_fallback");
    expect(result.items[0]?.sourceId).toBe("b");
  });

  it("hides hidden sources and sorts pinned first (FR-022)", async () => {
    const { service, feedback } = await seeded();
    await feedback.setHidden("sim", true);
    await feedback.setPinned("lnk", true);
    const result = await service.forSource("cur", 10);
    expect(result.items.some(({ sourceId }) => sourceId === "sim")).toBe(false);
    expect(result.items[0]?.sourceId).toBe("lnk");
    expect(result.items[0]?.pinned).toBe(true);
  });

  it("returns links_only for unknown sources", async () => {
    const { service } = await seeded();
    const result = await service.forSource("missing", 10);
    expect(result.items).toHaveLength(0);
  });
});

describe("ConnectionsService selection (FR-021)", () => {
  it("finds related blocks for the selection without writing to the index", async () => {
    const { service, store } = await seeded();
    const before = store.stats().chunks;
    const result = await service.forSelection("similar retrieval quality", "cur", 10);
    expect(result.mode).toBe("semantic");
    expect(result.items[0]?.sourceId).toBe("sim");
    expect(store.stats().chunks).toBe(before);
  });

  it("truncates oversized selections and reports it", async () => {
    const { service } = await seeded();
    const huge = "word ".repeat(5000);
    const result = await service.forSelection(huge, undefined, 5);
    expect(result.truncatedSelection).toBe(true);
  });

  it("falls back to lexical matching when embedding is unavailable", async () => {
    const { store } = await seeded();
    const feedback = new ConnectionFeedbackStore(new MemoryStorageAdapter());
    const service = new ConnectionsService({
      store,
      analyzerOptions: () => ANALYZER,
      metric: () => "cosine",
      queryTemplate: () => "{query}",
      feedback
    });
    const result = await service.forSelection("tomato soup recipe", undefined, 5);
    expect(result.mode).toBe("lexical_fallback");
    expect(result.items[0]?.sourceId).toBe("unr");
  });
});

describe("ConnectionFeedbackStore persistence", () => {
  it("round-trips pin and hide state", async () => {
    const adapter = new MemoryStorageAdapter();
    const store = new ConnectionFeedbackStore(adapter);
    await store.load();
    await store.setPinned("s1", true);
    await store.setHidden("s2", true);

    const reloaded = new ConnectionFeedbackStore(adapter);
    await reloaded.load();
    expect(reloaded.isPinned("s1")).toBe(true);
    expect(reloaded.isHidden("s2")).toBe(true);
    await reloaded.setHidden("s2", false);
    expect(reloaded.isHidden("s2")).toBe(false);
  });

  it("starts empty on corrupt payloads", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.write("connections-feedback.json", "{broken");
    const store = new ConnectionFeedbackStore(adapter);
    await store.load();
    expect(store.isPinned("x")).toBe(false);
  });
});

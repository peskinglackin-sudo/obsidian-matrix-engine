import { Buffer } from "node:buffer";

import { z } from "zod";

import { toSafeError, type SafeError } from "../core/errors";
import type { StorageAdapter } from "./adapter";
import { FieldIndex } from "./bm25";
import type {
  ArtifactStats,
  ChunkReader,
  ChunkRecord,
  ExactCandidate,
  ExactCandidateInput,
  LexicalField,
  LexicalHit,
  LexicalSearchInput,
  LexicalStore,
  ManifestRecord,
  ManifestStatus,
  SourceReader,
  SourceRecord,
  VectorHit,
  VectorSearchInput,
  VectorStore,
  WriteResult
} from "./contracts";
import { rowMatchesFilter, sourceMatchesFilter } from "./filter";

/**
 * LocalArtifactStore: the MVP storage backend.
 *
 * Pure-TypeScript flat vector search plus field-scoped BM25 indexes and
 * raw-text exact candidate scanning, persisted as a rebuildable JSON
 * artifact file. Spike 0 recorded the native LanceDB Community packaging
 * no-go and failed ANN recall gates, so flat search over project-owned
 * storage is the approved default; the VectorStore/LexicalStore contracts
 * keep the backend replaceable.
 */

const PERSIST_VERSION = 1;

const persistedChunkSchema = z.strictObject({
  rowId: z.string(),
  artifactId: z.string(),
  sourceId: z.string(),
  sourceRevision: z.number().int(),
  structuralAnchor: z.string(),
  chunkOrdinal: z.number().int(),
  headingPathRaw: z.array(z.string()),
  blockType: z.string(),
  textRaw: z.string(),
  lexicalTerms: z.array(z.string()),
  lexicalNgrams: z.array(z.string()),
  identifierTerms: z.array(z.string()),
  titleTerms: z.array(z.string()),
  aliasTerms: z.array(z.string()),
  headingTerms: z.array(z.string()),
  tagTerms: z.array(z.string()),
  pathTerms: z.array(z.string()),
  languageCodes: z.array(z.string()),
  scriptCodes: z.array(z.string()),
  lineStart: z.number().int(),
  lineEnd: z.number().int(),
  charStart: z.number().int(),
  charEnd: z.number().int(),
  rawChunkHash: z.string(),
  extractionHash: z.string(),
  lexicalInputHash: z.string(),
  embeddingInputHash: z.string(),
  embeddingBase64: z.string().nullable(),
  mtime: z.number(),
  folderNorm: z.string(),
  pathNorm: z.string(),
  extension: z.string(),
  tags: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number()
});

const persistedSourceSchema = z.strictObject({
  sourceId: z.string(),
  pathRaw: z.string(),
  pathNorm: z.string(),
  filenameRaw: z.string(),
  filenameNorm: z.string(),
  folderRaw: z.string(),
  folderNorm: z.string(),
  extension: z.string(),
  titleRaw: z.string(),
  titleNorm: z.string(),
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
  headings: z.array(z.string()),
  links: z.array(z.string()),
  frontmatterJson: z.string(),
  ctime: z.number(),
  mtime: z.number(),
  size: z.number(),
  rawContentHash: z.string(),
  metadataProjectionHash: z.string(),
  sourceRevision: z.number().int(),
  primaryLanguage: z.string(),
  languages: z.array(z.string()),
  scripts: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number()
});

const persistedManifestSchema = z.strictObject({
  artifactId: z.string(),
  sourceId: z.string(),
  seenRevision: z.number().int(),
  indexedRevision: z.number().int(),
  status: z.enum(["pending", "indexed", "failed", "stale"]),
  lastErrorCode: z.string().optional(),
  lastErrorMessage: z.string().optional(),
  retryCount: z.number().int(),
  lastAttemptAt: z.number(),
  updatedAt: z.number()
});

const persistedArtifactSchema = z.strictObject({
  persistVersion: z.literal(PERSIST_VERSION),
  artifactId: z.string(),
  artifactFingerprint: z.string(),
  dimension: z.number().int().nonnegative(),
  lastOptimizeAt: z.number(),
  sources: z.array(persistedSourceSchema),
  manifest: z.array(persistedManifestSchema),
  chunks: z.array(persistedChunkSchema)
});

export type ArtifactLoadResult = Readonly<{
  status: "loaded" | "empty" | "rebuilt";
  error?: SafeError;
}>;

export type SourceCommit = Readonly<{
  source: SourceRecord;
  chunks: readonly ChunkRecord[];
}>;

export class LocalArtifactStore implements VectorStore, LexicalStore, ChunkReader, SourceReader {
  readonly artifactId: string;
  readonly artifactFingerprint: string;
  #dimension: number;

  readonly #adapter: StorageAdapter;
  readonly #filePath: string;
  readonly #now: () => number;

  readonly #sources = new Map<string, SourceRecord>();
  readonly #sourcesByPath = new Map<string, string>();
  readonly #manifest = new Map<string, ManifestRecord>();
  readonly #chunks = new Map<string, ChunkRecord>();
  readonly #chunksBySource = new Map<string, Set<string>>();

  readonly #fields: Record<LexicalField, FieldIndex> = {
    title: new FieldIndex(),
    aliases: new FieldIndex(),
    headings: new FieldIndex(),
    tags: new FieldIndex(),
    filename: new FieldIndex(),
    path: new FieldIndex(),
    body: new FieldIndex(),
    identifier: new FieldIndex(),
    ngram: new FieldIndex()
  };

  #lastOptimizeAt = 0;
  #lastWriteAt = 0;
  #dirty = false;

  constructor(options: Readonly<{
    artifactId: string;
    artifactFingerprint: string;
    dimension: number;
    adapter: StorageAdapter;
    now?: () => number;
  }>) {
    this.artifactId = options.artifactId;
    this.artifactFingerprint = options.artifactFingerprint;
    this.#dimension = options.dimension;
    this.#adapter = options.adapter;
    this.#filePath = `artifact-${options.artifactId}.json`;
    this.#now = options.now ?? Date.now;
  }

  get dimension(): number {
    return this.#dimension;
  }

  set dimension(value: number) {
    this.#dimension = value;
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  // ---------------------------------------------------------------- loading

  async load(): Promise<ArtifactLoadResult> {
    let raw: string | null;
    try {
      raw = await this.#adapter.read(this.#filePath);
    } catch (error: unknown) {
      return Object.freeze({ status: "rebuilt", error: toSafeError(error, "ARTIFACT_READ_FAILED") });
    }
    if (raw === null) return Object.freeze({ status: "empty" });

    try {
      const parsed = persistedArtifactSchema.parse(JSON.parse(raw));
      if (parsed.artifactId !== this.artifactId || parsed.artifactFingerprint !== this.artifactFingerprint) {
        // A fingerprint mismatch means the artifact was built with other
        // rules; it must be rebuilt, not partially reused (PRD 12.8).
        return Object.freeze({ status: "rebuilt" });
      }
      this.#dimension = parsed.dimension;
      this.#lastOptimizeAt = parsed.lastOptimizeAt;
      for (const source of parsed.sources) this.#insertSource(Object.freeze({ ...source }));
      for (const entry of parsed.manifest) this.#manifest.set(entry.sourceId, Object.freeze({ ...entry }));
      for (const chunk of parsed.chunks) {
        const { embeddingBase64, ...rest } = chunk;
        this.#insertChunk(Object.freeze({ ...rest, embedding: decodeEmbedding(embeddingBase64) }));
      }
      this.#dirty = false;
      return Object.freeze({ status: "loaded" });
    } catch (error: unknown) {
      this.#clear();
      return Object.freeze({ status: "rebuilt", error: toSafeError(error, "ARTIFACT_CORRUPT") });
    }
  }

  async persist(): Promise<void> {
    const payload = {
      persistVersion: PERSIST_VERSION,
      artifactId: this.artifactId,
      artifactFingerprint: this.artifactFingerprint,
      dimension: this.#dimension,
      lastOptimizeAt: this.#lastOptimizeAt,
      sources: [...this.#sources.values()],
      manifest: [...this.#manifest.values()],
      chunks: [...this.#chunks.values()].map((chunk) => {
        const { embedding, ...rest } = chunk;
        return { ...rest, embeddingBase64: encodeEmbedding(embedding) };
      })
    };
    await this.#adapter.write(this.#filePath, JSON.stringify(payload));
    this.#dirty = false;
  }

  async destroy(): Promise<void> {
    this.#clear();
    await this.#adapter.remove(this.#filePath);
  }

  #clear(): void {
    this.#sources.clear();
    this.#sourcesByPath.clear();
    this.#manifest.clear();
    this.#chunks.clear();
    this.#chunksBySource.clear();
    for (const field of Object.values(this.#fields)) field.clear();
    this.#dirty = true;
  }

  // ---------------------------------------------------------------- writes

  /**
   * Commit one source revision atomically: reject stale generations, upsert
   * the new rows, then drop rows from older revisions (PRD 14.3, 14.5 —
   * never delete-first on rename).
   */
  commitSource(commit: SourceCommit): WriteResult {
    const existing = this.#manifest.get(commit.source.sourceId);
    if (existing !== undefined && existing.indexedRevision >= commit.source.sourceRevision) {
      return Object.freeze({ status: "stale_rejected", upserted: 0, deleted: 0 });
    }

    this.#insertSource(commit.source);
    let upserted = 0;
    for (const chunk of commit.chunks) {
      this.#insertChunk(chunk);
      upserted += 1;
    }

    let deleted = 0;
    const rowIds = this.#chunksBySource.get(commit.source.sourceId);
    if (rowIds !== undefined) {
      for (const rowId of [...rowIds]) {
        const chunk = this.#chunks.get(rowId);
        if (chunk !== undefined && chunk.sourceRevision < commit.source.sourceRevision) {
          this.#removeChunk(rowId);
          deleted += 1;
        }
      }
    }

    this.#manifest.set(commit.source.sourceId, Object.freeze({
      artifactId: this.artifactId,
      sourceId: commit.source.sourceId,
      seenRevision: commit.source.sourceRevision,
      indexedRevision: commit.source.sourceRevision,
      status: "indexed",
      retryCount: 0,
      lastAttemptAt: this.#now(),
      updatedAt: this.#now()
    }));
    this.#lastWriteAt = this.#now();
    this.#dirty = true;
    return Object.freeze({ status: "committed", upserted, deleted });
  }

  markSourceSeen(sourceId: string, revision: number): void {
    const existing = this.#manifest.get(sourceId);
    if (existing !== undefined && existing.seenRevision >= revision) return;
    this.#manifest.set(sourceId, Object.freeze({
      artifactId: this.artifactId,
      sourceId,
      seenRevision: revision,
      indexedRevision: existing?.indexedRevision ?? 0,
      status: "pending",
      retryCount: existing?.retryCount ?? 0,
      lastAttemptAt: existing?.lastAttemptAt ?? 0,
      updatedAt: this.#now()
    }));
    this.#dirty = true;
  }

  markSourceFailed(sourceId: string, revision: number, error: SafeError): void {
    const existing = this.#manifest.get(sourceId);
    this.#manifest.set(sourceId, Object.freeze({
      artifactId: this.artifactId,
      sourceId,
      seenRevision: Math.max(existing?.seenRevision ?? 0, revision),
      indexedRevision: existing?.indexedRevision ?? 0,
      status: "failed",
      lastErrorCode: error.code,
      lastErrorMessage: error.messageKey,
      retryCount: (existing?.retryCount ?? 0) + 1,
      lastAttemptAt: this.#now(),
      updatedAt: this.#now()
    }));
    this.#dirty = true;
  }

  deleteSource(sourceId: string): WriteResult {
    const source = this.#sources.get(sourceId);
    if (source === undefined) return Object.freeze({ status: "committed", upserted: 0, deleted: 0 });
    let deleted = 0;
    const rowIds = this.#chunksBySource.get(sourceId);
    if (rowIds !== undefined) {
      for (const rowId of [...rowIds]) {
        this.#removeChunk(rowId);
        deleted += 1;
      }
    }
    this.#chunksBySource.delete(sourceId);
    this.#sourcesByPath.delete(source.pathRaw);
    this.#sources.delete(sourceId);
    this.#manifest.delete(sourceId);
    this.#lastWriteAt = this.#now();
    this.#dirty = true;
    return Object.freeze({ status: "committed", upserted: 0, deleted });
  }

  /** Rename keeps the source ID and rows; only path projections change (PRD 13.4). */
  renameSource(sourceId: string, newPath: Readonly<{ pathRaw: string; pathNorm: string; filenameRaw: string; filenameNorm: string; folderRaw: string; folderNorm: string; pathTerms: readonly string[] }>, revision: number): boolean {
    const source = this.#sources.get(sourceId);
    if (source === undefined) return false;
    this.#sourcesByPath.delete(source.pathRaw);
    const updated: SourceRecord = Object.freeze({
      ...source,
      pathRaw: newPath.pathRaw,
      pathNorm: newPath.pathNorm,
      filenameRaw: newPath.filenameRaw,
      filenameNorm: newPath.filenameNorm,
      folderRaw: newPath.folderRaw,
      folderNorm: newPath.folderNorm,
      sourceRevision: revision,
      updatedAt: this.#now()
    });
    this.#insertSource(updated);
    const rowIds = this.#chunksBySource.get(sourceId);
    if (rowIds !== undefined) {
      for (const rowId of rowIds) {
        const chunk = this.#chunks.get(rowId);
        if (chunk === undefined) continue;
        this.#insertChunk(Object.freeze({
          ...chunk,
          sourceRevision: revision,
          folderNorm: newPath.folderNorm,
          pathNorm: newPath.pathNorm,
          pathTerms: newPath.pathTerms,
          updatedAt: this.#now()
        }));
      }
    }
    const manifest = this.#manifest.get(sourceId);
    if (manifest !== undefined) {
      this.#manifest.set(sourceId, Object.freeze({ ...manifest, seenRevision: revision, indexedRevision: revision, updatedAt: this.#now() }));
    }
    this.#dirty = true;
    return true;
  }

  attachEmbedding(rowId: string, embeddingInputHash: string, embedding: Float32Array): boolean {
    const chunk = this.#chunks.get(rowId);
    // Stale guard: the row may have been re-written while the embedding was
    // in flight; only attach when the input hash still matches (PRD 14.3).
    if (chunk?.embeddingInputHash !== embeddingInputHash) return false;
    this.#chunks.set(rowId, Object.freeze({ ...chunk, embedding, updatedAt: this.#now() }));
    this.#dirty = true;
    return true;
  }

  // ---------------------------------------------------------------- reads

  getChunk(rowId: string): ChunkRecord | undefined {
    return this.#chunks.get(rowId);
  }

  chunksForSource(sourceId: string): readonly ChunkRecord[] {
    const rowIds = this.#chunksBySource.get(sourceId);
    if (rowIds === undefined) return [];
    const chunks: ChunkRecord[] = [];
    for (const rowId of rowIds) {
      const chunk = this.#chunks.get(rowId);
      if (chunk !== undefined) chunks.push(chunk);
    }
    return chunks.sort((left, right) => left.chunkOrdinal - right.chunkOrdinal);
  }

  getSource(sourceId: string): SourceRecord | undefined {
    return this.#sources.get(sourceId);
  }

  getSourceByPath(pathRaw: string): SourceRecord | undefined {
    const sourceId = this.#sourcesByPath.get(pathRaw);
    return sourceId === undefined ? undefined : this.#sources.get(sourceId);
  }

  listSources(): readonly SourceRecord[] {
    return [...this.#sources.values()];
  }

  manifestFor(sourceId: string): ManifestRecord | undefined {
    return this.#manifest.get(sourceId);
  }

  listManifest(status?: ManifestStatus): readonly ManifestRecord[] {
    const entries = [...this.#manifest.values()];
    return status === undefined ? entries : entries.filter((entry) => entry.status === status);
  }

  stats(): ArtifactStats {
    let withEmbedding = 0;
    for (const chunk of this.#chunks.values()) {
      if (chunk.embedding !== undefined) withEmbedding += 1;
    }
    const manifest = [...this.#manifest.values()];
    return Object.freeze({
      sources: this.#sources.size,
      chunks: this.#chunks.size,
      chunksWithEmbedding: withEmbedding,
      pendingSources: manifest.filter((entry) => entry.status === "pending").length,
      failedSources: manifest.filter((entry) => entry.status === "failed").length,
      staleRows: manifest.filter((entry) => entry.status === "stale").length,
      lastOptimizeAt: this.#lastOptimizeAt,
      lastWriteAt: this.#lastWriteAt
    });
  }

  markOptimized(): void {
    this.#lastOptimizeAt = this.#now();
    this.#dirty = true;
  }

  // ---------------------------------------------------------------- search

  vectorSearch(input: VectorSearchInput): Promise<readonly VectorHit[]> {
    const hits: VectorHit[] = [];
    if (input.vector.length === 0) return Promise.resolve(hits);
    for (const chunk of this.#chunks.values()) {
      const embedding = chunk.embedding;
      if (embedding?.length !== input.vector.length) continue;
      if (!rowMatchesFilter(chunk, input.filter)) continue;
      const { rawValue, rankScore } = scoreVectors(input.vector, embedding, input.metric);
      hits.push(Object.freeze({ rowId: chunk.rowId, sourceId: chunk.sourceId, rawValue, rankScore }));
    }
    hits.sort((left, right) => right.rankScore - left.rankScore);
    return Promise.resolve(Object.freeze(hits.slice(0, input.limit)));
  }

  lexicalSearch(input: LexicalSearchInput): Promise<readonly LexicalHit[]> {
    const scores = new Map<string, number>();
    const matchedTerms = new Map<string, Set<string>>();
    const matchedFieldsByRow = new Map<string, Set<LexicalField>>();

    const apply = (field: LexicalField, terms: readonly string[]): void => {
      if (terms.length === 0) return;
      const fieldMatches = new Map<string, Set<string>>();
      this.#fields[field].score(terms, input.fieldWeights[field], scores, fieldMatches);
      for (const [rowId, termSet] of fieldMatches) {
        let fields = matchedFieldsByRow.get(rowId);
        if (fields === undefined) {
          fields = new Set<LexicalField>();
          matchedFieldsByRow.set(rowId, fields);
        }
        fields.add(field);
        let terms2 = matchedTerms.get(rowId);
        if (terms2 === undefined) {
          terms2 = new Set<string>();
          matchedTerms.set(rowId, terms2);
        }
        for (const term of termSet) terms2.add(term);
      }
    };

    apply("title", input.terms);
    apply("aliases", input.terms);
    apply("headings", input.terms);
    apply("tags", input.terms);
    apply("filename", input.terms);
    apply("path", input.terms);
    apply("body", input.terms);
    apply("identifier", input.identifierTerms.length > 0 ? input.identifierTerms : input.terms);
    apply("ngram", input.ngrams);

    const excluded = new Set<string>();
    for (const term of input.excludedTerms) {
      const posting = this.#fields.body.documentsWithTerm(term);
      if (posting !== undefined) {
        for (const rowId of posting.keys()) excluded.add(rowId);
      }
      const ngramPosting = this.#fields.ngram.documentsWithTerm(term);
      if (ngramPosting !== undefined) {
        for (const rowId of ngramPosting.keys()) excluded.add(rowId);
      }
    }

    const hits: LexicalHit[] = [];
    for (const [rowId, score] of scores) {
      if (excluded.has(rowId)) continue;
      const chunk = this.#chunks.get(rowId);
      if (chunk === undefined || !rowMatchesFilter(chunk, input.filter)) continue;
      hits.push(Object.freeze({
        rowId,
        sourceId: chunk.sourceId,
        rawValue: score,
        rankScore: score,
        matchedFields: Object.freeze([...(matchedFieldsByRow.get(rowId) ?? [])]),
        matchedTerms: Object.freeze([...(matchedTerms.get(rowId) ?? [])])
      }));
    }
    hits.sort((left, right) => right.rankScore - left.rankScore);
    return Promise.resolve(Object.freeze(hits.slice(0, input.limit)));
  }

  exactCandidates(input: ExactCandidateInput): Promise<readonly ExactCandidate[]> {
    const candidates: ExactCandidate[] = [];
    if (input.phrase.length === 0) return Promise.resolve(candidates);
    const needle = input.caseSensitive ? input.phrase : input.phrase.toLowerCase();

    const wantsField = (field: ExactCandidateInput["fields"][number]): boolean => input.fields.includes(field);

    if (wantsField("title") || wantsField("path") || wantsField("filename") || wantsField("alias") || wantsField("tag")) {
      for (const source of this.#sources.values()) {
        if (candidates.length >= input.limit) break;
        if (!sourceMatchesFilter(source, input.filter)) continue;
        if (wantsField("title")) checkSourceField(source, "title", source.titleRaw, needle, input.caseSensitive, candidates);
        if (wantsField("path")) checkSourceField(source, "path", source.pathRaw, needle, input.caseSensitive, candidates);
        if (wantsField("filename")) checkSourceField(source, "filename", source.filenameRaw, needle, input.caseSensitive, candidates);
        if (wantsField("alias")) {
          for (const alias of source.aliases) checkSourceField(source, "alias", alias, needle, input.caseSensitive, candidates);
        }
        if (wantsField("tag")) {
          for (const tag of source.tags) checkSourceField(source, "tag", `#${tag}`, needle, input.caseSensitive, candidates);
        }
      }
    }

    if (wantsField("text")) {
      for (const chunk of this.#chunks.values()) {
        if (candidates.length >= input.limit) break;
        if (!rowMatchesFilter(chunk, input.filter)) continue;
        const haystack = input.caseSensitive ? chunk.textRaw : chunk.textRaw.toLowerCase();
        const offset = haystack.indexOf(needle);
        if (offset >= 0) {
          candidates.push(Object.freeze({ sourceId: chunk.sourceId, rowId: chunk.rowId, field: "text", offset }));
        }
      }
    }

    return Promise.resolve(Object.freeze(candidates.slice(0, input.limit)));
  }

  // ---------------------------------------------------------------- internal

  #insertSource(source: SourceRecord): void {
    const previous = this.#sources.get(source.sourceId);
    if (previous !== undefined && previous.pathRaw !== source.pathRaw) {
      this.#sourcesByPath.delete(previous.pathRaw);
    }
    this.#sources.set(source.sourceId, source);
    this.#sourcesByPath.set(source.pathRaw, source.sourceId);
  }

  #insertChunk(chunk: ChunkRecord): void {
    this.#chunks.set(chunk.rowId, chunk);
    let rowIds = this.#chunksBySource.get(chunk.sourceId);
    if (rowIds === undefined) {
      rowIds = new Set<string>();
      this.#chunksBySource.set(chunk.sourceId, rowIds);
    }
    rowIds.add(chunk.rowId);
    this.#fields.title.addDocument(chunk.rowId, chunk.titleTerms);
    this.#fields.aliases.addDocument(chunk.rowId, chunk.aliasTerms);
    this.#fields.headings.addDocument(chunk.rowId, chunk.headingTerms);
    this.#fields.tags.addDocument(chunk.rowId, chunk.tagTerms);
    this.#fields.filename.addDocument(chunk.rowId, chunk.pathTerms.filter((term) => !term.includes("/")));
    this.#fields.path.addDocument(chunk.rowId, chunk.pathTerms);
    this.#fields.body.addDocument(chunk.rowId, chunk.lexicalTerms);
    this.#fields.identifier.addDocument(chunk.rowId, chunk.identifierTerms);
    this.#fields.ngram.addDocument(chunk.rowId, chunk.lexicalNgrams);
  }

  #removeChunk(rowId: string): void {
    const chunk = this.#chunks.get(rowId);
    if (chunk === undefined) return;
    this.#chunks.delete(rowId);
    this.#chunksBySource.get(chunk.sourceId)?.delete(rowId);
    for (const field of Object.values(this.#fields)) field.removeDocument(rowId);
  }
}

function checkSourceField(source: SourceRecord, field: ExactCandidate["field"], value: string, needle: string, caseSensitive: boolean, out: ExactCandidate[]): void {
  const haystack = caseSensitive ? value : value.toLowerCase();
  const offset = haystack.indexOf(needle);
  if (offset >= 0) out.push(Object.freeze({ sourceId: source.sourceId, field, offset }));
}

function scoreVectors(query: Float32Array, candidate: Float32Array, metric: VectorSearchInput["metric"]): Readonly<{ rawValue: number; rankScore: number }> {
  let dot = 0;
  let queryNorm = 0;
  let candidateNorm = 0;
  for (let index = 0; index < query.length; index += 1) {
    const q = query[index] ?? 0;
    const c = candidate[index] ?? 0;
    dot += q * c;
    queryNorm += q * q;
    candidateNorm += c * c;
  }
  switch (metric) {
    case "dot":
      return Object.freeze({ rawValue: dot, rankScore: dot });
    case "cosine": {
      const denominator = Math.sqrt(queryNorm) * Math.sqrt(candidateNorm);
      const similarity = denominator === 0 ? 0 : dot / denominator;
      // Report cosine distance as the raw value (LanceDB convention).
      return Object.freeze({ rawValue: 1 - similarity, rankScore: similarity });
    }
    case "l2": {
      let sum = 0;
      for (let index = 0; index < query.length; index += 1) {
        const difference = (query[index] ?? 0) - (candidate[index] ?? 0);
        sum += difference * difference;
      }
      const distance = Math.sqrt(sum);
      return Object.freeze({ rawValue: distance, rankScore: -distance });
    }
  }
}

function encodeEmbedding(embedding: Float32Array | undefined): string | null {
  if (embedding === undefined) return null;
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength).toString("base64");
}

function decodeEmbedding(base64: string | null): Float32Array | undefined {
  if (base64 === null) return undefined;
  const buffer = Buffer.from(base64, "base64");
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return new Float32Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 4));
}

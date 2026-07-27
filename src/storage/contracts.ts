/**
 * Storage contracts (PRD 11.1, 13).
 *
 * Business logic depends on these interfaces only. Spike 0 recorded a
 * Community-packaging no-go for the native LanceDB backend, so the MVP
 * default is the pure-TypeScript LocalArtifactStore; the boundary stays so
 * a native backend can return once its distribution gate passes.
 */

export type SourceRecord = Readonly<{
  sourceId: string;
  pathRaw: string;
  pathNorm: string;
  filenameRaw: string;
  filenameNorm: string;
  folderRaw: string;
  folderNorm: string;
  extension: string;
  titleRaw: string;
  titleNorm: string;
  aliases: readonly string[];
  tags: readonly string[];
  headings: readonly string[];
  links: readonly string[];
  frontmatterJson: string;
  ctime: number;
  mtime: number;
  size: number;
  rawContentHash: string;
  metadataProjectionHash: string;
  sourceRevision: number;
  primaryLanguage: string;
  languages: readonly string[];
  scripts: readonly string[];
  createdAt: number;
  updatedAt: number;
}>;

export type ChunkRecord = Readonly<{
  rowId: string;
  artifactId: string;
  sourceId: string;
  sourceRevision: number;
  structuralAnchor: string;
  chunkOrdinal: number;
  headingPathRaw: readonly string[];
  blockType: string;
  textRaw: string;
  lexicalTerms: readonly string[];
  lexicalNgrams: readonly string[];
  identifierTerms: readonly string[];
  titleTerms: readonly string[];
  aliasTerms: readonly string[];
  headingTerms: readonly string[];
  tagTerms: readonly string[];
  pathTerms: readonly string[];
  languageCodes: readonly string[];
  scriptCodes: readonly string[];
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
  rawChunkHash: string;
  extractionHash: string;
  lexicalInputHash: string;
  embeddingInputHash: string;
  embedding: Float32Array | undefined;
  mtime: number;
  folderNorm: string;
  pathNorm: string;
  extension: string;
  tags: readonly string[];
  createdAt: number;
  updatedAt: number;
}>;

export type ManifestStatus = "pending" | "indexed" | "failed" | "stale";

export type ManifestRecord = Readonly<{
  artifactId: string;
  sourceId: string;
  seenRevision: number;
  indexedRevision: number;
  status: ManifestStatus;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  retryCount: number;
  lastAttemptAt: number;
  updatedAt: number;
}>;

/** Structured row filter (PRD 21.4): compiled from the query AST, never raw SQL. */
export type RowFilter = Readonly<{
  folders?: readonly string[];
  pathContains?: readonly string[];
  tags?: readonly string[];
  extensions?: readonly string[];
  mtimeBefore?: number;
  mtimeAfter?: number;
  sourceIds?: readonly string[];
  excludeSourceIds?: readonly string[];
}>;

export type VectorMetric = "cosine" | "dot" | "l2";

export type VectorHit = Readonly<{
  rowId: string;
  sourceId: string;
  /** Raw metric value (distance or similarity, metric-dependent). */
  rawValue: number;
  /** Higher-is-better ranking score. */
  rankScore: number;
}>;

export type VectorSearchInput = Readonly<{
  vector: Float32Array;
  limit: number;
  metric: VectorMetric;
  filter?: RowFilter;
}>;

export type LexicalSearchInput = Readonly<{
  terms: readonly string[];
  ngrams: readonly string[];
  identifierTerms: readonly string[];
  excludedTerms: readonly string[];
  limit: number;
  fieldWeights: Readonly<Record<LexicalField, number>>;
  filter?: RowFilter;
}>;

export type LexicalField = "title" | "aliases" | "headings" | "tags" | "filename" | "path" | "body" | "identifier" | "ngram";

export type LexicalHit = Readonly<{
  rowId: string;
  sourceId: string;
  rawValue: number;
  rankScore: number;
  matchedFields: readonly LexicalField[];
  matchedTerms: readonly string[];
}>;

export type ExactField = "text" | "title" | "alias" | "path" | "filename" | "tag";

export type ExactCandidateInput = Readonly<{
  phrase: string;
  caseSensitive: boolean;
  fields: readonly ExactField[];
  limit: number;
  filter?: RowFilter;
}>;

export type ExactCandidate = Readonly<{
  sourceId: string;
  rowId?: string;
  field: ExactField;
  /** Char offset of the first occurrence within the matched field/raw text. */
  offset: number;
}>;

export type WriteResult = Readonly<{
  status: "committed" | "stale_rejected";
  upserted: number;
  deleted: number;
}>;

export type ArtifactStats = Readonly<{
  sources: number;
  chunks: number;
  chunksWithEmbedding: number;
  pendingSources: number;
  failedSources: number;
  staleRows: number;
  lastOptimizeAt: number;
  lastWriteAt: number;
}>;

export interface VectorStore {
  vectorSearch(input: VectorSearchInput): Promise<readonly VectorHit[]>;
}

export interface LexicalStore {
  lexicalSearch(input: LexicalSearchInput): Promise<readonly LexicalHit[]>;
  exactCandidates(input: ExactCandidateInput): Promise<readonly ExactCandidate[]>;
}

export interface ChunkReader {
  getChunk(rowId: string): ChunkRecord | undefined;
  chunksForSource(sourceId: string): readonly ChunkRecord[];
}

export interface SourceReader {
  getSource(sourceId: string): SourceRecord | undefined;
  getSourceByPath(pathRaw: string): SourceRecord | undefined;
  listSources(): readonly SourceRecord[];
}

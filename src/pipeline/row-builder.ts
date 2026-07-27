import { analyzeText, type AnalyzerOptions } from "../analysis/analyzer";
import { analyzePath } from "../analysis/identifier";
import { normalizeLexical } from "../analysis/normalize";
import { analyzeLanguage } from "../analysis/scripts";
import { chunkDocument, estimateTokens } from "../indexing/chunker";
import { extractDocument } from "../indexing/extractor";
import {
  computeEmbeddingInputHash,
  computeExtractionHash,
  computeLexicalInputHash,
  computeMetadataProjectionHash,
  computeRawContentHash,
  computeRowId,
  documentTemplateVariables,
  renderTemplate
} from "../indexing/hashes";
import { sha256Hex } from "../core/hash";
import type { CorpusProfile, LexicalProfile } from "../settings/types";
import type { ChunkRecord, SourceRecord } from "../storage/contracts";

/**
 * Source row builder: extraction -> chunking -> analysis -> hashes.
 *
 * Produces the complete source catalog record, chunk rows with all lexical
 * fields, and the embedding inputs (final rendered document template text
 * with its hash) for the embedding stage (PRD 13, 14.4).
 */

export type FileSnapshot = Readonly<{
  path: string;
  content: string;
  ctime: number;
  mtime: number;
  size: number;
}>;

export type BuildContext = Readonly<{
  artifactId: string;
  sourceId: string;
  revision: number;
  corpus: CorpusProfile;
  lexical: LexicalProfile;
  documentTemplate: string;
  lexicalFingerprint: string;
  now: number;
}>;

export type EmbeddingInput = Readonly<{
  rowId: string;
  text: string;
  embeddingInputHash: string;
  estimatedTokens: number;
}>;

export type BuiltSource = Readonly<{
  source: SourceRecord;
  chunks: readonly ChunkRecord[];
  embeddingInputs: readonly EmbeddingInput[];
}>;

export function analyzerOptionsFrom(lexical: LexicalProfile): AnalyzerOptions {
  return Object.freeze({
    useIntlSegmenter: lexical.useIntlSegmenter,
    cjkNgramMin: lexical.cjkNgramMin,
    cjkNgramMax: lexical.cjkNgramMax,
    normalizeNfkc: lexical.normalizeNfkc,
    accentFoldSecondary: lexical.accentFoldSecondary,
    identifierSplitting: lexical.identifierSplitting
  });
}

export function buildSourceRows(snapshot: FileSnapshot, context: BuildContext): BuiltSource {
  const options = analyzerOptionsFrom(context.lexical);
  const filename = snapshot.path.split("/").at(-1) ?? snapshot.path;
  const stem = filename.replace(/\.[^.]+$/u, "");
  const document = extractDocument(snapshot.content, stem);
  const chunks = chunkDocument(document, {
    chunkSizeTokens: context.corpus.chunkSizeTokens,
    chunkOverlapTokens: context.corpus.chunkOverlapTokens,
    minChunkTokens: context.corpus.minChunkTokens,
    includeCode: context.corpus.includeCode
  });

  const folder = snapshot.path.split("/").slice(0, -1).join("/");
  const extension = (filename.split(".").at(-1) ?? "").toLowerCase();
  const language = analyzeLanguage(snapshot.content);
  const rawContentHash = computeRawContentHash(snapshot.content);
  const includedFrontmatter = projectFrontmatter(document.frontmatter.fields, context.corpus.includeFrontmatterFields);
  const metadataProjectionHash = computeMetadataProjectionHash({
    path: snapshot.path,
    title: document.title,
    aliases: document.frontmatter.aliases,
    tags: document.tags,
    frontmatterFields: includedFrontmatter,
    mtime: snapshot.mtime,
    size: snapshot.size
  });

  const source: SourceRecord = Object.freeze({
    sourceId: context.sourceId,
    pathRaw: snapshot.path,
    pathNorm: normalizeLexical(snapshot.path, context.lexical.normalizeNfkc),
    filenameRaw: filename,
    filenameNorm: filename.toLowerCase(),
    folderRaw: folder,
    folderNorm: folder.toLowerCase(),
    extension,
    titleRaw: document.title,
    titleNorm: normalizeLexical(document.title, context.lexical.normalizeNfkc),
    aliases: document.frontmatter.aliases,
    tags: document.tags,
    headings: Object.freeze(document.headings.map(({ text }) => text)),
    links: Object.freeze(document.links.map(({ target }) => target)),
    frontmatterJson: JSON.stringify(includedFrontmatter),
    ctime: snapshot.ctime,
    mtime: snapshot.mtime,
    size: snapshot.size,
    rawContentHash,
    metadataProjectionHash,
    sourceRevision: context.revision,
    primaryLanguage: language.primaryLanguage,
    languages: language.languages,
    scripts: language.scripts,
    createdAt: context.now,
    updatedAt: context.now
  });

  const extractionHash = computeExtractionHash({
    extractionVersion: context.corpus.extractionVersion,
    chunkStrategy: context.corpus.chunkStrategy,
    chunks
  });

  const titleAnalysis = analyzeText(document.title, options);
  const aliasAnalysis = analyzeText(document.frontmatter.aliases.join(" "), options);
  const tagTerms = document.tags.map((tag) => tag.toLowerCase());
  const pathTerms = analyzePath(snapshot.path);

  const chunkRecords: ChunkRecord[] = [];
  const embeddingInputs: EmbeddingInput[] = [];
  for (const chunk of chunks) {
    const rowId = computeRowId({
      artifactId: context.artifactId,
      sourceId: context.sourceId,
      structuralAnchor: chunk.structuralAnchor,
      chunkOrdinal: chunk.ordinal
    });
    const analysis = analyzeText(chunk.text, options);
    const headingAnalysis = analyzeText(chunk.headingPath.join(" "), options);
    const chunkLanguage = analyzeLanguage(chunk.text);
    const rendered = renderTemplate(context.documentTemplate, documentTemplateVariables({
      title: document.title,
      headingPath: chunk.headingPath,
      content: chunk.text,
      path: snapshot.path,
      tags: document.tags
    }));
    const embeddingInputHash = computeEmbeddingInputHash(rendered.text);
    const lexicalInputHash = computeLexicalInputHash({
      analyzerId: context.lexical.analyzerId,
      analyzerVersion: context.lexical.analyzerVersion,
      lexicalFingerprint: context.lexicalFingerprint,
      chunkText: chunk.text,
      headingPath: chunk.headingPath,
      title: document.title,
      tags: document.tags,
      path: snapshot.path
    });

    chunkRecords.push(Object.freeze({
      rowId,
      artifactId: context.artifactId,
      sourceId: context.sourceId,
      sourceRevision: context.revision,
      structuralAnchor: chunk.structuralAnchor,
      chunkOrdinal: chunk.ordinal,
      headingPathRaw: chunk.headingPath,
      blockType: chunk.blockType,
      textRaw: chunk.text,
      lexicalTerms: Object.freeze([...analysis.terms, ...analysis.secondaryTerms]),
      lexicalNgrams: analysis.ngrams,
      identifierTerms: analysis.identifierTerms,
      titleTerms: titleAnalysis.terms,
      aliasTerms: aliasAnalysis.terms,
      headingTerms: headingAnalysis.terms,
      tagTerms: Object.freeze(tagTerms),
      pathTerms,
      languageCodes: chunkLanguage.languages,
      scriptCodes: chunkLanguage.scripts,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      rawChunkHash: sha256Hex(chunk.text),
      extractionHash,
      lexicalInputHash,
      embeddingInputHash,
      embedding: undefined,
      mtime: snapshot.mtime,
      folderNorm: folder.toLowerCase(),
      pathNorm: source.pathNorm,
      extension,
      tags: document.tags,
      createdAt: context.now,
      updatedAt: context.now
    }));
    embeddingInputs.push(Object.freeze({
      rowId,
      text: rendered.text,
      embeddingInputHash,
      estimatedTokens: estimateTokens(rendered.text)
    }));
  }

  return Object.freeze({
    source,
    chunks: Object.freeze(chunkRecords),
    embeddingInputs: Object.freeze(embeddingInputs)
  });
}

function projectFrontmatter(
  fields: Readonly<Record<string, string | readonly string[]>>,
  included: readonly string[]
): Readonly<Record<string, string | readonly string[]>> {
  if (included.length === 0) return Object.freeze({});
  const projection: Record<string, string | readonly string[]> = {};
  for (const key of included) {
    const value = fields[key];
    if (value !== undefined) projection[key] = value;
  }
  return Object.freeze(projection);
}

/** Corpus scope check (FR-001): folder prefixes or simple `*` globs. */
export function pathInScope(path: string, corpus: Pick<CorpusProfile, "includes" | "excludes" | "fileTypes">): boolean {
  const extension = (path.split(".").at(-1) ?? "").toLowerCase();
  if (!corpus.fileTypes.includes(extension as "md" | "txt")) return false;
  const normalized = path.toLowerCase();
  const matches = (pattern: string): boolean => {
    const cleaned = pattern.toLowerCase().replace(/^\/+|\/+$/gu, "");
    if (cleaned.length === 0) return true;
    if (cleaned.includes("*")) {
      const regex = new RegExp(`^${cleaned.split("*").map(escapeRegex).join(".*")}$`, "u");
      return regex.test(normalized);
    }
    return normalized === cleaned || normalized.startsWith(`${cleaned}/`);
  };
  if (corpus.excludes.some(matches)) return false;
  if (corpus.includes.length === 0) return true;
  return corpus.includes.some(matches);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

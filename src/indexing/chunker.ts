import type { ExtractedDocument } from "./extractor";

/**
 * Heading-block chunking (PRD FR-004).
 *
 * Heading blocks are the semantic knowledge units. Oversized blocks are
 * split on line boundaries within the model token budget (repeating table
 * headers), undersized neighbors merge, and fenced code is never treated
 * as heading structure. Anchors stay stable so row IDs survive re-chunking
 * of unchanged content.
 */

export type ChunkOptions = Readonly<{
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  minChunkTokens: number;
  includeCode: boolean;
}>;

export type RawChunk = Readonly<{
  structuralAnchor: string;
  ordinal: number;
  headingPath: readonly string[];
  blockType: "heading_block" | "preamble" | "split" | "merged";
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
  text: string;
}>;

type Section = Readonly<{
  headingPath: readonly string[];
  lineStart: number;
  lineEnd: number;
  kind: "preamble" | "heading_block";
}>;

/** Rough token estimate: CJK-style chars count as one token, other runs as chars/4 (PRD 17.2 fallback). */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u.test(char)) cjk += 1;
    else if (!/\s/u.test(char)) other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

export function chunkDocument(document: ExtractedDocument, options: ChunkOptions): readonly RawChunk[] {
  const lineOffsets = buildLineOffsets(document.lines);
  const sections = buildSections(document);
  const merged = mergeSmallSections(sections, document, options);

  const chunks: RawChunk[] = [];
  const anchorCounts = new Map<string, number>();
  for (const section of merged) {
    const text = sectionText(document, section, options);
    if (text.trim().length === 0) continue;
    const budgetPieces = splitByBudget(document, section, options);
    for (const piece of budgetPieces) {
      const pieceText = pieceContent(document, piece.lineStart, piece.lineEnd, options, piece.repeatHeader);
      if (pieceText.trim().length === 0) continue;
      const baseAnchor = section.headingPath.length === 0 ? "~preamble" : `h:${section.headingPath.join(" > ")}`;
      const anchorOrdinal = anchorCounts.get(baseAnchor) ?? 0;
      anchorCounts.set(baseAnchor, anchorOrdinal + 1);
      const structuralAnchor = anchorOrdinal === 0 ? baseAnchor : `${baseAnchor}~${String(anchorOrdinal)}`;
      chunks.push(Object.freeze({
        structuralAnchor,
        ordinal: chunks.length,
        headingPath: section.headingPath,
        blockType: piece.split ? "split" : section.kind === "preamble" ? "preamble" : section.merged ? "merged" : "heading_block",
        lineStart: piece.lineStart,
        lineEnd: piece.lineEnd,
        charStart: lineOffsets[piece.lineStart] ?? 0,
        charEnd: (lineOffsets[piece.lineEnd] ?? 0) + (document.lines[piece.lineEnd] ?? "").length,
        text: pieceText
      }));
    }
  }
  return Object.freeze(chunks);
}

type MergedSection = Section & Readonly<{ merged: boolean }>;

function buildLineOffsets(lines: readonly string[]): readonly number[] {
  const offsets: number[] = new Array<number>(lines.length);
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    offsets[index] = offset;
    offset += (lines[index] ?? "").length + 1;
  }
  return offsets;
}

function buildSections(document: ExtractedDocument): readonly Section[] {
  const sections: Section[] = [];
  const contentStart = document.frontmatter.endLine + 1;
  const firstHeadingLine = document.headings[0]?.line ?? document.lines.length;
  if (firstHeadingLine > contentStart) {
    sections.push({ headingPath: [], lineStart: contentStart, lineEnd: firstHeadingLine - 1, kind: "preamble" });
  }
  const stack: { level: number; text: string }[] = [];
  for (let index = 0; index < document.headings.length; index += 1) {
    const heading = document.headings[index];
    if (heading === undefined) continue;
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
    stack.push({ level: heading.level, text: heading.text });
    const nextHeadingLine = document.headings[index + 1]?.line ?? document.lines.length;
    sections.push({
      headingPath: stack.map(({ text }) => text),
      lineStart: heading.line,
      lineEnd: nextHeadingLine - 1,
      kind: "heading_block"
    });
  }
  return sections;
}

function mergeSmallSections(sections: readonly Section[], document: ExtractedDocument, options: ChunkOptions): readonly MergedSection[] {
  const merged: MergedSection[] = [];
  let pending: MergedSection | undefined;
  for (const section of sections) {
    if (pending === undefined) {
      pending = { ...section, merged: false };
      continue;
    }
    const pendingTokens = estimateTokens(sectionText(document, pending, options));
    if (pendingTokens < options.minChunkTokens && pending.kind === section.kind) {
      pending = {
        headingPath: pending.headingPath,
        lineStart: pending.lineStart,
        lineEnd: section.lineEnd,
        kind: pending.kind,
        merged: true
      };
      continue;
    }
    merged.push(pending);
    pending = { ...section, merged: false };
  }
  if (pending !== undefined) merged.push(pending);
  return merged;
}

function sectionText(document: ExtractedDocument, section: Pick<Section, "lineStart" | "lineEnd">, options: ChunkOptions): string {
  return pieceContent(document, section.lineStart, section.lineEnd, options, []);
}

function pieceContent(document: ExtractedDocument, lineStart: number, lineEnd: number, options: ChunkOptions, repeatHeader: readonly string[]): string {
  const parts: string[] = [...repeatHeader];
  for (let index = lineStart; index <= lineEnd; index += 1) {
    if (!options.includeCode && insideFence(document, index)) continue;
    parts.push(document.lines[index] ?? "");
  }
  return parts.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function insideFence(document: ExtractedDocument, line: number): boolean {
  return document.codeFences.some((fence) => line >= fence.startLine && line <= fence.endLine);
}

type BudgetPiece = Readonly<{ lineStart: number; lineEnd: number; split: boolean; repeatHeader: readonly string[] }>;

function splitByBudget(document: ExtractedDocument, section: Section, options: ChunkOptions): readonly BudgetPiece[] {
  const total = estimateTokens(sectionText(document, section, options));
  if (total <= options.chunkSizeTokens) {
    return [{ lineStart: section.lineStart, lineEnd: section.lineEnd, split: false, repeatHeader: [] }];
  }

  const pieces: BudgetPiece[] = [];
  let start = section.lineStart;
  let tokens = 0;
  let tableHeader: readonly string[] = [];
  let index = section.lineStart;
  while (index <= section.lineEnd) {
    // Whole fences stay inside one piece whenever the budget allows.
    const fenceEnd = fenceEndAt(document, index);
    const blockEnd = fenceEnd !== undefined && fenceEnd <= section.lineEnd ? fenceEnd : index;
    const blockTokens = rangeTokens(document, index, blockEnd);
    if (tokens > 0 && tokens + blockTokens > options.chunkSizeTokens) {
      pieces.push({ lineStart: start, lineEnd: index - 1, split: true, repeatHeader: tableHeader });
      tableHeader = tableHeaderFor(document, index);
      start = backtrackOverlap(document, index, start, options.chunkOverlapTokens);
      tokens = start < index ? rangeTokens(document, start, index - 1) : 0;
    }
    tokens += blockTokens;
    index = blockEnd + 1;
  }
  pieces.push({ lineStart: start, lineEnd: section.lineEnd, split: true, repeatHeader: tableHeader });
  return pieces;
}

function backtrackOverlap(document: ExtractedDocument, splitLine: number, previousStart: number, budget: number): number {
  let start = splitLine;
  let tokens = 0;
  while (start - 1 > previousStart) {
    const lineTokens = estimateTokens(document.lines[start - 1] ?? "");
    if (tokens + lineTokens > budget) break;
    tokens += lineTokens;
    start -= 1;
  }
  return start;
}

function fenceEndAt(document: ExtractedDocument, line: number): number | undefined {
  const fence = document.codeFences.find((candidate) => candidate.startLine === line);
  return fence?.endLine;
}

function rangeTokens(document: ExtractedDocument, lineStart: number, lineEnd: number): number {
  let total = 0;
  for (let index = lineStart; index <= lineEnd; index += 1) total += estimateTokens(document.lines[index] ?? "");
  return total;
}

/** When a split lands inside a Markdown table, repeat its header rows (PRD FR-004). */
function tableHeaderFor(document: ExtractedDocument, line: number): readonly string[] {
  if (!(document.lines[line] ?? "").trimStart().startsWith("|")) return [];
  let headerLine = line;
  while (headerLine - 1 >= 0 && (document.lines[headerLine - 1] ?? "").trimStart().startsWith("|")) headerLine -= 1;
  if (headerLine === line) return [];
  const header = document.lines[headerLine] ?? "";
  const divider = document.lines[headerLine + 1] ?? "";
  return /^\s*\|[\s:|-]+\|?\s*$/u.test(divider) ? [header, divider] : [header];
}


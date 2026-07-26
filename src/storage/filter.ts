import type { ChunkRecord, RowFilter, SourceRecord } from "./contracts";

/**
 * Structured filter evaluation (PRD 21.4).
 *
 * Filters are typed predicates over chunk rows; user input never becomes a
 * string expression. Folder and path comparisons run on normalized
 * lowercase forms.
 */

export function rowMatchesFilter(row: ChunkRecord, filter: RowFilter | undefined): boolean {
  if (filter === undefined) return true;
  if (filter.sourceIds?.includes(row.sourceId) === false) return false;
  if (filter.excludeSourceIds?.includes(row.sourceId) === true) return false;
  if (filter.extensions !== undefined && filter.extensions.length > 0 && !filter.extensions.includes(row.extension)) return false;
  if (filter.mtimeBefore !== undefined && row.mtime >= filter.mtimeBefore) return false;
  if (filter.mtimeAfter !== undefined && row.mtime <= filter.mtimeAfter) return false;
  if (filter.folders !== undefined && filter.folders.length > 0 && !folderMatches(row.folderNorm, filter.folders)) return false;
  if (filter.pathContains !== undefined && filter.pathContains.length > 0) {
    if (!filter.pathContains.every((needle) => row.pathNorm.includes(needle.toLowerCase()))) return false;
  }
  if (filter.tags !== undefined && filter.tags.length > 0 && !tagsMatch(row.tags, filter.tags)) return false;
  return true;
}

export function sourceMatchesFilter(source: SourceRecord, filter: RowFilter | undefined): boolean {
  if (filter === undefined) return true;
  if (filter.sourceIds?.includes(source.sourceId) === false) return false;
  if (filter.excludeSourceIds?.includes(source.sourceId) === true) return false;
  if (filter.extensions !== undefined && filter.extensions.length > 0 && !filter.extensions.includes(source.extension)) return false;
  if (filter.mtimeBefore !== undefined && source.mtime >= filter.mtimeBefore) return false;
  if (filter.mtimeAfter !== undefined && source.mtime <= filter.mtimeAfter) return false;
  if (filter.folders !== undefined && filter.folders.length > 0 && !folderMatches(source.folderNorm, filter.folders)) return false;
  if (filter.pathContains !== undefined && filter.pathContains.length > 0) {
    if (!filter.pathContains.every((needle) => source.pathNorm.includes(needle.toLowerCase()))) return false;
  }
  if (filter.tags !== undefined && filter.tags.length > 0 && !tagsMatch(source.tags, filter.tags)) return false;
  return true;
}

function folderMatches(folderNorm: string, folders: readonly string[]): boolean {
  return folders.some((candidate) => {
    const normalized = candidate.toLowerCase().replace(/^\/+|\/+$/gu, "");
    return folderNorm === normalized || folderNorm.startsWith(`${normalized}/`) || (normalized === "" && folderNorm === "");
  });
}

function tagsMatch(actual: readonly string[], wanted: readonly string[]): boolean {
  const actualLower = actual.map((tag) => tag.toLowerCase());
  return wanted
    .map((tag) => tag.toLowerCase().replace(/^#/u, ""))
    .every((tag) => actualLower.some((candidate) => candidate === tag || candidate.startsWith(`${tag}/`)));
}

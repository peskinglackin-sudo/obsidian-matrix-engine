/**
 * Identifier and path analysis (PRD 8.4.6).
 *
 * Code identifiers, paths, URLs, and error codes keep their own rules so
 * `_`, `-`, `.`, `/` and `::` survive. Expansion variants let
 * `IndexProfileService` match `index_profile_service` and the split words.
 */

const IDENTIFIER_TOKEN = /[\p{L}_][\p{L}\p{N}_]*(?:(?:::|[./-])[\p{L}\p{N}_]+)*/gu;
const CAMEL_BOUNDARY = /(?<=\p{Ll}|\p{N})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/gu;
const SEPARATORS = /::|[./\-_]/gu;

/** Split one identifier-like token into its word parts (camel, snake, kebab, path, scope). */
export function splitIdentifier(token: string): readonly string[] {
  const separated = token.split(SEPARATORS).filter((part) => part.length > 0);
  const parts: string[] = [];
  for (const part of separated) {
    for (const word of part.split(CAMEL_BOUNDARY)) {
      if (word.length > 0) parts.push(word);
    }
  }
  return parts;
}

/**
 * Expansion variants for indexing, all lowercased: the original token, its
 * word parts, the joined form, and snake/kebab forms (PRD 8.4.6).
 */
export function expandIdentifier(token: string): readonly string[] {
  const parts = splitIdentifier(token);
  const lowerParts = parts.map((part) => part.toLowerCase());
  const variants = new Set<string>([token.toLowerCase()]);
  if (parts.length >= 2) {
    for (const part of lowerParts) variants.add(part);
    variants.add(lowerParts.join(""));
    variants.add(lowerParts.join("_"));
    variants.add(lowerParts.join("-"));
    for (const segment of token.split(SEPARATORS)) {
      const segmentParts = segment.split(CAMEL_BOUNDARY).filter((part) => part.length > 0);
      if (segmentParts.length >= 2) variants.add(segmentParts.join("").toLowerCase());
    }
  }
  return [...variants];
}

/** Whether the token deserves identifier expansion at all. */
export function isCompoundIdentifier(token: string): boolean {
  return splitIdentifier(token).length >= 2;
}

/** Extract identifier-like tokens from text and expand compound ones. */
export function extractIdentifierTerms(text: string): readonly string[] {
  const terms: string[] = [];
  for (const match of text.matchAll(IDENTIFIER_TOKEN)) {
    const token = match[0];
    if (!isCompoundIdentifier(token)) continue;
    terms.push(...expandIdentifier(token));
  }
  return terms;
}

/**
 * Path analysis: directory segments, filename, stem, extension, and the
 * full normalized path (PRD 8.4.6).
 */
export function analyzePath(path: string): readonly string[] {
  const normalized = path.replace(/\\/gu, "/").replace(/^\/+/u, "").toLowerCase();
  if (normalized.length === 0) return [];
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  const terms = new Set<string>(segments);
  const filename = segments.at(-1);
  if (filename !== undefined) {
    const dot = filename.lastIndexOf(".");
    if (dot > 0) {
      terms.add(filename.slice(0, dot));
      terms.add(filename.slice(dot + 1));
    }
  }
  terms.add(normalized);
  return [...terms];
}

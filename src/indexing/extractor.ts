/**
 * Markdown structure extraction (PRD FR-003).
 *
 * Extracts frontmatter, headings with paths, links/embeds, inline tags,
 * tasks, and code fences with line ranges. Fenced code is never parsed for
 * headings or tags. Raw content is left untouched; consumers keep raw text
 * for display and exact verification.
 */

export type ExtractedHeading = Readonly<{ level: number; text: string; line: number }>;
export type ExtractedLink = Readonly<{ target: string; display?: string; line: number; embed: boolean }>;
export type ExtractedTask = Readonly<{ text: string; checked: boolean; line: number }>;
export type CodeFence = Readonly<{ startLine: number; endLine: number; language?: string }>;

export type Frontmatter = Readonly<{
  fields: Readonly<Record<string, string | readonly string[]>>;
  title?: string;
  aliases: readonly string[];
  tags: readonly string[];
  /** Last line (0-based) of the closing delimiter; -1 when absent. */
  endLine: number;
}>;

export type ExtractedDocument = Readonly<{
  frontmatter: Frontmatter;
  title: string;
  headings: readonly ExtractedHeading[];
  links: readonly ExtractedLink[];
  tags: readonly string[];
  tasks: readonly ExtractedTask[];
  codeFences: readonly CodeFence[];
  lines: readonly string[];
}>;

const HEADING_LINE = /^(#{1,6})\s+(.*)$/u;
const FENCE_LINE = /^(?:```|~~~)(.*)$/u;
const WIKILINK = /(!?)\[\[([^\][|#]+)(?:#[^\][|]*)?(?:\|([^\][]*))?\]\]/gu;
const MARKDOWN_LINK = /(!?)\[([^\][]*)\]\(([^()\s]+)(?:\s+"[^"]*")?\)/gu;
const INLINE_TAG = /(?:^|[\s(（])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
const TASK_LINE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/u;

export function extractDocument(raw: string, fallbackTitle: string): ExtractedDocument {
  const lines = raw.split("\n");
  const frontmatter = parseFrontmatter(lines);

  const headings: ExtractedHeading[] = [];
  const links: ExtractedLink[] = [];
  const tasks: ExtractedTask[] = [];
  const codeFences: CodeFence[] = [];
  const inlineTags: string[] = [];

  let fenceStart = -1;
  let fenceLanguage: string | undefined;
  for (let index = frontmatter.endLine + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMatch = FENCE_LINE.exec(line.trimStart());
    if (fenceMatch !== null) {
      if (fenceStart < 0) {
        fenceStart = index;
        const language = (fenceMatch[1] ?? "").trim();
        fenceLanguage = language.length > 0 ? language.split(/\s+/u)[0] : undefined;
      } else {
        codeFences.push(Object.freeze({ startLine: fenceStart, endLine: index, ...(fenceLanguage === undefined ? {} : { language: fenceLanguage }) }));
        fenceStart = -1;
        fenceLanguage = undefined;
      }
      continue;
    }
    if (fenceStart >= 0) continue;

    const headingMatch = HEADING_LINE.exec(line);
    if (headingMatch !== null) {
      headings.push(Object.freeze({ level: headingMatch[1]?.length ?? 1, text: (headingMatch[2] ?? "").trim(), line: index }));
    }
    const taskMatch = TASK_LINE.exec(line);
    if (taskMatch !== null) {
      tasks.push(Object.freeze({ text: (taskMatch[2] ?? "").trim(), checked: taskMatch[1] !== " ", line: index }));
    }
    collectLinks(line, index, links);
    for (const match of line.matchAll(INLINE_TAG)) {
      const tag = match[1];
      if (tag !== undefined && !/^\d+$/u.test(tag)) inlineTags.push(tag);
    }
  }
  if (fenceStart >= 0) {
    codeFences.push(Object.freeze({ startLine: fenceStart, endLine: lines.length - 1, ...(fenceLanguage === undefined ? {} : { language: fenceLanguage }) }));
  }

  const firstH1 = headings.find(({ level }) => level === 1);
  const tags = [...new Set([...frontmatter.tags, ...inlineTags])];

  return Object.freeze({
    frontmatter,
    title: frontmatter.title ?? firstH1?.text ?? fallbackTitle,
    headings: Object.freeze(headings),
    links: Object.freeze(links),
    tags: Object.freeze(tags),
    tasks: Object.freeze(tasks),
    codeFences: Object.freeze(codeFences),
    lines: Object.freeze(lines)
  });
}

function collectLinks(line: string, index: number, out: ExtractedLink[]): void {
  for (const match of line.matchAll(WIKILINK)) {
    const target = (match[2] ?? "").trim();
    if (target.length === 0) continue;
    const display = (match[3] ?? "").trim();
    out.push(Object.freeze({ target, ...(display.length > 0 ? { display } : {}), line: index, embed: match[1] === "!" }));
  }
  for (const match of line.matchAll(MARKDOWN_LINK)) {
    const target = (match[3] ?? "").trim();
    if (target.length === 0 || target.startsWith("#")) continue;
    const display = (match[2] ?? "").trim();
    out.push(Object.freeze({ target, ...(display.length > 0 ? { display } : {}), line: index, embed: match[1] === "!" }));
  }
}

function parseFrontmatter(lines: readonly string[]): Frontmatter {
  const empty: Frontmatter = Object.freeze({ fields: Object.freeze({}), aliases: Object.freeze([]), tags: Object.freeze([]), endLine: -1 });
  if (lines[0]?.trim() !== "---") return empty;
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? "").trim();
    if (trimmed === "---" || trimmed === "...") {
      end = index;
      break;
    }
  }
  if (end < 0) return empty;

  const fields: Record<string, string | string[]> = {};
  let activeListKey: string | undefined;
  for (let index = 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    const listItem = /^\s+-\s*(.*)$/u.exec(line);
    if (listItem !== null && activeListKey !== undefined) {
      const value = unquote((listItem[1] ?? "").trim());
      const existing = fields[activeListKey];
      if (Array.isArray(existing)) existing.push(value);
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line);
    if (pair === null) {
      activeListKey = undefined;
      continue;
    }
    const key = pair[1] ?? "";
    const value = (pair[2] ?? "").trim();
    if (value.length === 0) {
      fields[key] = [];
      activeListKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      fields[key] = value.slice(1, -1).split(",").map((item) => unquote(item.trim())).filter((item) => item.length > 0);
      activeListKey = undefined;
    } else {
      fields[key] = unquote(value);
      activeListKey = undefined;
    }
  }

  const title = typeof fields.title === "string" ? fields.title : undefined;
  return Object.freeze({
    fields: Object.freeze(fields),
    ...(title === undefined ? {} : { title }),
    aliases: Object.freeze(asList(fields.aliases ?? fields.alias)),
    tags: Object.freeze(asList(fields.tags ?? fields.tag).map((tag) => tag.replace(/^#/u, ""))),
    endLine: end
  });
}

function asList(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  return [...value];
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

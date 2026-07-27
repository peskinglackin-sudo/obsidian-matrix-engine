import { describe, expect, it } from "vitest";

import { chunkDocument, estimateTokens, type ChunkOptions } from "../src/indexing/chunker";
import { extractDocument } from "../src/indexing/extractor";
import {
  computeEmbeddingInputHash,
  computeExtractionHash,
  computeLexicalInputHash,
  computeMetadataProjectionHash,
  computeRawContentHash,
  computeRowId,
  documentTemplateVariables,
  renderTemplate
} from "../src/indexing/hashes";

const OPTIONS: ChunkOptions = { chunkSizeTokens: 512, chunkOverlapTokens: 32, minChunkTokens: 8, includeCode: true };

const SAMPLE = `---
title: Design Notes
aliases: [design, notes]
tags: [ai, retrieval]
status: draft
---

Intro paragraph before any heading.

# Overview

General overview text with a [[Linked Note|display]] link and a #search tag.

## Details

- [ ] open task item
- [x] finished task

\`\`\`ts
# not a heading inside code
const x = 1;
\`\`\`

## 中文段落

向量数据库设计说明。
`;

describe("markdown extraction (FR-003)", () => {
  const document = extractDocument(SAMPLE, "fallback");

  it("parses frontmatter title, aliases, tags, and retained fields", () => {
    expect(document.frontmatter.title).toBe("Design Notes");
    expect(document.frontmatter.aliases).toEqual(["design", "notes"]);
    expect(document.frontmatter.tags).toEqual(["ai", "retrieval"]);
    expect(document.frontmatter.fields.status).toBe("draft");
    expect(document.title).toBe("Design Notes");
  });

  it("collects headings with levels and lines", () => {
    expect(document.headings.map(({ text, level }) => `${String(level)}:${text}`)).toEqual(["1:Overview", "2:Details", "2:中文段落"]);
  });

  it("does not treat fenced lines as headings", () => {
    expect(document.headings.some(({ text }) => text.includes("not a heading"))).toBe(false);
  });

  it("captures wikilinks with display text", () => {
    expect(document.links).toContainEqual(expect.objectContaining({ target: "Linked Note", display: "display", embed: false }));
  });

  it("merges frontmatter and inline tags", () => {
    expect(document.tags).toEqual(expect.arrayContaining(["ai", "retrieval", "search"]));
  });

  it("collects tasks with checked state", () => {
    expect(document.tasks).toEqual([
      expect.objectContaining({ text: "open task item", checked: false }),
      expect.objectContaining({ text: "finished task", checked: true })
    ]);
  });

  it("records code fence ranges and language", () => {
    expect(document.codeFences).toHaveLength(1);
    expect(document.codeFences[0]?.language).toBe("ts");
  });

  it("parses block-style frontmatter lists", () => {
    const blockDoc = extractDocument("---\ntags:\n  - alpha\n  - beta\n---\nBody", "x");
    expect(blockDoc.frontmatter.tags).toEqual(["alpha", "beta"]);
  });

  it("falls back to first H1 then filename for the title", () => {
    expect(extractDocument("# Heading Title\nbody", "file").title).toBe("Heading Title");
    expect(extractDocument("plain body", "file").title).toBe("file");
  });
});

describe("token estimation", () => {
  it("counts CJK characters as whole tokens", () => {
    expect(estimateTokens("向量数据库")).toBe(5);
  });

  it("counts latin text at roughly four chars per token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});

describe("heading-block chunking (FR-004)", () => {
  const document = extractDocument(SAMPLE, "fallback");
  const chunks = chunkDocument(document, OPTIONS);

  it("creates a preamble chunk before the first heading", () => {
    expect(chunks[0]?.blockType).toBe("preamble");
    expect(chunks[0]?.text).toContain("Intro paragraph");
    expect(chunks[0]?.headingPath).toEqual([]);
  });

  it("builds heading paths root to leaf", () => {
    const details = chunks.find((chunk) => chunk.structuralAnchor.includes("Details"));
    expect(details?.headingPath).toEqual(["Overview", "Details"]);
  });

  it("assigns stable structural anchors and ordinals", () => {
    expect(chunks.map(({ ordinal }) => ordinal)).toEqual(chunks.map((_, index) => index));
    const anchors = chunks.map(({ structuralAnchor }) => structuralAnchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("computes line and char ranges that reproduce the raw slice", () => {
    for (const chunk of chunks) {
      const sliced = SAMPLE.slice(chunk.charStart, chunk.charEnd);
      const firstLine = sliced.split("\n")[0] ?? "";
      expect(chunk.text.startsWith(firstLine.trim())).toBe(true);
    }
  });

  it("splits oversized sections within the token budget and marks them", () => {
    const bigBody = Array.from({ length: 200 }, (_, index) => `Sentence number ${String(index)} about incremental vector indexing strategies.`).join("\n");
    const bigDocument = extractDocument(`# Big\n${bigBody}`, "big");
    const smallOptions: ChunkOptions = { ...OPTIONS, chunkSizeTokens: 128, chunkOverlapTokens: 16 };
    const bigChunks = chunkDocument(bigDocument, smallOptions);
    expect(bigChunks.length).toBeGreaterThan(1);
    expect(bigChunks.every(({ blockType }) => blockType === "split")).toBe(true);
    for (const chunk of bigChunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(smallOptions.chunkSizeTokens + smallOptions.chunkOverlapTokens + 32);
    }
  });

  it("merges undersized adjacent sections", () => {
    const tinyDoc = extractDocument("# A\nx\n# B\ny\n# C\nlonger content sentence here", "t");
    const merged = chunkDocument(tinyDoc, { ...OPTIONS, minChunkTokens: 50 });
    expect(merged.length).toBeLessThan(3);
    expect(merged.some(({ blockType }) => blockType === "merged")).toBe(true);
  });

  it("repeats table headers when splitting inside a table", () => {
    const rows = Array.from({ length: 120 }, (_, index) => `| row ${String(index)} | value with some longer text ${String(index)} |`).join("\n");
    const tableDoc = extractDocument(`# Table\n| col a | col b |\n| --- | --- |\n${rows}`, "table");
    const tableChunks = chunkDocument(tableDoc, { ...OPTIONS, chunkSizeTokens: 96, chunkOverlapTokens: 0 });
    expect(tableChunks.length).toBeGreaterThan(1);
    const continuation = tableChunks[1];
    expect(continuation?.text.split("\n")[0]).toBe("| col a | col b |");
  });

  it("keeps code fences out when includeCode is false", () => {
    const noCode = chunkDocument(document, { ...OPTIONS, includeCode: false });
    expect(noCode.some(({ text }) => text.includes("const x"))).toBe(false);
  });

  it("does not split inside a code fence when budget allows", () => {
    const code = Array.from({ length: 30 }, (_, index) => `const value${String(index)} = compute(${String(index)});`).join("\n");
    const fenceDoc = extractDocument(`# Code\nIntro text line.\n\`\`\`ts\n${code}\n\`\`\`\nAfter text.`, "code");
    const fenceChunks = chunkDocument(fenceDoc, { ...OPTIONS, chunkSizeTokens: 160, chunkOverlapTokens: 0 });
    for (const chunk of fenceChunks) {
      const opens = chunk.text.split("\n").filter((line) => line.startsWith("```")).length;
      expect(opens % 2).toBe(0);
    }
  });
});

describe("layered hashes (PRD 14.4)", () => {
  it("keeps raw hash independent of extraction settings", () => {
    expect(computeRawContentHash("abc")).toBe(computeRawContentHash("abc"));
    expect(computeRawContentHash("abc")).not.toBe(computeRawContentHash("abd"));
  });

  it("changes extraction hash when chunking output changes", () => {
    const document = extractDocument(SAMPLE, "fallback");
    const chunks = chunkDocument(document, OPTIONS);
    const alternate = chunkDocument(document, { ...OPTIONS, chunkSizeTokens: 64 });
    const base = computeExtractionHash({ extractionVersion: 1, chunkStrategy: "heading_blocks", chunks });
    expect(computeExtractionHash({ extractionVersion: 1, chunkStrategy: "heading_blocks", chunks })).toBe(base);
    expect(computeExtractionHash({ extractionVersion: 2, chunkStrategy: "heading_blocks", chunks })).not.toBe(base);
    if (alternate.length !== chunks.length) {
      expect(computeExtractionHash({ extractionVersion: 1, chunkStrategy: "heading_blocks", chunks: alternate })).not.toBe(base);
    }
  });

  it("scopes metadata projection to metadata only", () => {
    const base = {
      path: "a/b.md",
      title: "T",
      aliases: ["x"],
      tags: ["t"],
      frontmatterFields: { status: "draft" },
      mtime: 1,
      size: 10
    };
    expect(computeMetadataProjectionHash(base)).toBe(computeMetadataProjectionHash({ ...base }));
    expect(computeMetadataProjectionHash({ ...base, tags: ["other"] })).not.toBe(computeMetadataProjectionHash(base));
  });

  it("ties lexical input hash to analyzer identity", () => {
    const base = {
      analyzerId: "unicode-multilingual",
      analyzerVersion: 1,
      lexicalFingerprint: "fp",
      chunkText: "text",
      headingPath: ["H"],
      title: "T",
      tags: ["t"],
      path: "p.md"
    };
    expect(computeLexicalInputHash({ ...base, analyzerVersion: 2 })).not.toBe(computeLexicalInputHash(base));
  });

  it("renders templates and reports used/missing variables", () => {
    const rendered = renderTemplate("{title}\n{heading_path}\n{content}\n{unknown_var}", documentTemplateVariables({
      title: "T",
      headingPath: ["A", "B"],
      content: "body",
      path: "p.md",
      tags: []
    }));
    expect(rendered.text).toBe("T\nA > B\nbody\n");
    expect(rendered.usedVariables).toEqual(expect.arrayContaining(["title", "heading_path", "content"]));
    expect(rendered.missingVariables).toEqual(["unknown_var"]);
  });

  it("derives embedding input hash from the final rendered text (PRD scenario 4.2#8)", () => {
    const variables = documentTemplateVariables({ title: "T", headingPath: [], content: "body", path: "a.md", tags: [] });
    const withPath = renderTemplate("{path} {content}", variables);
    const withoutPath = renderTemplate("{content}", variables);
    expect(computeEmbeddingInputHash(withPath.text)).not.toBe(computeEmbeddingInputHash(withoutPath.text));
    expect(computeEmbeddingInputHash(withPath.text)).toBe(computeEmbeddingInputHash(withPath.text));
  });

  it("produces stable row ids from artifact, source, anchor, ordinal", () => {
    const id = computeRowId({ artifactId: "a", sourceId: "s", structuralAnchor: "h:X", chunkOrdinal: 0 });
    expect(id).toHaveLength(32);
    expect(computeRowId({ artifactId: "a", sourceId: "s", structuralAnchor: "h:X", chunkOrdinal: 0 })).toBe(id);
    expect(computeRowId({ artifactId: "a", sourceId: "s", structuralAnchor: "h:X", chunkOrdinal: 1 })).not.toBe(id);
  });
});

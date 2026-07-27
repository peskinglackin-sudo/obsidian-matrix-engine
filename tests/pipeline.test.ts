import { describe, expect, it, vi } from "vitest";

import type { BatchItem, BatchOutcome } from "../src/providers/batcher";
import { createDefaultSettings } from "../src/settings/defaults";
import { MemoryStorageAdapter } from "../src/storage/adapter";
import { LocalArtifactStore } from "../src/storage/local-store";
import { VaultEventCoalescer, type CoalescedTask } from "../src/pipeline/coalescer";
import { IndexCoordinator, type VaultPort } from "../src/pipeline/coordinator";
import { buildSourceRows, pathInScope, type FileSnapshot } from "../src/pipeline/row-builder";

const NOW = 1700000000000;

function corpusProfile() {
  const corpus = createDefaultSettings().corpusProfiles[0];
  if (corpus === undefined) throw new Error("missing corpus");
  return corpus;
}

function lexicalProfile() {
  const lexical = createDefaultSettings().lexicalProfiles[0];
  if (lexical === undefined) throw new Error("missing lexical");
  return lexical;
}

function buildContext(sourceId: string, revision: number) {
  return {
    artifactId: "artifact-a",
    sourceId,
    revision,
    corpus: corpusProfile(),
    lexical: lexicalProfile(),
    documentTemplate: "{title}\n{heading_path}\n{content}",
    lexicalFingerprint: "lex-fp",
    now: NOW
  };
}

function snapshot(path: string, content: string, mtime = NOW): FileSnapshot {
  return { path, content, ctime: NOW, mtime, size: content.length };
}

class FakeVault implements VaultPort {
  readonly files = new Map<string, string>();

  listPaths(): Promise<readonly string[]> {
    return Promise.resolve([...this.files.keys()]);
  }

  read(path: string): Promise<FileSnapshot | null> {
    const content = this.files.get(path);
    return Promise.resolve(content === undefined ? null : snapshot(path, content));
  }
}

function newStore(): LocalArtifactStore {
  return new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp", dimension: 2, adapter: new MemoryStorageAdapter(), now: () => NOW });
}

function newCoordinator(store: LocalArtifactStore, vault: FakeVault, options?: Partial<{ embeddingEnabled: boolean; embedder: { run: (items: readonly BatchItem[]) => Promise<BatchOutcome> } }>) {
  let counter = 0;
  return new IndexCoordinator({
    store,
    vault,
    config: () => ({
      corpus: corpusProfile(),
      lexical: lexicalProfile(),
      documentTemplate: "{title}\n{heading_path}\n{content}",
      lexicalFingerprint: "lex-fp",
      embeddingEnabled: options?.embeddingEnabled ?? false
    }),
    ...(options?.embedder === undefined ? {} : { embedder: options.embedder }),
    now: () => NOW,
    generateSourceId: () => `src-${String(counter += 1)}`,
    persistDebounceMs: 1
  });
}

describe("VaultEventCoalescer (PRD 14.3, FR-002)", () => {
  function collect(): { tasks: CoalescedTask[][]; coalescer: VaultEventCoalescer } {
    const tasks: CoalescedTask[][] = [];
    const coalescer = new VaultEventCoalescer({ debounceMs: 10000, onFlush: (flushed) => tasks.push([...flushed]) });
    return { tasks, coalescer };
  }

  it("merges repeated modifies into one upsert with the latest generation", () => {
    const { tasks, coalescer } = collect();
    coalescer.push({ kind: "modify", path: "a.md" });
    coalescer.push({ kind: "modify", path: "a.md" });
    coalescer.push({ kind: "modify", path: "a.md" });
    coalescer.flushNow();
    expect(tasks[0]).toEqual([{ kind: "upsert", path: "a.md", generation: 3 }]);
    coalescer.close();
  });

  it("collapses rename chains a->b->c into a->c", () => {
    const { tasks, coalescer } = collect();
    coalescer.push({ kind: "rename", path: "b.md", oldPath: "a.md" });
    coalescer.push({ kind: "rename", path: "c.md", oldPath: "b.md" });
    coalescer.flushNow();
    expect(tasks[0]).toHaveLength(1);
    expect(tasks[0]?.[0]).toMatchObject({ kind: "rename", path: "c.md", oldPath: "a.md", contentDirty: false });
    coalescer.close();
  });

  it("marks renamed files dirty when they were also modified", () => {
    const { tasks, coalescer } = collect();
    coalescer.push({ kind: "modify", path: "a.md" });
    coalescer.push({ kind: "rename", path: "b.md", oldPath: "a.md" });
    coalescer.flushNow();
    expect(tasks[0]?.[0]).toMatchObject({ kind: "rename", path: "b.md", oldPath: "a.md", contentDirty: true });
    coalescer.close();
  });

  it("turns rename-then-delete into a delete of the origin", () => {
    const { tasks, coalescer } = collect();
    coalescer.push({ kind: "rename", path: "b.md", oldPath: "a.md" });
    coalescer.push({ kind: "delete", path: "b.md" });
    coalescer.flushNow();
    expect(tasks[0]).toContainEqual(expect.objectContaining({ kind: "delete", path: "a.md" }));
    expect(tasks[0]?.some((task) => task.kind === "rename")).toBe(false);
    coalescer.close();
  });

  it("delete followed by create becomes an upsert", () => {
    const { tasks, coalescer } = collect();
    coalescer.push({ kind: "delete", path: "a.md" });
    coalescer.push({ kind: "create", path: "a.md" });
    coalescer.flushNow();
    expect(tasks[0]).toEqual([{ kind: "upsert", path: "a.md", generation: 2 }]);
    coalescer.close();
  });

  it("flushes after the debounce window", async () => {
    const flushed: CoalescedTask[][] = [];
    const coalescer = new VaultEventCoalescer({ debounceMs: 5, onFlush: (tasks) => flushed.push([...tasks]) });
    coalescer.push({ kind: "modify", path: "a.md" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(flushed).toHaveLength(1);
    coalescer.close();
  });
});

describe("row builder (PRD 13/14.4)", () => {
  const content = `---
title: Sample Note
tags: [ai]
aliases: [sample]
---

# Overview

Vector database design notes with IndexProfileService.

## 中文

向量数据库设计。
`;

  it("builds a complete source record", () => {
    const built = buildSourceRows(snapshot("notes/sample.md", content), buildContext("s1", 1));
    expect(built.source.titleRaw).toBe("Sample Note");
    expect(built.source.tags).toContain("ai");
    expect(built.source.aliases).toEqual(["sample"]);
    expect(built.source.extension).toBe("md");
    expect(built.source.folderRaw).toBe("notes");
    expect(built.source.headings).toEqual(["Overview", "中文"]);
    expect(built.source.rawContentHash).toHaveLength(64);
  });

  it("populates chunk lexical fields and hashes", () => {
    const built = buildSourceRows(snapshot("notes/sample.md", content), buildContext("s1", 1));
    expect(built.chunks.length).toBeGreaterThan(0);
    const chunk = built.chunks.find(({ textRaw }) => textRaw.includes("向量数据库"));
    expect(chunk).toBeDefined();
    expect(chunk?.lexicalNgrams).toContain("向量");
    expect(chunk?.titleTerms).toContain("sample");
    expect(chunk?.aliasTerms).toContain("sample");
    expect(chunk?.tagTerms).toContain("ai");
    expect(chunk?.pathTerms).toContain("notes/sample.md");
    expect(chunk?.embeddingInputHash).toHaveLength(64);
    const identifierChunk = built.chunks.find(({ textRaw }) => textRaw.includes("IndexProfileService"));
    expect(identifierChunk?.identifierTerms).toContain("index_profile_service");
  });

  it("keeps embedding inputs aligned with chunks and includes title/heading context", () => {
    const built = buildSourceRows(snapshot("notes/sample.md", content), buildContext("s1", 1));
    expect(built.embeddingInputs.map(({ rowId }) => rowId)).toEqual(built.chunks.map(({ rowId }) => rowId));
    const first = built.embeddingInputs[0];
    expect(first?.text).toContain("Sample Note");
    expect(first?.estimatedTokens).toBeGreaterThan(0);
  });

  it("gives stable row ids across rebuilds of identical content", () => {
    const a = buildSourceRows(snapshot("notes/sample.md", content), buildContext("s1", 1));
    const b = buildSourceRows(snapshot("notes/sample.md", content), buildContext("s1", 2));
    expect(a.chunks.map(({ rowId }) => rowId)).toEqual(b.chunks.map(({ rowId }) => rowId));
    expect(a.chunks.map(({ embeddingInputHash }) => embeddingInputHash)).toEqual(b.chunks.map(({ embeddingInputHash }) => embeddingInputHash));
  });

  it("filters scope by folders, globs, and file types (FR-001)", () => {
    const corpus = { includes: ["notes"], excludes: ["notes/private"], fileTypes: ["md" as const] };
    expect(pathInScope("notes/a.md", corpus)).toBe(true);
    expect(pathInScope("notes/private/a.md", corpus)).toBe(false);
    expect(pathInScope("other/a.md", corpus)).toBe(false);
    expect(pathInScope("notes/a.txt", corpus)).toBe(false);
    expect(pathInScope("archive/2026/a.md", { includes: ["archive/*"], excludes: [], fileTypes: ["md" as const] })).toBe(true);
    expect(pathInScope("elsewhere/2026/a.md", { includes: ["archive/*"], excludes: [], fileTypes: ["md" as const] })).toBe(false);
    expect(pathInScope("anything/a.md", { includes: [], excludes: [], fileTypes: ["md" as const, "txt" as const] })).toBe(true);
  });
});

describe("IndexCoordinator (PRD 14)", () => {
  it("performs a full scan and indexes in-scope files", async () => {
    const vault = new FakeVault();
    vault.files.set("a.md", "# A\ncontent about vectors");
    vault.files.set("b.md", "# B\nmore content here");
    vault.files.set("ignored.pdf", "binary");
    const store = newStore();
    const coordinator = newCoordinator(store, vault);
    const report = await coordinator.fullScan();
    expect(report.scanned).toBe(2);
    expect(report.indexed).toBe(2);
    expect(store.stats().sources).toBe(2);
    await coordinator.close();
  });

  it("skips unchanged files on rescan and removes vanished sources", async () => {
    const vault = new FakeVault();
    vault.files.set("a.md", "# A\ncontent");
    const store = newStore();
    const coordinator = newCoordinator(store, vault);
    await coordinator.fullScan();
    const second = await coordinator.fullScan();
    expect(second.skipped).toBe(1);
    vault.files.delete("a.md");
    const third = await coordinator.fullScan();
    expect(third.removed).toBe(1);
    expect(store.stats().sources).toBe(0);
    await coordinator.close();
  });

  it("processes upsert, rename (keeping source id), and delete tasks", async () => {
    const vault = new FakeVault();
    vault.files.set("a.md", "# A\noriginal content");
    const store = newStore();
    const coordinator = newCoordinator(store, vault);
    await coordinator.fullScan();
    const originalId = store.getSourceByPath("a.md")?.sourceId;
    expect(originalId).toBeDefined();

    vault.files.delete("a.md");
    vault.files.set("renamed.md", "# A\noriginal content");
    coordinator.enqueue([{ kind: "rename", path: "renamed.md", oldPath: "a.md", generation: 1, contentDirty: false }]);
    await waitForIdle(coordinator);
    expect(store.getSourceByPath("renamed.md")?.sourceId).toBe(originalId);
    expect(store.getSourceByPath("a.md")).toBeUndefined();

    vault.files.set("renamed.md", "# A\nupdated content now");
    coordinator.enqueue([{ kind: "upsert", path: "renamed.md", generation: 2 }]);
    await waitForIdle(coordinator);
    expect(store.chunksForSource(originalId ?? "").some(({ textRaw }) => textRaw.includes("updated"))).toBe(true);

    coordinator.enqueue([{ kind: "delete", path: "renamed.md", generation: 3 }]);
    await waitForIdle(coordinator);
    expect(store.getSourceByPath("renamed.md")).toBeUndefined();
    await coordinator.close();
  });

  it("abandons superseded generations (latest-wins)", async () => {
    const vault = new FakeVault();
    vault.files.set("a.md", "# A\nfinal content");
    const store = newStore();
    const coordinator = newCoordinator(store, vault);
    coordinator.enqueue([
      { kind: "upsert", path: "a.md", generation: 1 },
      { kind: "upsert", path: "a.md", generation: 2 }
    ]);
    await waitForIdle(coordinator);
    const source = store.getSourceByPath("a.md");
    expect(source).toBeDefined();
    expect(store.manifestFor(source?.sourceId ?? "")?.indexedRevision).toBeLessThanOrEqual(2);
    expect(store.chunksForSource(source?.sourceId ?? "").length).toBeGreaterThan(0);
    await coordinator.close();
  });

  it("embeds new chunks and carries embeddings for unchanged inputs", async () => {
    const vault = new FakeVault();
    const stable = "# A\nThis stable section keeps enough sentence content to stand alone as its own chunk without merging into neighbors at all.";
    vault.files.set("a.md", `${stable}\n\n# B\nThe changing section version one also carries plenty of words so both heading blocks stay separate chunks in the index.`);
    const store = newStore();
    const embedCalls: string[][] = [];
    const embedder = {
      run: (items: readonly { id: string; text: string; estimatedTokens: number }[]) => {
        embedCalls.push(items.map(({ id }) => id));
        return Promise.resolve({
          embedded: new Map(items.map(({ id }) => [id, new Float32Array([1, 0])])),
          failed: new Map<string, never>(),
          requests: 1
        });
      }
    };
    const coordinator = newCoordinator(store, vault, { embeddingEnabled: true, embedder });
    await coordinator.fullScan();
    const firstCallCount = embedCalls.length;
    expect(store.stats().chunksWithEmbedding).toBeGreaterThan(0);

    vault.files.set("a.md", `${stable}\n\n# B\nThe changing section version two still carries plenty of words so both heading blocks stay separate chunks in the index.`);
    coordinator.enqueue([{ kind: "upsert", path: "a.md", generation: 5 }]);
    await waitForIdle(coordinator);
    const newlyEmbedded = embedCalls.slice(firstCallCount).flat();
    const stableChunk = store.chunksForSource(store.getSourceByPath("a.md")?.sourceId ?? "").find(({ textRaw }) => textRaw.includes("stable"));
    expect(stableChunk?.embedding).toBeDefined();
    expect(newlyEmbedded).not.toContain(stableChunk?.rowId);
    expect(newlyEmbedded.length).toBeGreaterThan(0);
    await coordinator.close();
  });

  it("records dead letters for failed embeddings and retries them (FR-061)", async () => {
    const vault = new FakeVault();
    vault.files.set("a.md", "# A\nsome content");
    const store = newStore();
    let failNext = true;
    const embedder = {
      run: (items: readonly { id: string; text: string; estimatedTokens: number }[]) => {
        if (failNext) {
          return Promise.resolve({
            embedded: new Map<string, Float32Array>(),
            failed: new Map(items.map(({ id }) => [id, { code: "PROVIDER_HTTP_500", category: "provider" as const, messageKey: "error.provider.http", retryable: true }])),
            requests: 1
          });
        }
        return Promise.resolve({
          embedded: new Map(items.map(({ id }) => [id, new Float32Array([1, 0])])),
          failed: new Map<string, never>(),
          requests: 1
        });
      }
    };
    const coordinator = newCoordinator(store, vault, { embeddingEnabled: true, embedder });
    await coordinator.fullScan();
    expect(coordinator.progress().deadLetters).toBeGreaterThan(0);

    failNext = false;
    await coordinator.retryFailed();
    expect(coordinator.progress().deadLetters).toBe(0);
    expect(store.stats().chunksWithEmbedding).toBeGreaterThan(0);
    await coordinator.close();
  });

  it("pauses and resumes the task queue", async () => {
    const vault = new FakeVault();
    vault.files.set("a.md", "# A\ncontent");
    const store = newStore();
    const coordinator = newCoordinator(store, vault);
    coordinator.pause();
    coordinator.enqueue([{ kind: "upsert", path: "a.md", generation: 1 }]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.getSourceByPath("a.md")).toBeUndefined();
    expect(coordinator.progress().state).toBe("paused");
    coordinator.resume();
    await waitForIdle(coordinator);
    expect(store.getSourceByPath("a.md")).toBeDefined();
    await coordinator.close();
  });

  it("rebuilds the artifact from the vault (FR-061)", async () => {
    const vault = new FakeVault();
    vault.files.set("a.md", "# A\ncontent");
    const store = newStore();
    const coordinator = newCoordinator(store, vault);
    await coordinator.fullScan();
    const report = await coordinator.rebuildAll();
    expect(report.indexed).toBe(1);
    expect(store.stats().sources).toBe(1);
    await coordinator.close();
  });

  it("persists after work with debounce", async () => {
    const vault = new FakeVault();
    vault.files.set("a.md", "# A\ncontent");
    const adapter = new MemoryStorageAdapter();
    const store = new LocalArtifactStore({ artifactId: "artifact-a", artifactFingerprint: "fp", dimension: 2, adapter, now: () => NOW });
    const coordinator = new IndexCoordinator({
      store,
      vault,
      config: () => ({
        corpus: corpusProfile(),
        lexical: lexicalProfile(),
        documentTemplate: "{content}",
        lexicalFingerprint: "lex-fp",
        embeddingEnabled: false
      }),
      now: () => NOW,
      generateSourceId: () => "src-1",
      persistDebounceMs: 1
    });
    await coordinator.fullScan();
    await vi.waitFor(async () => {
      expect(await adapter.read("artifact-artifact-a.json")).not.toBeNull();
    });
    await coordinator.close();
  });
});

async function waitForIdle(coordinator: IndexCoordinator): Promise<void> {
  await vi.waitFor(() => {
    const progress = coordinator.progress();
    expect(progress.state).toBe("idle");
    expect(progress.queued).toBe(0);
  }, { timeout: 3000 });
}

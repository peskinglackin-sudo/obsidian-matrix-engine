import { toSafeError, type SafeError } from "../core/errors";
import { computeRawContentHash } from "../indexing/hashes";
import type { BatchItem, BatchOutcome } from "../providers/batcher";
import type { CorpusProfile, LexicalProfile } from "../settings/types";
import type { ChunkRecord } from "../storage/contracts";
import type { LocalArtifactStore } from "../storage/local-store";
import type { CoalescedTask } from "./coalescer";
import { analyzePath } from "../analysis/identifier";
import { buildSourceRows, pathInScope, type EmbeddingInput, type FileSnapshot } from "./row-builder";

/**
 * IndexCoordinator (PRD 14).
 *
 * Single writer over the artifact store: full scans, coalesced incremental
 * tasks, rename without delete-first, metadata-only refreshes, embedding
 * carry-over by input hash, dead-letter tracking, pause/resume, and
 * debounced persistence. Stale generations abandon before commit.
 */

export type VaultPort = Readonly<{
  listPaths(): Promise<readonly string[]>;
  read(path: string): Promise<FileSnapshot | null>;
}>;

export type EmbeddingPort = Readonly<{
  run(items: readonly BatchItem[], signal?: AbortSignal): Promise<BatchOutcome>;
}>;

export type CoordinatorConfig = Readonly<{
  corpus: CorpusProfile;
  lexical: LexicalProfile;
  documentTemplate: string;
  lexicalFingerprint: string;
  embeddingEnabled: boolean;
}>;

export type IndexState = "idle" | "scanning" | "indexing" | "paused";

export type IndexProgress = Readonly<{
  state: IndexState;
  queued: number;
  deadLetters: number;
  lastSyncAt: number;
  lastError?: SafeError;
}>;

export type ScanReport = Readonly<{
  scanned: number;
  indexed: number;
  skipped: number;
  removed: number;
  failed: number;
}>;

export class IndexCoordinator {
  readonly #store: LocalArtifactStore;
  readonly #vault: VaultPort;
  readonly #config: () => CoordinatorConfig;
  readonly #embedder: EmbeddingPort | undefined;
  readonly #now: () => number;
  readonly #generateSourceId: () => string;
  readonly #persistDebounceMs: number;
  readonly #onStatusChange: ((progress: IndexProgress) => void) | undefined;

  readonly #taskQueue: CoalescedTask[] = [];
  readonly #latestGeneration = new Map<string, number>();
  readonly #deadLetters = new Map<string, SafeError>();
  #state: IndexState = "idle";
  #paused = false;
  #draining = false;
  #closed = false;
  #lastSyncAt = 0;
  #lastError: SafeError | undefined;
  #persistTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #abort = new AbortController();

  constructor(deps: Readonly<{
    store: LocalArtifactStore;
    vault: VaultPort;
    config: () => CoordinatorConfig;
    embedder?: EmbeddingPort;
    now?: () => number;
    generateSourceId?: () => string;
    persistDebounceMs?: number;
    onStatusChange?: (progress: IndexProgress) => void;
  }>) {
    this.#store = deps.store;
    this.#vault = deps.vault;
    this.#config = deps.config;
    this.#embedder = deps.embedder;
    this.#now = deps.now ?? Date.now;
    this.#generateSourceId = deps.generateSourceId ?? (() => crypto.randomUUID());
    this.#persistDebounceMs = deps.persistDebounceMs ?? 2000;
    this.#onStatusChange = deps.onStatusChange;
  }

  progress(): IndexProgress {
    return Object.freeze({
      state: this.#paused ? "paused" : this.#state,
      queued: this.#taskQueue.length,
      deadLetters: this.#deadLetters.size,
      lastSyncAt: this.#lastSyncAt,
      ...(this.#lastError === undefined ? {} : { lastError: this.#lastError })
    });
  }

  deadLetters(): ReadonlyMap<string, SafeError> {
    return this.#deadLetters;
  }

  pause(): void {
    this.#paused = true;
    this.#notify();
  }

  resume(): void {
    this.#paused = false;
    this.#notify();
    void this.#drain();
  }

  /** Full vault scan (FR-001): index in-scope files, drop out-of-scope leftovers. */
  async fullScan(): Promise<ScanReport> {
    this.#setState("scanning");
    const config = this.#config();
    let scanned = 0;
    let indexed = 0;
    let skipped = 0;
    let failed = 0;
    const pendingEmbeds: EmbeddingInput[] = [];
    const seenPaths = new Set<string>();

    try {
      const paths = await this.#vault.listPaths();
      for (const path of paths) {
        if (this.#closed) break;
        if (!pathInScope(path, config.corpus)) continue;
        seenPaths.add(path);
        scanned += 1;
        try {
          const outcome = await this.#upsertPath(path, undefined, pendingEmbeds);
          if (outcome === "indexed") indexed += 1;
          else skipped += 1;
        } catch (error: unknown) {
          failed += 1;
          this.#lastError = toSafeError(error, "INDEX_SOURCE_FAILED");
        }
        if (scanned % 25 === 0) await yieldLoop();
      }

      let removed = 0;
      for (const source of this.#store.listSources()) {
        if (!seenPaths.has(source.pathRaw)) {
          this.#store.deleteSource(source.sourceId);
          removed += 1;
        }
      }

      await this.#runEmbeds(pendingEmbeds);
      this.#lastSyncAt = this.#now();
      this.#schedulePersist();
      return Object.freeze({ scanned, indexed, skipped, removed, failed });
    } finally {
      this.#setState("idle");
    }
  }

  /** Wired to the coalescer flush. */
  enqueue(tasks: readonly CoalescedTask[]): void {
    if (this.#closed) return;
    for (const task of tasks) {
      this.#latestGeneration.set(task.path, Math.max(this.#latestGeneration.get(task.path) ?? 0, task.generation));
      this.#taskQueue.push(task);
    }
    void this.#drain();
  }

  /** FR-061: retry embedding dead letters and failed sources. */
  async retryFailed(): Promise<void> {
    const failedSources = this.#store.listManifest("failed");
    this.#deadLetters.clear();
    const pendingEmbeds: EmbeddingInput[] = [];
    for (const entry of failedSources) {
      const source = this.#store.getSource(entry.sourceId);
      if (source === undefined) continue;
      try {
        await this.#upsertPath(source.pathRaw, undefined, pendingEmbeds, true);
      } catch (error: unknown) {
        this.#lastError = toSafeError(error, "INDEX_SOURCE_FAILED");
      }
    }
    const missing = this.#collectMissingEmbeddings();
    await this.#runEmbeds([...pendingEmbeds, ...missing]);
    this.#schedulePersist();
  }

  /** FR-061: rebuild the whole artifact from the vault. */
  async rebuildAll(): Promise<ScanReport> {
    await this.#store.destroy();
    this.#deadLetters.clear();
    return this.fullScan();
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#abort.abort();
    if (this.#persistTimer !== undefined) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = undefined;
    }
    if (this.#store.dirty) await this.#store.persist();
  }

  // ------------------------------------------------------------ internals

  async #drain(): Promise<void> {
    if (this.#draining || this.#paused || this.#closed) return;
    this.#draining = true;
    this.#setState("indexing");
    try {
      for (;;) {
        if (this.#isStopped()) break;
        const task = this.#taskQueue.shift();
        if (task === undefined) break;
        if ((this.#latestGeneration.get(task.path) ?? 0) > task.generation) continue;
        try {
          await this.#processTask(task);
        } catch (error: unknown) {
          this.#lastError = toSafeError(error, "INDEX_TASK_FAILED");
        }
      }
      this.#lastSyncAt = this.#now();
      this.#schedulePersist();
    } finally {
      this.#draining = false;
      this.#setState("idle");
    }
  }

  async #processTask(task: CoalescedTask): Promise<void> {
    switch (task.kind) {
      case "delete": {
        const source = this.#store.getSourceByPath(task.path);
        if (source !== undefined) this.#store.deleteSource(source.sourceId);
        return;
      }
      case "rename": {
        const source = this.#store.getSourceByPath(task.oldPath);
        if (source === undefined) {
          await this.#upsertAndEmbed(task.path, task.generation);
          return;
        }
        const filename = task.path.split("/").at(-1) ?? task.path;
        const folder = task.path.split("/").slice(0, -1).join("/");
        this.#store.renameSource(source.sourceId, {
          pathRaw: task.path,
          pathNorm: task.path.toLowerCase(),
          filenameRaw: filename,
          filenameNorm: filename.toLowerCase(),
          folderRaw: folder,
          folderNorm: folder.toLowerCase(),
          pathTerms: analyzePath(task.path)
        }, source.sourceRevision + 1);
        if (task.contentDirty) await this.#upsertAndEmbed(task.path, task.generation);
        return;
      }
      case "upsert":
        await this.#upsertAndEmbed(task.path, task.generation);
        return;
    }
  }

  async #upsertAndEmbed(path: string, generation: number | undefined): Promise<void> {
    const pendingEmbeds: EmbeddingInput[] = [];
    await this.#upsertPath(path, generation, pendingEmbeds);
    await this.#runEmbeds(pendingEmbeds);
  }

  async #upsertPath(
    path: string,
    generation: number | undefined,
    pendingEmbeds: EmbeddingInput[],
    force = false
  ): Promise<"indexed" | "skipped" | "removed" | "superseded"> {
    const config = this.#config();
    const existing = this.#store.getSourceByPath(path);
    if (!pathInScope(path, config.corpus)) {
      if (existing !== undefined) this.#store.deleteSource(existing.sourceId);
      return "removed";
    }
    const snapshot = await this.#vault.read(path);
    if (snapshot === null) {
      if (existing !== undefined) this.#store.deleteSource(existing.sourceId);
      return "removed";
    }
    if (generation !== undefined && (this.#latestGeneration.get(path) ?? 0) > generation) return "superseded";

    const rawContentHash = computeRawContentHash(snapshot.content);
    if (!force && existing?.rawContentHash === rawContentHash) {
      if (existing.mtime !== snapshot.mtime || existing.size !== snapshot.size) {
        this.#store.touchSource(existing.sourceId, { mtime: snapshot.mtime, size: snapshot.size, revision: existing.sourceRevision + 1 });
      }
      const missing = this.#collectMissingEmbeddings(existing.sourceId);
      pendingEmbeds.push(...missing);
      return "skipped";
    }

    const sourceId = existing?.sourceId ?? this.#generateSourceId();
    const manifest = this.#store.manifestFor(sourceId);
    const revision = Math.max(existing?.sourceRevision ?? 0, manifest?.seenRevision ?? 0, manifest?.indexedRevision ?? 0) + 1;
    this.#store.markSourceSeen(sourceId, revision);

    const built = buildSourceRows(snapshot, {
      artifactId: this.#store.artifactId,
      sourceId,
      revision,
      corpus: config.corpus,
      lexical: config.lexical,
      documentTemplate: config.documentTemplate,
      lexicalFingerprint: config.lexicalFingerprint,
      now: this.#now()
    });

    // Carry embeddings forward when the final rendered input is unchanged
    // (PRD 1.2: no re-embedding without an input change).
    const chunks: ChunkRecord[] = [];
    for (const chunk of built.chunks) {
      const previous = this.#store.getChunk(chunk.rowId);
      if (previous?.embedding !== undefined && previous.embeddingInputHash === chunk.embeddingInputHash) {
        chunks.push(Object.freeze({ ...chunk, embedding: previous.embedding }));
      } else {
        chunks.push(chunk);
      }
    }

    if (generation !== undefined && (this.#latestGeneration.get(path) ?? 0) > generation) return "superseded";
    const result = this.#store.commitSource({ source: built.source, chunks });
    if (result.status === "stale_rejected") return "superseded";

    if (config.embeddingEnabled) {
      const carried = new Set(chunks.filter((chunk) => chunk.embedding !== undefined).map((chunk) => chunk.rowId));
      for (const input of built.embeddingInputs) {
        if (!carried.has(input.rowId)) pendingEmbeds.push(input);
      }
    }
    this.#schedulePersist();
    return "indexed";
  }

  #collectMissingEmbeddings(sourceId?: string): EmbeddingInput[] {
    const config = this.#config();
    if (!config.embeddingEnabled) return [];
    const sources = sourceId === undefined ? this.#store.listSources().map(({ sourceId: id }) => id) : [sourceId];
    const missing: EmbeddingInput[] = [];
    for (const id of sources) {
      for (const chunk of this.#store.chunksForSource(id)) {
        if (chunk.embedding !== undefined) continue;
        if (this.#deadLetters.has(chunk.rowId)) continue;
        missing.push(Object.freeze({
          rowId: chunk.rowId,
          text: chunk.textRaw,
          embeddingInputHash: chunk.embeddingInputHash,
          estimatedTokens: Math.max(1, Math.ceil(chunk.textRaw.length / 4))
        }));
      }
    }
    return missing;
  }

  async #runEmbeds(inputs: readonly EmbeddingInput[]): Promise<void> {
    const config = this.#config();
    if (!config.embeddingEnabled || this.#embedder === undefined || inputs.length === 0) return;
    const byRow = new Map<string, EmbeddingInput>();
    for (const input of inputs) byRow.set(input.rowId, input);
    const items: BatchItem[] = [...byRow.values()].map((input) => ({
      id: input.rowId,
      text: input.text,
      estimatedTokens: input.estimatedTokens
    }));
    const outcome = await this.#embedder.run(items, this.#abort.signal);
    for (const [rowId, vector] of outcome.embedded) {
      const input = byRow.get(rowId);
      if (input === undefined) continue;
      this.#store.attachEmbedding(rowId, input.embeddingInputHash, vector);
      this.#deadLetters.delete(rowId);
    }
    for (const [rowId, error] of outcome.failed) {
      if (error.category === "cancelled") continue;
      this.#deadLetters.set(rowId, error);
      this.#lastError = error;
    }
    if (outcome.embedded.size > 0) this.#schedulePersist();
  }

  #schedulePersist(): void {
    if (this.#closed) return;
    if (this.#persistTimer !== undefined) clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = undefined;
      void this.#store.persist().catch((error: unknown) => {
        this.#lastError = toSafeError(error, "ARTIFACT_PERSIST_FAILED");
      });
    }, this.#persistDebounceMs);
  }

  #isStopped(): boolean {
    return this.#paused || this.#closed;
  }

  #setState(state: IndexState): void {
    this.#state = state;
    this.#notify();
  }

  #notify(): void {
    this.#onStatusChange?.(this.progress());
  }
}

function yieldLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

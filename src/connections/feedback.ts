import { z } from "zod";

import type { StorageAdapter } from "../storage/adapter";

/**
 * ConnectionFeedbackStore (FR-022).
 *
 * Pin and hide decisions persist as a small JSON file next to the index
 * artifacts. Feedback only reorders/filters local results; it never trains
 * or mutates the model or index rows.
 */

const FILE_PATH = "connections-feedback.json";

const persistedSchema = z.strictObject({
  version: z.literal(1),
  pinned: z.array(z.string()),
  hidden: z.array(z.string())
});

export class ConnectionFeedbackStore {
  readonly #adapter: StorageAdapter;
  readonly #pinned = new Set<string>();
  readonly #hidden = new Set<string>();

  constructor(adapter: StorageAdapter) {
    this.#adapter = adapter;
  }

  async load(): Promise<void> {
    try {
      const raw = await this.#adapter.read(FILE_PATH);
      if (raw === null) return;
      const parsed = persistedSchema.parse(JSON.parse(raw));
      for (const id of parsed.pinned) this.#pinned.add(id);
      for (const id of parsed.hidden) this.#hidden.add(id);
    } catch {
      // Feedback is a rebuildable preference cache; start empty on corruption.
      this.#pinned.clear();
      this.#hidden.clear();
    }
  }

  async #save(): Promise<void> {
    await this.#adapter.write(FILE_PATH, JSON.stringify({
      version: 1,
      pinned: [...this.#pinned],
      hidden: [...this.#hidden]
    }));
  }

  isPinned(sourceId: string): boolean {
    return this.#pinned.has(sourceId);
  }

  isHidden(sourceId: string): boolean {
    return this.#hidden.has(sourceId);
  }

  listHidden(): readonly string[] {
    return [...this.#hidden];
  }

  async setPinned(sourceId: string, pinned: boolean): Promise<void> {
    if (pinned) this.#pinned.add(sourceId);
    else this.#pinned.delete(sourceId);
    await this.#save();
  }

  async setHidden(sourceId: string, hidden: boolean): Promise<void> {
    if (hidden) this.#hidden.add(sourceId);
    else this.#hidden.delete(sourceId);
    await this.#save();
  }
}

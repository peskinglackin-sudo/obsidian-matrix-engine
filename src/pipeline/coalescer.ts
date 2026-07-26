/**
 * VaultEventCoalescer (PRD 14.1-14.3, FR-002).
 *
 * Rapid events on the same path merge inside a debounce window; every
 * change bumps a per-path generation so later stages can reject stale
 * work (latest-wins). Renames follow chains and carry their generation
 * to the new path.
 */

export type VaultEvent =
  | Readonly<{ kind: "create" | "modify"; path: string }>
  | Readonly<{ kind: "delete"; path: string }>
  | Readonly<{ kind: "rename"; path: string; oldPath: string }>;

export type CoalescedTask =
  | Readonly<{ kind: "upsert"; path: string; generation: number }>
  | Readonly<{ kind: "delete"; path: string; generation: number }>
  | Readonly<{ kind: "rename"; path: string; oldPath: string; generation: number; contentDirty: boolean }>;

type Pending =
  | { op: "upsert"; renamedFrom?: string; contentDirty: boolean }
  | { op: "delete"; renamedFrom?: string };

export class VaultEventCoalescer {
  readonly #debounceMs: number;
  readonly #onFlush: (tasks: readonly CoalescedTask[]) => void;
  readonly #pending = new Map<string, Pending>();
  readonly #generations = new Map<string, number>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(options: Readonly<{ debounceMs: number; onFlush: (tasks: readonly CoalescedTask[]) => void }>) {
    this.#debounceMs = options.debounceMs;
    this.#onFlush = options.onFlush;
  }

  generationFor(path: string): number {
    return this.#generations.get(path) ?? 0;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  push(event: VaultEvent): void {
    if (this.#closed) return;
    switch (event.kind) {
      case "create":
      case "modify": {
        const existing = this.#pending.get(event.path);
        if (existing?.op === "upsert") {
          existing.contentDirty = true;
        } else {
          this.#pending.set(event.path, { op: "upsert", ...(existing?.renamedFrom === undefined ? {} : { renamedFrom: existing.renamedFrom }), contentDirty: true });
        }
        this.#bump(event.path);
        break;
      }
      case "delete": {
        const existing = this.#pending.get(event.path);
        if (existing?.renamedFrom !== undefined) {
          // The rename source disappears with the target: delete the original.
          this.#pending.set(existing.renamedFrom, { op: "delete" });
          this.#bump(existing.renamedFrom);
          this.#pending.delete(event.path);
        } else {
          this.#pending.set(event.path, { op: "delete" });
        }
        this.#bump(event.path);
        break;
      }
      case "rename": {
        const previous = this.#pending.get(event.oldPath);
        this.#pending.delete(event.oldPath);
        // Follow chains: a->b then b->c becomes a->c.
        const origin = previous !== undefined && "renamedFrom" in previous && previous.renamedFrom !== undefined ? previous.renamedFrom : event.oldPath;
        const contentDirty = previous?.op === "upsert" && previous.contentDirty;
        this.#pending.set(event.path, { op: "upsert", renamedFrom: origin, contentDirty });
        const carried = Math.max(this.#generations.get(event.oldPath) ?? 0, this.#generations.get(event.path) ?? 0);
        this.#generations.set(event.path, carried);
        this.#bump(event.path);
        break;
      }
    }
    this.#schedule();
  }

  flushNow(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (this.#pending.size === 0) return;
    const tasks: CoalescedTask[] = [];
    for (const [path, pending] of this.#pending) {
      const generation = this.#generations.get(path) ?? 0;
      if (pending.op === "delete") {
        tasks.push(Object.freeze({ kind: "delete", path, generation }));
      } else if (pending.renamedFrom !== undefined && pending.renamedFrom !== path) {
        tasks.push(Object.freeze({ kind: "rename", path, oldPath: pending.renamedFrom, generation, contentDirty: pending.contentDirty }));
      } else {
        tasks.push(Object.freeze({ kind: "upsert", path, generation }));
      }
    }
    this.#pending.clear();
    this.#onFlush(Object.freeze(tasks));
  }

  close(): void {
    this.#closed = true;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#pending.clear();
  }

  #bump(path: string): void {
    this.#generations.set(path, (this.#generations.get(path) ?? 0) + 1);
  }

  #schedule(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.flushNow();
    }, this.#debounceMs);
  }
}

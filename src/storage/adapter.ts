/**
 * Persistence adapter boundary.
 *
 * The artifact store persists through this narrow interface so tests run
 * in memory and the plugin maps it onto the Obsidian vault adapter under
 * the plugin's own directory. Index files are rebuildable caches: a
 * corrupt file is reported and rebuilt from the vault, never trusted.
 */

export interface StorageAdapter {
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(): Promise<readonly string[]>;
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly #files = new Map<string, string>();

  read(path: string): Promise<string | null> {
    return Promise.resolve(this.#files.get(path) ?? null);
  }

  write(path: string, data: string): Promise<void> {
    this.#files.set(path, data);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.#files.delete(path);
    return Promise.resolve();
  }

  list(): Promise<readonly string[]> {
    return Promise.resolve([...this.#files.keys()]);
  }

  /** Test hook: corrupt or inspect stored payloads. */
  peek(path: string): string | undefined {
    return this.#files.get(path);
  }
}

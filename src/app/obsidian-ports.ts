import type { App, DataAdapter, TFile } from "obsidian";

import type { FileSnapshot } from "../pipeline/row-builder";
import type { VaultPort } from "../pipeline/coordinator";
import type { StorageAdapter } from "../storage/adapter";

/**
 * Obsidian adapters for the pure ports.
 *
 * Index artifacts live under the plugin's own configuration directory, so
 * the vault stays the untouched source of truth and the artifact directory
 * can be deleted safely for a rebuild (PRD 21.1).
 */

export class ObsidianStorageAdapter implements StorageAdapter {
  readonly #adapter: DataAdapter;
  readonly #baseDir: string;
  #ready = false;

  constructor(adapter: DataAdapter, baseDir: string) {
    this.#adapter = adapter;
    this.#baseDir = baseDir.replace(/\/+$/u, "");
  }

  async #ensureDir(): Promise<void> {
    if (this.#ready) return;
    if (!(await this.#adapter.exists(this.#baseDir))) {
      await this.#adapter.mkdir(this.#baseDir);
    }
    this.#ready = true;
  }

  #resolve(path: string): string {
    if (path.includes("..") || path.includes("/")) throw new TypeError("Storage adapter paths must be plain file names");
    return `${this.#baseDir}/${path}`;
  }

  async read(path: string): Promise<string | null> {
    await this.#ensureDir();
    const full = this.#resolve(path);
    if (!(await this.#adapter.exists(full))) return null;
    return this.#adapter.read(full);
  }

  async write(path: string, data: string): Promise<void> {
    await this.#ensureDir();
    await this.#adapter.write(this.#resolve(path), data);
  }

  async remove(path: string): Promise<void> {
    await this.#ensureDir();
    const full = this.#resolve(path);
    if (await this.#adapter.exists(full)) await this.#adapter.remove(full);
  }

  async list(): Promise<readonly string[]> {
    await this.#ensureDir();
    const listing = await this.#adapter.list(this.#baseDir);
    return listing.files.map((file) => file.split("/").at(-1) ?? file);
  }
}

const INDEXABLE_EXTENSIONS = new Set(["md", "txt"]);

export class ObsidianVaultPort implements VaultPort {
  readonly #app: App;

  constructor(app: App) {
    this.#app = app;
  }

  listPaths(): Promise<readonly string[]> {
    const paths = this.#app.vault.getFiles()
      .filter((file) => INDEXABLE_EXTENSIONS.has(file.extension.toLowerCase()))
      .map((file) => file.path);
    return Promise.resolve(paths);
  }

  async read(path: string): Promise<FileSnapshot | null> {
    const file = this.#app.vault.getFileByPath(path);
    if (file === null) return null;
    try {
      const content = await this.#app.vault.cachedRead(file);
      return Object.freeze({
        path: file.path,
        content,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        size: file.stat.size
      });
    } catch {
      return null;
    }
  }
}

export function markdownFileFor(app: App, path: string): TFile | null {
  return app.vault.getFileByPath(path);
}

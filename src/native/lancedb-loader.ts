import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";

import { canonicalJson, sha256 } from "../../spike/evidence/canonical";
import { MatrixEngineError } from "../core/errors";
import { artifactManifestSchema, type ArtifactManifest } from "./artifact-manifest";

export type RuntimeTarget = Readonly<{
  platform: NodeJS.Platform;
  architecture: string;
  libc: "glibc" | "musl" | "none" | "unknown";
}>;

export type LoadedLanceDb = Readonly<{
  Index: Readonly<{
    fts(options?: Readonly<{ baseTokenizer?: "whitespace" | "ngram"; withPosition?: boolean; ngramMinLength?: number; ngramMaxLength?: number }>): unknown;
  }>;
  MatchQuery: new (query: string, column: string, options?: Readonly<{ fuzziness?: number }>) => unknown;
  connect(uri: string): Promise<{
    close(): void;
    openTable(name: string): Promise<{
      close(): void;
      countRows(filter?: string): Promise<number>;
      vectorSearch(vector: readonly number[]): { limit(count: number): { toArray(): Promise<unknown[]> } };
    }>;
    createTable(name: string, data: readonly Record<string, unknown>[], options?: { mode?: "overwrite" }): Promise<{
      close(): void;
      add(data: readonly Record<string, unknown>[]): Promise<void>;
      countRows(filter?: string): Promise<number>;
      createIndex(column: string, options?: Readonly<{ config?: unknown; replace?: boolean }>): Promise<void>;
      query(): { fullTextSearch(query: unknown): { limit(count: number): { toArray(): Promise<unknown[]> } } };
      vectorSearch(vector: readonly number[]): { limit(count: number): { toArray(): Promise<unknown[]> } };
    }>;
  }>;
}>;

function safeJoin(root: string, manifestPath: string): string {
  if (isAbsolute(manifestPath) || normalize(manifestPath).startsWith("..")) {
    throw new MatrixEngineError({ code: "ARTIFACT_PATH_INVALID", category: "invalid_input", messageKey: "error.artifact.path", retryable: false });
  }
  const path = resolve(root, manifestPath);
  const inside = relative(resolve(root), path);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new MatrixEngineError({ code: "ARTIFACT_PATH_INVALID", category: "invalid_input", messageKey: "error.artifact.path", retryable: false });
  }
  return path;
}

function expectedRuntime(target: ArtifactManifest["target"]): ArtifactManifest["allowedRuntime"] {
  switch (target) {
    case "win32-x64": return { platform: "win32", architecture: "x64", libc: "none" };
    case "darwin-arm64": return { platform: "darwin", architecture: "arm64", libc: "none" };
    case "linux-x64-gnu": return { platform: "linux", architecture: "x64", libc: "glibc" };
  }
}

export async function verifyArtifact(pluginDirectory: string, runtime?: RuntimeTarget): Promise<ArtifactManifest> {
  const manifestPath = join(resolve(pluginDirectory), "artifact-manifest.json");
  const manifest = artifactManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (JSON.stringify(manifest.allowedRuntime) !== JSON.stringify(expectedRuntime(manifest.target))) {
    throw new MatrixEngineError({ code: "ARTIFACT_RUNTIME_MATRIX_INVALID", category: "invalid_input", messageKey: "error.artifact.runtime", retryable: false });
  }
  if (runtime !== undefined) {
    const expected = manifest.allowedRuntime;
    if (runtime.platform !== expected.platform || runtime.architecture !== expected.architecture || runtime.libc !== expected.libc) {
      throw new MatrixEngineError({ code: "ARTIFACT_RUNTIME_MISMATCH", category: "unsupported", messageKey: "error.artifact.runtime", retryable: false });
    }
  }

  const nativeFiles = manifest.files.filter(({ path }) => path.endsWith(".node"));
  if (nativeFiles.length !== 1 || !nativeFiles[0]?.path.startsWith("vendor/native/")) {
    throw new MatrixEngineError({ code: "ARTIFACT_NATIVE_COUNT_INVALID", category: "invalid_input", messageKey: "error.artifact.native", retryable: false });
  }
  for (const file of manifest.files) {
    const bytes = await readFile(safeJoin(pluginDirectory, file.path));
    if (bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) {
      throw new MatrixEngineError({ code: "ARTIFACT_HASH_MISMATCH", category: "invalid_input", messageKey: "error.artifact.hash", retryable: false });
    }
  }
  if (sha256(canonicalJson(manifest.files)) !== manifest.contentSetSha256) {
    throw new MatrixEngineError({ code: "ARTIFACT_CONTENT_SET_MISMATCH", category: "invalid_input", messageKey: "error.artifact.contentset", retryable: false });
  }
  return manifest;
}

export async function loadVerifiedLanceDb(pluginDirectory: string, runtime: RuntimeTarget): Promise<LoadedLanceDb> {
  const manifest = await verifyArtifact(pluginDirectory, runtime);
  const native = manifest.files.find(({ path }) => path.endsWith(".node"));
  if (native === undefined) throw new Error("Verified manifest did not contain a native file");
  const libraryPath = safeJoin(pluginDirectory, native.path);
  const entryPath = safeJoin(pluginDirectory, "vendor/lancedb.cjs");
  const previous = process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
  try {
    process.env.NAPI_RS_NATIVE_LIBRARY_PATH = libraryPath;
    const require = createRequire(import.meta.url);
    return require(entryPath) as LoadedLanceDb;
  } catch {
    throw new MatrixEngineError({ code: "LANCEDB_NATIVE_LOAD_FAILED", category: "environment", messageKey: "error.lancedb.load", retryable: false });
  } finally {
    if (previous === undefined) delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
    else process.env.NAPI_RS_NATIVE_LIBRARY_PATH = previous;
  }
}

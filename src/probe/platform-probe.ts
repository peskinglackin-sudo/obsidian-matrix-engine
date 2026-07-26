import { release } from "node:os";

import { apiVersion, FileSystemAdapter, type App } from "obsidian";
import { z } from "zod";

import { sha256 } from "../../spike/evidence/canonical";
import { runLanceDbSmoke } from "../../spike/native/smoke";
import { toSafeError } from "../core/errors";
import { buildNamespaces, SPIKE_IDENTITY } from "../identity";
import { loadVerifiedLanceDb, verifyArtifact, type RuntimeTarget } from "../native/lancedb-loader";
import { runSecretStorageProbe } from "./secret-storage";
import { appendLoadSession, mergeCheckpoints, loadProbeRequest, loadProbeState, writeProbeState } from "./platform-state";
import type { PlatformCheckpoint, PlatformProbeRequest } from "./platform-contract";

export type PlatformProbeProgress = Readonly<{
  status: "idle" | "running" | "pass" | "fail";
  phase: PlatformProbeRequest["phase"];
  completed: number;
  errorCode?: string;
}>;

function checkpoint(id: PlatformCheckpoint["id"], started: number, status: PlatformCheckpoint["status"] = "pass", errorCode?: string): PlatformCheckpoint {
  return Object.freeze({ id, status, durationMs: performance.now() - started, ...(errorCode === undefined ? {} : { errorCode }) });
}

function runtimeForRequest(request: PlatformProbeRequest): RuntimeTarget {
  const expected: Record<PlatformProbeRequest["target"], RuntimeTarget> = {
    "win32-x64": { platform: "win32", architecture: "x64", libc: "none" },
    "darwin-arm64": { platform: "darwin", architecture: "arm64", libc: "none" },
    "linux-x64-gnu": { platform: "linux", architecture: "x64", libc: "glibc" }
  };
  const actual = expected[request.target];
  if (process.platform !== actual.platform || process.arch !== actual.architecture) throw new Error("RUNTIME_TARGET_MISMATCH");
  if (actual.platform === "linux") {
    const report = z.object({ header: z.object({ glibcVersionRuntime: z.string().min(1) }) }).safeParse(process.report.getReport());
    if (!report.success) throw new Error("GLIBC_RUNTIME_REQUIRED");
  }
  return actual;
}

function pluginDirectory(app: App, manifestDir: string | undefined): string {
  if (!(app.vault.adapter instanceof FileSystemAdapter) || manifestDir === undefined) throw new Error("DESKTOP_FILESYSTEM_REQUIRED");
  return app.vault.adapter.getFullPath(manifestDir);
}

function appDatabaseRoot(app: App, relativeDirectory: string): string {
  if (!(app.vault.adapter instanceof FileSystemAdapter)) throw new Error("DESKTOP_FILESYSTEM_REQUIRED");
  return app.vault.adapter.getFullPath(`.matrix-engine-spike/${relativeDirectory}/space 中文 日本語 😀`);
}

function safeRuntime(request: PlatformProbeRequest, target: RuntimeTarget) {
  return {
    osVersion: release().replace(/[^a-zA-Z0-9.+_-]/gu, "_"),
    architecture: target.architecture === "arm64" ? "arm64" as const : "x64" as const,
    libc: target.libc === "glibc" ? "glibc" as const : "none" as const,
    obsidianVersion: apiVersion,
    electronVersion: process.versions.electron ?? "0.0.0",
    nodeVersion: process.versions.node,
    nodeAbi: process.versions.modules
  };
}

async function runFtsSmoke(lancedb: Awaited<ReturnType<typeof loadVerifiedLanceDb>>, databaseDirectory: string): Promise<boolean> {
  const connection = await lancedb.connect(databaseDirectory);
  let table: Awaited<ReturnType<typeof connection.createTable>> | undefined;
  try {
    table = await connection.createTable("fts_smoke", [
      { id: "zh", text: "检索引擎 multilingual search", vector: [1, 0, 0] },
      { id: "en", text: "unrelated synthetic content", vector: [0, 1, 0] }
    ], { mode: "overwrite" });
    await table.createIndex("text", { config: lancedb.Index.fts({ baseTokenizer: "ngram", ngramMinLength: 2, ngramMaxLength: 3, withPosition: true }), replace: true });
    const rows = await table.query().fullTextSearch(new lancedb.MatchQuery("检索", "text", { fuzziness: 0 })).limit(10).toArray();
    return rows.length > 0;
  } finally {
    table?.close();
    connection.close();
  }
}

async function runReopenSmoke(lancedb: Awaited<ReturnType<typeof loadVerifiedLanceDb>>, databaseDirectory: string): Promise<boolean> {
  const connection = await lancedb.connect(databaseDirectory);
  try {
    const table = await connection.openTable("smoke");
    try {
      const count = await table.countRows();
      const rows = await table.vectorSearch([1, 0, 0]).limit(3).toArray();
      return count === 3 && rows.length === 3;
    } finally {
      table.close();
    }
  } finally {
    connection.close();
  }
}

async function runCleanupFailureInjection(lancedb: Awaited<ReturnType<typeof loadVerifiedLanceDb>>, databaseDirectory: string): Promise<boolean> {
  let injected = false;
  const connection = await lancedb.connect(databaseDirectory);
  try {
    const table = await connection.openTable("smoke");
    try {
      injected = true;
      throw new Error("CONTROLLED_CLEANUP_INJECTION");
    } finally {
      table.close();
    }
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.message !== "CONTROLLED_CLEANUP_INJECTION") throw error;
  } finally {
    connection.close();
  }
  return injected && await runReopenSmoke(lancedb, databaseDirectory);
}

export class PlatformProbeController {
  readonly #app: App;
  readonly #manifestDir: string | undefined;
  readonly #loadSessionId = crypto.randomUUID();
  readonly #listeners = new Set<(progress: PlatformProbeProgress) => void>();
  #progress: PlatformProbeProgress = Object.freeze({ status: "idle", phase: "initial", completed: 0 });

  constructor(app: App, manifestDir: string | undefined) {
    this.#app = app;
    this.#manifestDir = manifestDir;
  }

  get progress(): PlatformProbeProgress { return this.#progress; }
  subscribe(listener: (progress: PlatformProbeProgress) => void): () => void { this.#listeners.add(listener); listener(this.#progress); return () => this.#listeners.delete(listener); }
  #publish(progress: PlatformProbeProgress): void { this.#progress = Object.freeze(progress); for (const listener of this.#listeners) listener(this.#progress); }

  async run(): Promise<void> {
    if (this.#progress.status === "running") throw new Error("PLATFORM_PROBE_ALREADY_RUNNING");
    const adapter = this.#app.vault.adapter;
    let phase: PlatformProbeRequest["phase"] = "initial";
    let completed = 0;
    try {
      const request = await loadProbeRequest(adapter);
      phase = request.phase;
      this.#publish({ status: "running", phase, completed: 0 });
      const runtimeTarget = runtimeForRequest(request);
      const safeEnvironment = safeRuntime(request, runtimeTarget);
      if (safeEnvironment.obsidianVersion !== request.appVersion) throw new Error("OBSIDIAN_VERSION_MISMATCH");
      const state = await loadProbeState(adapter, request, safeEnvironment);
      completed = state.checkpoints.length;
      const checks: PlatformCheckpoint[] = [];
      const directory = pluginDirectory(this.#app, this.#manifestDir);
      let started = performance.now();
      const artifact = await verifyArtifact(directory, runtimeTarget);
      if (this.#manifestDir === undefined) throw new Error("PLUGIN_DIRECTORY_MISSING");
      if (artifact.contentSetSha256 !== request.artifactSha256) throw new Error("ARTIFACT_BINDING_MISMATCH");
      const mainBytes = await adapter.readBinary(`${this.#manifestDir}/main.js`);
      if (sha256(new Uint8Array(mainBytes)) !== request.pluginRunnerSha256) throw new Error("RUNNER_BINDING_MISMATCH");
      checks.push(checkpoint("artifact-verified", started), checkpoint("plugin-installed", started), checkpoint("plugin-loaded", started));

      started = performance.now();
      const namespaces = buildNamespaces(SPIKE_IDENTITY);
      const secret = runSecretStorageProbe(this.#app.secretStorage, `${namespaces.secretEmbeddingApiKey}-probe`, crypto.randomUUID());
      checks.push(checkpoint("secret-set", started, secret.checks.set ? "pass" : "fail", secret.checks.set ? undefined : "SECRET_SET_FAILED"));
      checks.push(checkpoint("secret-get", started, secret.checks.get ? "pass" : "fail", secret.checks.get ? undefined : "SECRET_GET_FAILED"));
      checks.push(checkpoint("secret-list", started, secret.checks.list ? "pass" : "fail", secret.checks.list ? undefined : "SECRET_LIST_FAILED"));

      started = performance.now();
      const lancedb = await loadVerifiedLanceDb(directory, runtimeTarget);
      checks.push(checkpoint("native-loaded", started));
      const databaseRoot = appDatabaseRoot(this.#app, namespaces.databaseDirectory);
      const rows = await runLanceDbSmoke(lancedb, databaseRoot);
      checks.push(checkpoint("crud-query-close", started, rows.length === 3 ? "pass" : "fail", rows.length === 3 ? undefined : "CRUD_RESULT_INVALID"));
      checks.push(checkpoint("path-space", started), checkpoint("path-zh-hans", started), checkpoint("path-ja", started), checkpoint("path-emoji", started));
      const loadSessionIds = appendLoadSession(state.loadSessionIds, this.#loadSessionId);
      const observedArtifacts = [...state.observedArtifacts.filter(({ contentSetSha256 }) => contentSetSha256 !== artifact.contentSetSha256), {
        contentSetSha256: artifact.contentSetSha256,
        pluginVersion: artifact.pluginVersion
      }];
      if (request.cell === "current-stable" && request.phase !== "initial") {
        checks.push(checkpoint("enable-disable-reload", started, loadSessionIds.length >= 2 ? "pass" : "fail", loadSessionIds.length >= 2 ? undefined : "RELOAD_SESSION_MISSING"));
      }
      if (request.cell === "current-stable" && (request.phase === "upgraded" || request.phase === "complete")) {
        const prior = observedArtifacts.some(({ pluginVersion }) => pluginVersion === "0.0.0");
        const current = observedArtifacts.some(({ pluginVersion }) => pluginVersion === "0.0.1");
        checks.push(checkpoint("prior-artifact-upgrade", started, prior && current ? "pass" : "fail", prior && current ? undefined : "UPGRADE_ARTIFACTS_MISSING"));
      }
      if (request.cell === "current-stable" && request.phase === "complete") {
        const reopened = await runReopenSmoke(lancedb, databaseRoot);
        checks.push(checkpoint("reopen-close", started, reopened ? "pass" : "fail", reopened ? undefined : "REOPEN_FAILED"));
        checks.push(checkpoint("vector-smoke", started, reopened ? "pass" : "fail", reopened ? undefined : "VECTOR_SMOKE_FAILED"));
        const fts = await runFtsSmoke(lancedb, `${databaseRoot}/fts`);
        checks.push(checkpoint("fts-smoke", started, fts ? "pass" : "fail", fts ? undefined : "FTS_SMOKE_FAILED"));
        const second = await runLanceDbSmoke(lancedb, databaseRoot);
        checks.push(checkpoint("repeated-cleanup", started, second.length === 3 ? "pass" : "fail", second.length === 3 ? undefined : "REPEATED_CLEANUP_FAILED"));
        const failureCleanup = await runCleanupFailureInjection(lancedb, databaseRoot);
        checks.push(checkpoint("failure-injection-cleanup", started, failureCleanup ? "pass" : "fail", failureCleanup ? undefined : "FAILURE_INJECTION_CLEANUP_FAILED"));
      }
      checks.push(checkpoint("cleanup", started));
      const merged = mergeCheckpoints(state.checkpoints, checks);
      await writeProbeState(adapter, { schemaVersion: 1, request, checkpoints: merged, loadSessionIds, observedArtifacts, runtime: safeEnvironment }, request.phase === "complete" || request.cell === "minimum-1.11.4");
      this.#publish({ status: checks.some(({ status }) => status !== "pass") ? "fail" : "pass", phase: request.phase, completed: merged.length });
    } catch (error: unknown) {
      const safe = toSafeError(error, "PLATFORM_PROBE_FAILED");
      this.#publish({ status: "fail", phase, completed, errorCode: safe.code });
      throw error;
    }
  }
}

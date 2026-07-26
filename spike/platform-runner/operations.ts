import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { artifactManifestSchema } from "../../src/native/artifact-manifest";
import { platformProbeRequestSchema, platformProbeStateSchema, requiredChecks, type PlatformCheckpoint, type PlatformProbeRequest, type PlatformProbeState } from "../../src/probe/platform-contract";
import { assertFinalProbeState } from "../../src/probe/platform-state";
import { canonicalJson, sha256 } from "../evidence/canonical";
import { evaluatePlatformRun, type PlatformEvaluation } from "./evaluate";

const STATE_RELATIVE_PATH = join(".matrix-engine-spike", "state.json");
const REQUEST_RELATIVE_PATH = join(".matrix-engine-spike", "request.json");

export type PreparePlatformRunOptions = Readonly<{
  manifestPath: string;
  vaultPath: string;
  profilePath: string;
  cell: string;
  appVersion: string;
  phase: string;
}>;

export type FinalizePlatformRunOptions = Readonly<{
  checkpointsPath: string;
  vaultPath: string;
  profilePath: string;
  outputPath: string;
}>;

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function assertDirectory(path: string, code: string): Promise<void> {
  const directory = await stat(path).catch(() => undefined);
  if (directory?.isDirectory() !== true) throw new Error(code);
}

function previousPhase(phase: PlatformProbeRequest["phase"]): PlatformProbeRequest["phase"] | undefined {
  switch (phase) {
    case "initial": return undefined;
    case "reloaded": return "initial";
    case "upgraded": return "reloaded";
    case "complete": return "upgraded";
  }
}

function requiredChecksForCompletedPhase(phase: PlatformProbeRequest["phase"]): readonly PlatformCheckpoint["id"][] {
  const common = requiredChecks("minimum-1.11.4");
  switch (phase) {
    case "initial": return common;
    case "reloaded": return [...common, "enable-disable-reload"];
    case "upgraded": return [...common, "enable-disable-reload", "prior-artifact-upgrade"];
    case "complete": return requiredChecks("current-stable");
  }
}

function assertPassed(checkpoints: PlatformProbeState["checkpoints"], required: readonly PlatformCheckpoint["id"][]): void {
  const byId = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  if (required.some((id) => byId.get(id)?.status !== "pass")) throw new Error("PREVIOUS_PHASE_INCOMPLETE");
}

function assertTransition(previous: PlatformProbeState, next: PlatformProbeRequest): void {
  const expectedPrevious = previousPhase(next.phase);
  if (expectedPrevious === undefined || previous.request.phase !== expectedPrevious) throw new Error("PLATFORM_PHASE_TRANSITION_INVALID");
  if (previous.request.target !== next.target || previous.request.cell !== next.cell || previous.request.appVersion !== next.appVersion || previous.request.pluginRunnerSha256 !== next.pluginRunnerSha256 || previous.request.vaultPathSha256 !== next.vaultPathSha256 || previous.request.profilePathSha256 !== next.profilePathSha256) {
    throw new Error("PLATFORM_PROBE_REQUEST_CHANGED");
  }
  assertPassed(previous.checkpoints, requiredChecksForCompletedPhase(expectedPrevious));
}

function assertArtifactVersion(cell: PlatformProbeRequest["cell"], phase: PlatformProbeRequest["phase"], pluginVersion: "0.0.0" | "0.0.1"): void {
  const expected = cell === "current-stable" && (phase === "initial" || phase === "reloaded") ? "0.0.0" : "0.0.1";
  if (pluginVersion !== expected) throw new Error("PLATFORM_ARTIFACT_VERSION_INVALID");
}

export async function preparePlatformRun(options: PreparePlatformRunOptions): Promise<PlatformProbeRequest> {
  const artifactPath = resolve(options.manifestPath);
  const vaultPath = resolve(options.vaultPath);
  const profilePath = resolve(options.profilePath);
  await assertDirectory(vaultPath, "DISPOSABLE_VAULT_MISSING");
  await assertDirectory(profilePath, "DISPOSABLE_PROFILE_MISSING");
  const manifest = artifactManifestSchema.parse(JSON.parse(await readFile(artifactPath, "utf8")));
  const main = await readFile(join(dirname(artifactPath), "main.js"));
  const request = platformProbeRequestSchema.parse({
    schemaVersion: 1,
    target: manifest.target,
    cell: options.cell,
    appVersion: options.appVersion,
    artifactSha256: manifest.contentSetSha256,
    pluginRunnerSha256: sha256(main),
    vaultPathSha256: sha256(vaultPath),
    profilePathSha256: sha256(profilePath),
    dependencyVersions: { lancedb: manifest.lancedbVersion, apacheArrow: manifest.apacheArrowVersion },
    disposableVault: true,
    disposableProfile: true,
    phase: options.phase
  });
  assertArtifactVersion(request.cell, request.phase, manifest.pluginVersion);

  const statePath = join(vaultPath, STATE_RELATIVE_PATH);
  const requestPath = join(vaultPath, REQUEST_RELATIVE_PATH);
  if (request.phase === "initial") {
    if (await exists(dirname(statePath))) throw new Error("DISPOSABLE_VAULT_DIRTY");
  } else {
    if (!(await exists(statePath))) throw new Error("PREVIOUS_PHASE_STATE_MISSING");
    const previous = platformProbeStateSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
    assertTransition(previous, request);
  }

  await mkdir(dirname(requestPath), { recursive: true });
  await writeFile(requestPath, canonicalJson(request), { mode: 0o600 });
  return request;
}

export async function finalizePlatformRun(options: FinalizePlatformRunOptions): Promise<PlatformEvaluation> {
  const checkpointsPath = resolve(options.checkpointsPath);
  const profilePath = resolve(options.profilePath);
  const vaultPath = resolve(options.vaultPath);
  const state = platformProbeStateSchema.parse(JSON.parse(await readFile(checkpointsPath, "utf8")));
  if (sha256(vaultPath) !== state.request.vaultPathSha256 || sha256(profilePath) !== state.request.profilePathSha256) throw new Error("DISPOSABLE_PATH_BINDING_MISMATCH");
  if (await exists(profilePath)) throw new Error("DISPOSABLE_PROFILE_STILL_EXISTS");
  if (await exists(vaultPath)) throw new Error("DISPOSABLE_VAULT_STILL_EXISTS");
  assertFinalProbeState(state);
  const input = {
    schemaVersion: 1 as const,
    executionKind: "obsidian-desktop" as const,
    target: state.request.target,
    cell: state.request.cell,
    appVersion: state.request.appVersion,
    artifactSha256: state.request.artifactSha256,
    pluginRunnerSha256: state.request.pluginRunnerSha256,
    vaultPathSha256: state.request.vaultPathSha256,
    profilePathSha256: state.request.profilePathSha256,
    dependencyVersions: state.request.dependencyVersions,
    disposableVault: true,
    disposableProfile: true,
    runtime: state.runtime,
    checkpoints: state.checkpoints,
    vaultDestroyed: true,
    profileDestroyed: true,
    completed: true
  };
  const evaluation = evaluatePlatformRun(input);
  const outputPath = resolve(options.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, canonicalJson({ ...input, evaluation }), { mode: 0o600 });
  return evaluation;
}

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../spike/evidence/canonical";
import { finalizePlatformRun, preparePlatformRun } from "../spike/platform-runner/operations";
import { platformProbeRequestSchema, requiredChecks, type PlatformProbeRequest, type PlatformProbeState } from "../src/probe/platform-contract";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (path) => rm(path, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "matrix-engine-platform-operations-"));
  temporaryRoots.push(root);
  return root;
}

async function disposablePaths(root: string, name: string): Promise<{ vault: string; profile: string }> {
  const vault = join(root, `${name}-vault`);
  const profile = join(root, `${name}-profile`);
  await mkdir(vault);
  await mkdir(profile);
  return { vault, profile };
}

async function artifact(root: string, pluginVersion: "0.0.0" | "0.0.1", main = "plugin-runner"): Promise<string> {
  const directory = join(root, `artifact-${pluginVersion}`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "main.js"), main);
  const files = ["main.js", "manifest.json", "vendor/lancedb.cjs", "vendor/native/lancedb.node"].map((path) => ({
    path, size: 1, sha256: "a".repeat(64)
  }));
  const manifestPath = join(directory, "artifact-manifest.json");
  await writeFile(manifestPath, canonicalJson({
    schemaVersion: 1,
    target: "linux-x64-gnu",
    pluginId: "matrix-engine-spike",
    pluginVersion,
    minAppVersion: "1.11.4",
    lancedbVersion: "0.31.0",
    apacheArrowVersion: "18.1.0",
    sourceCommit: "a".repeat(40),
    buildIdentitySha256: "b".repeat(64),
    contentSetSha256: sha256(canonicalJson(files)),
    files,
    allowedRuntime: { platform: "linux", architecture: "x64", libc: "glibc" }
  }));
  return manifestPath;
}

function checkpoints(cell: PlatformProbeRequest["cell"], extra: readonly string[] = []) {
  return [...new Set([...requiredChecks(cell === "minimum-1.11.4" ? "minimum-1.11.4" : "minimum-1.11.4"), ...extra])]
    .map((id) => ({ id, status: "pass" as const, durationMs: 1 }));
}

function state(request: PlatformProbeRequest, extraChecks: readonly string[] = []): PlatformProbeState {
  return {
    schemaVersion: 1,
    request,
    checkpoints: checkpoints(request.cell, extraChecks) as PlatformProbeState["checkpoints"],
    loadSessionIds: ["d9428888-122b-11e1-b85c-61cd3cbb3210"],
    observedArtifacts: [{ contentSetSha256: request.artifactSha256, pluginVersion: request.phase === "initial" || request.phase === "reloaded" ? "0.0.0" : "0.0.1" }],
    runtime: { osVersion: "6.6.1", architecture: "x64", libc: "glibc", obsidianVersion: request.appVersion, electronVersion: "36.1.0", nodeVersion: "22.15.0", nodeAbi: "127" }
  };
}

async function writeState(vault: string, value: PlatformProbeState): Promise<void> {
  const directory = join(vault, ".matrix-engine-spike");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "state.json"), canonicalJson(value));
}

describe("platform operator state machine", () => {
  it("rejects a dirty disposable vault and invalid app version before preparation", async () => {
    const root = await temporaryRoot();
    const manifestPath = await artifact(root, "0.0.1");
    const { vault, profile } = await disposablePaths(root, "dirty");
    await mkdir(join(vault, ".matrix-engine-spike"), { recursive: true });
    await writeFile(join(vault, ".matrix-engine-spike", "state.json"), "{}");
    await expect(preparePlatformRun({ manifestPath, vaultPath: vault, profilePath: profile, cell: "minimum-1.11.4", appVersion: "1.11.4", phase: "initial" })).rejects.toThrow(/DISPOSABLE_VAULT_DIRTY/u);
    const clean = await disposablePaths(root, "clean");
    await expect(preparePlatformRun({ manifestPath, vaultPath: clean.vault, profilePath: clean.profile, cell: "minimum-1.11.4", appVersion: "current", phase: "initial" })).rejects.toThrow();
  });

  it("requires the reviewed artifact version for each cell and phase", async () => {
    const root = await temporaryRoot();
    const oldManifest = await artifact(root, "0.0.0");
    const currentManifest = await artifact(root, "0.0.1");
    const minimum = await disposablePaths(root, "minimum");
    const stable = await disposablePaths(root, "stable");
    await expect(preparePlatformRun({ manifestPath: oldManifest, vaultPath: minimum.vault, profilePath: minimum.profile, cell: "minimum-1.11.4", appVersion: "1.11.4", phase: "initial" })).rejects.toThrow(/ARTIFACT_VERSION_INVALID/u);
    await expect(preparePlatformRun({ manifestPath: currentManifest, vaultPath: stable.vault, profilePath: stable.profile, cell: "current-stable", appVersion: "1.13.1", phase: "initial" })).rejects.toThrow(/ARTIFACT_VERSION_INVALID/u);
  });

  it("rejects skipped, crashed, changed-run, and incomplete phase transitions", async () => {
    const root = await temporaryRoot();
    const oldManifest = await artifact(root, "0.0.0");
    const currentManifest = await artifact(root, "0.0.1");
    const { vault, profile } = await disposablePaths(root, "transition");
    await expect(preparePlatformRun({ manifestPath: oldManifest, vaultPath: vault, profilePath: profile, cell: "current-stable", appVersion: "1.13.1", phase: "reloaded" })).rejects.toThrow(/STATE_MISSING/u);

    const initial = await preparePlatformRun({ manifestPath: oldManifest, vaultPath: vault, profilePath: profile, cell: "current-stable", appVersion: "1.13.1", phase: "initial" });
    await writeState(vault, { ...state(initial), checkpoints: [] });
    await expect(preparePlatformRun({ manifestPath: oldManifest, vaultPath: vault, profilePath: profile, cell: "current-stable", appVersion: "1.13.1", phase: "reloaded" })).rejects.toThrow(/PREVIOUS_PHASE_INCOMPLETE/u);

    await writeState(vault, state(initial));
    await expect(preparePlatformRun({ manifestPath: currentManifest, vaultPath: vault, profilePath: profile, cell: "current-stable", appVersion: "1.13.1", phase: "upgraded" })).rejects.toThrow(/PHASE_TRANSITION_INVALID/u);
    await expect(preparePlatformRun({ manifestPath: await artifact(root, "0.0.0", "changed-runner"), vaultPath: vault, profilePath: profile, cell: "current-stable", appVersion: "1.13.1", phase: "reloaded" })).rejects.toThrow(/REQUEST_CHANGED/u);
  });

  it("accepts the full stable phase sequence only after each prior checkpoint set passes", async () => {
    const root = await temporaryRoot();
    const oldManifest = await artifact(root, "0.0.0");
    const currentManifest = await artifact(root, "0.0.1");
    const { vault, profile } = await disposablePaths(root, "sequence");
    const initial = await preparePlatformRun({ manifestPath: oldManifest, vaultPath: vault, profilePath: profile, cell: "current-stable", appVersion: "1.13.1", phase: "initial" });
    await writeState(vault, state(initial));
    const reloaded = await preparePlatformRun({ manifestPath: oldManifest, vaultPath: vault, profilePath: profile, cell: "current-stable", appVersion: "1.13.1", phase: "reloaded" });
    await writeState(vault, state(reloaded, ["enable-disable-reload"]));
    const upgraded = await preparePlatformRun({ manifestPath: currentManifest, vaultPath: vault, profilePath: profile, cell: "current-stable", appVersion: "1.13.1", phase: "upgraded" });
    await writeState(vault, state(upgraded, ["enable-disable-reload", "prior-artifact-upgrade"]));
    await expect(preparePlatformRun({ manifestPath: currentManifest, vaultPath: vault, profilePath: profile, cell: "current-stable", appVersion: "1.13.1", phase: "complete" })).resolves.toMatchObject({ phase: "complete" });
  });

  it("refuses finalization before cleanup or with incomplete checkpoints", async () => {
    const root = await temporaryRoot();
    const manifestPath = await artifact(root, "0.0.1");
    const { vault, profile } = await disposablePaths(root, "finalize");
    const request = platformProbeRequestSchema.parse({
      ...(await preparePlatformRun({ manifestPath, vaultPath: vault, profilePath: profile, cell: "minimum-1.11.4", appVersion: "1.11.4", phase: "initial" }))
    });
    const copied = join(root, "copied-checkpoints.json");
    await writeFile(copied, canonicalJson({ ...state(request), checkpoints: [] }));
    await expect(finalizePlatformRun({ checkpointsPath: copied, vaultPath: vault, profilePath: profile, outputPath: join(root, "result.json") })).rejects.toThrow(/PROFILE_STILL_EXISTS/u);
    await rm(profile, { recursive: true });
    await expect(finalizePlatformRun({ checkpointsPath: copied, vaultPath: join(root, "different-vault"), profilePath: join(root, "different-profile"), outputPath: join(root, "result.json") })).rejects.toThrow(/PATH_BINDING_MISMATCH/u);
    await expect(finalizePlatformRun({ checkpointsPath: copied, vaultPath: vault, profilePath: profile, outputPath: join(root, "result.json") })).rejects.toThrow(/VAULT_STILL_EXISTS/u);
    await rm(vault, { recursive: true });
    await expect(finalizePlatformRun({ checkpointsPath: copied, vaultPath: vault, profilePath: profile, outputPath: join(root, "result.json") })).resolves.toMatchObject({ status: "unverified", decisionCodes: ["REQUIRED_CHECKS_MISSING"] });
    expect(JSON.parse(await readFile(join(root, "result.json"), "utf8"))).toMatchObject({ evaluation: { status: "unverified" } });
  });
});

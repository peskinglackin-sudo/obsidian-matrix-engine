import { describe, expect, it } from "vitest";

import { appendLoadSession, assertFinalProbeState, mergeCheckpoints } from "../src/probe/platform-state";
import { platformProbeStateSchema, requiredChecks } from "../src/probe/platform-contract";

describe("platform checkpoint production contract", () => {
  it("merges repeated phases by stable checkpoint ID", () => {
    const merged = mergeCheckpoints(
      [{ id: "plugin-loaded", status: "pass", durationMs: 2 }],
      [{ id: "plugin-loaded", status: "pass", durationMs: 1 }, { id: "cleanup", status: "pass", durationMs: 3 }]
    );
    expect(merged).toEqual([
      { id: "cleanup", status: "pass", durationMs: 3 },
      { id: "plugin-loaded", status: "pass", durationMs: 1 }
    ]);
  });

  it("requires all stable lifecycle checkpoints", () => {
    expect(requiredChecks("minimum-1.11.4")).toHaveLength(13);
    expect(requiredChecks("current-stable")).toHaveLength(20);
  });

  it("does not treat repeated runs in one plugin load as reload evidence", () => {
    const first = appendLoadSession([], "d9428888-122b-11e1-b85c-61cd3cbb3210");
    expect(appendLoadSession(first, "d9428888-122b-11e1-b85c-61cd3cbb3210")).toEqual(first);
  });

  it("requires a complete stable phase, distinct loads, and both upgrade artifacts", () => {
    const base = platformProbeStateSchema.parse({
      schemaVersion: 1,
      request: {
        schemaVersion: 1, target: "linux-x64-gnu", cell: "current-stable", appVersion: "1.13.1",
        artifactSha256: "a".repeat(64), pluginRunnerSha256: "b".repeat(64),
        vaultPathSha256: "c".repeat(64), profilePathSha256: "d".repeat(64),
        dependencyVersions: { lancedb: "0.31.0", apacheArrow: "18.1.0" },
        disposableVault: true, disposableProfile: true, phase: "complete"
      },
      checkpoints: [],
      loadSessionIds: ["d9428888-122b-11e1-b85c-61cd3cbb3210", "a9815558-122b-11e1-b85c-61cd3cbb3210"],
      observedArtifacts: [
        { contentSetSha256: "c".repeat(64), pluginVersion: "0.0.0" },
        { contentSetSha256: "d".repeat(64), pluginVersion: "0.0.1" }
      ],
      runtime: { osVersion: "6.6.1", architecture: "x64", libc: "glibc", obsidianVersion: "1.13.1", electronVersion: "36.1.0", nodeVersion: "22.1.0", nodeAbi: "127" }
    });
    expect(() => assertFinalProbeState(base)).not.toThrow();
    expect(() => assertFinalProbeState({ ...base, loadSessionIds: [base.loadSessionIds[0] ?? ""] })).toThrow(/RELOAD_SESSION_MISSING/u);
    expect(() => assertFinalProbeState({ ...base, observedArtifacts: base.observedArtifacts.slice(1) })).toThrow(/UPGRADE_ARTIFACTS_MISSING/u);
    expect(() => assertFinalProbeState({ ...base, request: { ...base.request, phase: "upgraded" } })).toThrow(/STABLE_CELL_INCOMPLETE/u);
  });

  it("rejects content, paths, and operator-authored status fields", () => {
    const input = {
      schemaVersion: 1,
      request: {
        schemaVersion: 1, target: "linux-x64-gnu", cell: "minimum-1.11.4", appVersion: "1.11.4",
        artifactSha256: "a".repeat(64), pluginRunnerSha256: "b".repeat(64),
        vaultPathSha256: "c".repeat(64), profilePathSha256: "d".repeat(64),
        dependencyVersions: { lancedb: "0.31.0", apacheArrow: "18.1.0" },
        disposableVault: true, disposableProfile: true, phase: "initial"
      },
      checkpoints: [], loadSessionIds: [], observedArtifacts: [],
      runtime: { osVersion: "6.6.1", architecture: "x64", libc: "glibc", obsidianVersion: "1.11.4", electronVersion: "36.1.0", nodeVersion: "22.1.0", nodeAbi: "127" },
      vaultPath: "/private/vault",
      operatorStatus: "pass"
    };
    expect(() => platformProbeStateSchema.parse(input)).toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { evaluatePlatformRun } from "../spike/platform-runner/evaluate";
import { requiredChecks } from "../spike/platform-runner/schema";

function run(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    executionKind: "obsidian-desktop",
    target: "linux-x64-gnu",
    cell: "minimum-1.11.4",
    appVersion: "1.11.4",
    artifactSha256: "a".repeat(64),
    pluginRunnerSha256: "b".repeat(64),
    vaultPathSha256: "c".repeat(64),
    profilePathSha256: "d".repeat(64),
    dependencyVersions: { lancedb: "0.31.0", apacheArrow: "18.1.0" },
    disposableVault: true,
    disposableProfile: true,
    runtime: { osVersion: "6.6.1", architecture: "x64", libc: "glibc", obsidianVersion: "1.11.4", electronVersion: "36.1.0", nodeVersion: "22.15.0", nodeAbi: "127" },
    checkpoints: requiredChecks("minimum-1.11.4").map((id) => ({ id, status: "pass", durationMs: 1 })),
    vaultDestroyed: true,
    profileDestroyed: true,
    completed: true,
    ...overrides
  };
}

describe("real-device platform evaluation", () => {
  it("passes only a complete real Obsidian disposable cell", () => {
    expect(evaluatePlatformRun(run())).toMatchObject({ status: "pass", decisionCodes: ["REAL_OBSIDIAN_CELL_PASS"] });
  });

  it("never upgrades Node or CI evidence to a real-device pass", () => {
    expect(evaluatePlatformRun(run({ executionKind: "node-precheck" }))).toMatchObject({ status: "unverified" });
    expect(evaluatePlatformRun(run({ executionKind: "ci-precheck" }))).toMatchObject({ status: "unverified" });
  });

  it("distinguishes missing evidence, check failure, and invalid environments", () => {
    expect(evaluatePlatformRun(run({ checkpoints: [] }))).toMatchObject({ status: "unverified" });
    expect(evaluatePlatformRun(run({ checkpoints: requiredChecks("minimum-1.11.4").map((id) => ({ id, status: id === "cleanup" ? "fail" : "pass", durationMs: 1 })) }))).toMatchObject({ status: "fail" });
    expect(evaluatePlatformRun(run({ disposableProfile: false }))).toMatchObject({ status: "environment_error" });
    expect(evaluatePlatformRun(run({ vaultDestroyed: false }))).toMatchObject({ status: "environment_error" });
    expect(evaluatePlatformRun(run({ runtime: { osVersion: "6.6.1", architecture: "arm64", libc: "glibc", obsidianVersion: "1.11.4", electronVersion: "36.1.0", nodeVersion: "22.15.0", nodeAbi: "127" } }))).toMatchObject({ status: "environment_error" });
  });
});

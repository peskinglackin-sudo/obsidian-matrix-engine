import { z } from "zod";

import { SUPPORTED_TARGETS } from "../native/artifact-manifest";

export const PLATFORM_CELLS = ["minimum-1.11.4", "current-stable"] as const;
export const PLATFORM_PHASES = ["initial", "reloaded", "upgraded", "complete"] as const;

export const commonCheckpointIds = [
  "artifact-verified", "plugin-installed", "plugin-loaded", "secret-set", "secret-get", "secret-list",
  "native-loaded", "crud-query-close", "path-space", "path-zh-hans", "path-ja", "path-emoji", "cleanup"
] as const;
export const stableCheckpointIds = [
  "enable-disable-reload", "prior-artifact-upgrade", "reopen-close", "fts-smoke", "vector-smoke", "repeated-cleanup", "failure-injection-cleanup"
] as const;
export const platformCheckpointIdSchema = z.enum([...commonCheckpointIds, ...stableCheckpointIds]);

export const platformCheckpointSchema = z.strictObject({
  id: platformCheckpointIdSchema,
  status: z.enum(["pass", "fail", "environment_error"]),
  durationMs: z.number().nonnegative(),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u).optional()
});

export const platformProbeRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  target: z.enum(SUPPORTED_TARGETS),
  cell: z.enum(PLATFORM_CELLS),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  pluginRunnerSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  vaultPathSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  profilePathSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  dependencyVersions: z.strictObject({
    lancedb: z.literal("0.31.0"),
    apacheArrow: z.literal("18.1.0")
  }),
  disposableVault: z.literal(true),
  disposableProfile: z.literal(true),
  phase: z.enum(PLATFORM_PHASES)
});

export const platformProbeStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  request: platformProbeRequestSchema,
  checkpoints: z.array(platformCheckpointSchema).max(30),
  loadSessionIds: z.array(z.uuid()).max(10),
  observedArtifacts: z.array(z.strictObject({
    contentSetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    pluginVersion: z.enum(["0.0.0", "0.0.1"])
  })).max(4),
  runtime: z.strictObject({
    osVersion: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,63}$/u),
    architecture: z.enum(["x64", "arm64"]),
    libc: z.enum(["glibc", "none"]),
    obsidianVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    electronVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u),
    nodeVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    nodeAbi: z.string().regex(/^\d+$/u)
  })
});

export type PlatformProbeRequest = z.infer<typeof platformProbeRequestSchema>;
export type PlatformCheckpoint = z.infer<typeof platformCheckpointSchema>;
export type PlatformProbeState = z.infer<typeof platformProbeStateSchema>;

export function requiredChecks(cell: PlatformProbeRequest["cell"]): readonly PlatformCheckpoint["id"][] {
  return cell === "minimum-1.11.4" ? commonCheckpointIds : [...commonCheckpointIds, ...stableCheckpointIds];
}

import { z } from "zod";

import { SUPPORTED_TARGETS } from "../../src/native/artifact-manifest";
import { PLATFORM_CELLS, platformCheckpointSchema, requiredChecks } from "../../src/probe/platform-contract";

export const platformRunInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  executionKind: z.enum(["obsidian-desktop", "node-precheck", "ci-precheck"]),
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
  disposableVault: z.boolean(),
  disposableProfile: z.boolean(),
  runtime: z.strictObject({
    osVersion: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,63}$/u),
    architecture: z.enum(["x64", "arm64"]),
    libc: z.enum(["glibc", "none"]),
    obsidianVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    electronVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u),
    nodeVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    nodeAbi: z.string().regex(/^\d+$/u)
  }),
  checkpoints: z.array(platformCheckpointSchema).max(30),
  vaultDestroyed: z.boolean(),
  profileDestroyed: z.boolean(),
  completed: z.boolean()
});

export type PlatformRunInput = z.infer<typeof platformRunInputSchema>;

export { PLATFORM_CELLS, platformCheckpointSchema, requiredChecks };

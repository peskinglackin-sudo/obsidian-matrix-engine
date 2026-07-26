import { z } from "zod";

export const SUPPORTED_TARGETS = ["win32-x64", "darwin-arm64", "linux-x64-gnu"] as const;
export type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

export const artifactManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  target: z.enum(SUPPORTED_TARGETS),
  pluginId: z.literal("matrix-engine-spike"),
  pluginVersion: z.enum(["0.0.0", "0.0.1"]),
  minAppVersion: z.literal("1.11.4"),
  lancedbVersion: z.literal("0.31.0"),
  apacheArrowVersion: z.literal("18.1.0"),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  buildIdentitySha256: z.string().regex(/^[a-f0-9]{64}$/u),
  contentSetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  files: z.array(z.strictObject({
    path: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })).min(4),
  allowedRuntime: z.strictObject({
    platform: z.enum(["win32", "darwin", "linux"]),
    architecture: z.enum(["x64", "arm64"]),
    libc: z.enum(["glibc", "none"])
  })
});

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;

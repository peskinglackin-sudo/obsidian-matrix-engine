import { z } from "zod";

import { LLAMA_COMMIT } from "./evaluate";

export const llamaBuildManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  target: z.enum(["windows-vulkan", "linux-vulkan", "macos-metal"]),
  sourceCommit: z.literal(LLAMA_COMMIT),
  sourceTreeClean: z.literal(true),
  buildType: z.literal("Release"),
  flags: z.array(z.enum(["CMAKE_BUILD_TYPE=Release", "GGML_METAL=OFF", "GGML_METAL=ON", "GGML_VULKAN=OFF", "GGML_VULKAN=ON"])).length(3),
  cmakeVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/u),
  compiler: z.string().regex(/^[a-zA-Z0-9_.+-]{1,80}$/u),
  compilerVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)*$/u),
  binaryVersion: z.number().int().positive(),
  binaryRevision: z.string().regex(/^[a-f0-9]{7,40}$/u),
  binarySha256: z.string().regex(/^[a-f0-9]{64}$/u)
});

export type LlamaBuildManifest = z.infer<typeof llamaBuildManifestSchema>;

export function assertBuildManifest(manifest: LlamaBuildManifest, platform: "windows-x64" | "macos-arm64" | "linux-x64", binarySha256: string): void {
  const target = { "windows-x64": "windows-vulkan", "linux-x64": "linux-vulkan", "macos-arm64": "macos-metal" } as const;
  const requiredFlag = platform === "macos-arm64" ? "GGML_METAL=ON" : "GGML_VULKAN=ON";
  if (manifest.target !== target[platform] || !manifest.flags.includes(requiredFlag) || manifest.binarySha256 !== binarySha256 || !LLAMA_COMMIT.startsWith(manifest.binaryRevision)) {
    throw new Error("LLAMA_BUILD_MANIFEST_INVALID");
  }
}

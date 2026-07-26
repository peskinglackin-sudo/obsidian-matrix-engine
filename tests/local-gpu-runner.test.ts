import { describe, expect, it } from "vitest";

import { assertListedDevice, cosine, parseFullGpuOffload } from "../spike/local-gpu/log-parser";
import { assertBuildManifest, llamaBuildManifestSchema } from "../spike/local-gpu/build-manifest";
import { LLAMA_COMMIT } from "../spike/local-gpu/evaluate";
import { buildServerArgs } from "../spike/local-gpu/process";
import { parseVulkanSummary } from "../spike/local-gpu/runtime-metadata";

describe("llama.cpp GPU evidence parsing", () => {
  it("requires exact full layer offload", () => {
    expect(parseFullGpuOffload("load_tensors: offloaded 25/25 layers to GPU")).toEqual({ offloadedLayers: 25, totalLayers: 25 });
    expect(() => parseFullGpuOffload("load_tensors: offloaded 24/25 layers to GPU")).toThrow(/INCOMPLETE/u);
    expect(() => parseFullGpuOffload("warning: no usable GPU found")).toThrow(/NOT_USABLE/u);
  });

  it("requires the named backend and device", () => {
    expect(() => assertListedDevice("Vulkan0: Example GPU", "Vulkan0", "vulkan", "Example GPU")).not.toThrow();
    expect(() => assertListedDevice("Metal: Example GPU", "Vulkan0", "vulkan")).toThrow();
    expect(() => assertListedDevice("Vulkan0: Other GPU", "Vulkan0", "vulkan", "Example GPU")).toThrow(/NAME_NOT_LISTED/u);
  });

  it("computes finite vector cosine without accepting shape drift", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(() => cosine([1], [1, 0])).toThrow(/SHAPE/u);
    expect(() => cosine([Number.NaN], [1])).toThrow(/VALUE/u);
  });

  it("binds the loopback model alias and approved GPU flags", () => {
    expect(buildServerArgs({ model: "/not-reported/model.gguf", port: 18081, device: "Vulkan0", gpu: true })).toEqual(expect.arrayContaining([
      "--alias", "jina-v5-nano", "--host", "127.0.0.1", "--embedding", "--pooling", "last",
      "--device", "Vulkan0", "--n-gpu-layers", "all"
    ]));
  });

  it("binds Vulkan API and driver metadata to the expected physical device", () => {
    const summary = "GPU0:\n\tapiVersion = 1.3.280\n\tdriverVersion = 550.40.7\n\tdeviceName = Example Integrated GPU\n";
    expect(parseVulkanSummary(summary, "Example Integrated GPU")).toEqual({ apiVersion: "1.3.280", driverVersion: "550.40.7" });
    expect(() => parseVulkanSummary(summary, "Different GPU")).toThrow(/METADATA_MISSING/u);
    expect(() => parseVulkanSummary(summary.replace("1.3.280", "1.1.99"), "Example Integrated GPU")).toThrow(/VERSION_INVALID/u);
  });

  it("binds the clean build target, flags, revision, and binary hash", () => {
    const manifest = llamaBuildManifestSchema.parse({
      schemaVersion: 1, target: "linux-vulkan", sourceCommit: LLAMA_COMMIT,
      sourceTreeClean: true, buildType: "Release",
      flags: ["CMAKE_BUILD_TYPE=Release", "GGML_METAL=OFF", "GGML_VULKAN=ON"],
      cmakeVersion: "4.1.0", compiler: "GNU-g++", compilerVersion: "15.1.0",
      binaryVersion: 10018, binaryRevision: LLAMA_COMMIT.slice(0, 8), binarySha256: "a".repeat(64)
    });
    expect(() => assertBuildManifest(manifest, "linux-x64", "a".repeat(64))).not.toThrow();
    expect(() => assertBuildManifest(manifest, "windows-x64", "a".repeat(64))).toThrow(/MANIFEST_INVALID/u);
    expect(() => assertBuildManifest(manifest, "linux-x64", "b".repeat(64))).toThrow(/MANIFEST_INVALID/u);
  });
});

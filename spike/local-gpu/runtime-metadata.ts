import { spawnSync } from "node:child_process";

export type BackendMetadata = Readonly<{ apiVersion: string; driverVersion: string }>;

function command(commandName: string, args: readonly string[]): string {
  const result = spawnSync(commandName, args, { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0) throw new Error("GPU_RUNTIME_METADATA_FAILED");
  return `${result.stdout}${result.stderr}`;
}

export function parseVulkanSummary(summary: string, expectedDeviceName: string): BackendMetadata {
  const block = summary.split(/(?=^GPU\d+:)/gmu).find((candidate) => candidate.toLocaleLowerCase("en-US").includes(expectedDeviceName.toLocaleLowerCase("en-US")));
  const apiVersion = block?.match(/^\s*apiVersion\s*=\s*(\d+\.\d+(?:\.\d+)?)/mu)?.[1];
  const driverVersion = block?.match(/^\s*driverVersion\s*=\s*([a-zA-Z0-9_.+-]+)/mu)?.[1];
  if (apiVersion === undefined || driverVersion === undefined) throw new Error("VULKAN_DEVICE_METADATA_MISSING");
  const [major = 0, minor = 0] = apiVersion.split(".").map(Number);
  if (major < 1 || (major === 1 && minor < 2)) throw new Error("VULKAN_VERSION_INVALID");
  return Object.freeze({ apiVersion, driverVersion });
}

export function collectBackendMetadata(backend: "vulkan" | "metal", expectedDeviceName?: string): BackendMetadata {
  if (backend === "vulkan") {
    if (expectedDeviceName === undefined || expectedDeviceName.length === 0) throw new Error("VULKAN_DEVICE_NAME_REQUIRED");
    return parseVulkanSummary(command("vulkaninfo", ["--summary"]), expectedDeviceName);
  }
  const version = command("sw_vers", ["-productVersion"]).trim();
  if (!/^\d+\.\d+(?:\.\d+)?$/u.test(version)) throw new Error("METAL_RUNTIME_VERSION_INVALID");
  return Object.freeze({ apiVersion: "native-metal", driverVersion: version });
}

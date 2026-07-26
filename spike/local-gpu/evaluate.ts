import { z } from "zod";
export const MODEL_SIZE = 232883776;
export const MODEL_SHA256 = "86b6e6279e9b9e71389f02a082764a2ac2b15a50e37482c26f98d69092f12442";
export const LLAMA_COMMIT = "22b208b1cacb67bae191b00d795dae7cc819edb8";
export const REPEAT_MINIMUM_COSINE = 0.99999;
const inputSchema = z.strictObject({
  platform: z.enum(["windows-x64", "macos-arm64", "linux-x64"]),
  backend: z.enum(["vulkan", "metal"]),
  modelSize: z.number().int(), modelSha256: z.string(), llamaCommit: z.string(),
  deviceListed: z.boolean(), explicitlySelected: z.boolean(), apiVersion: z.union([z.literal("native-metal"), z.string().regex(/^\d+\.\d+(?:\.\d+)?$/u)]),
  offloadedLayers: z.number().int().nonnegative(), totalLayers: z.number().int().positive(),
  vectorDimensions: z.number().int(), allFinite: z.boolean(), normalized: z.boolean(),
  minimumCosine: z.number(), cleanShutdown: z.boolean(), batchOrder: z.boolean(),
  repeatMinimumCosine: z.number(), cancellation: z.boolean(), timeout: z.boolean(),
  invalidInput: z.boolean(), emptyInput: z.boolean(), oversizeInput: z.boolean()
});
export function evaluateLocalGpu(input: unknown) {
  const value = inputSchema.parse(input);
  const expectedBackend = value.platform === "macos-arm64" ? "metal" : "vulkan";
  const failures: string[] = [];
  if (value.backend !== expectedBackend) failures.push("GPU_BACKEND_INVALID");
  if (value.modelSize !== MODEL_SIZE || value.modelSha256 !== MODEL_SHA256) failures.push("MODEL_IDENTITY_INVALID");
  if (value.llamaCommit !== LLAMA_COMMIT) failures.push("LLAMA_COMMIT_INVALID");
  if (!value.deviceListed || !value.explicitlySelected) failures.push("GPU_DEVICE_INVALID");
  if (value.backend === "vulkan") {
    const [major = 0, minor = 0] = value.apiVersion.split(".").map(Number);
    if (major < 1 || (major === 1 && minor < 2)) failures.push("VULKAN_VERSION_INVALID");
  }
  if (value.offloadedLayers !== value.totalLayers) failures.push("GPU_OFFLOAD_INCOMPLETE");
  if (value.vectorDimensions !== 768 || !value.allFinite || !value.normalized) failures.push("VECTOR_INVALID");
  if (!value.batchOrder) failures.push("BATCH_ORDER_INVALID");
  if (value.repeatMinimumCosine < REPEAT_MINIMUM_COSINE) failures.push("GPU_REPEAT_TOLERANCE_FAILED");
  if (!value.cancellation || !value.timeout || !value.invalidInput || !value.emptyInput || !value.oversizeInput) failures.push("GPU_BEHAVIOR_CHECK_FAILED");
  if (value.minimumCosine < 0.999) failures.push("GPU_CPU_PARITY_FAILED");
  if (!value.cleanShutdown) failures.push("CLEANUP_FAILED");
  return Object.freeze({ status: failures.length === 0 ? "pass" as const : "fail" as const, decisionCodes: Object.freeze(failures.length === 0 ? ["LOCAL_GPU_PASS"] : failures) });
}

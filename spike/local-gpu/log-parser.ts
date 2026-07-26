export type OffloadEvidence = Readonly<{ offloadedLayers: number; totalLayers: number }>;

export function parseFullGpuOffload(log: string): OffloadEvidence {
  if (/no usable GPU found/iu.test(log)) throw new Error("GPU_NOT_USABLE");
  const matches = [...log.matchAll(/offloaded\s+(\d+)\/(\d+)\s+layers to GPU/giu)];
  const last = matches.at(-1);
  if (last === undefined) throw new Error("GPU_OFFLOAD_EVIDENCE_MISSING");
  const offloadedLayers = Number.parseInt(last[1] ?? "", 10);
  const totalLayers = Number.parseInt(last[2] ?? "", 10);
  if (!Number.isSafeInteger(offloadedLayers) || !Number.isSafeInteger(totalLayers) || offloadedLayers !== totalLayers || totalLayers <= 0) {
    throw new Error("GPU_OFFLOAD_INCOMPLETE");
  }
  return Object.freeze({ offloadedLayers, totalLayers });
}

export function assertListedDevice(log: string, expectedDevice: string, backend: "vulkan" | "metal", expectedDeviceName?: string): void {
  if (!log.includes(expectedDevice)) throw new Error("GPU_DEVICE_NOT_LISTED");
  if (!new RegExp(backend, "iu").test(log)) throw new Error("GPU_BACKEND_NOT_LISTED");
  if (expectedDeviceName !== undefined && !log.toLocaleLowerCase("en-US").includes(expectedDeviceName.toLocaleLowerCase("en-US"))) throw new Error("GPU_DEVICE_NAME_NOT_LISTED");
}

export function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) throw new Error("VECTOR_SHAPE_INVALID");
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]; const b = right[index];
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) throw new Error("VECTOR_VALUE_INVALID");
    dot += a * b; leftNorm += a * a; rightNorm += b * b;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}

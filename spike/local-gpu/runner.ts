import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import { canonicalJson } from "../evidence/canonical";
import { buildSemanticWorkload } from "../semantic/runner";
import { assertBuildManifest, llamaBuildManifestSchema } from "./build-manifest";
import { evaluateLocalGpu, LLAMA_COMMIT, MODEL_SHA256, MODEL_SIZE } from "./evaluate";
import { assertListedDevice, cosine, parseFullGpuOffload } from "./log-parser";
import { verifyPinnedModel } from "./model";
import { fileSha256, listDevices, runEmbeddingServer } from "./process";
import { collectBackendMetadata } from "./runtime-metadata";

function option(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function required(name: string): string { const value = option(name); if (value === undefined) throw new Error(`Missing ${name}`); return value; }

const binary = resolve(required("--binary"));
const model = resolve(required("--model"));
const device = required("--device");
const platform = required("--platform") as "windows-x64" | "macos-arm64" | "linux-x64";
const backend = platform === "macos-arm64" ? "metal" as const : "vulkan" as const;
const output = resolve(required("--output"));
const binarySha256 = await fileSha256(binary);
const buildManifest = llamaBuildManifestSchema.parse(JSON.parse(await readFile(resolve(required("--build-manifest")), "utf8")));
assertBuildManifest(buildManifest, platform, binarySha256);
const verification = await verifyPinnedModel(model);
if (verification.status !== "pass") throw new Error(verification.code);
const deviceLog = listDevices(binary);
const deviceName = required("--device-name");
assertListedDevice(deviceLog, device, backend, deviceName);
const backendMetadata = collectBackendMetadata(backend, backend === "vulkan" ? deviceName : undefined);
const semanticWorkload = buildSemanticWorkload();
const gpu = await runEmbeddingServer({ binary, model, port: 18081, device, gpu: true, workloadInputs: semanticWorkload.inputs });
const cpu = await runEmbeddingServer({ binary, model, port: 18082, device, gpu: false, workloadInputs: semanticWorkload.inputs });
if (gpu.behavior === undefined) throw new Error("GPU_BEHAVIOR_EVIDENCE_MISSING");
const offload = parseFullGpuOffload(gpu.log);
const similarities = gpu.vectors.map((vector, index) => cosine(vector, cpu.vectors[index] ?? []));
const protocolMinimumCosine = Math.min(...similarities);
const workloadMinimumCosine = Math.min(...gpu.workloadVectors.map((vector, index) => cosine(vector, cpu.workloadVectors[index] ?? [])));
const overallMinimumCosine = Math.min(protocolMinimumCosine, workloadMinimumCosine);
const gpuSemantic = semanticWorkload.evaluate(gpu.workloadVectors, { backend, platform, modelSha256: MODEL_SHA256, llamaCommit: LLAMA_COMMIT });
const cpuSemantic = semanticWorkload.evaluate(cpu.workloadVectors, { backend: "cpu", platform, modelSha256: MODEL_SHA256, llamaCommit: LLAMA_COMMIT });
const allGpuVectors = [...gpu.vectors, ...gpu.workloadVectors];
const vectorDimensionsValid = allGpuVectors.every((vector) => vector.length === 768);
const allFinite = allGpuVectors.every((vector) => vector.every(Number.isFinite));
const normalized = allGpuVectors.every((vector) => Math.abs(Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) - 1) <= 0.01);
const input = {
  platform, backend, modelSize: MODEL_SIZE, modelSha256: MODEL_SHA256, llamaCommit: LLAMA_COMMIT,
  deviceListed: true, explicitlySelected: true, apiVersion: backendMetadata.apiVersion,
  offloadedLayers: offload.offloadedLayers, totalLayers: offload.totalLayers,
  vectorDimensions: vectorDimensionsValid ? 768 : 0,
  allFinite,
  normalized, minimumCosine: overallMinimumCosine, cleanShutdown: gpu.cleanShutdown && cpu.cleanShutdown,
  ...gpu.behavior
};
const evaluation = evaluateLocalGpu(input);
const deviceIdSha256 = createHash("sha256").update(`${backend}:${device}:${deviceName}`).digest("hex");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, canonicalJson({
  schemaVersion: 1, status: evaluation.status, decisionCodes: evaluation.decisionCodes,
  platform, backend, deviceIdSha256, binarySha256, backendMetadata,
  build: {
    target: buildManifest.target, buildType: buildManifest.buildType, flags: buildManifest.flags,
    cmakeVersion: buildManifest.cmakeVersion, compiler: buildManifest.compiler,
    compilerVersion: buildManifest.compilerVersion, binaryVersion: buildManifest.binaryVersion,
    binaryRevision: buildManifest.binaryRevision
  },
  modelSha256: MODEL_SHA256, llamaCommit: LLAMA_COMMIT, dimensions: input.vectorDimensions,
  vectorCount: gpu.vectors.length, workloadVectorCount: gpu.workloadVectors.length, workloadDimensions: vectorDimensionsValid ? 768 : 0,
  protocolMinimumCosine, workloadMinimumCosine, overallMinimumCosine, offload, cleanShutdown: input.cleanShutdown,
  behavior: gpu.behavior,
  semantic: {
    fixtureSha256: gpuSemantic.resultSet.fixtureSha256,
    recipeSha256: gpuSemantic.resultSet.recipeSha256,
    gpu: { resultSet: gpuSemantic.resultSet, evaluation: gpuSemantic.evaluation },
    cpu: { resultSet: cpuSemantic.resultSet, evaluation: cpuSemantic.evaluation }
  }
}), { mode: 0o600 });
process.stdout.write(`${evaluation.status}\n`);
if (evaluation.status !== "pass") process.exitCode = 1;

import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { EmbeddingProviderResult } from "../../src/providers/embedding";
import { OpenAiCompatibleEmbeddingProvider } from "../../src/providers/openai-compatible";
import { REPEAT_MINIMUM_COSINE } from "./evaluate";
import { cosine, parseFullGpuOffload } from "./log-parser";

const INPUTS = ["Query: synthetic retrieval note", "Query: 合成检索笔记", "Query: 検索用の合成ノート"] as const;
const MODEL_ALIAS = "jina-v5-nano";

export type LocalBehaviorChecks = Readonly<{
  batchOrder: boolean;
  repeatMinimumCosine: number;
  cancellation: boolean;
  timeout: boolean;
  invalidInput: boolean;
  emptyInput: boolean;
  oversizeInput: boolean;
}>;

export async function fileSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export function buildServerArgs(options: Readonly<{ model: string; port: number; device: string; gpu: boolean }>): string[] {
  return [
    "--model", options.model, "--alias", MODEL_ALIAS,
    "--host", "127.0.0.1", "--port", String(options.port),
    "--embedding", "--pooling", "last", "--ctx-size", "8192", "--batch-size", "512",
    "--ubatch-size", "512", "--device", options.gpu ? options.device : "none",
    "--n-gpu-layers", options.gpu ? "all" : "0"
  ];
}

export function listDevices(binary: string): string {
  const result = spawnSync(binary, ["--list-devices"], { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0) throw new Error("GPU_DEVICE_LIST_FAILED");
  return `${result.stdout}${result.stderr}`;
}

async function waitForServer(port: number, child: ChildProcessWithoutNullStreams, log: () => string, spawnFailed: () => boolean): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (spawnFailed() || child.exitCode !== null) throw new Error("LLAMA_SERVER_EXITED");
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/health`);
      if (response.ok) return;
    } catch {
      // The loopback server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (/no usable GPU found/iu.test(log())) throw new Error("GPU_NOT_USABLE");
  throw new Error("LLAMA_SERVER_START_TIMEOUT");
}

async function stopServer(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  if (child.exitCode !== null || !child.kill("SIGTERM")) return false;
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function hasCode(result: EmbeddingProviderResult, code: string): boolean {
  return !result.ok && result.error.code === code;
}

async function checkGpuBehavior(provider: OpenAiCompatibleEmbeddingProvider, vectors: readonly (readonly number[])[]): Promise<LocalBehaviorChecks> {
  const repeated = await provider.embed({ inputs: INPUTS, timeoutMs: 30_000 });
  if (!repeated.ok || repeated.value.vectors.length !== vectors.length) throw new Error("GPU_REPEAT_FAILED");
  const repeatMinimumCosine = Math.min(...vectors.map((vector, index) => cosine(vector, repeated.value.vectors[index] ?? [])));
  const individualVectors = await Promise.all(INPUTS.map(async (input) => {
    const result = await provider.embed({ inputs: [input], timeoutMs: 30_000 });
    if (!result.ok || result.value.vectors[0] === undefined) throw new Error("GPU_BATCH_ORDER_PROBE_FAILED");
    return result.value.vectors[0];
  }));
  const batchOrder = vectors.every((vector, index) => cosine(vector, individualVectors[index] ?? []) >= REPEAT_MINIMUM_COSINE);

  const controller = new AbortController();
  const cancellation = provider.embed({ inputs: INPUTS, timeoutMs: 30_000, signal: controller.signal });
  controller.abort();
  const cancelled = await cancellation;
  const timedOut = await provider.embed({ inputs: INPUTS, timeoutMs: 0 });
  const invalid = await provider.embed({ inputs: [""], timeoutMs: 30_000 });
  const empty = await provider.embed({ inputs: [], timeoutMs: 30_000 });
  const oversize = await provider.embed({ inputs: ["x".repeat(8193)], timeoutMs: 30_000 });
  return Object.freeze({
    batchOrder,
    repeatMinimumCosine,
    cancellation: hasCode(cancelled, "OPERATION_CANCELLED"),
    timeout: hasCode(timedOut, "PROVIDER_TIMEOUT"),
    invalidInput: hasCode(invalid, "PROVIDER_INPUT_INVALID"),
    emptyInput: hasCode(empty, "PROVIDER_INPUT_INVALID"),
    oversizeInput: hasCode(oversize, "PROVIDER_INPUT_INVALID")
  });
}

async function embedWorkload(provider: OpenAiCompatibleEmbeddingProvider, inputs: readonly string[]): Promise<readonly (readonly number[])[]> {
  const vectors: (readonly number[])[] = [];
  for (let start = 0; start < inputs.length; start += 128) {
    const batch = inputs.slice(start, start + 128);
    const result = await provider.embed({ inputs: batch, timeoutMs: 120_000 });
    if (!result.ok) throw new Error(result.error.code);
    vectors.push(...result.value.vectors);
  }
  if (vectors.length !== inputs.length) throw new Error("LLAMA_WORKLOAD_RESULT_INVALID");
  return Object.freeze(vectors);
}

export async function runEmbeddingServer(options: Readonly<{
  binary: string;
  model: string;
  port: number;
  device: string;
  gpu: boolean;
  workloadInputs?: readonly string[];
}>): Promise<Readonly<{ vectors: readonly (readonly number[])[]; workloadVectors: readonly (readonly number[])[]; log: string; cleanShutdown: boolean; behavior?: LocalBehaviorChecks }>> {
  const child = spawn(options.binary, buildServerArgs(options), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let boundedLog = "";
  let spawnFailed = false;
  const capture = (chunk: Buffer) => { boundedLog = `${boundedLog}${chunk.toString("utf8")}`.slice(-256 * 1024); };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", () => { spawnFailed = true; });

  let vectors: readonly (readonly number[])[] | undefined;
  let behavior: LocalBehaviorChecks | undefined;
  let workloadVectors: readonly (readonly number[])[] = Object.freeze([]);
  let operationError: unknown;
  try {
    await waitForServer(options.port, child, () => boundedLog, () => spawnFailed);
    if (options.gpu) parseFullGpuOffload(boundedLog);
    const provider = new OpenAiCompatibleEmbeddingProvider({
      baseUrl: `http://127.0.0.1:${String(options.port)}/v1`,
      apiKey: "local-loopback",
      model: MODEL_ALIAS,
      dimensions: 768
    });
    const result = await provider.embed({ inputs: INPUTS, timeoutMs: 30_000 });
    if (!result.ok) throw new Error(result.error.code);
    vectors = result.value.vectors;
    if (options.gpu) behavior = await checkGpuBehavior(provider, vectors);
    if (options.workloadInputs !== undefined) workloadVectors = await embedWorkload(provider, options.workloadInputs);
  } catch (error: unknown) {
    operationError = error;
  }

  const cleanShutdown = await stopServer(child);
  if (!cleanShutdown) throw new Error("LLAMA_SERVER_CLEANUP_FAILED");
  if (operationError !== undefined) throw operationError instanceof Error ? operationError : new Error("LLAMA_EMBEDDING_FAILED");
  if (vectors === undefined) throw new Error("LLAMA_EMBEDDING_RESULT_MISSING");
  return Object.freeze({ vectors, workloadVectors, log: boundedLog, cleanShutdown, ...(behavior === undefined ? {} : { behavior }) });
}

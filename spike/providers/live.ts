import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import { canonicalJson, sha256 } from "../evidence/canonical";
import { OpenAiCompatibleEmbeddingProvider, validateEmbeddingBaseUrl } from "../../src/providers/openai-compatible";
const baseUrl = process.env.OPENAI_BASE_URL;
const key = process.env.OPENAI_KEY;
if (baseUrl === undefined || key === undefined) throw new Error("LIVE_ENVIRONMENT_MISSING");
validateEmbeddingBaseUrl(baseUrl);
const provider = new OpenAiCompatibleEmbeddingProvider({ baseUrl, apiKey: key, model: "text-embedding-3-small", dimensions: 1536 });
const started = performance.now();
const result = await provider.embed({ inputs: ["synthetic retrieval note", "合成检索笔记", "検索用の合成ノート"], timeoutMs: 30000 });
const elapsedMs = performance.now() - started;
await mkdir("reports/provider-live", { recursive: true });
if (!result.ok) {
  await writeFile("reports/provider-live/redacted-failure.json", canonicalJson({ schemaVersion: 1, status: "fail", model: "text-embedding-3-small", error: result.error, elapsedMs }), { mode: 0o600 });
  process.stderr.write(`LIVE_PROBE_FAILED ${result.error.code}\n`);
  process.exitCode = 1;
} else {
  const vectorDigest = sha256(canonicalJson(result.value.vectors.map((vector) => ({ dimensions: vector.length, finite: vector.every(Number.isFinite) }))));
  await writeFile("reports/provider-live/result.json", canonicalJson({ schemaVersion: 1, status: "pass", model: result.value.model, dimensions: result.value.dimensions, vectorCount: result.value.vectors.length, vectorShapeSha256: vectorDigest, usage: result.value.usage, elapsedMs, testedAt: new Date().toISOString() }), { mode: 0o600 });
  process.stdout.write("LIVE_PROBE_PASS\n");
}

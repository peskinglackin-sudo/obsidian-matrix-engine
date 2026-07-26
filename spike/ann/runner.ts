import { mkdtemp, rm, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { connect, Index, type Table } from "@lancedb/lancedb";
import { canonicalJson, sha256 } from "../evidence/canonical";
import { evaluateAnn, type AnnQueryResult } from "./evaluate";
const VECTOR_COUNT = 50_000; const DIMENSIONS = 768; const QUERY_COUNT = 500;
function random(seed: number) { let state = seed >>> 0; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; }; }
function vectorFor(index: number) { const next = random(20260715 ^ index); const vector = new Array<number>(DIMENSIONS); let norm = 0; for (let dimension = 0; dimension < DIMENSIONS; dimension += 1) { const value = next() * 2 - 1; vector[dimension] = value; norm += value * value; } const scale = 1 / Math.sqrt(norm); return vector.map((value) => value * scale); }
async function query(table: Table, vectors: readonly (readonly number[])[], indexed: boolean, options?: { probes: number; refine: number }) {
  const rows: string[][] = []; const latencies: number[] = [];
  for (const vector of vectors) { const started = performance.now(); let builder = table.vectorSearch([...vector]).distanceType("cosine").limit(20); if (!indexed) builder = builder.bypassVectorIndex(); if (options !== undefined) builder = builder.nprobes(options.probes).refineFactor(options.refine); const result: unknown[] = await builder.select(["id", "_distance"]).toArray(); latencies.push(performance.now() - started); rows.push(result.map((row) => { if (typeof row !== "object" || row === null || !("id" in row)) throw new Error("ANN result row is missing an ID"); return String(row.id); })); }
  return { rows, latencies };
}
function percentile(values: readonly number[], p: number) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0; }
async function directorySize(path: string): Promise<number> { let total = 0; for (const entry of await readdir(path, { withFileTypes: true })) { const child = join(path, entry.name); total += entry.isDirectory() ? await directorySize(child) : (await stat(child)).size; } return total; }
async function timedProtocol(table: Table, queries: readonly (readonly number[])[], indexed: boolean, options?: { probes: number; refine: number }) {
  const cold = await query(table, queries.slice(0, 1), indexed, options);
  for (let warmup = 0; warmup < 2; warmup += 1) await query(table, queries, indexed, options);
  const timed: number[] = [];
  let lastRows: string[][] = [];
  for (let repetition = 0; repetition < 10; repetition += 1) {
    const result = await query(table, queries, indexed, options);
    timed.push(...result.latencies);
    lastRows = result.rows;
  }
  return { coldFirstQueryMs: cold.latencies[0] ?? 0, timed, lastRows };
}
export async function runAnnBenchmark(output = "reports/ann") {
  const directory = await mkdtemp(join(tmpdir(), "matrix-engine-ann-")); const db = await connect(directory);
  try {
    let table: Table | undefined;
    try {
      for (let start = 0; start < VECTOR_COUNT; start += 250) { const batch = Array.from({ length: Math.min(250, VECTOR_COUNT - start) }, (_, offset) => ({ id: `v-${String(start + offset).padStart(5, "0")}`, vector: vectorFor(start + offset) })); if (table === undefined) table = await db.createTable("benchmark", batch, { mode: "overwrite" }); else await table.add(batch); }
      if (table === undefined) throw new Error("ANN table was not created");
      const queries = Array.from({ length: QUERY_COUNT }, (_, index) => vectorFor(index * 97));
      const ground = await query(table, queries, false);
      const groundIds = ground.rows.map((ids) => ids.slice(0, 10));
      const flat = await timedProtocol(table, queries, false);
      const configurations = [
        { id: "default-cosine", indexParameters: { distanceType: "cosine" as const, numPartitions: "sdk-default-sqrt-rows" as const, numSubVectors: "sdk-default-dimension-derived" as const, numBits: 8 as const }, config: Index.ivfPq({ distanceType: "cosine" }), queryParameters: { probes: 20, refine: 2 } },
        { id: "ivfpq-128-48-8", indexParameters: { distanceType: "cosine" as const, numPartitions: 128, numSubVectors: 48, numBits: 8 as const }, config: Index.ivfPq({ distanceType: "cosine", numPartitions: 128, numSubVectors: 48, numBits: 8 }), queryParameters: { probes: 20, refine: 2 } },
        { id: "ivfpq-256-48-8", indexParameters: { distanceType: "cosine" as const, numPartitions: 256, numSubVectors: 48, numBits: 8 as const }, config: Index.ivfPq({ distanceType: "cosine", numPartitions: 256, numSubVectors: 48, numBits: 8 }), queryParameters: { probes: 32, refine: 2 } }
      ];
      const reports = [];
      for (const configuration of configurations) {
        const existing = await table.listIndices(); if (existing.some(({ name }) => name === "vector_idx")) { await table.dropIndex("vector_idx"); await table.optimize(); }
        const dataSizeBeforeIndex = await directorySize(directory);
        const buildStarted = performance.now(); await table.createIndex("vector", { config: configuration.config }); const buildMs = performance.now() - buildStarted;
        table.close();
        const openStarted = performance.now(); table = await db.openTable("benchmark"); const openMs = performance.now() - openStarted;
        const indexAndDataSizeBytes = await directorySize(directory);
        const indexSizeBytes = Math.max(0, indexAndDataSizeBytes - dataSizeBeforeIndex);
        const measured = await timedProtocol(table, queries, true, configuration.queryParameters);
        const recalls: AnnQueryResult[] = measured.lastRows.map((ids, index) => { const expected10 = new Set(groundIds[index]?.slice(0, 10)); const expected20 = new Set(ground.rows[index]?.slice(0, 20)); const hit10 = ids.slice(0, 10).filter((id) => expected10.has(id)).length; const hit20 = ids.slice(0, 20).filter((id) => expected20.has(id)).length; return { id: `q-${String(index).padStart(3, "0")}`, recallAt10: hit10 / 10, recallAt20: hit20 / 20 }; });
        const timing = { flatP95Ms: percentile(flat.timed, 0.95), annP95Ms: percentile(measured.timed, 0.95) };
        reports.push({ id: configuration.id, indexParameters: configuration.indexParameters, queryParameters: configuration.queryParameters, buildMs, openMs, coldFirstQueryMs: measured.coldFirstQueryMs, dataSizeBeforeIndex, indexSizeBytes, indexAndDataSizeBytes, latency: { p50: percentile(measured.timed, 0.5), p95: timing.annP95Ms, p99: percentile(measured.timed, 0.99) }, evaluation: evaluateAnn(recalls, timing), queryResults: recalls });
      }
      const fixture = { seed: 20260715, vectorCount: VECTOR_COUNT, dimensions: DIMENSIONS, queryCount: QUERY_COUNT, repetitions: 10, warmups: 2, coldPreflights: 1, distance: "cosine" };
      await mkdir(output, { recursive: true }); await writeFile(join(output, "benchmark.json"), canonicalJson({ schemaVersion: 2, fixtureSha256: sha256(canonicalJson(fixture)), fixture, flat: { coldFirstQueryMs: flat.coldFirstQueryMs, latency: { p50: percentile(flat.timed, 0.5), p95: percentile(flat.timed, 0.95), p99: percentile(flat.timed, 0.99) } }, configurations: reports }), { mode: 0o600 });
      return reports;
    } finally { table?.close(); }
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1]?.endsWith("runner.ts") === true) { const reports = await runAnnBenchmark(); process.stdout.write(`${reports.map(({ id, evaluation }) => `${id}:${evaluation.decision}`).join(" ")}\n`); }

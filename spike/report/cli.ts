import { mkdir, readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import { canonicalJson } from "../evidence/canonical";
import { projectSafeEvidence } from "./projection";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const status = z.enum(["pass", "fail", "unverified", "environment_error"]);
const ftsSchema = z.object({ schemaVersion: z.literal(1), lancedbVersion: z.literal("0.31.0"), authoritativeScope: z.string(), checks: z.array(z.object({ id: z.string(), status })) });
const lexicalSchema = z.object({ schemaVersion: z.literal(1), status: z.literal("pass"), fixtureSha256: hash, documentCount: z.number().int(), queryCount: z.number().int(), groups: z.array(z.object({ group: z.string(), count: z.number().int(), recallAt10: z.number(), mrrAt10: z.number(), zeroResultRate: z.number(), pass: z.boolean() })) });
const liveSchema = z.object({ schemaVersion: z.literal(1), status: z.literal("pass"), model: z.literal("text-embedding-3-small"), testedAt: z.string(), dimensions: z.number().int(), vectorCount: z.number().int(), vectorShapeSha256: hash });
const semanticFixtureSchema = z.object({ schemaVersion: z.literal(2), sha256: hash, recipeSha256: hash, documents: z.array(z.unknown()), distractors: z.array(z.unknown()), sameLanguage: z.array(z.unknown()), crossLanguage: z.array(z.unknown()), prefixControls: z.object({ queries: z.array(z.unknown()), documents: z.array(z.unknown()) }) });
const annSchema = z.object({ schemaVersion: z.literal(2), fixtureSha256: hash, fixture: z.object({ vectorCount: z.literal(50_000), dimensions: z.literal(768), queryCount: z.literal(500), repetitions: z.literal(10), warmups: z.literal(2), coldPreflights: z.literal(1) }), flat: z.object({ coldFirstQueryMs: z.number(), latency: z.object({ p50: z.number(), p95: z.number(), p99: z.number() }) }), configurations: z.array(z.object({ id: z.string(), buildMs: z.number(), openMs: z.number(), coldFirstQueryMs: z.number(), dataSizeBeforeIndex: z.number().int(), indexSizeBytes: z.number().int(), indexAndDataSizeBytes: z.number().int(), indexParameters: z.record(z.string(), z.unknown()), queryParameters: z.record(z.string(), z.unknown()), latency: z.object({ p50: z.number(), p95: z.number(), p99: z.number() }), evaluation: z.object({ decision: z.enum(["flat-default", "ann-default", "insufficient"]), decisionCodes: z.array(z.string()), aggregateRecallAt10: z.number().optional(), minimumRecallAt10: z.number().optional(), queryFractionAtLeast80: z.number().optional() }) })) });
const licenseSchema = z.object({ schemaVersion: z.literal(1), generatedFromLockfile: z.literal(true), packageCount: z.number().int(), nativeArtifacts: z.array(z.object({ target: z.string(), files: z.array(z.object({ path: z.string(), size: z.number().int(), sha256: hash })) })), modelFixture: z.object({ license: z.literal("CC-BY-NC-4.0"), bundled: z.literal(false), downloadedByProject: z.literal(false), productionDefault: z.literal(false) }), sourceAndSyntheticFixturesLicense: z.literal("Apache-2.0") });

async function required<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(path, "utf8")));
}

const [fts, lexical, live, semantic, ann, licenses] = await Promise.all([
  required("reports/fts/capability.json", ftsSchema),
  required("reports/lexical/reference.json", lexicalSchema),
  required("reports/provider-live/result.json", liveSchema),
  required("reports/semantic/fixture-manifest.json", semanticFixtureSchema),
  required("reports/ann/benchmark.json", annSchema),
  required("reports/licenses/inventory.json", licenseSchema)
]);
const summary = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  decisions: {
    communityPackaging: { status: "fail", code: "COMMUNITY_NATIVE_LAYOUT_UNACCEPTED", consequence: "replace-vector-store-before-mvp" },
    platformRuntime: { status: "unverified", requiredCells: 6, passingCells: 0 },
    lexicalStore: { status: "pass", decision: "separate-replaceable-lexical-store" },
    providerProtocol: { status: "pass" },
    providerLive: { status: "pass", scope: "configured-endpoint-text-embedding-3-small-2026-07-15" },
    providerLocalGpu: { status: "unverified", requiredCells: 3, passingCells: 0 },
    semanticQuality: { status: "unverified", requiredGpuCells: 3, passingGpuCells: 0 },
    ann: { status: "pass", decision: "flat-default" }
  },
  evidence: projectSafeEvidence({ fts, lexical, live, semantic, ann, licenses })
};
await mkdir("reports/final", { recursive: true });
await writeFile("reports/final/decision-summary.json", canonicalJson(summary), { mode: 0o600 });
const decisions = Object.entries(summary.decisions).map(([name, value]) => `| ${name} | ${value.status} | ${"decision" in value ? value.decision : "consequence" in value ? value.consequence : "external evidence required"} |`);
await writeFile("reports/final/decision-summary.md", ["# Spike 0 decision summary", "", "| Area | Status | Decision / next gate |", "|---|---|---|", ...decisions, ""].join("\n"), { mode: 0o600 });
process.stdout.write("report-complete\n");

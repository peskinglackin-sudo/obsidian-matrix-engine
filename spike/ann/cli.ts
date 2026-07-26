import { mkdir, writeFile } from "node:fs/promises";
import { canonicalJson, sha256 } from "../evidence/canonical";
import { evaluateAnn } from "./evaluate";
import { runAnnBenchmark } from "./runner";
if (process.argv.includes("--execute")) {
  await runAnnBenchmark();
  process.stdout.write("benchmark-complete\n");
  process.exit(0);
}
const seed = 20260715;
const dataset = { seed, vectorCount: 50000, dimensions: 768, queryCount: 500, repetitions: 10, warmups: 2, coldPreflights: 1 };
const fixtureSha256 = sha256(canonicalJson(dataset));
const evaluation = evaluateAnn([], { flatP95Ms: 0, annP95Ms: 0 });
await mkdir("reports/ann", { recursive: true });
await writeFile("reports/ann/preflight.json", canonicalJson({ schemaVersion: 1, status: "unverified", fixtureSha256, dataset, evaluation }), { mode: 0o600 });
process.stdout.write(`insufficient ${fixtureSha256}\n`);

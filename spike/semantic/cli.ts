import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import { canonicalJson } from "../evidence/canonical";
import { evaluateSemanticResultSet, semanticResultSetSchema } from "./evaluate";
import { buildSemanticFixtures } from "./fixtures";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const inputPath = option("--input");
const outputPath = resolve(option("--output") ?? (inputPath === undefined ? "reports/semantic/fixture-manifest.json" : "reports/semantic/evaluation.json"));
await mkdir(dirname(outputPath), { recursive: true });
if (inputPath === undefined) {
  const fixtures = buildSemanticFixtures();
  await writeFile(outputPath, canonicalJson(fixtures), { mode: 0o600 });
  process.stdout.write(`unverified ${fixtures.sha256}\n`);
} else {
  const resultSet = semanticResultSetSchema.parse(JSON.parse(await readFile(resolve(inputPath), "utf8")));
  const evaluation = evaluateSemanticResultSet(resultSet);
  await writeFile(outputPath, canonicalJson({ schemaVersion: 1, fixtureSha256: resultSet.fixtureSha256, recipeSha256: resultSet.recipeSha256, modelSha256: resultSet.modelSha256, llamaCommit: resultSet.llamaCommit, backend: resultSet.backend, platform: resultSet.platform, evaluation }), { mode: 0o600 });
  process.stdout.write(`${evaluation.status}\n`);
  if (evaluation.status !== "pass") process.exitCode = 1;
}

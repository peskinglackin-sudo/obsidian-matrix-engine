import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { canonicalJson } from "../evidence/canonical";
import { evaluatePlatformRun } from "./evaluate";
import { platformRunInputSchema } from "./schema";

const inputIndex = process.argv.indexOf("--input");
const outputIndex = process.argv.indexOf("--output");
const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
if (inputPath === undefined || outputPath === undefined) throw new Error("Use --input <safe-checkpoints.json> --output <evaluation.json>");
const run = platformRunInputSchema.parse(JSON.parse(await readFile(inputPath, "utf8")));
const output = { schemaVersion: 1, target: run.target, cell: run.cell, appVersion: run.appVersion, artifactSha256: run.artifactSha256, dependencyVersions: run.dependencyVersions, ...evaluatePlatformRun(run) };
await writeFile(outputPath, canonicalJson(output), { mode: 0o600 });
process.stdout.write(`${output.status}\n`);

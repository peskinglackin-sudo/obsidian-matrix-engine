import process from "node:process";

import { finalizePlatformRun, preparePlatformRun } from "./operations";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function required(name: string): string {
  const value = option(name);
  if (value === undefined) throw new Error(`Missing ${name}`);
  return value;
}
const command = process.argv[2];
if (command === "prepare") {
  await preparePlatformRun({
    manifestPath: required("--manifest"),
    vaultPath: required("--vault"),
    profilePath: required("--profile"),
    cell: required("--cell"),
    appVersion: required("--app-version"),
    phase: required("--phase")
  });
  process.stdout.write("prepared\n");
} else if (command === "finalize") {
  const evaluation = await finalizePlatformRun({
    checkpointsPath: required("--checkpoints"),
    profilePath: required("--profile"),
    vaultPath: required("--vault"),
    outputPath: required("--output")
  });
  process.stdout.write(`${evaluation.status}\n`);
  if (evaluation.status !== "pass") process.exitCode = 1;
} else {
  throw new Error("Use prepare or finalize");
}

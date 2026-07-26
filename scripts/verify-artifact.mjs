import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import { canonicalJson, fileRecord, sha256 } from "./artifact-lib.mjs";

const index = process.argv.indexOf("--manifest");
const manifestPath = index >= 0 ? process.argv[index + 1] : undefined;
if (manifestPath === undefined) throw new Error("Use --manifest <artifact-manifest.json>");
const absolute = resolve(manifestPath);
const root = dirname(absolute);
const manifest = JSON.parse(await readFile(absolute, "utf8"));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.filter((file) => file.path.endsWith(".node")).length !== 1) {
  throw new Error("Artifact manifest structure or native sidecar count is invalid");
}
const actual = await Promise.all(manifest.files.map((file) => fileRecord(root, resolve(root, file.path))));
actual.sort((a, b) => a.path.localeCompare(b.path));
if (canonicalJson(actual) !== canonicalJson(manifest.files) || sha256(canonicalJson(actual)) !== manifest.contentSetSha256) {
  throw new Error("Artifact file hash verification failed");
}
process.stdout.write(`verified ${manifest.target} ${manifest.contentSetSha256}\n`);

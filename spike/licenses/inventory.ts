import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { canonicalJson } from "../evidence/canonical";
type PackageMetadata = Readonly<{ name?: unknown; version?: unknown; license?: unknown; licenses?: unknown }>;
const store = join(process.cwd(), "node_modules", ".pnpm");
const records: { name: string; version: string; license: string }[] = [];
for (const entry of await readdir(store, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith("node_modules")) continue;
  const modules = join(store, entry.name, "node_modules");
  try {
    for (const child of await readdir(modules, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const paths = child.name.startsWith("@") ? (await readdir(join(modules, child.name))).map((name) => join(modules, child.name, name)) : [join(modules, child.name)];
      for (const path of paths) {
        try {
          const metadata = JSON.parse(await readFile(join(path, "package.json"), "utf8")) as PackageMetadata;
          if (typeof metadata.name !== "string" || typeof metadata.version !== "string") continue;
          const license = typeof metadata.license === "string" ? metadata.license : Array.isArray(metadata.licenses) ? metadata.licenses.map(String).join(" OR ") : "UNKNOWN";
          records.push({ name: metadata.name, version: metadata.version, license });
        } catch { /* Package store aliases need not contain metadata. */ }
      }
    }
  } catch { /* Ignore pnpm metadata-only entries. */ }
}
const unique = [...new Map(records.map((record) => [`${record.name}@${record.version}`, record])).values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const nativeArtifacts = [];
for (const target of ["win32-x64", "darwin-arm64", "linux-x64-gnu"]) {
  const manifestPath = join("dist", `matrix-engine-spike-${target}`, "artifact-manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: { path: string; size: number; sha256: string }[] };
    nativeArtifacts.push({ target, files: manifest.files.filter(({ path }) => path.endsWith(".node")) });
  } catch { nativeArtifacts.push({ target, files: [] }); }
}
await mkdir("reports/licenses", { recursive: true });
await writeFile("reports/licenses/inventory.json", canonicalJson({ schemaVersion: 1, generatedFromLockfile: true, packageCount: unique.length, packages: unique, nativeArtifacts, modelFixture: { name: "jina-embeddings-v5-text-nano-retrieval-Q8_0.gguf", license: "CC-BY-NC-4.0", bundled: false, downloadedByProject: false, productionDefault: false }, sourceAndSyntheticFixturesLicense: "Apache-2.0" }), { mode: 0o600 });
process.stdout.write(`inventory ${String(unique.length)} packages\n`);

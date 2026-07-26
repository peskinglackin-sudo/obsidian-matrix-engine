import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import esbuild from "esbuild";

import { canonicalJson, fileRecord, sha256 } from "./artifact-lib.mjs";

const TARGETS = {
  "win32-x64": { package: "@lancedb/lancedb-win32-x64-msvc", node: "lancedb.win32-x64-msvc.node", runtime: { platform: "win32", architecture: "x64", libc: "none" } },
  "darwin-arm64": { package: "@lancedb/lancedb-darwin-arm64", node: "lancedb.darwin-arm64.node", runtime: { platform: "darwin", architecture: "arm64", libc: "none" } },
  "linux-x64-gnu": { package: "@lancedb/lancedb-linux-x64-gnu", node: "lancedb.linux-x64-gnu.node", runtime: { platform: "linux", architecture: "x64", libc: "glibc" } }
};

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const target = option("--target");
if (target === undefined || !(target in TARGETS)) {
  throw new Error("Use --target with one of: win32-x64, darwin-arm64, linux-x64-gnu");
}
const config = TARGETS[target];
const pluginVersion = option("--plugin-version") ?? "0.0.1";
if (!["0.0.0", "0.0.1"].includes(pluginVersion)) throw new Error("Use --plugin-version 0.0.0 or 0.0.1");
const root = process.cwd();
const output = resolve(option("--output") ?? join("dist", `matrix-engine-spike-${target}`));
const temporary = await mkdtemp(join(tmpdir(), "matrix-engine-package-"));

try {
  await rm(output, { recursive: true, force: true });
  await mkdir(join(output, "vendor", "native"), { recursive: true });
  execFileSync("npm", ["pack", `${config.package}@0.31.0`, "--pack-destination", temporary], { cwd: root, stdio: "ignore" });
  const archive = (await readdir(temporary)).find((name) => name.endsWith(".tgz"));
  if (archive === undefined) throw new Error("Native package archive was not produced");
  execFileSync("tar", ["-xzf", join(temporary, archive), "-C", temporary], { stdio: "ignore" });
  await cp(join(temporary, "package", config.node), join(output, "vendor", "native", config.node));

  await esbuild.build({
    entryPoints: [join(root, "spike", "native", "lancedb-entry.ts")],
    outfile: join(output, "vendor", "lancedb.cjs"),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    external: ["@lancedb/lancedb-*"]
  });
  await cp(join(root, "main.js"), join(output, "main.js"));
  const formalManifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  await writeFile(join(output, "manifest.json"), canonicalJson({ ...formalManifest, id: "matrix-engine-spike", name: "Matrix Engine Spike", version: pluginVersion }));
  await cp(join(root, "LICENSE"), join(output, "LICENSE"));
  await cp(join(root, "THIRD_PARTY_NOTICES.md"), join(output, "THIRD_PARTY_NOTICES.md"));
  const lancedbRoot = join(root, "node_modules", "@lancedb", "lancedb");
  await cp(join(lancedbRoot, "NODEJS_THIRD_PARTY_LICENSES.md"), join(output, "LANCEDB_NODEJS_THIRD_PARTY_LICENSES.md"));
  await cp(join(lancedbRoot, "RUST_THIRD_PARTY_LICENSES.html"), join(output, "LANCEDB_RUST_THIRD_PARTY_LICENSES.html"));

  const paths = [
    "main.js", "manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md",
    "LANCEDB_NODEJS_THIRD_PARTY_LICENSES.md", "LANCEDB_RUST_THIRD_PARTY_LICENSES.html",
    "vendor/lancedb.cjs", `vendor/native/${config.node}`
  ];
  const files = await Promise.all(paths.map((path) => fileRecord(output, join(output, path))));
  files.sort((a, b) => a.path.localeCompare(b.path));
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const buildIdentitySha256 = sha256(await readFile(join(root, "pnpm-lock.yaml")));
  const contentSetSha256 = sha256(canonicalJson(files));
  await writeFile(join(output, "artifact-manifest.json"), canonicalJson({
    schemaVersion: 1, target, pluginId: "matrix-engine-spike", pluginVersion, minAppVersion: "1.11.4",
    lancedbVersion: "0.31.0", apacheArrowVersion: "18.1.0", sourceCommit, buildIdentitySha256, contentSetSha256,
    files, allowedRuntime: config.runtime
  }), { mode: 0o600 });
  process.stdout.write(`${join(output, "artifact-manifest.json")}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

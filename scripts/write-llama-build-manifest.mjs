import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const EXPECTED_COMMIT = "22b208b1cacb67bae191b00d795dae7cc819edb8";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function required(name) {
  const value = option(name);
  if (value === undefined) throw new Error(`Missing ${name}`);
  return value;
}
function output(file, args) {
  return execFileSync(file, args, { encoding: "utf8" }).trim();
}
function version(text, code) {
  const match = text.match(/\b(\d+\.\d+(?:\.\d+)*)\b/u);
  if (match?.[1] === undefined) throw new Error(code);
  return match[1];
}

const source = resolve(required("--source"));
const build = resolve(required("--build"));
const binary = resolve(required("--binary"));
const target = required("--target");
if (!["windows-vulkan", "linux-vulkan", "macos-metal"].includes(target)) throw new Error("LLAMA_BUILD_TARGET_INVALID");
if (output("git", ["-C", source, "rev-parse", "HEAD"]) !== EXPECTED_COMMIT) throw new Error("LLAMA_COMMIT_INVALID");
if (output("git", ["-C", source, "status", "--porcelain"]) !== "") throw new Error("LLAMA_SOURCE_DIRTY");

const cache = readFileSync(join(build, "CMakeCache.txt"), "utf8");
const compilerPath = cache.match(/^CMAKE_CXX_COMPILER:FILEPATH=(.+)$/mu)?.[1];
if (compilerPath === undefined) throw new Error("LLAMA_COMPILER_MISSING");
const compilerMetadataPath = readdirSync(join(build, "CMakeFiles"), { recursive: true, encoding: "utf8" })
  .find((path) => path.endsWith("CMakeCXXCompiler.cmake"));
if (compilerMetadataPath === undefined) throw new Error("LLAMA_COMPILER_METADATA_MISSING");
const compilerMetadata = readFileSync(join(build, "CMakeFiles", compilerMetadataPath), "utf8");
const compilerId = compilerMetadata.match(/^set\(CMAKE_CXX_COMPILER_ID "([a-zA-Z0-9_.+-]+)"\)$/mu)?.[1];
const compilerVersion = compilerMetadata.match(/^set\(CMAKE_CXX_COMPILER_VERSION "(\d+\.\d+(?:\.\d+)*)"\)$/mu)?.[1];
if (compilerId === undefined || compilerVersion === undefined) throw new Error("LLAMA_COMPILER_METADATA_INVALID");
const binaryVersionOutput = output(binary, ["--version"]);
const binaryVersionMatch = binaryVersionOutput.match(/version:\s*(\d+)\s*\(([a-f0-9]+)\)/iu);
if (binaryVersionMatch?.[1] === undefined || binaryVersionMatch[2] === undefined || !EXPECTED_COMMIT.startsWith(binaryVersionMatch[2].toLowerCase())) {
  throw new Error("LLAMA_BINARY_VERSION_INVALID");
}
const bytes = readFileSync(binary);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const flags = target.endsWith("vulkan")
  ? ["CMAKE_BUILD_TYPE=Release", "GGML_METAL=OFF", "GGML_VULKAN=ON"]
  : ["CMAKE_BUILD_TYPE=Release", "GGML_METAL=ON", "GGML_VULKAN=OFF"];
const manifest = {
  schemaVersion: 1,
  target,
  sourceCommit: EXPECTED_COMMIT,
  sourceTreeClean: true,
  buildType: "Release",
  flags,
  cmakeVersion: version(output("cmake", ["--version"]), "CMAKE_VERSION_INVALID"),
  compiler: `${compilerId}-${basename(compilerPath)}`,
  compilerVersion,
  binaryVersion: Number.parseInt(binaryVersionMatch[1], 10),
  binaryRevision: binaryVersionMatch[2].toLowerCase(),
  binarySha256: sha256
};
const outputPath = resolve(required("--output"));
writeFileSync(outputPath, `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o600 });
writeFileSync(`${binary}.sha256`, `${sha256}  ${basename(binary)}\n`, { mode: 0o600 });

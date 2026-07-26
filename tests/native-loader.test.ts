import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../spike/evidence/canonical";
import { artifactManifestSchema } from "../src/native/artifact-manifest";
import { verifyArtifact } from "../src/native/lancedb-loader";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "matrix-engine-artifact-"));
  await mkdir(join(root, "vendor", "native"), { recursive: true });
  const contents: Record<string, string> = {
    "main.js": "plugin",
    "manifest.json": "{}",
    "vendor/lancedb.cjs": "module.exports = {}",
    "vendor/native/lancedb.linux-x64-gnu.node": "native"
  };
  const files = [];
  for (const [path, value] of Object.entries(contents)) {
    await writeFile(join(root, path), value);
    files.push({ path, size: Buffer.byteLength(value), sha256: sha256(value) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(join(root, "artifact-manifest.json"), canonicalJson({
    schemaVersion: 1, target: "linux-x64-gnu", pluginId: "matrix-engine-spike", pluginVersion: "0.0.1",
    minAppVersion: "1.11.4", lancedbVersion: "0.31.0", apacheArrowVersion: "18.1.0",
    sourceCommit: "a".repeat(40), buildIdentitySha256: "b".repeat(64), contentSetSha256: sha256(canonicalJson(files)), files,
    allowedRuntime: { platform: "linux", architecture: "x64", libc: "glibc" }
  }));
  return root;
}

describe("verified native artifact", () => {
  it("accepts the exact supported runtime and one sidecar", async () => {
    const root = await fixture();
    await expect(verifyArtifact(root, { platform: "linux", architecture: "x64", libc: "glibc" })).resolves.toMatchObject({ target: "linux-x64-gnu" });
  });

  it("rejects runtime and content mismatches before native loading", async () => {
    const root = await fixture();
    await expect(verifyArtifact(root, { platform: "linux", architecture: "arm64", libc: "glibc" })).rejects.toMatchObject({ safe: { code: "ARTIFACT_RUNTIME_MISMATCH" } });
    await writeFile(join(root, "main.js"), `${await readFile(join(root, "main.js"), "utf8")}tampered`);
    await expect(verifyArtifact(root)).rejects.toMatchObject({ safe: { code: "ARTIFACT_HASH_MISMATCH" } });
  });

  it("rejects a manifest whose content-set binding was changed", async () => {
    const root = await fixture();
    const path = join(root, "artifact-manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    await writeFile(path, canonicalJson({ ...manifest, contentSetSha256: "c".repeat(64) }));
    await expect(verifyArtifact(root)).rejects.toMatchObject({ safe: { code: "ARTIFACT_CONTENT_SET_MISMATCH" } });
  });

  it("accepts only the two reviewed Spike upgrade versions", async () => {
    const root = await fixture();
    const manifest = JSON.parse(await readFile(join(root, "artifact-manifest.json"), "utf8")) as Record<string, unknown>;
    expect(artifactManifestSchema.parse({ ...manifest, pluginVersion: "0.0.0" }).pluginVersion).toBe("0.0.0");
    expect(artifactManifestSchema.parse({ ...manifest, pluginVersion: "0.0.1" }).pluginVersion).toBe("0.0.1");
    expect(() => artifactManifestSchema.parse({ ...manifest, pluginVersion: "0.0.2" })).toThrow();
  });
});

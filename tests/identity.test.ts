import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FORMAL_IDENTITY,
  FORMAL_PLUGIN_ID,
  SPIKE_IDENTITY,
  buildNamespaces,
  validatePluginIdentity,
  type PluginIdentity
} from "../src/identity";

type Manifest = Readonly<{
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  isDesktopOnly: boolean;
  authorUrl?: string;
  fundingUrl?: string;
}>;

function readManifest(): Manifest {
  return JSON.parse(readFileSync(resolve("manifest.json"), "utf8")) as Manifest;
}

describe("formal plugin manifest", () => {
  it("uses the approved private-development identity", () => {
    const manifest = readManifest();

    expect(manifest).toMatchObject({
      id: FORMAL_PLUGIN_ID,
      name: "Matrix Engine",
      version: "0.1.0",
      minAppVersion: "1.11.4",
      author: "Opus",
      isDesktopOnly: true
    });
    expect(manifest).not.toHaveProperty("authorUrl");
    expect(manifest).not.toHaveProperty("fundingUrl");
  });

  it("maps every released version to its minimum app version", () => {
    const manifest = readManifest();
    const versions = JSON.parse(readFileSync(resolve("versions.json"), "utf8")) as Record<string, string>;
    expect(versions[manifest.version]).toBe(manifest.minAppVersion);
  });

  it("keeps the Chinese name presentation-only", () => {
    const en = JSON.parse(readFileSync(resolve("src/i18n/en.json"), "utf8")) as Record<string, unknown>;
    const zh = JSON.parse(readFileSync(resolve("src/i18n/zh-CN.json"), "utf8")) as Record<string, unknown>;

    expect(zh["plugin.name"]).toBe("矩阵引擎");
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    expect(readManifest().id).not.toContain("矩阵");
  });
});

describe("identity namespaces", () => {
  it("derives deterministic and disjoint formal and Spike namespaces", () => {
    const formal = buildNamespaces(FORMAL_IDENTITY);
    const spike = buildNamespaces(SPIKE_IDENTITY);

    expect(buildNamespaces(FORMAL_IDENTITY)).toEqual(formal);
    expect(new Set(Object.values(formal))).not.toContainEqual(expect.stringContaining(SPIKE_IDENTITY.id));
    expect(Object.values(formal)).not.toContainEqual(expect.stringContaining("矩阵"));
    expect(Object.values(spike)).not.toContainEqual(expect.stringContaining(FORMAL_IDENTITY.id + "/"));
    expect(Object.values(formal).filter((value) => Object.values(spike).includes(value))).toEqual([]);
  });

  it("uses SecretStorage-compatible lowercase/dash-only IDs", () => {
    const secretIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

    expect(buildNamespaces(FORMAL_IDENTITY).secretEmbeddingApiKey).toMatch(secretIdPattern);
    expect(buildNamespaces(SPIKE_IDENTITY).secretEmbeddingApiKey).toMatch(secretIdPattern);
  });

  it("rejects an invalid identity and formal/test collisions", () => {
    const invalid = { ...SPIKE_IDENTITY, id: "Matrix Engine" } satisfies PluginIdentity;
    const collision = { ...SPIKE_IDENTITY, id: FORMAL_PLUGIN_ID } satisfies PluginIdentity;
    const renamedFormal = { ...FORMAL_IDENTITY, id: "matrix-engine-renamed" } satisfies PluginIdentity;

    expect(() => validatePluginIdentity(invalid)).toThrow(/lowercase/u);
    expect(() => validatePluginIdentity(collision)).toThrow(/must not share/u);
    expect(() => validatePluginIdentity(renamedFormal)).toThrow(/immutable/u);
  });
});

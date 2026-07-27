import { describe, expect, it } from "vitest";

import { createDefaultSettings, DEFAULT_ARTIFACT_ID, DEFAULT_RETRIEVAL_ID } from "../src/settings/defaults";
import {
  buildArtifactDescriptor,
  computeArtifactFingerprint,
  computeCorpusFingerprint,
  computeEmbeddingFingerprint,
  computeEmbeddingSpaceId,
  computeLexicalFingerprint
} from "../src/settings/fingerprint";
import { loadSettings, selectActiveConfiguration, SettingsStore } from "../src/settings/store";
import { classifyEndpoint, pluginSettingsSchema, validateProviderBaseUrl } from "../src/settings/types";

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("expected at least one item");
  return item;
}

function recipeFixture() {
  const defaults = createDefaultSettings();
  const recipe = defaults.embeddingRecipes[0];
  if (recipe === undefined) throw new Error("missing default recipe");
  return { ...recipe, modelId: "test-model", modelSignature: "sig-1", dimension: 768 };
}

describe("settings schema and defaults", () => {
  it("accepts the default settings", () => {
    expect(() => pluginSettingsSchema.parse(createDefaultSettings())).not.toThrow();
  });

  it("keeps the default retrieval profile pointed at the default artifact", () => {
    const defaults = createDefaultSettings();
    expect(defaults.activeRetrievalProfileId).toBe(DEFAULT_RETRIEVAL_ID);
    expect(defaults.retrievalProfiles[0]?.artifactId).toBe(DEFAULT_ARTIFACT_ID);
    expect(defaults.retrievalProfiles[0]?.fusion).toEqual({ method: "rrf", rrfK: 60, exactWeight: 1.4, lexicalWeight: 1.0, semanticWeight: 1.0 });
  });

  it("rejects duplicate profile IDs", () => {
    const settings = createDefaultSettings();
    settings.providerProfiles.push({ ...first(settings.providerProfiles) });
    expect(pluginSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("rejects recipes referencing unknown providers", () => {
    const settings = createDefaultSettings();
    first(settings.embeddingRecipes).providerProfileId = "missing-provider";
    expect(pluginSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("rejects credential headers in plain settings", () => {
    const settings = createDefaultSettings();
    first(settings.providerProfiles).headers = { Authorization: "Bearer nope" };
    expect(pluginSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("rejects an active retrieval profile that does not exist", () => {
    const settings = createDefaultSettings();
    settings.activeRetrievalProfileId = "ghost-profile";
    expect(pluginSettingsSchema.safeParse(settings).success).toBe(false);
  });
});

describe("provider base URL policy", () => {
  it("accepts loopback llama.cpp default", () => {
    expect(classifyEndpoint("http://127.0.0.1:8080/v1")).toBe("local");
  });

  it("classifies HTTPS remote endpoints", () => {
    expect(classifyEndpoint("https://api.example.com/v1")).toBe("remote_https");
  });

  it("flags plaintext remote endpoints for a strong warning", () => {
    expect(classifyEndpoint("http://internal-gateway.example/v1")).toBe("remote_plaintext");
  });

  it("rejects URLs with credentials, query, fragment, or missing /v1", () => {
    expect(() => validateProviderBaseUrl("https://user:pass@example.com/v1")).toThrow(TypeError);
    expect(() => validateProviderBaseUrl("https://example.com/v1?x=1")).toThrow(TypeError);
    expect(() => validateProviderBaseUrl("https://example.com/v1#frag")).toThrow(TypeError);
    expect(() => validateProviderBaseUrl("https://example.com/api")).toThrow(TypeError);
    expect(() => validateProviderBaseUrl("https://example.com/v1/")).toThrow(TypeError);
  });
});

describe("fingerprints (PRD 12.8)", () => {
  it("keeps connection parameters out of the embedding space", () => {
    const recipe = recipeFixture();
    const spaceA = computeEmbeddingSpaceId(recipe);
    const spaceB = computeEmbeddingSpaceId({ ...recipe, providerProfileId: "other-provider" });
    expect(spaceA).toBe(spaceB);
  });

  it("ignores query template changes but tracks document template changes", () => {
    const recipe = recipeFixture();
    expect(computeEmbeddingFingerprint({ ...recipe, queryTemplate: "Q: {query}" })).toBe(computeEmbeddingFingerprint(recipe));
    expect(computeEmbeddingFingerprint({ ...recipe, documentTemplate: "{content}" })).not.toBe(computeEmbeddingFingerprint(recipe));
  });

  it("changes the space when the model signature or metric changes", () => {
    const recipe = recipeFixture();
    expect(computeEmbeddingSpaceId({ ...recipe, modelSignature: "sig-2" })).not.toBe(computeEmbeddingSpaceId(recipe));
    expect(computeEmbeddingSpaceId({ ...recipe, metric: "dot" })).not.toBe(computeEmbeddingSpaceId(recipe));
  });

  it("keeps includes/excludes out of the corpus fingerprint", () => {
    const corpus = first(createDefaultSettings().corpusProfiles);
    expect(computeCorpusFingerprint({ ...corpus, includes: ["notes/"] })).toBe(computeCorpusFingerprint(corpus));
    expect(computeCorpusFingerprint({ ...corpus, chunkSizeTokens: 256 })).not.toBe(computeCorpusFingerprint(corpus));
  });

  it("tracks analyzer identity in the lexical fingerprint", () => {
    const lexical = first(createDefaultSettings().lexicalProfiles);
    expect(computeLexicalFingerprint({ ...lexical, analyzerVersion: 2 })).not.toBe(computeLexicalFingerprint(lexical));
  });

  it("builds a stable artifact descriptor", () => {
    const defaults = createDefaultSettings();
    const descriptor = buildArtifactDescriptor({
      artifactId: "artifact-a",
      corpus: first(defaults.corpusProfiles),
      lexical: first(defaults.lexicalProfiles),
      recipe: recipeFixture(),
      now: 1000
    });
    expect(descriptor.state).toBe("building");
    expect(descriptor.chunkTableName).toBe("chunks_artifact-a");
    expect(descriptor.artifactFingerprint).toBe(computeArtifactFingerprint({
      corpusFingerprint: descriptor.corpusFingerprint,
      lexicalFingerprint: descriptor.lexicalFingerprint,
      embeddingFingerprint: computeEmbeddingFingerprint(recipeFixture()),
      schemaVersion: descriptor.schemaVersion
    }));
  });
});

describe("settings loading and migration", () => {
  it("returns defaults for a fresh install", () => {
    const result = loadSettings(null);
    expect(result.changed).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.settings.version).toBe(1);
  });

  it("keeps valid stored settings unchanged", () => {
    const stored = createDefaultSettings();
    stored.ui.connectionsLimit = 25;
    const result = loadSettings(stored);
    expect(result.changed).toBe(false);
    expect(result.settings.ui.connectionsLimit).toBe(25);
  });

  it("resets with an issue on unsupported version", () => {
    const result = loadSettings({ version: 99 });
    expect(result.changed).toBe(true);
    expect(result.issues[0]?.code).toBe("settings.reset.version");
  });

  it("resets with an issue on invalid payloads", () => {
    const result = loadSettings({ version: 1, activeRetrievalProfileId: 42 });
    expect(result.changed).toBe(true);
    expect(result.issues[0]?.code).toBe("settings.reset.invalid");
  });
});

describe("settings store", () => {
  it("persists validated updates and notifies subscribers", async () => {
    const saved: unknown[] = [];
    const store = new SettingsStore(createDefaultSettings(), (settings) => {
      saved.push(settings);
      return Promise.resolve();
    });
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    await store.update((settings) => {
      settings.ui.autoSubmit = false;
      return settings;
    });
    expect(store.current.ui.autoSubmit).toBe(false);
    expect(saved).toHaveLength(1);
    expect(notified).toBe(1);
    unsubscribe();
    await store.update((settings) => settings);
    expect(notified).toBe(1);
  });

  it("rejects invalid updates without persisting", async () => {
    const saved: unknown[] = [];
    const store = new SettingsStore(createDefaultSettings(), (settings) => {
      saved.push(settings);
      return Promise.resolve();
    });
    await expect(store.update((settings) => ({ ...settings, activeRetrievalProfileId: "missing" }))).rejects.toThrow();
    expect(saved).toHaveLength(0);
    expect(store.current.activeRetrievalProfileId).toBe(DEFAULT_RETRIEVAL_ID);
  });

  it("resolves the active configuration with fallbacks before the artifact exists", () => {
    const config = selectActiveConfiguration(createDefaultSettings());
    expect(config.artifact).toBeUndefined();
    expect(config.recipe?.id).toBe("default-recipe");
    expect(config.provider?.id).toBe("default-local-provider");
  });
});

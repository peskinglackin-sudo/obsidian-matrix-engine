import { createDefaultSettings } from "./defaults";
import { pluginSettingsSchema, SETTINGS_VERSION, type PluginSettings } from "./types";

/**
 * Versioned settings loading and persistence.
 *
 * The vault stays the source of truth for content; settings are the source
 * of truth for configuration. Unreadable settings fall back to defaults with
 * explicit issues so the UI can surface the reset instead of failing silently.
 */

export type SettingsIssue = Readonly<{ code: "settings.reset.invalid" | "settings.reset.version" | "settings.migrated"; detail: string }>;

export type SettingsLoadResult = Readonly<{
  settings: PluginSettings;
  issues: readonly SettingsIssue[];
  changed: boolean;
}>;

export function loadSettings(raw: unknown): SettingsLoadResult {
  if (raw === null || raw === undefined) {
    return Object.freeze({ settings: createDefaultSettings(), issues: Object.freeze([]), changed: true });
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return resetResult("settings.reset.invalid", "Settings payload is not an object");
  }
  const version = (raw as Record<string, unknown>).version;
  if (version !== SETTINGS_VERSION) {
    return resetResult("settings.reset.version", `Unsupported settings version: ${String(version)}`);
  }
  const parsed = pluginSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return resetResult("settings.reset.invalid", first === undefined ? "Unknown validation failure" : `${first.path.join(".")}: ${first.message}`);
  }
  return Object.freeze({ settings: parsed.data, issues: Object.freeze([]), changed: false });
}

function resetResult(code: SettingsIssue["code"], detail: string): SettingsLoadResult {
  return Object.freeze({
    settings: createDefaultSettings(),
    issues: Object.freeze([Object.freeze({ code, detail })]),
    changed: true
  });
}

export type SettingsListener = (settings: PluginSettings) => void;

export class SettingsStore {
  #settings: PluginSettings;
  readonly #persist: (settings: PluginSettings) => Promise<void>;
  readonly #listeners = new Set<SettingsListener>();

  constructor(settings: PluginSettings, persist: (settings: PluginSettings) => Promise<void>) {
    this.#settings = pluginSettingsSchema.parse(settings);
    this.#persist = persist;
  }

  get current(): PluginSettings {
    return this.#settings;
  }

  subscribe(listener: SettingsListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async update(mutate: (settings: PluginSettings) => PluginSettings): Promise<PluginSettings> {
    const next = pluginSettingsSchema.parse(mutate(structuredClone(this.#settings)));
    this.#settings = next;
    await this.#persist(next);
    for (const listener of [...this.#listeners]) listener(next);
    return next;
  }
}

export function selectActiveRetrievalProfile(settings: PluginSettings): PluginSettings["retrievalProfiles"][number] {
  const profile = settings.retrievalProfiles.find(({ id }) => id === settings.activeRetrievalProfileId);
  if (profile === undefined) throw new Error("Active retrieval profile is missing");
  return profile;
}

export type ActiveConfiguration = Readonly<{
  retrieval: PluginSettings["retrievalProfiles"][number];
  artifact: PluginSettings["indexArtifacts"][number] | undefined;
  recipe: PluginSettings["embeddingRecipes"][number] | undefined;
  corpus: PluginSettings["corpusProfiles"][number] | undefined;
  lexical: PluginSettings["lexicalProfiles"][number] | undefined;
  provider: PluginSettings["providerProfiles"][number] | undefined;
}>;

export function selectActiveConfiguration(settings: PluginSettings): ActiveConfiguration {
  const retrieval = selectActiveRetrievalProfile(settings);
  const artifact = settings.indexArtifacts.find(({ id }) => id === retrieval.artifactId);
  const recipe = settings.embeddingRecipes.find(({ id }) => id === artifact?.embeddingRecipeId) ?? settings.embeddingRecipes[0];
  const corpus = settings.corpusProfiles.find(({ id }) => id === artifact?.corpusProfileId) ?? settings.corpusProfiles[0];
  const lexical = settings.lexicalProfiles.find(({ id }) => id === artifact?.lexicalProfileId) ?? settings.lexicalProfiles[0];
  const provider = settings.providerProfiles.find(({ id }) => id === recipe?.providerProfileId);
  return Object.freeze({ retrieval, artifact, recipe, corpus, lexical, provider });
}

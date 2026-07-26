export const FORMAL_PLUGIN_ID = "matrix-engine" as const;
export const SPIKE_PLUGIN_ID = "matrix-engine-spike" as const;

export type PluginIdentity = Readonly<{
  id: string;
  name: string;
  localizedNameZhCn: string;
  author: "Opus";
  minAppVersion: "1.11.4";
  isDesktopOnly: true;
  kind: "formal" | "spike";
}>;

export type PluginNamespaces = Readonly<{
  settings: string;
  secretEmbeddingApiKey: string;
  databaseDirectory: string;
  diagnosticsComponent: string;
  artifactDirectory: string;
}>;

export const FORMAL_IDENTITY: PluginIdentity = Object.freeze({
  id: FORMAL_PLUGIN_ID,
  name: "Matrix Engine",
  localizedNameZhCn: "矩阵引擎",
  author: "Opus",
  minAppVersion: "1.11.4",
  isDesktopOnly: true,
  kind: "formal"
});

export const SPIKE_IDENTITY: PluginIdentity = Object.freeze({
  id: SPIKE_PLUGIN_ID,
  name: "Matrix Engine Spike",
  localizedNameZhCn: "矩阵引擎（技术验证）",
  author: "Opus",
  minAppVersion: "1.11.4",
  isDesktopOnly: true,
  kind: "spike"
});

const PERSISTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function validatePluginIdentity(identity: PluginIdentity): void {
  if (!PERSISTENT_ID_PATTERN.test(identity.id)) {
    throw new Error("Plugin identity must contain lowercase alphanumeric segments separated by dashes");
  }
  if (identity.kind === "formal" && identity.id !== FORMAL_PLUGIN_ID) {
    throw new Error("Formal builds must use the immutable matrix-engine plugin ID");
  }
  if (identity.kind === "spike" && identity.id === FORMAL_PLUGIN_ID) {
    throw new Error("Spike builds must not share the formal plugin ID");
  }
}

export function buildNamespaces(identity: PluginIdentity): PluginNamespaces {
  validatePluginIdentity(identity);
  const id = identity.id;

  return Object.freeze({
    settings: `${id}-settings`,
    secretEmbeddingApiKey: `${id}-embedding-api-key`,
    databaseDirectory: `${id}/database`,
    diagnosticsComponent: `${id}-diagnostics`,
    artifactDirectory: `${id}/artifacts`
  });
}

export function identityForPluginId(pluginId: string): PluginIdentity {
  if (pluginId === FORMAL_PLUGIN_ID) return FORMAL_IDENTITY;
  if (pluginId === SPIKE_PLUGIN_ID) return SPIKE_IDENTITY;
  throw new Error("Plugin manifest ID does not match an approved Matrix Engine identity");
}

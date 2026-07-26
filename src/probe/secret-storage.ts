import type { SafeError } from "../core/errors";

export type SecretStoragePort = Readonly<{
  setSecret(id: string, secret: string): void;
  getSecret(id: string): string | null;
  listSecrets(): string[];
}>;

export type SecretStorageProbeResult = Readonly<{
  status: "pass" | "fail";
  priorValueExisted: boolean;
  disposableProfileDestructionRequired: boolean;
  checks: Readonly<{
    set: boolean;
    get: boolean;
    list: boolean;
    restored: boolean;
  }>;
  error?: SafeError;
}>;

const SECRET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function runSecretStorageProbe(
  storage: SecretStoragePort,
  secretId: string,
  ephemeralValue: string
): SecretStorageProbeResult {
  if (!SECRET_ID_PATTERN.test(secretId)) {
    throw new TypeError("SecretStorage probe ID must be lowercase alphanumeric with dash separators");
  }
  if (ephemeralValue.length < 16) {
    throw new TypeError("SecretStorage probe value must be an unpredictable ephemeral value");
  }

  const previous = storage.getSecret(secretId);
  const priorValueExisted = previous !== null;
  const checks = (() => {
    storage.setSecret(secretId, ephemeralValue);
    try {
      return Object.freeze({
        get: storage.getSecret(secretId) === ephemeralValue,
        list: storage.listSecrets().includes(secretId)
      });
    } finally {
      if (previous !== null) {
        storage.setSecret(secretId, previous);
      }
    }
  })();
  const restored = previous !== null && storage.getSecret(secretId) === previous;
  if (previous !== null && !restored) {
    throw new Error("SecretStorage probe could not restore the prior isolated value");
  }
  const pass = checks.get && checks.list;
  return Object.freeze({
    status: pass ? "pass" : "fail",
    priorValueExisted,
    disposableProfileDestructionRequired: !priorValueExisted,
    checks: Object.freeze({ set: true, get: checks.get, list: checks.list, restored })
  });
}

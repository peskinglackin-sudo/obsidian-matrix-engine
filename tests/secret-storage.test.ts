import { describe, expect, it } from "vitest";

import { runSecretStorageProbe, type SecretStoragePort } from "../src/probe/secret-storage";

class MemorySecretStorage implements SecretStoragePort {
  readonly values = new Map<string, string>();
  setSecret(id: string, secret: string): void { this.values.set(id, secret); }
  getSecret(id: string): string | null { return this.values.get(id) ?? null; }
  listSecrets(): string[] { return [...this.values.keys()]; }
}

describe("SecretStorage disposable-profile probe", () => {
  it("restores a pre-existing isolated value", () => {
    const storage = new MemorySecretStorage();
    storage.setSecret("matrix-engine-spike-probe", "previous-private-value");
    const result = runSecretStorageProbe(storage, "matrix-engine-spike-probe", "ephemeral-value-123456");
    expect(result).toMatchObject({ status: "pass", priorValueExisted: true, disposableProfileDestructionRequired: false });
    expect(storage.getSecret("matrix-engine-spike-probe")).toBe("previous-private-value");
  });

  it("requires profile destruction when no value existed because deletion is unavailable", () => {
    const storage = new MemorySecretStorage();
    const result = runSecretStorageProbe(storage, "matrix-engine-spike-probe", "ephemeral-value-123456");
    expect(result).toMatchObject({ status: "pass", priorValueExisted: false, disposableProfileDestructionRequired: true });
    expect(storage.getSecret("matrix-engine-spike-probe")).not.toBe("");
  });
});

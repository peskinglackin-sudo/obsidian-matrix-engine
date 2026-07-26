import { describe, expect, it, vi } from "vitest";

import { LifecycleRegistry } from "../src/core/lifecycle";

describe("LifecycleRegistry", () => {
  it("cleans resources in reverse acquisition order", async () => {
    const order: string[] = [];
    const registry = new LifecycleRegistry();
    registry.registerDatabase("database-primary", () => { order.push("database"); });
    registry.registerTemporaryResource("temporary-vault", () => { order.push("temporary"); });
    registry.register({ resourceId: "listener-workspace", kind: "listener", cleanup: () => { order.push("listener"); } });

    await expect(registry.close()).resolves.toEqual({ status: "pass", attempted: 3, failures: [] });
    expect(order).toEqual(["listener", "temporary", "database"]);
    await expect(registry.close()).resolves.toEqual({ status: "pass", attempted: 0, failures: [] });
  });

  it("continues cleanup and reports only safe failure data", async () => {
    const finalCleanup = vi.fn();
    const registry = new LifecycleRegistry();
    registry.registerDatabase("database-primary", finalCleanup);
    registry.registerTemporaryResource("temporary-vault", () => {
      throw new Error("/home/user/vault secret document");
    });

    const report = await registry.close();
    expect(report.status).toBe("fail");
    expect(report.failures).toEqual([{
      resourceId: "temporary-vault",
      kind: "temporary-resource",
      error: {
        code: "RESOURCE_CLEANUP_FAILED",
        category: "internal",
        messageKey: "error.internal.failure",
        retryable: false
      }
    }]);
    expect(JSON.stringify(report)).not.toContain("/home/user");
    expect(finalCleanup).toHaveBeenCalledOnce();
  });
});

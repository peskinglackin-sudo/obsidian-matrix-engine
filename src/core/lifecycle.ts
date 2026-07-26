import type { ChildProcess } from "node:child_process";

import { toSafeError, type SafeError } from "./errors";

export type ResourceKind =
  | "listener"
  | "timer"
  | "abort-controller"
  | "subprocess"
  | "database"
  | "temporary-resource";

export type CleanupFailure = Readonly<{
  resourceId: string;
  kind: ResourceKind;
  error: SafeError;
}>;

export type CleanupReport = Readonly<{
  status: "pass" | "fail";
  attempted: number;
  failures: readonly CleanupFailure[];
}>;

type CleanupAction = Readonly<{
  resourceId: string;
  kind: ResourceKind;
  cleanup: () => void | Promise<void>;
}>;

const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9-]{0,79}$/u;

export class LifecycleRegistry {
  readonly #actions: CleanupAction[] = [];
  #closed = false;

  register(action: CleanupAction): () => void {
    if (this.#closed) {
      throw new Error("Lifecycle registry is already closed");
    }
    if (!RESOURCE_ID_PATTERN.test(action.resourceId)) {
      throw new TypeError("Lifecycle resource ID is invalid");
    }
    if (this.#actions.some(({ resourceId }) => resourceId === action.resourceId)) {
      throw new Error(`Lifecycle resource ID is already registered: ${action.resourceId}`);
    }

    this.#actions.push(action);
    let active = true;
    return () => {
      if (!active || this.#closed) return;
      active = false;
      const index = this.#actions.indexOf(action);
      if (index >= 0) this.#actions.splice(index, 1);
    };
  }

  registerAbortController(resourceId: string, controller: AbortController): () => void {
    return this.register({ resourceId, kind: "abort-controller", cleanup: () => controller.abort() });
  }

  registerTimer(resourceId: string, timer: ReturnType<typeof setTimeout>): () => void {
    return this.register({ resourceId, kind: "timer", cleanup: () => clearTimeout(timer) });
  }

  registerSubprocess(resourceId: string, child: Pick<ChildProcess, "kill">): () => void {
    return this.register({
      resourceId,
      kind: "subprocess",
      cleanup: () => {
        if (!child.kill()) throw new Error("Subprocess did not accept termination");
      }
    });
  }

  registerDatabase(resourceId: string, close: () => void | Promise<void>): () => void {
    return this.register({ resourceId, kind: "database", cleanup: close });
  }

  registerTemporaryResource(resourceId: string, remove: () => void | Promise<void>): () => void {
    return this.register({ resourceId, kind: "temporary-resource", cleanup: remove });
  }

  async close(): Promise<CleanupReport> {
    if (this.#closed) {
      return Object.freeze({ status: "pass", attempted: 0, failures: Object.freeze([]) });
    }
    this.#closed = true;
    const actions = this.#actions.splice(0).reverse();
    const failures: CleanupFailure[] = [];

    for (const action of actions) {
      try {
        await action.cleanup();
      } catch (error: unknown) {
        failures.push(Object.freeze({
          resourceId: action.resourceId,
          kind: action.kind,
          error: toSafeError(error, "RESOURCE_CLEANUP_FAILED")
        }));
      }
    }

    return Object.freeze({
      status: failures.length === 0 ? "pass" : "fail",
      attempted: actions.length,
      failures: Object.freeze(failures)
    });
  }
}

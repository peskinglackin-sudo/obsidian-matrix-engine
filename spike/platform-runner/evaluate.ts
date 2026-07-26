import { requiredChecks, platformRunInputSchema } from "./schema";

export type PlatformEvaluation = Readonly<{
  status: "pass" | "fail" | "unverified" | "environment_error";
  decisionCodes: readonly string[];
  missingChecks: readonly string[];
}>;

const expectedRuntime = {
  "win32-x64": { architecture: "x64", libc: "none" },
  "darwin-arm64": { architecture: "arm64", libc: "none" },
  "linux-x64-gnu": { architecture: "x64", libc: "glibc" }
} as const;

export function evaluatePlatformRun(input: unknown): PlatformEvaluation {
  const run = platformRunInputSchema.parse(input);
  const expected = expectedRuntime[run.target];
  if (run.runtime.architecture !== expected.architecture || run.runtime.libc !== expected.libc) {
    return Object.freeze({ status: "environment_error", decisionCodes: Object.freeze(["RUNTIME_TARGET_MISMATCH"]), missingChecks: Object.freeze([]) });
  }
  if (run.executionKind !== "obsidian-desktop") {
    return Object.freeze({ status: "unverified", decisionCodes: Object.freeze(["PRECHECK_NOT_REAL_OBSIDIAN"]), missingChecks: Object.freeze([]) });
  }
  if (!run.disposableVault || !run.disposableProfile || !run.vaultDestroyed || !run.profileDestroyed) {
    return Object.freeze({ status: "environment_error", decisionCodes: Object.freeze(["DISPOSABLE_ENVIRONMENT_REQUIRED"]), missingChecks: Object.freeze([]) });
  }
  if (!run.completed || run.runtime.obsidianVersion !== run.appVersion) {
    return Object.freeze({ status: "environment_error", decisionCodes: Object.freeze(["RUN_INCOMPLETE_OR_VERSION_MISMATCH"]), missingChecks: Object.freeze([]) });
  }
  if (run.cell === "minimum-1.11.4" && run.appVersion !== "1.11.4") {
    return Object.freeze({ status: "environment_error", decisionCodes: Object.freeze(["MINIMUM_CELL_VERSION_INVALID"]), missingChecks: Object.freeze([]) });
  }
  const byId = new Map<string, (typeof run.checkpoints)[number]>(run.checkpoints.map((check) => [check.id, check]));
  const missing = requiredChecks(run.cell).filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return Object.freeze({ status: "unverified", decisionCodes: Object.freeze(["REQUIRED_CHECKS_MISSING"]), missingChecks: Object.freeze(missing) });
  }
  if ([...byId.values()].some(({ status }) => status === "environment_error")) {
    return Object.freeze({ status: "environment_error", decisionCodes: Object.freeze(["CHECK_ENVIRONMENT_ERROR"]), missingChecks: Object.freeze([]) });
  }
  if ([...byId.values()].some(({ status }) => status === "fail")) {
    return Object.freeze({ status: "fail", decisionCodes: Object.freeze(["PLATFORM_CHECK_FAILED"]), missingChecks: Object.freeze([]) });
  }
  return Object.freeze({ status: "pass", decisionCodes: Object.freeze(["REAL_OBSIDIAN_CELL_PASS"]), missingChecks: Object.freeze([]) });
}

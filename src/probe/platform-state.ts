import type { DataAdapter } from "obsidian";

import { platformProbeRequestSchema, platformProbeStateSchema, type PlatformCheckpoint, type PlatformProbeRequest, type PlatformProbeState } from "./platform-contract";

export const SPIKE_REQUEST_PATH = ".matrix-engine-spike/request.json";
export const SPIKE_STATE_PATH = ".matrix-engine-spike/state.json";
export const SPIKE_RESULT_PATH = ".matrix-engine-spike/checkpoints.json";

export async function loadProbeRequest(adapter: DataAdapter): Promise<PlatformProbeRequest> {
  return platformProbeRequestSchema.parse(JSON.parse(await adapter.read(SPIKE_REQUEST_PATH)));
}

function sameRun(left: PlatformProbeRequest, right: PlatformProbeRequest): boolean {
  return left.target === right.target
    && left.cell === right.cell
    && left.appVersion === right.appVersion
    && left.pluginRunnerSha256 === right.pluginRunnerSha256
    && left.vaultPathSha256 === right.vaultPathSha256
    && left.profilePathSha256 === right.profilePathSha256;
}

export async function loadProbeState(
  adapter: DataAdapter,
  request: PlatformProbeRequest,
  runtime: PlatformProbeState["runtime"]
): Promise<PlatformProbeState> {
  if (!(await adapter.exists(SPIKE_STATE_PATH))) {
    return { schemaVersion: 1, request, checkpoints: [], loadSessionIds: [], observedArtifacts: [], runtime };
  }
  const state = platformProbeStateSchema.parse(JSON.parse(await adapter.read(SPIKE_STATE_PATH)));
  if (!sameRun(state.request, request)) throw new Error("PLATFORM_PROBE_REQUEST_CHANGED");
  return { ...state, request, runtime };
}

export function mergeCheckpoints(existing: readonly PlatformCheckpoint[], next: readonly PlatformCheckpoint[]): PlatformCheckpoint[] {
  const merged = new Map(existing.map((checkpoint) => [checkpoint.id, checkpoint]));
  for (const checkpoint of next) merged.set(checkpoint.id, checkpoint);
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function appendLoadSession(existing: readonly string[], loadSessionId: string): string[] {
  return [...new Set([...existing, loadSessionId])];
}

export function assertFinalProbeState(state: PlatformProbeState): void {
  if (state.request.cell === "minimum-1.11.4") {
    if (state.request.phase !== "initial") throw new Error("MINIMUM_CELL_PHASE_INVALID");
    return;
  }
  if (state.request.phase !== "complete") throw new Error("STABLE_CELL_INCOMPLETE");
  if (new Set(state.loadSessionIds).size < 2) throw new Error("RELOAD_SESSION_MISSING");
  const versions = new Set(state.observedArtifacts.map(({ pluginVersion }) => pluginVersion));
  if (!versions.has("0.0.0") || !versions.has("0.0.1")) throw new Error("UPGRADE_ARTIFACTS_MISSING");
}

export async function writeProbeState(adapter: DataAdapter, state: PlatformProbeState, final = false): Promise<void> {
  if (!(await adapter.exists(".matrix-engine-spike"))) await adapter.mkdir(".matrix-engine-spike");
  const json = `${JSON.stringify(state, undefined, 2)}\n`;
  await adapter.write(SPIKE_STATE_PATH, json);
  if (final) await adapter.write(SPIKE_RESULT_PATH, json);
}

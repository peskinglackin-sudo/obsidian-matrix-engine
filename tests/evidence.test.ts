import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../spike/evidence/canonical";
import { BoundedSafeLog } from "../spike/evidence/redaction";
import { parseEvidenceEnvelope } from "../spike/evidence/schema";
import {
  renderEvidenceJson,
  renderEvidenceJunit,
  renderEvidenceMarkdown,
  writeEvidenceReports
} from "../spike/evidence/write-report";

const HASH = "a".repeat(64);
const COMMIT = "b".repeat(40);

function validEvidence(): unknown {
  return {
    schemaVersion: 1,
    runId: "123e4567-e89b-42d3-a456-426614174000",
    kind: "packaging",
    status: "pass",
    startedAt: "2026-07-15T10:00:00.000Z",
    completedAt: "2026-07-15T10:00:01.000Z",
    sourceCommit: COMMIT,
    artifactSha256: HASH,
    environment: {
      os: "linux",
      osVersion: "6.6.87.2",
      architecture: "x64",
      libc: "glibc",
      nodeVersion: "22.22.1",
      dependencyVersions: { lancedb: "0.31.0" }
    },
    decisionCodes: ["PACKAGE_BASELINE_PASS"],
    details: {
      checks: [{ id: "manifest", status: "pass", durationMs: 1 }],
      counts: { files: 3 },
      durationsMs: { total: 1 },
      versions: { plugin: "0.0.1" }
    }
  };
}

describe("evidence schema and serialization", () => {
  it("validates, canonicalizes, hashes, and renders only allowlisted data", () => {
    const evidence = parseEvidenceEnvelope(validEvidence());
    const json = renderEvidenceJson(evidence);

    expect(json).toBe(canonicalJson(evidence));
    expect(sha256(json)).toMatch(/^[a-f0-9]{64}$/u);
    expect(renderEvidenceJunit(evidence)).toContain('<testcase name="manifest"');
    expect(renderEvidenceMarkdown(evidence)).toContain("PACKAGE_BASELINE_PASS");
  });

  it("rejects secrets, arbitrary responses, content, and absolute paths as extra fields", () => {
    const adversarial = {
      ...(validEvidence() as Record<string, unknown>),
      authorization: "Bearer secret",
      query: "private query",
      document: "private document",
      path: "/home/user/vault/note.md",
      response: { data: [1, 2, 3] }
    };

    expect(() => parseEvidenceEnvelope(adversarial)).toThrow();
    expect(() => parseEvidenceEnvelope({ ...validEvidence() as object, error: { message: "secret" } })).toThrow();
  });

  it("writes authoritative JSON plus JUnit and Markdown with private file modes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "matrix-engine-evidence-"));
    await writeEvidenceReports(directory, validEvidence());

    const json = await readFile(join(directory, "evidence.json"), "utf8");
    expect(parseEvidenceEnvelope(JSON.parse(json))).toBeDefined();
    expect((await stat(join(directory, "evidence.json"))).mode & 0o077).toBe(0);
  });
});

describe("bounded safe logs", () => {
  it("accepts fixed safe events and drops arbitrary sensitive objects without inspecting them", () => {
    const log = new BoundedSafeLog(512);
    expect(log.capture({
      timestamp: "2026-07-15T10:00:00.000Z",
      level: "info",
      event: "probe.packaging.complete",
      component: "matrix-engine-spike",
      durationMs: 4
    })).toBe(true);
    expect(log.capture({
      timestamp: "2026-07-15T10:00:00.000Z",
      level: "error",
      event: "provider.request.failed",
      component: "matrix-engine-spike",
      authorization: "Bearer secret",
      input: "private query",
      response: { body: "private document" },
      path: "/home/user/vault"
    })).toBe(false);

    const snapshot = log.snapshot();
    expect(snapshot.dropped).toBe(1);
    expect(snapshot.text).not.toMatch(/secret|private|\/home\/user/u);
  });
});

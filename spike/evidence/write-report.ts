import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson } from "./canonical";
import { parseEvidenceEnvelope, type EvidenceEnvelope } from "./schema";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderEvidenceJson(input: unknown): string {
  return canonicalJson(parseEvidenceEnvelope(input));
}

export function renderEvidenceJunit(input: unknown): string {
  const evidence = parseEvidenceEnvelope(input);
  const failures = evidence.details.checks.filter(({ status }) => status === "fail");
  const skipped = evidence.details.checks.filter(({ status }) => status !== "pass" && status !== "fail");
  const cases = evidence.details.checks.map((check) => {
    const attributes = `name="${escapeXml(check.id)}" time="${(check.durationMs / 1000).toFixed(6)}"`;
    if (check.status === "fail") {
      return `    <testcase ${attributes}><failure type="${escapeXml(check.errorCode ?? "CHECK_FAILED")}"/></testcase>`;
    }
    if (check.status !== "pass") {
      return `    <testcase ${attributes}><skipped message="${escapeXml(check.status)}"/></testcase>`;
    }
    return `    <testcase ${attributes}/>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${escapeXml(evidence.kind)}" tests="${String(evidence.details.checks.length)}" failures="${String(failures.length)}" skipped="${String(skipped.length)}">`,
    ...cases,
    "</testsuite>",
    ""
  ].join("\n");
}

export function renderEvidenceMarkdown(input: unknown): string {
  const evidence = parseEvidenceEnvelope(input);
  const decisions = evidence.decisionCodes.length > 0 ? evidence.decisionCodes.join(", ") : "none";
  return [
    `# ${evidence.kind} evidence`,
    "",
    `- Status: \`${evidence.status}\``,
    `- Run ID: \`${evidence.runId}\``,
    `- Artifact SHA-256: \`${evidence.artifactSha256}\``,
    `- Checks: ${String(evidence.details.checks.length)}`,
    `- Decisions: ${decisions}`,
    ""
  ].join("\n");
}

export async function writeEvidenceReports(outputDirectory: string, input: unknown): Promise<EvidenceEnvelope> {
  const evidence = parseEvidenceEnvelope(input);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(outputDirectory, "evidence.json"), renderEvidenceJson(evidence), { encoding: "utf8", mode: 0o600 }),
    writeFile(join(outputDirectory, "evidence.junit.xml"), renderEvidenceJunit(evidence), { encoding: "utf8", mode: 0o600 }),
    writeFile(join(outputDirectory, "evidence.md"), renderEvidenceMarkdown(evidence), { encoding: "utf8", mode: 0o600 })
  ]);
  return evidence;
}

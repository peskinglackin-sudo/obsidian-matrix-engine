import { z } from "zod";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const SAFE_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,63}$/u;

export const evidenceStatusSchema = z.enum([
  "pass",
  "fail",
  "unverified",
  "environment_error",
  "unsupported"
]);

export const evidenceKindSchema = z.enum([
  "packaging",
  "community_distribution",
  "fts_capability",
  "lexical_quality",
  "provider_protocol",
  "provider_live",
  "provider_local_gpu",
  "semantic_quality",
  "ann_benchmark",
  "license_audit",
  "secret_audit"
]);

export const safeErrorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
  category: z.enum([
    "cancelled",
    "timeout",
    "environment",
    "unsupported",
    "unverified",
    "invalid_input",
    "authentication",
    "authorization",
    "rate_limit",
    "provider",
    "storage",
    "internal"
  ]),
  messageKey: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/u),
  retryable: z.boolean(),
  operationId: z.string().regex(SAFE_ID_PATTERN).optional(),
  retryAfterMs: z.number().int().nonnegative().optional()
});

const safeStringMapSchema = z.record(
  z.string().regex(/^[a-z][a-zA-Z0-9]*$/u),
  z.string().regex(SAFE_VERSION_PATTERN)
);

export const safeEnvironmentSchema = z.strictObject({
  os: z.enum(["windows", "macos", "linux", "unknown"]),
  osVersion: z.string().regex(SAFE_VERSION_PATTERN),
  architecture: z.enum(["x64", "arm64", "unknown"]),
  libc: z.enum(["glibc", "musl", "none", "unknown"]),
  obsidianVersion: z.string().regex(SAFE_VERSION_PATTERN).optional(),
  electronVersion: z.string().regex(SAFE_VERSION_PATTERN).optional(),
  nodeVersion: z.string().regex(SAFE_VERSION_PATTERN),
  nodeAbi: z.string().regex(SAFE_VERSION_PATTERN).optional(),
  dependencyVersions: safeStringMapSchema,
  runtimeHashes: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*Sha256$/u), z.string().regex(SHA256_PATTERN)).optional(),
  gpuBackend: z.enum(["vulkan", "metal", "cpu-control", "none", "unknown"]).optional()
});

const checkResultSchema = z.strictObject({
  id: z.string().regex(SAFE_ID_PATTERN),
  status: evidenceStatusSchema,
  durationMs: z.number().nonnegative(),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u).optional()
});

export const safeEvidenceDetailsSchema = z.strictObject({
  checks: z.array(checkResultSchema).max(1000),
  counts: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/u), z.number().int().nonnegative()),
  durationsMs: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/u), z.number().nonnegative()),
  versions: safeStringMapSchema
});

export const evidenceEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.uuid(),
  kind: evidenceKindSchema,
  status: evidenceStatusSchema,
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  sourceCommit: z.string().regex(SOURCE_COMMIT_PATTERN),
  artifactSha256: z.string().regex(SHA256_PATTERN),
  fixtureSha256: z.string().regex(SHA256_PATTERN).optional(),
  environment: safeEnvironmentSchema,
  decisionCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u)).max(100),
  details: safeEvidenceDetailsSchema,
  error: safeErrorSchema.optional()
});

export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;
export type EvidenceEnvelope = z.infer<typeof evidenceEnvelopeSchema>;
export type SafeEnvironment = z.infer<typeof safeEnvironmentSchema>;

export function parseEvidenceEnvelope(input: unknown): EvidenceEnvelope {
  return evidenceEnvelopeSchema.parse(input);
}

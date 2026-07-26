# Diagnostics and Privacy

Diagnostics are local-first and user-inspectable. The plugin must not upload
telemetry by default (`prd.md` sections 20.5 and 21).

## Structured diagnostics

Use a project-owned diagnostics service rather than scattered console calls.
Diagnostic records should carry a stable event name, severity, timestamp,
operation/request ID, component, duration or count where applicable, and safe
error code. Keep presentation strings out of the record schema.

Capture the phase timings named in `prd.md` section 20.5:

- `query_parse_ms`, `language_analysis_ms`, and `query_embed_ms`;
- `exact_search_ms`, `lexical_search_ms`, and `vector_search_ms`;
- `fusion_ms`, `rerank_ms`, `hydrate_ms`, and `render_ms`.

Also expose index health values required by sections 14.7 and 19: indexed and
unindexed rows, deleted fragments, pending/dead-letter jobs, last sync,
maintenance state, artifact/provider state, and recent errors.

## Levels

- Error: an operation failed and needs user action, retry, or degradation.
- Warn: a safe fallback, unsupported capability, insecure remote endpoint, or
  recoverable inconsistency occurred.
- Info: lifecycle and user-triggered maintenance milestones, without content.
- Debug: detailed local troubleshooting only when explicitly enabled.

Routine cancellation and expected capability misses are not errors. Repeated
per-row success logs are forbidden; aggregate batches and stages instead.

## Redaction boundary

Never record or export:

- API keys, secret values, or Authorization headers;
- complete document bodies or rendered embedding inputs;
- complete query history unless the user explicitly enables local debug;
- arbitrary provider headers or raw responses without redaction.

Prefer IDs, hashes, sizes, language/script codes, status, latency, and bounded
safe summaries. `data.json` stores only `secretRef`; the secret itself belongs
in Obsidian SecretStorage.

Remote calls require a separate user-facing preview of destination, model,
fields, and rendered document/query samples. That preview is not permission to
copy the same sensitive content into diagnostics.

## Diagnostic export

Export is an explicit user action and safe-redacted by construction. Before
writing export code, define an allowlist schema and test it with secrets,
headers, document text, queries, non-ASCII paths, and nested provider errors.
Do not implement redaction as a short denylist over arbitrary objects.

## Verification

Tests must assert both presence of useful codes/timings and absence of secrets,
document contents, and unauthorized query contents. Review every new log field
at the same trust boundary as persisted settings and remote requests.

Spike evidence is owned by `spike/evidence/schema.ts`, `redaction.ts`,
`canonical.ts`, and `write-report.ts`. The boundary uses Zod strict objects and
bounded event schemas, not a recursive denylist. JSON is canonical and
authoritative; JUnit/Markdown are projections. Output uses private modes.
`tests/evidence.test.ts` rejects keys, Authorization data, content, arbitrary
responses, nested raw errors, and absolute paths.

Final Spike aggregation is a second trust boundary. `spike/report/cli.ts`
strictly parses each required report, then calls
`projectSafeEvidence()` from `spike/report/projection.ts`. The projection keeps
hashes, counts, allowlisted metrics, parameters, and decision codes; it drops
semantic source/control text, vectors, query-level ANN results, dependency
package rows, raw logs, and all arbitrary extra fields. Test the projection
with actual prohibited values (`tests/final-report.test.ts`), not by checking
source strings or assuming an earlier report was already safe.

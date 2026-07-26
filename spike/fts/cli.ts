import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { connect, Index, MatchQuery, PhraseQuery } from "@lancedb/lancedb";
import { canonicalJson } from "../evidence/canonical";
const directory = await mkdtemp(join(tmpdir(), "matrix-engine-fts-"));
const checks: { id: string; status: "pass" | "fail" | "unsupported"; errorCode?: string }[] = [];
const db = await connect(directory);
try {
  const table = await db.createTable("capability", [{ id: "a", text: "alpha ordered phrase 检索引擎", tags: ["alpha", "检索"] }, { id: "b", text: "beta different order phrase", tags: ["beta"] }], { mode: "overwrite" });
  try {
    for (const [id, config] of [["whitespace", Index.fts({ baseTokenizer: "whitespace", withPosition: true })], ["ngram", Index.fts({ baseTokenizer: "ngram", ngramMinLength: 2, ngramMaxLength: 3, withPosition: true })]] as const) {
      try { await table.createIndex("text", { config, replace: true }); checks.push({ id, status: "pass" }); } catch { checks.push({ id, status: "unsupported", errorCode: "FTS_INDEX_UNSUPPORTED" }); }
    }
    try { const rows = await table.query().fullTextSearch(new MatchQuery("检索", "text", { fuzziness: 0 })).limit(10).toArray(); checks.push({ id: "match", status: rows.length > 0 ? "pass" : "fail" }); } catch { checks.push({ id: "match", status: "fail", errorCode: "FTS_MATCH_FAILED" }); }
    try { const rows = await table.query().fullTextSearch(new PhraseQuery("ordered phrase", "text")).limit(10).toArray(); checks.push({ id: "phrase-position", status: rows.length > 0 ? "pass" : "fail" }); } catch { checks.push({ id: "phrase-position", status: "unsupported", errorCode: "FTS_PHRASE_UNSUPPORTED" }); }
    try { const rows = await table.query().fullTextSearch(new MatchQuery("alhpa", "text", { fuzziness: 1 })).limit(10).toArray(); checks.push({ id: "fuzzy", status: rows.length > 0 ? "pass" : "fail" }); } catch { checks.push({ id: "fuzzy", status: "unsupported", errorCode: "FTS_FUZZY_UNSUPPORTED" }); }
    try { await table.createIndex("tags", { config: Index.fts({ baseTokenizer: "whitespace" }) }); checks.push({ id: "array-field", status: "pass" }); } catch { checks.push({ id: "array-field", status: "unsupported", errorCode: "FTS_ARRAY_UNSUPPORTED" }); }
    await table.add([{ id: "c", text: "gamma unindexed row", tags: ["gamma"] }]); checks.push({ id: "add-unindexed", status: "pass" });
    await table.update({ where: "id = 'c'", values: { text: "gamma updated" } }); checks.push({ id: "update", status: "pass" });
    await table.delete("id = 'b'"); checks.push({ id: "delete", status: "pass" });
    await table.optimize(); checks.push({ id: "optimize-rebuild", status: "pass" });
  } finally { table.close(); }
} finally { db.close(); await rm(directory, { recursive: true, force: true }); }
await mkdir("reports/fts", { recursive: true });
await writeFile("reports/fts/capability.json", canonicalJson({ schemaVersion: 1, lancedbVersion: "0.31.0", authoritativeScope: "current-host-node-precheck", checks }), { mode: 0o600 });
process.stdout.write(`${checks.every(({ status }) => status === "pass") ? "combined-candidate" : "vector-only-candidate"}\n`);

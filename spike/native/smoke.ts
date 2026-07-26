import type { LoadedLanceDb } from "../../src/native/lancedb-loader";

export async function runLanceDbSmoke(lancedb: LoadedLanceDb, databaseDirectory: string): Promise<readonly unknown[]> {
  const connection = await lancedb.connect(databaseDirectory);
  let table: Awaited<ReturnType<typeof connection.createTable>> | undefined;
  try {
    table = await connection.createTable("smoke", [
      { id: "简体中文", vector: [1, 0, 0], path: "space folder/中文.md" },
      { id: "日本語", vector: [0, 1, 0], path: "日本語/😀.md" }
    ], { mode: "overwrite" });
    await table.add([{ id: "emoji", vector: [0, 0, 1], path: "emoji/🧪.md" }]);
    return await table.vectorSearch([1, 0, 0]).limit(3).toArray();
  } finally {
    table?.close();
    connection.close();
  }
}

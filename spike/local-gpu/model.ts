import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { MODEL_SHA256, MODEL_SIZE } from "./evaluate";
export async function verifyPinnedModel(path: string) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (stat.size !== MODEL_SIZE) return Object.freeze({ status: "fail" as const, code: "MODEL_SIZE_INVALID" });
    const header = Buffer.alloc(4); await file.read(header, 0, 4, 0);
    if (header.toString("ascii") !== "GGUF") return Object.freeze({ status: "fail" as const, code: "MODEL_HEADER_INVALID" });
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream()) {
      if (!Buffer.isBuffer(chunk)) throw new TypeError("Model stream yielded a non-buffer chunk");
      hash.update(chunk);
    }
    if (hash.digest("hex") !== MODEL_SHA256) return Object.freeze({ status: "fail" as const, code: "MODEL_HASH_INVALID" });
    return Object.freeze({ status: "pass" as const, size: stat.size, sha256: MODEL_SHA256 });
  } finally { await file.close(); }
}

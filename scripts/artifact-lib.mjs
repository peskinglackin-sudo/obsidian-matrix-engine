import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalJson(value) {
  const sort = (item) => Array.isArray(item)
    ? item.map(sort)
    : item !== null && typeof item === "object"
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, sort(nested)]))
      : item;
  return `${JSON.stringify(sort(value), undefined, 2)}\n`;
}

export async function fileRecord(root, path) {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  return { path: relative(resolve(root), absolute).replaceAll("\\", "/"), size: bytes.byteLength, sha256: sha256(bytes) };
}

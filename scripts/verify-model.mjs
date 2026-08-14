import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, "public", "model-manifest.json"), "utf8"));
const bytes = await readFile(join(root, "public", "models", manifest.filename));
const sha256 = createHash("sha256").update(bytes).digest("hex");

if (bytes.byteLength !== manifest.sizeBytes) {
  throw new Error(`Size mismatch: expected ${manifest.sizeBytes}, got ${bytes.byteLength}`);
}

if (sha256 !== manifest.sha256) {
  throw new Error(`SHA mismatch: expected ${manifest.sha256}, got ${sha256}`);
}

console.log(`Verified ${manifest.filename}`);
console.log(`SHA-256: ${sha256}`);

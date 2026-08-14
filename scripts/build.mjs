import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vite";

const root = process.cwd();
const dist = join(root, "dist");

await build();

await cp(join(root, "public"), dist, { recursive: true });
await cp(join(dist, "src", "ui", "popup.html"), join(dist, "popup.html"));
await cp(join(dist, "src", "ui", "options.html"), join(dist, "options.html"));
await cp(join(dist, "src", "offscreen", "offscreen.html"), join(dist, "offscreen.html"));

const ortSource = join(root, "node_modules", "onnxruntime-web", "dist");
const ortTarget = join(dist, "ort");
await mkdir(ortTarget, { recursive: true });

for (const file of await readdir(ortSource)) {
  if (file.endsWith(".wasm") || file.endsWith(".mjs")) {
    await cp(join(ortSource, file), join(ortTarget, file));
  }
}

await writeFile(join(dist, ".sourcesight-build"), new Date().toISOString() + "\n");

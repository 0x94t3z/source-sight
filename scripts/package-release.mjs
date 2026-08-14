import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const dist = resolve(root, "dist");
const output = resolve(root, `source-sight-v${readVersion()}.zip`);

run("npm", ["run", "check"]);
run("npm", ["run", "verify:model"]);
run("npm", ["run", "build"]);

const required = [
  join(dist, "manifest.json"),
  join(dist, "model-manifest.json"),
  join(dist, "models", "ai-image-detection-int8.onnx"),
  join(dist, "ort"),
  join(dist, "assets")
];
for (const path of required) {
  if (!existsSync(path)) throw new Error(`Release asset is missing: ${path}`);
}

if (existsSync(output)) rmSync(output, { force: true });
const result = spawnSync("zip", ["-qr", output, "."], { cwd: dist, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`zip exited with status ${result.status}`);

const sizeMb = (statSync(output).size / 1024 / 1024).toFixed(1);
console.log(`Created ${output} (${sizeMb} MB)`);
console.log("The archive contains the verified model and all inference runtime assets.");

function readVersion() {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  return packageJson.version;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

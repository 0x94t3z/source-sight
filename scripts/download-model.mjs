import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const model = {
  id: "capcheck-ai-image-detection-vit-int8",
  filename: "ai-image-detection-int8.onnx",
  url: "https://huggingface.co/onnx-community/ai-image-detection-ONNX/resolve/e3cfe99f2841930a040a6281682c10c989965603/onnx/model_int8.onnx",
  source: "onnx-community/ai-image-detection-ONNX",
  upstream: "CapCheck AI Image Detection (CIFAKE ViT-Base)",
  input: {
    width: 224,
    height: 224,
    resizeShortSide: 224,
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5]
  },
  output: {
    kind: "softmax2",
    aiIndex: 1,
    meaning: "softmax(logits)[1] = P(AI-generated); labels are REAL=0, FAKE=1",
    threshold: 0.65
  }
};

const publicDir = join(process.cwd(), "public");
const modelPath = join(publicDir, "models", model.filename);
const manifestPath = join(publicDir, "model-manifest.json");

try {
  const [existingBytes, existingManifestText, existingStat] = await Promise.all([
    readFile(modelPath),
    readFile(manifestPath, "utf8"),
    stat(modelPath)
  ]);
  const existingManifest = JSON.parse(existingManifestText);
  const existingSha256 = createHash("sha256").update(existingBytes).digest("hex");
  if (
    existingStat.size === existingManifest.sizeBytes &&
    existingSha256 === existingManifest.sha256 &&
    existingManifest.id === model.id
  ) {
    console.log(`Model already present and verified: ${model.filename}`);
    console.log(`SHA-256: ${existingSha256}`);
    process.exit(0);
  }
} catch {
  // Missing or invalid local files are repaired by the pinned download below.
}

const response = await fetch(model.url);
if (!response.ok) {
  throw new Error(`Failed to download model: ${response.status} ${response.statusText}`);
}

const bytes = new Uint8Array(await response.arrayBuffer());
const sha256 = createHash("sha256").update(bytes).digest("hex");

await mkdir(join(publicDir, "models"), { recursive: true });
await writeFile(modelPath, bytes);
await writeFile(
  manifestPath,
  JSON.stringify({ ...model, sizeBytes: bytes.byteLength, sha256 }, null, 2) + "\n"
);

console.log(`Downloaded ${model.filename}`);
console.log(`Size: ${bytes.byteLength}`);
console.log(`SHA-256: ${sha256}`);

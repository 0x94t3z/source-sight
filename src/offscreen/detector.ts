import * as ort from "onnxruntime-web";
import { DEFAULT_THRESHOLD } from "../shared/settings";
import type { AnalyzeImageResult, ModelManifest } from "../shared/types";
import { prepareImage } from "./preprocess";
import { readStoredModel, sha256Hex, writeStoredModel } from "./model-store";

let session: ort.InferenceSession | null = null;
let sessionPromise: Promise<ort.InferenceSession> | null = null;
let analysisQueue: Promise<unknown> = Promise.resolve();
let manifestPromise: Promise<ModelManifest> | null = null;
let backend: "webgpu" | "wasm" = "wasm";
let downloadPromise: Promise<ArrayBuffer> | null = null;

ort.env.logLevel = "error";

export async function getManifest(): Promise<ModelManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(chrome.runtime.getURL("model-manifest.json")).then(async (response) => {
      if (!response.ok) throw new Error("Could not load model manifest");
      return response.json() as Promise<ModelManifest>;
    });
  }
  return manifestPromise;
}

export async function modelReady(): Promise<boolean> {
  const manifest = await getManifest();
  return (await readStoredModel(manifest)) !== null;
}

export async function setupModel(): Promise<void> {
  await loadSession();
}

export async function analyzeImage(id: string, url: string): Promise<AnalyzeImageResult> {
  const queued = analysisQueue.then(() => analyzeImageNow(id, url));
  analysisQueue = queued.catch(() => undefined);
  return queued;
}

async function analyzeImageNow(id: string, url: string): Promise<AnalyzeImageResult> {
  const manifest = await getManifest();
  const activeSession = await loadSession();
  const prepared = await prepareImage(url, manifest);
  const inputName = activeSession.inputNames[0];
  const visualScores: number[] = [];
  for (const tensor of prepared.tensors) {
    const input = new ort.Tensor("float32", tensor, [
      1,
      3,
      manifest.input.height,
      manifest.input.width
    ]);
    const outputs = await activeSession.run({ [inputName]: input });
    const outputName = activeSession.outputNames[0];
    visualScores.push(modelAiProbability(outputs[outputName].data, manifest));
  }
  const visualScore = visualScores.reduce((sum, value) => sum + value, 0) / visualScores.length;
  const aiProbability = clamp01(visualScore + metadataAdjustment(prepared.metadataSignals));
  const threshold = DEFAULT_THRESHOLD;
  const label =
    aiProbability >= threshold
      ? "likely_ai"
      : 1 - aiProbability >= threshold
        ? "likely_real"
        : "uncertain";
  const confidence = label === "likely_ai" ? aiProbability : 1 - aiProbability;

  return {
    type: "SS_ANALYZE_RESULT",
    id,
    label,
    confidence,
    aiProbability,
    visualScore,
    metadataSignals: prepared.metadataSignals,
    threshold,
    backend,
    modelId: manifest.id
  };
}

async function loadSession(): Promise<ort.InferenceSession> {
  if (session) return session;
  if (sessionPromise) return sessionPromise;

  sessionPromise = createSession().finally(() => {
    sessionPromise = null;
  });

  return sessionPromise;
}

async function createSession(): Promise<ort.InferenceSession> {
  const manifest = await getManifest();
  const modelBytes = await loadModelBytes(manifest);

  ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";

  try {
    session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["webgpu", "wasm"],
      graphOptimizationLevel: "all",
      logSeverityLevel: 3
    });
    backend = "webgpu";
  } catch (error) {
    console.warn("Source Sight WebGPU initialization failed; falling back to WASM.", error);
    session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      logSeverityLevel: 3
    });
    backend = "wasm";
  }

  return session;
}

async function loadModelBytes(manifest: ModelManifest): Promise<ArrayBuffer> {
  const stored = await readStoredModel(manifest);
  if (stored) return stored;

  if (!downloadPromise) {
    downloadPromise = downloadAndVerifyModel(manifest);
  }

  return downloadPromise;
}

async function downloadAndVerifyModel(manifest: ModelManifest): Promise<ArrayBuffer> {
  const packagedUrl = chrome.runtime.getURL(`models/${manifest.filename}`);
  const bytes = await fetchModelCandidate(packagedUrl).catch(() => {
    throw new Error(
      "The verified model is not bundled. Run npm run download:model and rebuild the extension."
    );
  });

  if (bytes.byteLength !== manifest.sizeBytes) {
    throw new Error(
      `Model size mismatch: expected ${manifest.sizeBytes}, got ${bytes.byteLength}`
    );
  }

  const sha256 = await sha256Hex(bytes);
  if (sha256 !== manifest.sha256) {
    throw new Error(`Model SHA-256 mismatch: expected ${manifest.sha256}, got ${sha256}`);
  }

  await writeStoredModel(manifest, bytes.slice(0));
  return bytes;
}

async function fetchModelCandidate(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Model fetch failed from ${url}: ${response.status}`);
  }
  return response.arrayBuffer();
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function modelAiProbability(data: ort.Tensor["data"], manifest: ModelManifest): number {
  if (manifest.output.kind === "sigmoid") {
    return sigmoid(Number(data[0]));
  }

  const aiIndex = manifest.output.aiIndex ?? 1;
  const logits = Array.from(data, Number);
  const maxLogit = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maxLogit));
  const denominator = exponentials.reduce((sum, value) => sum + value, 0);
  return clamp01((exponentials[aiIndex] ?? 0) / denominator);
}

function metadataAdjustment(signals: string[]): number {
  const syntheticSignals = signals.filter((signal) => !signal.includes("C2PA"));
  return Math.min(0.06, syntheticSignals.length * 0.03);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

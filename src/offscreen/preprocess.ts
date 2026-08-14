import type { ModelManifest } from "../shared/types";

export interface PreparedImage {
  tensors: Float32Array[];
  metadataSignals: string[];
}

export async function prepareImage(url: string, manifest: ModelManifest): Promise<PreparedImage> {
  const response = await fetch(url, {
    cache: "force-cache",
    credentials: "omit",
    referrerPolicy: "no-referrer"
  });

  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`Unsupported media type: ${blob.type || "unknown"}`);
  }

  const metadataSignals = await inspectMetadata(blob);
  const bitmap = await createImageBitmap(blob);
  const tensors = bitmapToTensors(bitmap, manifest);
  bitmap.close();

  return { tensors, metadataSignals };
}

function bitmapToTensors(bitmap: ImageBitmap, manifest: ModelManifest): Float32Array[] {
  const { width, height, resizeShortSide, mean, std } = manifest.input;
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const scale = resizeShortSide / Math.min(sourceWidth, sourceHeight);
  const resizedWidth = Math.round(sourceWidth * scale);
  const resizedHeight = Math.round(sourceHeight * scale);
  const resizeCanvas = new OffscreenCanvas(resizedWidth, resizedHeight);
  const resizeCtx = resizeCanvas.getContext("2d", { willReadFrequently: true });
  if (!resizeCtx) throw new Error("Could not create resize canvas context");
  resizeCtx.drawImage(bitmap, 0, 0, resizedWidth, resizedHeight);

  const excessX = Math.max(0, resizedWidth - width);
  const excessY = Math.max(0, resizedHeight - height);
  const excess = Math.max(excessX, excessY);
  const offsets = excess < 8 ? [0.5] : [0, 0.5, 1];
  return offsets.map((position) => {
    const cropX = Math.floor(excessX * position);
    const cropY = Math.floor(excessY * position);
    const cropCanvas = new OffscreenCanvas(width, height);
    const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
    if (!cropCtx) throw new Error("Could not create crop canvas context");
    cropCtx.drawImage(resizeCanvas, cropX, cropY, width, height, 0, 0, width, height);

    const rgba = cropCtx.getImageData(0, 0, width, height).data;
    const planeSize = width * height;
    const tensor = new Float32Array(3 * planeSize);

    for (let i = 0, pixel = 0; i < rgba.length; i += 4, pixel += 1) {
      const r = rgba[i] / 255;
      const g = rgba[i + 1] / 255;
      const b = rgba[i + 2] / 255;
      tensor[pixel] = (r - mean[0]) / std[0];
      tensor[planeSize + pixel] = (g - mean[1]) / std[1];
      tensor[2 * planeSize + pixel] = (b - mean[2]) / std[2];
    }

    return tensor;
  });
}

async function inspectMetadata(blob: Blob): Promise<string[]> {
  const head = await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer();
  const text = new TextDecoder("latin1", { fatal: false }).decode(head).toLowerCase();
  const signals: string[] = [];

  const checks: Array<[string, string]> = [
    ["stable diffusion", "metadata: Stable Diffusion"],
    ["midjourney", "metadata: Midjourney"],
    ["dall-e", "metadata: DALL-E"],
    ["dalle", "metadata: DALL-E"],
    ["comfyui", "metadata: ComfyUI"],
    ["automatic1111", "metadata: AUTOMATIC1111"],
    ["invokeai", "metadata: InvokeAI"],
    ["c2pa", "metadata: C2PA present"],
    ["contentauthenticity", "metadata: content authenticity marker"]
  ];

  for (const [needle, label] of checks) {
    if (text.includes(needle) && !signals.includes(label)) signals.push(label);
  }

  return signals;
}

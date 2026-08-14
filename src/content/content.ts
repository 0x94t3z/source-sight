import type { AnalyzeImageError, AnalyzeImageResult, RuntimeResponse } from "../shared/types";

interface ContentSettings {
  enabled: boolean;
  showUncertain: boolean;
  maxImagesPerPage: number;
}

const DEFAULT_CONTENT_SETTINGS: ContentSettings = {
  enabled: true,
  showUncertain: true,
  maxImagesPerPage: 80
};

const seen = new WeakSet<HTMLImageElement>();
const overlays = new WeakMap<HTMLImageElement, HTMLElement>();
let scannedCount = 0;
let showUncertain = true;

void boot();

async function boot(): Promise<void> {
  const settings = await getContentSettings();
  if (!settings.enabled) return;
  showUncertain = settings.showUncertain;

  injectStyles();
  scanImages(settings.maxImagesPerPage);

  const observer = new MutationObserver(() => scanImages(settings.maxImagesPerPage));
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset", "style", "class"]
  });

  window.addEventListener("scroll", updateOverlayPositions, { passive: true });
  window.addEventListener("resize", updateOverlayPositions, { passive: true });
}

async function getContentSettings(): Promise<ContentSettings> {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_CONTENT_SETTINGS, ...(stored.settings ?? {}) };
}

function scanImages(maxImages: number): void {
  const images = Array.from(document.images);
  for (const image of images) {
    if (scannedCount >= maxImages) return;
    if (seen.has(image)) continue;
    if (!image.complete || !(image.naturalWidth || image.width)) {
      image.addEventListener("load", () => scanImages(maxImages), { once: true });
      continue;
    }
    if (!shouldAnalyze(image)) continue;

    seen.add(image);
    scannedCount += 1;
    void analyze(image);
  }
}

function shouldAnalyze(image: HTMLImageElement): boolean {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!image.currentSrc && !image.src) return false;
  if (width < 96 || height < 96) return false;
  if (width * height < 96 * 96) return false;
  if (image.closest("[data-sourcesight-ignore]")) return false;
  return true;
}

async function analyze(image: HTMLImageElement): Promise<void> {
  const overlay = createOverlay(image);
  setOverlayState(overlay, "Scanning", "sourcesight-badge--pending");

  try {
    const id = crypto.randomUUID();
    const response = (await sendAnalyzeMessage({
      type: "SS_ANALYZE_IMAGE",
      id,
      url: image.currentSrc || image.src,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight
    })) as RuntimeResponse;

    if (response.type === "SS_ANALYZE_ERROR") {
      setError(overlay, response);
      return;
    }

    if (response.type === "SS_ANALYZE_RESULT") {
      setResult(overlay, response);
      return;
    }

    setOverlayState(overlay, "Unavailable", "sourcesight-badge--error", "Unexpected response");
  } catch (error) {
    setOverlayState(
      overlay,
      "Unavailable",
      "sourcesight-badge--error",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function sendAnalyzeMessage(message: object): Promise<RuntimeResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return (await chrome.runtime.sendMessage(message)) as RuntimeResponse;
    } catch (error) {
      lastError = error;
      if (!String(error).includes("Receiving end does not exist")) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  throw lastError;
}

function createOverlay(image: HTMLImageElement): HTMLElement {
  const overlay = document.createElement("button");
  overlay.type = "button";
  overlay.className = "sourcesight-badge sourcesight-badge--pending";
  overlay.textContent = "Scanning";
  overlay.setAttribute("aria-label", "Source Sight image analysis");
  overlay.dataset.imageId = image.id || image.alt || "image";
  document.documentElement.appendChild(overlay);
  overlays.set(image, overlay);
  positionOverlay(image, overlay);
  return overlay;
}

function setResult(overlay: HTMLElement, result: AnalyzeImageResult): void {
  if (result.label === "uncertain" && !showUncertain) {
    overlay.remove();
    return;
  }

  const pct = Math.round(result.confidence * 100);
  const text =
    result.label === "likely_ai"
      ? `AI ${pct}%`
      : result.label === "likely_real"
        ? `Real ${pct}%`
        : `Uncertain ${pct}%`;
  const className =
    result.label === "likely_ai"
      ? "sourcesight-badge--ai"
      : result.label === "likely_real"
        ? "sourcesight-badge--real"
        : "sourcesight-badge--uncertain";

  overlay.dataset.aiProbability = String(result.aiProbability);
  setOverlayState(
    overlay,
    text,
    className,
    [
      `AI probability: ${Math.round(result.aiProbability * 100)}%`,
      `Visual score: ${Math.round(result.visualScore * 100)}%`,
      `Backend: ${result.backend}`,
      `Threshold: ${Math.round(result.threshold * 100)}%`,
      ...result.metadataSignals
    ].join("\n")
  );
}

function setError(overlay: HTMLElement, error: AnalyzeImageError): void {
  setOverlayState(overlay, "Skipped", "sourcesight-badge--error", error.error);
}

function setOverlayState(
  overlay: HTMLElement,
  text: string,
  className: string,
  title = text
): void {
  overlay.className = `sourcesight-badge ${className}`;
  overlay.textContent = text;
  overlay.title = title;
}

function updateOverlayPositions(): void {
  for (const image of Array.from(document.images)) {
    const overlay = overlays.get(image);
    if (overlay) positionOverlay(image, overlay);
  }
}

function positionOverlay(image: HTMLImageElement, overlay: HTMLElement): void {
  const rect = image.getBoundingClientRect();
  overlay.style.left = `${Math.max(8, rect.left + window.scrollX + 8)}px`;
  overlay.style.top = `${Math.max(8, rect.top + window.scrollY + 8)}px`;
  overlay.style.display =
    rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 ? "block" : "none";
}

function injectStyles(): void {
  if (document.getElementById("sourcesight-styles")) return;

  const style = document.createElement("style");
  style.id = "sourcesight-styles";
  style.textContent = `
    .sourcesight-badge {
      position: absolute;
      z-index: 2147483647;
      border: 1px solid rgba(255, 255, 255, 0.42);
      border-radius: 6px;
      padding: 4px 7px;
      font: 600 11px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff;
      box-shadow: 0 5px 16px rgba(0, 0, 0, 0.24);
      backdrop-filter: blur(8px);
      cursor: help;
      pointer-events: auto;
      letter-spacing: 0;
    }
    .sourcesight-badge--pending { background: rgba(86, 57, 151, 0.92); }
    .sourcesight-badge--ai { background: rgba(190, 18, 60, 0.88); }
    .sourcesight-badge--real { background: rgba(21, 128, 61, 0.88); }
    .sourcesight-badge--uncertain { background: rgba(146, 64, 14, 0.88); }
    .sourcesight-badge--error { background: rgba(75, 85, 99, 0.84); }
  `;
  document.documentElement.appendChild(style);
}

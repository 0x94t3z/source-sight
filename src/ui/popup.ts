import type { RuntimeResponse } from "../shared/types";
import { getSettings, saveSettings, type SourceSightSettings } from "../shared/settings";
import "./ui.css";

const statusEl = document.querySelector<HTMLDivElement>("#status");
const setupButton = document.querySelector<HTMLButtonElement>("#setup");
const enabled = document.querySelector<HTMLInputElement>("#enabled");
const showUncertain = document.querySelector<HTMLInputElement>("#showUncertain");
const maxImagesPerPage = document.querySelector<HTMLInputElement>("#maxImagesPerPage");
const saved = document.querySelector<HTMLParagraphElement>("#saved");

void refreshStatus();
void bootSettings();

setupButton?.addEventListener("click", async () => {
  if (!setupButton || !statusEl) return;
  setupButton.disabled = true;
  statusEl.textContent = "Downloading and verifying model...";

  const response = (await chrome.runtime.sendMessage({ type: "SS_SETUP_MODEL" })) as RuntimeResponse;
  renderStatus(response);
});

async function refreshStatus(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({ type: "SS_GET_STATUS" })) as RuntimeResponse;
  renderStatus(response);
}

async function bootSettings(): Promise<void> {
  renderSettings(await getSettings());
  for (const element of [enabled, showUncertain, maxImagesPerPage]) {
    element?.addEventListener("change", persistSettings);
  }
}

function renderSettings(settings: SourceSightSettings): void {
  if (enabled) enabled.checked = settings.enabled;
  if (showUncertain) showUncertain.checked = settings.showUncertain;
  if (maxImagesPerPage) maxImagesPerPage.value = String(settings.maxImagesPerPage);
}

async function persistSettings(): Promise<void> {
  const settings: SourceSightSettings = {
    enabled: Boolean(enabled?.checked),
    threshold: 0.65,
    showUncertain: Boolean(showUncertain?.checked),
    maxImagesPerPage: Math.max(1, Math.min(500, Number(maxImagesPerPage?.value || 80)))
  };
  await saveSettings(settings);
  if (maxImagesPerPage) maxImagesPerPage.value = String(settings.maxImagesPerPage);
  if (saved) saved.textContent = "Settings saved";
}

function renderStatus(response: RuntimeResponse): void {
  if (!statusEl || !setupButton) return;

  if (response.type === "SS_STATUS") {
    setupButton.disabled = response.downloading;
    statusEl.textContent = response.ready
      ? `Model ready: ${response.modelId}`
      : response.downloading
        ? "Preparing local model..."
        : "Model not prepared yet";
    return;
  }

  if (response.type === "SS_ANALYZE_ERROR") {
    setupButton.disabled = false;
    statusEl.textContent = response.error;
  }
}

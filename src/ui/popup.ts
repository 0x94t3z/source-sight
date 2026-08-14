import type { RuntimeResponse } from "../shared/types";
import "./ui.css";

const statusEl = document.querySelector<HTMLDivElement>("#status");
const setupButton = document.querySelector<HTMLButtonElement>("#setup");

void refreshStatus();

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

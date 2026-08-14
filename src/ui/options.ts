import { getSettings, saveSettings, type SourceSightSettings } from "../shared/settings";
import "./ui.css";

const enabled = document.querySelector<HTMLInputElement>("#enabled");
const showUncertain = document.querySelector<HTMLInputElement>("#showUncertain");
const maxImagesPerPage = document.querySelector<HTMLInputElement>("#maxImagesPerPage");
const saved = document.querySelector<HTMLParagraphElement>("#saved");

void boot();

async function boot(): Promise<void> {
  const settings = await getSettings();
  render(settings);

  for (const element of [enabled, showUncertain, maxImagesPerPage]) {
    element?.addEventListener("change", persist);
  }
}

function render(settings: SourceSightSettings): void {
  if (enabled) enabled.checked = settings.enabled;
  if (showUncertain) showUncertain.checked = settings.showUncertain;
  if (maxImagesPerPage) maxImagesPerPage.value = String(settings.maxImagesPerPage);
}

async function persist(): Promise<void> {
  const settings: SourceSightSettings = {
    enabled: Boolean(enabled?.checked),
    threshold: 0.65,
    showUncertain: Boolean(showUncertain?.checked),
    maxImagesPerPage: Number(maxImagesPerPage?.value || 10)
  };
  await saveSettings(settings);
  if (saved) saved.textContent = `Saved ${new Date().toLocaleTimeString()}`;
}

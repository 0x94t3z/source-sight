export const DEFAULT_THRESHOLD = 0.65;
export const MIN_IMAGE_EDGE = 96;
export const MIN_IMAGE_AREA = 96 * 96;

export interface SourceSightSettings {
  enabled: boolean;
  threshold: number;
  showUncertain: boolean;
  maxImagesPerPage: number;
}

export const DEFAULT_SETTINGS: SourceSightSettings = {
  enabled: true,
  threshold: DEFAULT_THRESHOLD,
  showUncertain: true,
  maxImagesPerPage: 80
};

export async function getSettings(): Promise<SourceSightSettings> {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
}

export async function saveSettings(settings: SourceSightSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

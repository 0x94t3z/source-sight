import type { RuntimeRequest, RuntimeResponse } from "../shared/types";

const OFFSCREEN_URL = "offscreen.html";
let creatingOffscreenDocument: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;

  creatingOffscreenDocument ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification:
        "Source Sight decodes webpage images and runs local ONNX inference in a browser document."
    })
    .finally(() => {
      creatingOffscreenDocument = null;
    });

  await creatingOffscreenDocument;
}

async function forwardToOffscreen(message: RuntimeRequest): Promise<RuntimeResponse> {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage(message);
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    installedAt: Date.now()
  });
});

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  if (!message || !message.type?.startsWith("SS_")) return false;

  forwardToOffscreen(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      const id = "id" in message ? String(message.id) : "setup";
      sendResponse({
        type: "SS_ANALYZE_ERROR",
        id,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

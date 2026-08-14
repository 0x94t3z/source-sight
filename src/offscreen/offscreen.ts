import type { RuntimeRequest, RuntimeResponse, SetupStatus } from "../shared/types";
import { analyzeImage, getManifest, modelReady, setupModel } from "./detector";

let downloading = false;
let lastError: string | undefined;

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  if (!message || !message.type?.startsWith("SS_")) return false;

  handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      const id = "id" in message ? String(message.id) : "setup";
      const response: RuntimeResponse = {
        type: "SS_ANALYZE_ERROR",
        id,
        error: error instanceof Error ? error.message : String(error)
      };
      sendResponse(response);
    });

  return true;
});

async function handleMessage(message: RuntimeRequest): Promise<RuntimeResponse> {
  if (message.type === "SS_GET_STATUS") {
    return status();
  }

  if (message.type === "SS_SETUP_MODEL") {
    downloading = true;
    lastError = undefined;
    try {
      await setupModel();
      return status();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      downloading = false;
    }
  }

  if (message.type === "SS_ANALYZE_IMAGE") {
    return analyzeImage(message.id, message.url);
  }

  throw new Error("Unknown Source Sight message");
}

async function status(): Promise<SetupStatus> {
  const manifest = await getManifest();
  return {
    type: "SS_STATUS",
    ready: await modelReady(),
    downloading,
    modelId: manifest.id,
    error: lastError
  };
}

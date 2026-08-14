import type { ModelManifest } from "../shared/types";

const DB_NAME = "sourcesight-models";
const DB_VERSION = 1;
const STORE_NAME = "files";

interface StoredModel {
  key: string;
  bytes: ArrayBuffer;
  sha256: string;
  sizeBytes: number;
  storedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readStoredModel(manifest: ModelManifest): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(manifest.id);
    request.onsuccess = () => {
      const record = request.result as StoredModel | undefined;
      if (
        record &&
        record.sha256 === manifest.sha256 &&
        record.sizeBytes === manifest.sizeBytes
      ) {
        resolve(record.bytes);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function writeStoredModel(
  manifest: ModelManifest,
  bytes: ArrayBuffer
): Promise<void> {
  const db = await openDb();
  const record: StoredModel = {
    key: manifest.id,
    bytes,
    sha256: manifest.sha256,
    sizeBytes: bytes.byteLength,
    storedAt: Date.now()
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

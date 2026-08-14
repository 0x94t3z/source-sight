export type SourceSightLabel = "likely_ai" | "likely_real" | "uncertain";

export interface ModelManifest {
  id: string;
  filename: string;
  url: string;
  source: string;
  upstream: string;
  sizeBytes: number;
  sha256: string;
  input: {
    width: number;
    height: number;
    resizeShortSide: number;
    mean: [number, number, number];
    std: [number, number, number];
  };
  output: {
    kind: "sigmoid" | "softmax2";
    aiIndex?: number;
    meaning: string;
    threshold: number;
  };
}

export interface AnalyzeImageRequest {
  type: "SS_ANALYZE_IMAGE";
  id: string;
  url: string;
  naturalWidth: number;
  naturalHeight: number;
}

export interface AnalyzeImageResult {
  type: "SS_ANALYZE_RESULT";
  id: string;
  label: SourceSightLabel;
  confidence: number;
  aiProbability: number;
  visualScore: number;
  metadataSignals: string[];
  threshold: number;
  backend: "webgpu" | "wasm";
  modelId: string;
}

export interface AnalyzeImageError {
  type: "SS_ANALYZE_ERROR";
  id: string;
  error: string;
}

export interface SetupRequest {
  type: "SS_SETUP_MODEL";
}

export interface StatusRequest {
  type: "SS_GET_STATUS";
}

export interface SetupStatus {
  type: "SS_STATUS";
  ready: boolean;
  downloading: boolean;
  modelId?: string;
  backend?: "webgpu" | "wasm";
  error?: string;
}

export type RuntimeRequest = AnalyzeImageRequest | SetupRequest | StatusRequest;
export type RuntimeResponse = AnalyzeImageResult | AnalyzeImageError | SetupStatus;

# Source Sight Compliance Matrix

| Requirement | Source Sight implementation |
|---|---|
| Open source under MIT | `LICENSE` is MIT. |
| Native Manifest V3 Chrome extension | `public/manifest.json` uses `manifest_version: 3`. |
| Local browser inference | ONNX Runtime Web runs in `src/offscreen/detector.ts`. |
| WebGPU/WASM/WebGL | WebGPU is attempted first, WASM fallback is used if WebGPU is unavailable. |
| No cloud inference | There are no remote inference calls. |
| No external APIs for detection | No API receives image data or inference input/output. |
| No local server dependency | Runtime does not require Python, Node, Flask, localhost, or native messaging. |
| One-time public model download only | The build-time setup script downloads the pinned public model, verifies its bytes, and bundles it. Runtime inference only loads the bundled model; it cannot download a replacement model. |
| Offline inference after setup | Verified model bytes are bundled and/or stored in IndexedDB, and runtime inference has no model network fallback. |
| Automatically analyze webpage images | `src/content/content.ts` scans images and watches DOM changes. |
| Display confidence score | Content overlay shows AI/Real/Uncertain confidence. |
| Reproducible from source | `npm install && npm run build` creates `dist/`; `npm run package:release` creates a reviewer-ready ZIP when the model is present. |
| 65% confidence threshold | `DEFAULT_THRESHOLD` is `0.65` and inference labels use it. |
| 75% balanced-accuracy bar | Not independently verifiable here because the bounty benchmark is private; this requires maintainer evaluation. |
| No hardcoded benchmark hashes | No benchmark image identifiers, hashes, or lookup tables are present. |

## Network Behavior

Source Sight has host permissions for ordinary webpage image fetching. Detection uses the fetched webpage image bytes only inside the extension process. Model setup happens before packaging; the installed extension has no model-download host permission or runtime model network fallback.

## Notes

The model-led score is the primary signal. Metadata markers such as Stable Diffusion or ComfyUI add only a small local adjustment and are never required for a positive detection.

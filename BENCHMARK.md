# Benchmark Plan

Source Sight is designed to be evaluated at the bounty-required `0.65` confidence threshold.

The first benchmark harness should measure balanced accuracy:

```text
balanced accuracy = (real recall + AI recall) / 2
```

Suggested proxy sets:

- Real images: LAION aesthetics samples, Unsplash-style photography, COCO/OpenImages samples, compressed web screenshots.
- AI images: Stable Diffusion variants, SDXL, Midjourney-style public samples, DALL-E, Flux, Ideogram, web-resized AI images.
- Stress transforms: JPEG quality 40/60/80, resize, crop, mild blur, screenshots.

The benchmark must not tune against private bounty images, hardcode image IDs, or use lookup tables.

Current implementation status:

- Fixed threshold: `0.65`
- Model: CapCheck CIFAKE ViT-Base int8 ONNX export
- Preprocessing: resize to 224×224, RGB mean/std 0.5/0.5
- Output: two-class softmax, class 1 as `P(AI-generated)`
- Inference views: center crop for near-square inputs; center plus edge crops for larger inputs, averaged before thresholding
- Performance guard: edge crops run only when the center-view score is within 12 percentage points of the fixed threshold

The public score should be added here once a proxy dataset run is completed.

## Reproducible local run

The repository does not include a benchmark set and does not embed image hashes. Put labeled images in a local directory with this shape:

```text
/tmp/sourcesight-dataset/
├── ai/
└── real/
```

Then build the extension and run the Chrome harness:

```bash
npm run build
SOURCESIGHT_BENCHMARK_DIR=/tmp/sourcesight-dataset npm run benchmark
```

The harness serves those files from a temporary local HTTP server, loads the unpacked build into a fresh headless Chrome profile, waits for every badge, and prints per-image predictions plus balanced accuracy at `0.65`. It is a development measurement tool; the extension itself still performs inference in the offscreen document with the bundled ONNX model. No images are uploaded and no benchmark result is hardcoded.

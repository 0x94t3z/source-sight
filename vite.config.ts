import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, "src/background/service-worker.ts"),
        content: resolve(import.meta.dirname, "src/content/content.ts"),
        offscreen: resolve(import.meta.dirname, "src/offscreen/offscreen.html"),
        popup: resolve(import.meta.dirname, "src/ui/popup.html"),
        options: resolve(import.meta.dirname, "src/ui/options.html")
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

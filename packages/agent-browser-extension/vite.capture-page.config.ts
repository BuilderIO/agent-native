import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "./",
  publicDir: false,
  resolve: {
    alias: {
      "@agent-native/browser-control-extension-core": resolve(
        root,
        "../browser-control-extension-core/src/index.ts",
      ),
      "@agent-native/core/browser-context": resolve(
        root,
        "../core/src/browser-context/index.ts",
      ),
      "@agent-native/core/integrations/computer-supervision": resolve(
        root,
        "../core/src/integrations/computer-supervision.ts",
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: resolve(root, "src/capture-page.ts"),
      output: {
        // chrome.scripting.executeScript injects a classic script, not an ES module.
        format: "iife",
        name: "AgentNativeCapturePage",
        entryFileNames: "assets/capture-page.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});

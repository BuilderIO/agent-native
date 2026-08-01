import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "./",
  publicDir: "public",
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
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        background: resolve(root, "src/background.ts"),
        "capture-page": resolve(root, "src/capture-page.ts"),
        sidepanel: resolve(root, "src/sidepanel.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  test: {
    include: ["src/**/*.spec.ts"],
  },
});

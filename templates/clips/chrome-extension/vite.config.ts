import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(root, "src/background.ts"),
        "content-script": resolve(root, "src/content-script.ts"),
        offscreen: resolve(root, "src/offscreen.html"),
        overlay: resolve(root, "src/overlay.html"),
        permission: resolve(root, "src/permission.html"),
        popup: resolve(root, "src/popup.html"),
        options: resolve(root, "src/options.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});

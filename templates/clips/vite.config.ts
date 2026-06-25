import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";
import type { Plugin } from "vite";

const _require = createRequire(import.meta.url);
const ffmpegDir = path.resolve(
  path.dirname(_require.resolve("@ffmpeg/ffmpeg")),
  "../..",
);

// The camera background-blur feature loads the MediaPipe vision WASM runtime
// from our own origin at `/mediapipe/wasm/*` (see `app/lib/camera-blur.ts`).
// Rather than commit ~21MB of binaries, copy them out of the installed,
// lockfile-verified `@mediapipe/tasks-vision` package at build/dev start. The
// destination is gitignored. The small segmentation model is vendored in
// `public/mediapipe/` directly. `buildStart` runs for both `vite dev` and
// `vite build`, so the assets are always present before anything is served.
const MEDIAPIPE_WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

function copyMediapipeWasm(): Plugin {
  return {
    name: "clips-copy-mediapipe-wasm",
    buildStart() {
      try {
        const wasmSrc = path.join(
          path.dirname(_require.resolve("@mediapipe/tasks-vision")),
          "wasm",
        );
        const wasmDest = path.resolve(
          import.meta.dirname,
          "public/mediapipe/wasm",
        );
        fs.mkdirSync(wasmDest, { recursive: true });
        for (const file of MEDIAPIPE_WASM_FILES) {
          fs.copyFileSync(path.join(wasmSrc, file), path.join(wasmDest, file));
        }
      } catch (err) {
        // Don't fail the build — camera blur degrades to recording un-blurred.
        this.warn(`could not copy MediaPipe WASM assets: ${err}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [reactRouter(), copyMediapipeWasm()],
  // shiki only runs in AssistantChat's useEffect — keep it out of the
  // CF Pages Functions bundle (25 MiB limit).
  ssrStubs: ["shiki"],
  fsAllow: [ffmpegDir],
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
});

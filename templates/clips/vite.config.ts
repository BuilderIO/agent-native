import path from "path";
import { createRequire } from "module";
import { reactRouter } from "@react-router/dev/vite";
import { agentNative } from "@agent-native/core/vite";
import { defineConfig } from "vite";

const _require = createRequire(import.meta.url);
const ffmpegDir = path.resolve(
  path.dirname(_require.resolve("@ffmpeg/ffmpeg")),
  "../..",
);

export default defineConfig({
  plugins: [
    reactRouter(),
    agentNative({
      // shiki only runs in AssistantChat's useEffect — keep it out of the
      // CF Pages Functions bundle (25 MiB limit).
      ssrStubs: ["shiki"],
      fsAllow: [ffmpegDir],
    }),
  ],
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
});

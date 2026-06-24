import { reactRouter } from "@react-router/dev/vite";
import { agentNative } from "@agent-native/core/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    reactRouter(),
    agentNative({
      // Browser-only renderers run in useEffect — keep them out of the CF Pages
      // Functions bundle (25 MiB limit) and away from SSR DOM/canvas shims.
      ssrStubs: [
        "shiki",
        "mermaid",
        "@excalidraw/excalidraw",
        "@excalidraw/mermaid-to-excalidraw",
      ],
    }),
  ],
});

import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  plugins: [reactRouter()],
  // Browser-only renderers run in useEffect — keep them out of the CF Pages
  // Functions bundle (25 MiB limit) and away from SSR DOM/canvas shims.
  ssrStubs: [
    "shiki",
    "mermaid",
    "@excalidraw/excalidraw",
    "@excalidraw/mermaid-to-excalidraw",
  ],
});

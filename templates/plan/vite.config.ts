import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default defineConfig({
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
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

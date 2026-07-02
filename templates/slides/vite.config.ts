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
      // These libs only render in the browser (diagram/drawing canvases) and
      // blow past CF Pages' 25 MiB Functions limit if bundled into SSR.
      // MermaidRenderer and Excalidraw-based components mount client-side only
      // (inside useEffect), so SSR never calls into them.
      ssrStubs: [
        "shiki",
        "mermaid",
        "dom-to-pptx",
        "@excalidraw/excalidraw",
        "@excalidraw/mermaid-to-excalidraw",
        "@agent-native/pinpoint",
      ],
    }),
  ],
  optimizeDeps: {
    include: [
      "@tiptap/core",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "@tiptap/extension-collaboration",
      "@tiptap/extension-collaboration-caret",
      "@tiptap/y-tiptap",
      "yjs",
      "y-protocols/awareness",
    ],
  },
});

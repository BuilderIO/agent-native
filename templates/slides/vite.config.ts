import { reactRouter } from "@react-router/dev/vite";
import { agentNative } from "@agent-native/core/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    reactRouter(),
    agentNative({
      // These libs only render in the browser (diagram/drawing canvases) and
      // blow past CF Pages' 25 MiB Functions limit if bundled into SSR.
      // MermaidRenderer and Excalidraw-based components mount client-side only
      // (inside useEffect), so SSR never calls into them.
      ssrStubs: [
        "shiki",
        "mermaid",
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

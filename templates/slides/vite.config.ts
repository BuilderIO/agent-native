import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  plugins: [reactRouter()],
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

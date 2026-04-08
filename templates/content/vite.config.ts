import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  plugins: [reactRouter()],
  optimizeDeps: {
    include: [
      "yjs",
      "y-protocols/awareness",
      "@tiptap/core",
      "@tiptap/extension-collaboration",
      "@tiptap/extension-collaboration-caret",
      "@tiptap/y-tiptap",
    ],
  },
});

import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
import { defineConfig } from "vite";

import { sitemapPlugin } from "./app/vite-sitemap-plugin";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default defineConfig({
  plugins: [
    tailwindcss(),
    wgslVitePlugin(),
    ...reactRouterPlugins(),
    sitemapPlugin(),
    ...agentNativePlugins({
      tailwind: false,
      ssrStubs: [
        "shiki",
        "mermaid",
        "@excalidraw/excalidraw",
        "@excalidraw/mermaid-to-excalidraw",
        "@assistant-ui/react",
        "@tiptap/core",
        "@tiptap/react",
        "@tiptap/pm",
        "@tiptap/starter-kit",
        "@tiptap/extension-blockquote",
        "@tiptap/extension-code",
        "@tiptap/extension-code-block-lowlight",
        "@tiptap/extension-collaboration",
        "@tiptap/extension-collaboration-caret",
        "@tiptap/extension-color",
        "@tiptap/extension-image",
        "@tiptap/extension-link",
        "@tiptap/extension-placeholder",
        "@tiptap/extension-table",
        "@tiptap/extension-table-cell",
        "@tiptap/extension-table-header",
        "@tiptap/extension-table-row",
        "@tiptap/extension-task-item",
        "@tiptap/extension-task-list",
        "@tiptap/extension-text-style",
        "@tiptap/y-tiptap",
        "tiptap-markdown",
        "prosemirror-markdown",
      ],
      routeWarmup: {
        strategy: "viewport",
        data: true,
        modules: true,
        maxConcurrent: 8,
      },
    }),
  ],
});

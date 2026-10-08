import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import { CLIENT_COMPATIBILITY_VERSION } from "./shared/client-compatibility";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default defineConfig({
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      clientCompatibilityVersion: CLIENT_COMPATIBILITY_VERSION,
      ssrStubs: [
        "shiki",
        "mermaid",
        "dom-to-pptx",
        "@excalidraw/excalidraw",
        "@excalidraw/mermaid-to-excalidraw",
      ],
    }),
  ],
  optimizeDeps: {
    // The editor's lazy route isn't visible from index.html; prebundle its
    // dependencies so WebKit doesn't hit stale-dependency reloads on first load.
    noDiscovery: true,
    include: [
      "yjs",
      "y-protocols/awareness",
      "@ag-ui/core",
      "@amplitude/analytics-browser",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "@mcp-b/webmcp-polyfill",
      "@noble/hashes/sha2.js",
      "@noble/hashes/utils.js",
      "@opentelemetry/api",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-hover-card",
      "@sentry/browser",
      "@tanstack/react-table",
      "@tiptap/core",
      "@tiptap/extension-code-block-lowlight",
      "@tiptap/extension-collaboration-caret",
      "@tiptap/extension-collaboration",
      "@tiptap/extension-image",
      "@tiptap/extension-link",
      "@tiptap/extension-placeholder",
      "@tiptap/extension-table-cell",
      "@tiptap/extension-table-header",
      "@tiptap/extension-table-row",
      "@tiptap/extension-table",
      "@tiptap/extension-task-item",
      "@tiptap/extension-task-list",
      "@tiptap/pm/state",
      "@tiptap/pm/transform",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "@tiptap/y-tiptap",
      "culori",
      "fast-xml-parser",
      "linkedom/worker",
      "mammoth",
      "officeparser",
      "qrcode.react",
      "tiptap-markdown",
      "xlsx",
    ],
  },
});

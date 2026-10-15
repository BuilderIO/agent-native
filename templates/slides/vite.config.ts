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
      "@agent-native/core > @agent-native/agentkit > @ag-ui/core",
      "@agent-native/core > @amplitude/analytics-browser",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "@agent-native/core > @mcp-b/webmcp-polyfill",
      "@agent-native/core > @noble/hashes/sha2.js",
      "@agent-native/core > @noble/hashes/utils.js",
      "@agent-native/core > @opentelemetry/api",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-hover-card",
      "@agent-native/core > @sentry/browser",
      "@agent-native/toolkit > @tanstack/react-table",
      "@agent-native/toolkit > @tiptap/core",
      "@agent-native/toolkit > @tiptap/extension-code-block-lowlight",
      "@agent-native/toolkit > @tiptap/extension-collaboration-caret",
      "@agent-native/toolkit > @tiptap/extension-collaboration",
      "@agent-native/toolkit > @tiptap/extension-image",
      "@agent-native/toolkit > @tiptap/extension-link",
      "@agent-native/toolkit > @tiptap/extension-placeholder",
      "@agent-native/toolkit > @tiptap/extension-table-cell",
      "@agent-native/toolkit > @tiptap/extension-table-header",
      "@agent-native/toolkit > @tiptap/extension-table-row",
      "@agent-native/toolkit > @tiptap/extension-table",
      "@agent-native/toolkit > @tiptap/extension-task-item",
      "@agent-native/toolkit > @tiptap/extension-task-list",
      "@agent-native/toolkit > @tiptap/pm/state",
      "@agent-native/toolkit > @tiptap/pm/transform",
      "@agent-native/toolkit > @tiptap/react",
      "@agent-native/toolkit > @tiptap/starter-kit",
      "@agent-native/toolkit > @tiptap/y-tiptap",
      "@agent-native/toolkit > culori",
      "fast-xml-parser",
      "linkedom/worker",
      "mammoth",
      "@agent-native/core > officeparser",
      "@agent-native/toolkit > qrcode.react",
      "@agent-native/toolkit > tiptap-markdown",
      "@agent-native/core > xlsx",
      "axe-core",
      "jszip",
    ],
  },
});

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
      ssrStubs: ["shiki"],
    }),
  ],
  // A cold dev server otherwise discovers these lazily imported deps
  // mid-session and answers with a full page reload, which closes open
  // popovers and fails in-flight Playwright actions.
  optimizeDeps: {
    include: [
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-hover-card",
      "acorn",
      "drizzle-orm/pg-proxy",
      "jspdf",
      "nanoid/non-secure",
      "parse5",
      "postcss",
      "postcss/lib/css-syntax-error",
      "postcss/lib/input",
      "postcss/lib/parse",
      "postcss/lib/tokenize",
      "@agent-native/core > @amplitude/analytics-browser",
      "@agent-native/core > ajv",
      "@agent-native/core > ajv/dist/2020.js",
      "@agent-native/core > @mcp-b/webmcp-polyfill",
      "@agent-native/core > @opentelemetry/api",
      "@agent-native/core > @sentry/browser",
      "@agent-native/toolkit > @agent-native/agentkit > @ag-ui/core",
      "@agent-native/toolkit > @tanstack/react-table",
      "@agent-native/toolkit > @tiptap/core",
      "@agent-native/toolkit > @tiptap/extension-code-block-lowlight",
      "@agent-native/toolkit > @tiptap/extension-collaboration",
      "@agent-native/toolkit > @tiptap/extension-collaboration-caret",
      "@agent-native/toolkit > @tiptap/extension-image",
      "@agent-native/toolkit > @tiptap/extension-link",
      "@agent-native/toolkit > @tiptap/extension-placeholder",
      "@agent-native/toolkit > @tiptap/extension-table",
      "@agent-native/toolkit > @tiptap/extension-table-cell",
      "@agent-native/toolkit > @tiptap/extension-table-header",
      "@agent-native/toolkit > @tiptap/extension-table-row",
      "@agent-native/toolkit > @tiptap/extension-task-item",
      "@agent-native/toolkit > @tiptap/extension-task-list",
      "@agent-native/toolkit > @tiptap/pm/state",
      "@agent-native/toolkit > @tiptap/pm/transform",
      "@agent-native/toolkit > @tiptap/react",
      "@agent-native/toolkit > @tiptap/starter-kit",
      "@agent-native/toolkit > @tiptap/y-tiptap",
      "@agent-native/toolkit > culori",
      "@agent-native/toolkit > linkedom/worker",
      "@agent-native/toolkit > qrcode.react",
      "@agent-native/toolkit > tiptap-markdown",
    ],
  },
});

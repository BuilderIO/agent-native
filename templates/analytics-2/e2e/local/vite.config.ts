import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { defineConfig, mergeConfig, type UserConfig } from "vite";

import app from "../../vite.config.ts";
import { CLIENT_ENTRIES, prepareClient } from "./client-readiness.ts";

export default defineConfig((env) => {
  if (env.command !== "serve")
    throw new Error(
      "The local analytics harness cannot be built for production",
    );
  const dependencies = realpathSync(
    resolve(import.meta.dirname, "../../../../node_modules"),
  );
  const base = typeof app === "function" ? app(env) : app;
  return mergeConfig(base, {
    envDir: false,
    optimizeDeps: {
      include: [
        "@agent-native/core > @agent-native/agentkit > @ag-ui/core",
        "@agent-native/core > @amplitude/analytics-browser",
        "@agent-native/core > @noble/hashes/sha2.js",
        "@agent-native/core > @noble/hashes/utils.js",
        "@agent-native/core > @opentelemetry/api",
        "@agent-native/core > @sentry/browser",
        "@agent-native/core > @mcp-b/webmcp-polyfill",
        "@agent-native/core > entities/decode",
        "@agent-native/core > idb-keyval",
        "@agent-native/core > linkedom/worker",
        "@agent-native/core > mdast-util-gfm-strikethrough",
        "@agent-native/core > mdast-util-to-markdown",
        "@agent-native/toolkit > @radix-ui/react-dialog",
        "@agent-native/toolkit > @radix-ui/react-dropdown-menu",
        "@agent-native/toolkit > @radix-ui/react-hover-card",
        "@agent-native/toolkit > @tiptap/core",
        "@agent-native/toolkit > @tiptap/extension-code",
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
        "@agent-native/toolkit > @tiptap/pm/model",
        "@agent-native/toolkit > @tiptap/pm/state",
        "@agent-native/toolkit > @tiptap/pm/transform",
        "@agent-native/toolkit > @tiptap/react",
        "@agent-native/toolkit > @tiptap/starter-kit",
        "@agent-native/toolkit > @tiptap/y-tiptap",
        "@agent-native/toolkit > culori",
        "@agent-native/toolkit > openai/helpers/live",
        "@agent-native/toolkit > qrcode.react",
        "@agent-native/toolkit > shiki/langs/diff.mjs",
        "@agent-native/toolkit > tiptap-markdown",
      ],
    },
    resolve: {
      alias: {
        "@google-cloud/bigquery-storage": resolve(
          import.meta.dirname,
          "fake-storage-client.ts",
        ),
      },
    },
    server: {
      hmr: false,
      fs: { allow: [dependencies] },
      warmup: { clientFiles: CLIENT_ENTRIES.map((url) => `.${url}`) },
    },
    cacheDir: resolve(tmpdir(), "vite-cache"),
    plugins: [
      {
        name: "analytics-local-isolation",
        enforce: "post",
        configureServer(server) {
          let ready: Promise<void> | undefined;
          server.middlewares.use(
            "/__analytics-local/client-ready",
            (_req, res, next) => {
              ready ??= prepareClient(server.environments.client);
              void ready.then(() => res.writeHead(204).end(), next);
            },
          );
        },
        config: (config: UserConfig) => ({
          envDir: false,
          ...(config.cacheDir === "node_modules/.vite-child-compiler"
            ? { cacheDir: resolve(tmpdir(), "vite-child-compiler") }
            : {}),
        }),
      },
    ],
    nitro: {
      buildDir: resolve(tmpdir(), "nitro"),
      plugins: [resolve(import.meta.dirname, "runtime.ts")],
    },
  });
});

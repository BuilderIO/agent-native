import { resolve } from "path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const workspaceRendererPackages = [
  "@agent-native/code-agents-ui",
  "@agent-native/code-agents-ui/code-agents",
  "@agent-native/core",
  "@agent-native/core/code-agents/transcript-normalizer",
  "@agent-native/core/client",
  "@agent-native/shared-app-config",
];

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function resolveSentryDsn(): string {
  const direct = firstNonEmpty(
    process.env.SENTRY_DESKTOP_DSN,
    process.env.SENTRY_ELECTRON_DSN,
    process.env.SENTRY_CLIENT_DSN,
    process.env.VITE_SENTRY_CLIENT_DSN,
    process.env.VITE_SENTRY_DSN,
    process.env.SENTRY_DSN,
  );
  if (direct) return direct;

  const key = firstNonEmpty(
    process.env.SENTRY_DESKTOP_CLIENT_KEY,
    process.env.SENTRY_ELECTRON_CLIENT_KEY,
    process.env.SENTRY_CLIENT_KEY,
    process.env.VITE_SENTRY_CLIENT_KEY,
  );
  const projectId = firstNonEmpty(
    process.env.SENTRY_DESKTOP_PROJECT_ID,
    process.env.SENTRY_ELECTRON_PROJECT_ID,
    process.env.SENTRY_PROJECT_ID,
    process.env.VITE_SENTRY_PROJECT_ID,
  );
  const host = firstNonEmpty(
    process.env.SENTRY_DESKTOP_INGEST_HOST,
    process.env.SENTRY_ELECTRON_INGEST_HOST,
    process.env.SENTRY_INGEST_HOST,
    process.env.VITE_SENTRY_INGEST_HOST,
  );

  return key && projectId && host ? `https://${key}@${host}/${projectId}` : "";
}

const desktopSentryDefines = {
  __AGENT_NATIVE_DESKTOP_SENTRY_DSN__: JSON.stringify(resolveSentryDsn()),
  __AGENT_NATIVE_DESKTOP_SENTRY_ENVIRONMENT__: JSON.stringify(
    firstNonEmpty(
      process.env.SENTRY_DESKTOP_ENVIRONMENT,
      process.env.SENTRY_ELECTRON_ENVIRONMENT,
      process.env.NETLIFY_CONTEXT,
      process.env.VERCEL_ENV,
      process.env.SENTRY_ENVIRONMENT,
      process.env.NODE_ENV,
    ),
  ),
  __AGENT_NATIVE_DESKTOP_SENTRY_RELEASE__: JSON.stringify(
    firstNonEmpty(
      process.env.SENTRY_DESKTOP_RELEASE,
      process.env.SENTRY_ELECTRON_RELEASE,
      process.env.SENTRY_RELEASE,
    ),
  ),
  __AGENT_NATIVE_DESKTOP_SENTRY_DEBUG__: JSON.stringify(
    firstNonEmpty(
      process.env.SENTRY_DESKTOP_DEBUG,
      process.env.SENTRY_ELECTRON_DEBUG,
      process.env.SENTRY_DEBUG,
    ),
  ),
};

export default defineConfig({
  main: {
    define: desktopSentryDefines,
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@agent-native/code-agents-ui",
          "@agent-native/code-agents-ui/code-agents",
          "@agent-native/shared-app-config",
          "@sentry/electron",
          "electron-updater",
        ],
      }),
    ],
    resolve: {
      alias: {
        "@shared": resolve("shared"),
      },
    },
  },
  preload: {
    define: desktopSentryDefines,
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@agent-native/code-agents-ui",
          "@agent-native/code-agents-ui/code-agents",
          "@agent-native/shared-app-config",
        ],
      }),
    ],
    resolve: {
      alias: {
        "@shared": resolve("shared"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          webview: resolve("src/preload/webview.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
        },
      },
    },
  },
  renderer: {
    define: desktopSentryDefines,
    optimizeDeps: {
      exclude: workspaceRendererPackages,
    },
    resolve: {
      alias: {
        "@shared": resolve("shared"),
        "@renderer": resolve("src/renderer"),
        react: resolve("node_modules/react"),
        "react-dom": resolve("node_modules/react-dom"),
        "react/jsx-dev-runtime": resolve(
          "node_modules/react/jsx-dev-runtime.js",
        ),
        "react/jsx-runtime": resolve("node_modules/react/jsx-runtime.js"),
      },
      dedupe: ["react", "react-dom"],
    },
    plugins: [react(), tailwindcss({ optimize: false })],
  },
});

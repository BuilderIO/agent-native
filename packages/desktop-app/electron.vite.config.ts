import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

const workspaceRendererPackages = [
  "@agent-native/code-agents-ui",
  "@agent-native/code-agents-ui/code-agents",
  "@agent-native/core",
  "@agent-native/core/code-agents/transcript-normalizer",
  "@agent-native/core/client",
  "@agent-native/shared-app-config",
];

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@agent-native/code-agents-ui",
          "@agent-native/code-agents-ui/code-agents",
          "@agent-native/shared-app-config",
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

import { defineConfig } from "tsup";
import { solidPlugin } from "esbuild-plugin-solid";

export default defineConfig([
  // Browser bundle (includes SolidJS UI)
  {
    entry: { "index.browser": "src/index.browser.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom", "express", "@modelcontextprotocol/sdk"],
    esbuildPlugins: [solidPlugin({ solid: { generate: "dom" } })],
    esbuildOptions(options) {
      // Ensure solid-js resolves to browser/DOM version, not server
      options.conditions = ["browser", "solid", "import", "module"];
    },
    banner: { js: '"use client";' },
  },
  // Node/server bundle (no SolidJS UI)
  {
    entry: {
      index: "src/index.ts",
      "server/index": "src/server/index.ts",
      "primitives/index": "src/primitives/index.ts",
      "types/index": "src/types/index.ts",
      react: "src/react.tsx",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    external: [
      "react",
      "react-dom",
      "express",
      "solid-js",
      "solid-js/web",
      "@modelcontextprotocol/sdk",
      "@agent-native/core",
      "@medv/finder",
      "bippy",
      "element-source",
      "zod",
    ],
  },
]);

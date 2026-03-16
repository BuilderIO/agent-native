import { defineConfig } from "tsup";
import * as solidPlugin from "esbuild-plugin-solid";

export default defineConfig([
  // Browser bundle (includes SolidJS UI)
  {
    entry: { "index.browser": "src/index.browser.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom", "express", "@modelcontextprotocol/sdk"],
    esbuildPlugins: [solidPlugin.default({ solid: { generate: "dom" } })],
    banner: { js: '"use client";' },
  },
  // Node/server bundle
  {
    entry: {
      index: "src/index.ts",
      "server/index": "src/server/index.ts",
      "primitives/index": "src/primitives/index.ts",
      "types/index": "src/types/index.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    external: [
      "react",
      "react-dom",
      "express",
      "solid-js",
      "@modelcontextprotocol/sdk",
      "@agent-native/core",
    ],
  },
  // IIFE for script tag usage
  {
    entry: { "index.global": "src/index.browser.ts" },
    format: ["iife"],
    globalName: "Pinpoint",
    sourcemap: true,
    esbuildPlugins: [solidPlugin.default({ solid: { generate: "dom" } })],
    noExternal: [/(.*)/],
    external: ["react", "react-dom"],
  },
]);

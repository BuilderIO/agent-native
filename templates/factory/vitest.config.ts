import path from "node:path";

import baseConfig from "@agent-native/core/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

// Tests run without the production Vite plugin stack: its SSR `noExternal`
// inlines the framework's CommonJS dependencies, so a test that loads the
// action registry cannot import them.
export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./app"),
        "@shared": path.resolve(__dirname, "./shared"),
      },
    },
    test: {
      exclude: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/.react-router/**",
      ],
    },
  }),
);

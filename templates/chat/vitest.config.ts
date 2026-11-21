import path from "node:path";

import baseConfig from "@agent-native/core/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

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
      env: { DATABASE_URL: "pglite:memory" },
      exclude: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/.react-router/**",
      ],
    },
  }),
);

import path from "node:path";

import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";

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
      include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
      // e2e/ holds Playwright (@playwright/test) specs; run via `pnpm e2e`, not vitest.
      exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/e2e/**"],
    },
  }),
);

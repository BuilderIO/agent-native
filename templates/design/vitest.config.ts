import path from "node:path";

import baseConfig from "@agent-native/core/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

const TEST_INCLUDE = "**/*.{test,spec}.?(c|m)[jt]s?(x)";
const PERFORMANCE_TEST_INCLUDE = "**/*.perf.spec.ts";
const DEFAULT_TEST_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/.react-router/**",
  "**/e2e/**",
];

export function createDesignVitestConfig({
  performanceTests = false,
}: { performanceTests?: boolean } = {}) {
  return mergeConfig(
    baseConfig,
    defineConfig({
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./app"),
          "@shared": path.resolve(__dirname, "./shared"),
        },
      },
      test: {
        include: [performanceTests ? PERFORMANCE_TEST_INCLUDE : TEST_INCLUDE],
        exclude: [
          ...DEFAULT_TEST_EXCLUDES,
          ...(performanceTests ? [] : [PERFORMANCE_TEST_INCLUDE]),
        ],
      },
    }),
  );
}

export default createDesignVitestConfig();

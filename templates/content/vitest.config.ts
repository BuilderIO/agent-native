import path from "node:path";

import baseConfig from "@agent-native/core/vitest-config";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./app"),
        "@shared": path.resolve(__dirname, "./shared"),
      },
    },
    test: {
      include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
      exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/e2e/**"],
      hookTimeout: 60_000,
      testTimeout: 60_000,
      maxWorkers: "50%",
    },
  }),
);

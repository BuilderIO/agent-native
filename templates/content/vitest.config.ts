import path from "node:path";

import baseConfig, {
  resolveMaxWorkers,
} from "@agent-native/core/vitest-config";
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
      exclude: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/.react-router/**",
        "**/e2e/**",
      ],
      // Search drains its whole index backlog before answering, so tests take
      // the indexed path unless they force the fallback scan.
      env: { AGENT_NATIVE_SEARCH_DRAIN_BUDGET_MS: "0" },
      hookTimeout: 60_000,
      testTimeout: 60_000,
      maxWorkers: resolveMaxWorkers(process.env, "50%"),
    },
  }),
);

import path from "node:path";

import baseConfig, {
  resolveMaxWorkers,
} from "@agent-native/core/vitest-config";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, mergeConfig } from "vitest/config";

import { KNOWN_LOSS_TAG } from "./acceptance/known-loss";

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
      // A search budget longer than any test lets search drain its whole
      // index backlog before answering, so tests take the indexed path unless
      // they force the fallback scan.
      env: { AGENT_NATIVE_SEARCH_DRAIN_BUDGET_MS: "60000" },
      globalSetup: ["./acceptance/generate-action-registry.ts"],
      tags: [
        {
          name: KNOWN_LOSS_TAG,
          description:
            "Main fails this today; its meta names the lane whose fix flips it. CI reports it without failing the PR.",
        },
      ],
      hookTimeout: 60_000,
      testTimeout: 60_000,
      maxWorkers: process.env.CONTENT_MIGRATION_POSTGRES_URL
        ? 1
        : resolveMaxWorkers(process.env, "50%"),
    },
  }),
);

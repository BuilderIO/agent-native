import baseConfig from "@agent-native/core/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["server/**/*.test.ts"],
      hookTimeout: 60_000,
    },
  }),
);

import { resolve } from "node:path";

import baseConfig from "@agent-native/core/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: { alias: { "@": resolve("./app") } },
    test: { environment: "happy-dom", passWithNoTests: true },
  }),
);

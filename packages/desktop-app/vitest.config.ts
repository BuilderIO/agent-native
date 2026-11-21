import { resolve } from "node:path";

import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: {
        "@agent-native/core/resources/shared-memory": resolve(
          __dirname,
          "../core/src/resources/shared-memory.ts",
        ),
        "@agent-native/shared-app-config": resolve(
          __dirname,
          "../shared-app-config/index.ts",
        ),
        "@shared": resolve(__dirname, "shared"),
      },
    },
  }),
);

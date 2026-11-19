import { resolve } from "node:path";

import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: {
        "@agent-native/shared-app-config": resolve(
          __dirname,
          "../shared-app-config/index.ts",
        ),
        "@shared": resolve(__dirname, "shared"),
      },
    },
  }),
);

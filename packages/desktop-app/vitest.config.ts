import { resolve } from "node:path";

import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "shared"),
      },
    },
  }),
);

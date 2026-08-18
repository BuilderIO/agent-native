import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: {
        "@": new URL(".", import.meta.url).pathname,
      },
    },
  }),
);

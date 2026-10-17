import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      passWithNoTests: true,
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.output/**",
        "**/.{idea,git,cache,output,temp}/**",
      ],
    },
  }),
);

import baseConfig from "@agent-native/core/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  mergeConfig(
    baseConfig,
    defineConfig({
      test: {
        exclude: [
          "**/node_modules/**",
          "**/.git/**",
          "**/dist/**",
          "**/.react-router/**",
        ],
      },
    }),
  ),
);

import baseConfig from "@agent-native/core/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

// Kept separate from vite.config.ts so the production config never imports
// vitest: `agent-native build` loads vite.config.ts in installs where vitest
// is absent.
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

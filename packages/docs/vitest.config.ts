import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";

export default mergeConfig(
  baseConfig,
  defineConfig({
    // Vitest resolves through this config, not vite.config.ts, so the hero
    // ocean's .wgsl imports would otherwise reach the JS parser as source.
    plugins: [wgslVitePlugin()],
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

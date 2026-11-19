import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@agent-native/core/client/mobile-auth": new URL(
          "../core/src/client/mobile-auth.ts",
          import.meta.url,
        ).pathname,
        "@agent-native/toolkit/onboarding": new URL(
          "../toolkit/src/onboarding/index.ts",
          import.meta.url,
        ).pathname,
        "@": new URL(".", import.meta.url).pathname,
      },
    },
  }),
);

import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __ANALYTICS_APP_SOURCE__: JSON.stringify("test"),
  },
  resolve: {
    alias: {
      // A panel mounted on its own in a spec draws the app's default look.
      "@/lib/standalone-settings-part": fileURLToPath(
        new URL("./app/testing/standalone-settings-part.tsx", import.meta.url),
      ),
      "@": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    css: { include: [/\.css\?(raw|inline)$/] },
    // e2e/ holds Playwright specs: they drive a browser through the @playwright
    // harness and cannot run under vitest, so vitest reported them as red on
    // every run (tester row 514's "tests red" count included them).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.output/**",
      "e2e/**",
      // Production-browser checks use vitest.build.config.ts after agent-native build.
      "build-tests/**",
      "quarantined-specs/**",
    ],
    setupFiles: ["./app/testing/match-media-setup.ts"],
    maxWorkers: 2,
    hookTimeout: 180_000,
    testTimeout: 120_000,
  },
});

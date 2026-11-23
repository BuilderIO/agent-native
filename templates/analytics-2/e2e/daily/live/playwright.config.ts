import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: resolve(
    import.meta.dirname,
    "../../../../../.tmp/analytics-daily-live-results",
  ),
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: resolve(
          import.meta.dirname,
          "../../../../../.tmp/analytics-daily-live-results/results.json",
        ),
      },
    ],
  ],
  timeout: 60_000,
  use: {
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
  },
});

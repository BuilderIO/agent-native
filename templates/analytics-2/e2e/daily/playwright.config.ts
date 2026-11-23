import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const configDir = fileURLToPath(new URL(".", import.meta.url));
const results = resolve(configDir, "../../../../.tmp/analytics-daily-results");

// The daily-use suite: every test runs against a local analytics dev server whose external
// providers (BigQuery, HubSpot, Builder.io, the model) are a loopback fake. One shared server
// for the whole run (see run.ts). No live network.
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  testIgnore: "**/live/**",
  outputDir: results,
  fullyParallel: false,
  workers: 5,
  projects: [
    { name: "setup", testMatch: /(?:setup|provider)\.spec\.ts$/, workers: 1 },
    { name: "daily", testIgnore: /(?:setup|provider)\.spec\.ts$/, workers: 4 },
  ],
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(results, "results.json") }],
  ],
  use: {
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
    actionTimeout: 5_000,
  },
});

import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.CONTENT_BASE_URL || "http://127.0.0.1:8090"; // e2e-harness-ignore: specs read the served URL from here

// CI serves the production build it just made on the job's Postgres. Locally,
// point CONTENT_BASE_URL at a running server instead.
const SERVE_BUILD = process.env.CONTENT_E2E_SERVE_BUILD === "1";

export default defineConfig({
  testDir: ".",
  testMatch:
    /(registry-blocks|local-files|database-preview-menu|sidebar-delete|shared-personal-page|signup-landing|unreadable-page-link|content-responsive-layout|realtime-collab|two-tab-convergence)\.spec\.ts/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 2,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: ".report.json" }]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 25_000,
  },
  projects: [
    {
      name: "authed",
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".auth/state.json",
      },
    },
  ],
  webServer: SERVE_BUILD
    ? {
        command: "node .output/server/index.mjs",
        cwd: path.join(import.meta.dirname, ".."),
        env: { PORT: new URL(BASE_URL).port || "80" },
        url: `${BASE_URL}/_agent-native/ping`,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: "ignore",
        stderr: "pipe",
      }
    : undefined,
});

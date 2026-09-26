import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch:
    /(registry-blocks|local-files|database-preview-menu|sidebar-delete|shared-personal-page|signup-landing)\.spec\.ts/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 2,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: ".report.json" }]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: process.env.CONTENT_BASE_URL || "http://127.0.0.1:8090",
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
});

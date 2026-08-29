import { defineConfig, devices } from "@playwright/test";

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: 4,
  timeout: 360_000,
  expect: { timeout: 30_000 },
  reporter: isCi ? [["github"], ["list"]] : [["list"]],
  outputDir: "test-results/signup",
  use: {
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
});

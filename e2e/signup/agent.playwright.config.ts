import { defineConfig, devices } from "@playwright/test";

const isCi = Boolean(process.env.CI);

/**
 * Separate config, and a separate `agent-specs/` directory, so this lane can
 * never be picked up by `pnpm e2e:signup`. The deterministic canary is a gating
 * lane that must stay free of model tokens and of a second required secret;
 * this one spends both and is advisory.
 *
 * One worker and no retries on purpose: a retry would pay for the whole
 * journey and a second model review to tell us something we already know.
 */
export default defineConfig({
  testDir: "./agent-specs",
  fullyParallel: false,
  forbidOnly: isCi,
  retries: 0,
  workers: 1,
  timeout: 480_000,
  expect: { timeout: 30_000 },
  reporter: isCi ? [["github"], ["list"]] : [["list"]],
  outputDir: "test-results/signup-agent",
  use: {
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
});

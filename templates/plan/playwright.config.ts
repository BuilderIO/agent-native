import { defineConfig, devices } from "@playwright/test";
import { planE2eAuthStatePath, planE2eBaseUrl } from "./e2e/auth-state";

const baseURL = planE2eBaseUrl();
const authStatePath = planE2eAuthStatePath(baseURL);

/*
 * Parallel browser E2E for the Agent-Native Plan app.
 *
 * Runs against an already-running dev server (PLAN_BASE_URL, default :8081).
 * fullyParallel + multiple workers => many browser contexts at once (this is the
 * parallelism browser testing needs). Retries absorb transient HMR reloads while
 * other agents edit the app. Auth is established once in global-setup and reused
 * via storageState; guest specs opt out with their own fresh context.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 5,
  retries: 2,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "e2e/.report.json" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "authed",
      use: {
        ...devices["Desktop Chrome"],
        storageState: authStatePath,
      },
    },
    {
      name: "guest",
      testMatch: /.*guest.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
    },
  ],
});

import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { AUTH_FILES } from "./auth-files";
import { runServerNonce } from "./server-identity";

const BASE_URL = process.env.CONTENT_BASE_URL || "http://127.0.0.1:8090"; // e2e-harness-ignore: specs read the served URL from here

// CI serves the production build it just made on the job's Postgres. Locally,
// point CONTENT_BASE_URL at a running server instead, started with
// PING_MESSAGE set to the run's CONTENT_E2E_SERVER_NONCE.
const SERVE_BUILD = process.env.CONTENT_E2E_SERVE_BUILD === "1";
const SERVER_NONCE = runServerNonce(SERVE_BUILD);

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 2,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: ".report.json" }]],
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
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
        storageState: AUTH_FILES.state,
      },
    },
  ],
  webServer: SERVE_BUILD
    ? {
        command: "node .output/server/index.mjs",
        cwd: path.join(import.meta.dirname, ".."),
        env: {
          PORT: new URL(BASE_URL).port || "80",
          PING_MESSAGE: SERVER_NONCE!,
        },
        url: `${BASE_URL}/_agent-native/ping`,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: "ignore",
        stderr: "pipe",
      }
    : undefined,
});

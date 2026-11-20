import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// guard:allow-env-credential — Browser-test session file path, not a provider credential.
const storageState = process.env.SOCIAL_E2E_STORAGE_STATE;

// guard:allow-env-credential — Browser-test artifact directory, not a provider credential.
const outputDirEnv = process.env.SOCIAL_E2E_OUTPUT_DIR;
const outputDir = outputDirEnv ?? resolve(tmpdir(), "social-e2e");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir,
  use: {
    ...devices["Desktop Chrome"],
    ...(storageState ? { storageState } : {}),
    // guard:allow-env-credential — Loopback test target, not a provider credential.
    baseURL: process.env.SOCIAL_E2E_BASE_URL ?? "http://127.0.0.1:8136",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(outputDir, "results.json") }],
  ],
});

import { defineConfig, devices } from "@playwright/test";

import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "./lib/test-traffic";


const isCi = Boolean(process.env.CI);
const isAuthedCiRun = isCi && process.env.BETA_E2E_AUTHED === "1";

const REPORT_SLOT = (process.env.BETA_E2E_REPORT_SLOT || "local").replace(
  /[^a-z0-9._-]/gi,
  "-",
);

/**
 * Artifact settings for the lanes that run signed in.
 *
 * A Playwright trace records real request headers, so a trace of an
 * authenticated run carries the e2e account's live session cookie — a
 * replayable credential, in an artifact anyone with repo read access can
 * download. Screenshots cannot carry a header, so they stay on; the trace and
 * the video do not. Diagnosis for these lanes comes from assertion messages,
 * which are written to name the cause rather than to be read alongside a trace.
 */
const AUTHED_ARTIFACTS = {
  trace: "off",
  video: "off",
  screenshot: "only-on-failure",
} as const;

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 1,
  workers: isCi ? (isAuthedCiRun ? 1 : 3) : 4,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: isCi
    ? [
        ["github"],
        ["list"],
        [
          "html",
          { open: "never", outputFolder: `playwright-report/${REPORT_SLOT}` },
        ],
        [
          "json",
          { outputFile: `playwright-report/${REPORT_SLOT}/results.json` },
        ],
      ]
    : [["list"]],
  outputDir: `test-results/${REPORT_SLOT}`,
  use: {
    ...devices["Desktop Chrome"],
    extraHTTPHeaders: BETA_E2E_TEST_TRAFFIC_HEADERS,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "public",
      testMatch: /specs\/(fleet-public|auth-surface)\.spec\.ts$/,
    },
    {
      name: "fleet",
      testMatch: /specs\/fleet-wide\.spec\.ts$/,
    },
    {
      name: "registry",
      testMatch: /specs\/registry\.spec\.ts$/,
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    {
      name: "chat",
      testMatch: /specs\/(chat|a2a)\.spec\.ts$/,
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    {
      name: "journeys",
      testMatch: /specs\/apps\/.*\.spec\.ts$/,
      testIgnore: /specs\/apps\/design-(?:interactions|culling)\.spec\.ts$/,
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    {
      name: "design",
      testMatch: /specs\/apps\/design-(?:interactions|culling)\.spec\.ts$/,
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    {
      name: "advisory",
      testMatch: /specs\/advisory\.spec\.ts$/,
      retries: 0,
    },
  ],
});

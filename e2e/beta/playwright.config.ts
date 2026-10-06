import { defineConfig, devices } from "@playwright/test";

import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "./lib/test-traffic";

const isCi = Boolean(process.env.CI);
const isAuthedCiRun = isCi && process.env.BETA_E2E_AUTHED === "1";

/**
 * A hard wall-clock bound for the whole run, setup included, so a hung host
 * ends in a reported failure instead of the job's timeout killing it with no
 * results. The workflow sets it a few minutes under each job's own
 * `timeout-minutes`, leaving room to write the report and upload artifacts.
 */
function globalTimeoutMs(): number {
  if (!isCi) return 0;
  const raw = process.env.BETA_E2E_GLOBAL_TIMEOUT_MINUTES?.trim();
  if (!raw) return 20 * 60_000;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error(
      `BETA_E2E_GLOBAL_TIMEOUT_MINUTES must be a positive whole number of minutes, got ${JSON.stringify(raw)}.`,
    );
  }
  return minutes * 60_000;
}

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

// One spec file belongs to exactly one project, and `journeys-core` takes every
// file under specs/apps that is not claimed below. A new spec therefore lands in
// a lane by default instead of in none; `lib/suite-partition.spec.ts` lists the
// suite and fails the gate if a file is claimed twice, claimed by nothing, or
// run by no workflow slot.
const DESIGN_SPECS = /specs\/apps\/design-(?:interactions|culling)\.spec\.ts$/;
const JOURNEY_SESSION_SPECS =
  /specs\/apps\/journey-session-stability\.spec\.ts$/;
const JOURNEY_CREDENTIAL_SPECS =
  /specs\/apps\/journey-(?:credential-state|settings-keys)\.spec\.ts$/;
const JOURNEY_FLOW_SPECS =
  /specs\/apps\/journey-(?:slides-pdf-import|forms-lifecycle|design-systems-indexing|dispatch-app-launch)\.spec\.ts$/;

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: isCi,
  globalTimeout: globalTimeoutMs(),
  // A broad regression should stop in minutes, not run every remaining test to
  // its own timeout.
  maxFailures: isCi ? 8 : 0,
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
      // Registry checks do not spend model tokens, but one retry still
      // separates a cold host from a deterministic authentication failure.
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    {
      name: "chat",
      testMatch: /specs\/(chat|a2a|chat-realtime|chat-reliability)\.spec\.ts$/,
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    // The journeys are split by area so each runs in its own workflow slot
    // inside a 30 minute limit; serially they were ~75 tests in one 15 minute
    // slot. Keep a project's workflow slot(s) in .github/workflows/beta-e2e.yml.
    {
      name: "journeys-core",
      testMatch: /specs\/apps\/.*\.spec\.ts$/,
      testIgnore: [
        DESIGN_SPECS,
        JOURNEY_SESSION_SPECS,
        JOURNEY_CREDENTIAL_SPECS,
        JOURNEY_FLOW_SPECS,
      ],
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    {
      // [journey] [session]: 13 tests of 5 to 10 page loads each, run as
      // workflow shards (`--shard`).
      name: "journeys-session",
      testMatch: JOURNEY_SESSION_SPECS,
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    {
      // [journey] [credentials] and [settings-keys]: read-only, one page per app.
      name: "journeys-credentials",
      testMatch: JOURNEY_CREDENTIAL_SPECS,
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    {
      // [slides-import], [forms], [design-systems], [dispatch-apps]: the
      // multi-step product flows. Two of them create and delete a deck and a form.
      name: "journeys-flows",
      testMatch: JOURNEY_FLOW_SPECS,
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    {
      name: "design",
      testMatch: DESIGN_SPECS,
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

import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E against the deployed Agent Native beta fleet.
 *
 * This suite does not start a server. It drives the real beta deploys listed in
 * scripts/netlify-beta-sites.json to answer one question before a promotion:
 * would a user hitting these hosts right now be able to sign in, load the app,
 * and get a working agent turn?
 *
 * Two lanes:
 *   public  no credentials, every host, zero model spend. Always runs.
 *   authed  needs BETA_E2E_SESSION_TOKENS (or BETA_E2E_STORAGE_STATE) and
 *           BETA_E2E_OPENAI_API_KEY. Spends luna tokens. Skipped only when the
 *           run was not asked for it — never when it was asked for and the
 *           credential is absent, which fails in global setup instead.
 *
 * `ignoreHTTPSErrors` is deliberately left unset: "the connection isn't
 * private" was a real beta report, and only a browser that still checks
 * certificates can catch it.
 */

const isCi = Boolean(process.env.CI);

/**
 * Names this invocation's report directory.
 *
 * Set by the workflow per lane; falls back to a generic slot for a local run.
 */
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
  // Beta hosts cold-start and the fleet is shared with real users; a retry
  // distinguishes a slow host from a broken one. It cannot mask a broken one:
  // every assertion here is deterministic given a responsive host.
  retries: isCi ? 2 : 1,
  // GitHub's ubuntu-latest has 4 vCPUs. Six concurrent Chromium instances
  // oversubscribe it, and every navigation slows down together — measured at
  // 5-15s per page load in CI against 1-2s locally. Matching the core count
  // trades a little theoretical parallelism for pages that actually load.
  workers: isCi ? 4 : 4,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  // Per-lane report paths. The workflow invokes this config once per lane, and
  // a shared output path meant each run overwrote the last — the uploaded
  // artifact then contained only the final lane's results while looking like a
  // complete report, which is worse than having no report at all.
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
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    userAgent: `agent-native-beta-e2e (+https://github.com/BuilderIO/agent-native) Chrome/${devices["Desktop Chrome"].userAgent?.match(/Chrome\/([\d.]+)/)?.[1] ?? "latest"}`,
  },
  projects: [
    // Gating lanes: a red here is a reason not to promote.
    {
      name: "public",
      testMatch: /specs\/(fleet-public|auth-surface)\.spec\.ts$/,
    },
    {
      name: "authed",
      testMatch: /specs\/(registry|chat|a2a)\.spec\.ts$/,
      // One retry, not two: each retry of a chat spec is another paid agent
      // turn, and a turn that fails twice is a finding rather than a flake.
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    {
      name: "journeys",
      testMatch: /specs\/apps\/.*\.spec\.ts$/,
      retries: 1,
      use: { ...AUTHED_ARTIFACTS },
    },
    // Non-gating: real findings that do not stop a user, reported separately so
    // a red here never trains anyone to ignore a red run.
    {
      name: "advisory",
      testMatch: /specs\/advisory\.spec\.ts$/,
      // These findings are deterministic configuration facts, not races.
      // Retrying them only doubles the time to report something already known.
      retries: 0,
    },
  ],
});

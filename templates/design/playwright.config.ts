import { randomUUID } from "node:crypto";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the Design visual editor.
 *
 * Runs real Chromium against a dev server backed by a throwaway local PGlite
 * database (`data/e2e-pglite`). `global-setup.ts` signs up a test user, saves the
 * signed session as `storageState`, and seeds one design with a known fixture.
 *
 * Run: `pnpm e2e` (headless), `pnpm e2e:headed`, `pnpm e2e:ui`.
 * Override the target with `E2E_BASE_URL` (e.g. point at an already-running
 * server on :9300); then `webServer.reuseExistingServer` keeps it.
 */
const PORT = Number(process.env.E2E_PORT ?? 9333);
const INSPECT_PORT = Number(process.env.E2E_INSPECT_PORT ?? 9229);
const USE_SIDEBAR_LOOPBACK = process.env.E2E_AI_SIDEBAR_LOOPBACK === "1";
const LOOPBACK_PORT = Number(
  process.env.E2E_LOOPBACK_PORT ?? 41000 + (process.pid % 1000),
);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const E2E_RUN_ID =
  process.env.E2E_RUN_ID ?? `${Date.now()}-${process.pid}-${randomUUID()}`;
if (!/^[A-Za-z0-9_-]+$/.test(E2E_RUN_ID)) {
  throw new Error("E2E_RUN_ID must contain only letters, numbers, _ or -");
}
process.env.E2E_RUN_ID ??= E2E_RUN_ID; // guard:allow-env-mutation - Playwright boot shares this run id with setup and teardown
const E2E_RUN_ROOT = path.join(
  import.meta.dirname,
  "..",
  "..",
  ".tmp",
  "design-e2e",
  E2E_RUN_ID,
);
process.env.E2E_RUN_ROOT ??= E2E_RUN_ROOT; // guard:allow-env-mutation - Playwright boot shares this run root with setup and teardown
const AUTH_DIR = process.env.E2E_AUTH_DIR
  ? path.resolve(process.env.E2E_AUTH_DIR)
  : path.join(E2E_RUN_ROOT, "auth");
process.env.E2E_AUTH_DIR ??= AUTH_DIR; // guard:allow-env-mutation - Playwright boot shares isolated auth state with setup
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? `pglite:${path.join(E2E_RUN_ROOT, "pglite")}`;
const usesRunPglite = !process.env.E2E_DATABASE_URL;
process.env.E2E_DATABASE_URL ??= E2E_DATABASE_URL; // guard:allow-env-mutation - Playwright boot pins its isolated test database
if (usesRunPglite) {
  process.env.E2E_RUN_PGLITE_DIR = path.join(E2E_RUN_ROOT, "pglite"); // guard:allow-env-mutation - teardown removes only this Playwright run
}
const E2E_RESULTS_DIR = path.join(
  import.meta.dirname,
  "test-results",
  E2E_RUN_ID,
);
process.env.E2E_RUN_RESULTS_DIR ??= E2E_RESULTS_DIR; // guard:allow-env-mutation - teardown removes only this Playwright run
const BROWSER_CHANNEL = process.env.E2E_BROWSER_CHANNEL;
const SHOW_SECONDARY_PANELS_IN_E2E =
  process.env.E2E_SHOW_DESIGN_SECONDARY_LEFT_PANELS !== "0";
const SECONDARY_PANELS_ENV = SHOW_SECONDARY_PANELS_IN_E2E
  ? "VITE_SHOW_DESIGN_SECONDARY_LEFT_PANELS=1 "
  : "VITE_SHOW_DESIGN_SECONDARY_LEFT_PANELS=0 ";
const ADVANCED_PANEL_SPEC_FILES = [
  /canvas-tools\.spec\.ts$/,
  /code-native-deep-surfaces\.spec\.ts$/,
  /code-native-pr-surfaces\.spec\.ts$/,
  /code-workbench-local-files\.spec\.ts$/,
];

export default defineConfig({
  metadata: { sidebarLoopbackPort: LOOPBACK_PORT },
  testDir: "./e2e",
  // These suites intentionally exercise panels that are not mounted in the
  // disabled profile. Ignoring them keeps that profile focused on verifying
  // the hidden-panel contract without failing on missing advanced controls.
  // No CI job sets E2E_SHOW_DESIGN_SECONDARY_LEFT_PANELS=0, so this branch and
  // editor.spec.ts's hidden-panel test only run via `pnpm e2e:no-panels`.
  testIgnore: SHOW_SECONDARY_PANELS_IN_E2E ? [] : ADVANCED_PANEL_SPEC_FILES,
  // The editor is heavy (iframe bridge + polling); give generous budgets.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: path.join(import.meta.dirname, "e2e", "global-setup.ts"),
  globalTeardown: path.join(import.meta.dirname, "e2e", "global-teardown.ts"),
  outputDir: E2E_RESULTS_DIR,
  use: {
    baseURL: BASE_URL,
    storageState: path.join(AUTH_DIR, "state.json"),
    trace: "on-first-retry",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: BROWSER_CHANNEL ? `chromium-${BROWSER_CHANNEL}` : "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(BROWSER_CHANNEL ? { channel: BROWSER_CHANNEL } : {}),
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // APP_NAME + the app-prefixed DESIGN_DATABASE_URL is checked BEFORE the
        // generic DATABASE_URL, but set both to an absolute PGlite URL so a
        // `.env` Postgres URL or a changed command cwd can never override this
        // throwaway local db.
        command: `APP_NAME=design AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS=1 ${USE_SIDEBAR_LOOPBACK ? `AGENT_ENGINE=ai-sdk:openai AGENT_MODEL=agentkit-loopback OPENAI_API_KEY=sk-agentkit-loopback-not-a-real-key OPENAI_BASE_URL=http://127.0.0.1:${LOOPBACK_PORT}/v1 E2E_LOOPBACK_PORT=${LOOPBACK_PORT} ` : ""}${SECONDARY_PANELS_ENV}DESIGN_DATABASE_URL=${JSON.stringify(E2E_DATABASE_URL)} DATABASE_URL=${JSON.stringify(E2E_DATABASE_URL)} PORT=${PORT} corepack pnpm exec agent-native dev --inspect=${INSPECT_PORT}`,
        url: BASE_URL,
        // The panel flag is compiled into the Vite bundle. Reusing a local
        // server can therefore run this profile with the opposite setting.
        reuseExistingServer: false,
        // Cold Vite dep-optimization on first boot can exceed two minutes.
        timeout: 300_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});

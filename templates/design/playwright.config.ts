import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the Design visual editor.
 *
 * Runs real Chromium against a dev server backed by a throwaway local SQLite
 * database (`data/e2e.db`). `global-setup.ts` signs up a test user, saves the
 * signed session as `storageState`, and seeds one design with a known fixture.
 *
 * Run: `pnpm e2e` (headless), `pnpm e2e:headed`, `pnpm e2e:ui`.
 * Override the target with `E2E_BASE_URL` (e.g. point at an already-running
 * server on :9300); then `webServer.reuseExistingServer` keeps it.
 */
const PORT = Number(process.env.E2E_PORT ?? 9333);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const AUTH_DIR = process.env.E2E_AUTH_DIR
  ? path.resolve(process.env.E2E_AUTH_DIR)
  : path.join(import.meta.dirname, "e2e", ".auth");
const E2E_DATABASE_URL = `file:${path.join(
  import.meta.dirname,
  "data",
  "e2e.db",
)}`;
const BROWSER_CHANNEL = process.env.E2E_BROWSER_CHANNEL;

export default defineConfig({
  testDir: "./e2e",
  // The editor is heavy (iframe bridge + polling); give generous budgets.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: path.join(import.meta.dirname, "e2e", "global-setup.ts"),
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
        // generic DATABASE_URL, but set both to an absolute SQLite URL so a
        // `.env` Postgres URL or a changed command cwd can never override this
        // throwaway local db.
        command: `APP_NAME=design DESIGN_DATABASE_URL=${JSON.stringify(E2E_DATABASE_URL)} DATABASE_URL=${JSON.stringify(E2E_DATABASE_URL)} PORT=${PORT} corepack pnpm dev`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        // Cold Vite dep-optimization on first boot can exceed two minutes.
        timeout: 300_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});

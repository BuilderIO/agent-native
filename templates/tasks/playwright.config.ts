import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 5174);
const HOST = process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const E2E_DB_PATH = "./data/e2e-playwright.db";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: `AUTH_DISABLED=true DATABASE_URL=file:${E2E_DB_PATH} pnpm exec agent-native dev -- --port ${PORT} --host ${HOST} --strictPort`,
    url: `${BASE_URL}/tasks`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

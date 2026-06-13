import { defineConfig, devices } from "@playwright/test";

/*
 * Browser E2E for the Agent-Native Content app.
 *
 * Runs against an already-running dev server (CONTENT_BASE_URL, default :8090).
 * Auth is established once in global-setup and reused via storageState. Retries
 * absorb transient HMR reloads while other agents edit the app.
 *
 * This config + the registry-blocks spec verify the editor-unification claim:
 * content's VisualEditor mounts core's RegistryBlockNode -> RegistryBlockNodeView
 * -> BlockView -> the block's React Read component for an inline NFM registry
 * block, i.e. the SAME render path already browser-proven in the plan app.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /(registry-blocks|local-files)\.spec\.ts/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 2,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: ".report.json" }]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: process.env.CONTENT_BASE_URL || "http://127.0.0.1:8090",
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
        storageState: ".auth/state.json",
      },
    },
  ],
});

import { rmSync } from "node:fs";
import path from "node:path";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const VISUAL_MODES = ["record", "compare"] as const;
type VisualMode = (typeof VISUAL_MODES)[number];
const visualSetting = process.env.STORYBOOK_VISUAL_REGRESSION ?? "";
if (
  visualSetting !== "" &&
  !VISUAL_MODES.includes(visualSetting as VisualMode)
) {
  throw new Error(
    `STORYBOOK_VISUAL_REGRESSION=${visualSetting} is not one of ${VISUAL_MODES.join(", ")}.`,
  );
}
const visualMode = visualSetting === "" ? null : (visualSetting as VisualMode);
const browser = process.env.STORYBOOK_TEST_BROWSER ?? "chromium";
if (browser !== "chromium" && browser !== "webkit")
  throw new Error(`Unsupported Storybook test browser: ${browser}`);
if (visualMode && browser !== "chromium")
  throw new Error(
    "Storybook screenshot baselines are recorded and compared in Chromium.",
  );

const visualDir = path.resolve(
  import.meta.dirname,
  "../../.tmp/storybook-visual",
);
const baselineDir = path.join(visualDir, "baseline");
const diffDir = path.join(visualDir, "diff");
const resultsDir = path.join(visualDir, "results");

if (visualMode) {
  rmSync(resultsDir, { recursive: true, force: true });
  rmSync(diffDir, { recursive: true, force: true });
  rmSync(path.join(visualDir, "attachments"), { recursive: true, force: true });
  if (visualMode === "record") {
    rmSync(baselineDir, { recursive: true, force: true });
  }
}

const configDir = path.join(import.meta.dirname, ".storybook");

export default defineConfig({
  test: {
    update: visualMode === "record",
    attachmentsDir: path.join(visualDir, "attachments"),
    projects: [
      {
        plugins: [
          storybookTest({ configDir, initialGlobals: { appearance: "light" } }),
        ],
        test: {
          name: "storybook-light",
          hookTimeout: visualMode ? 60_000 : undefined,
          setupFiles: visualMode ? ["./dev/visual-regression/setup.ts"] : [],
          provide: visualMode
            ? { storybookVisual: { mode: visualMode, resultsDir } }
            : {},
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser }],
            ...(visualMode ? { api: { allowWrite: true } } : {}),
            expect: {
              toMatchScreenshot: {
                comparatorName: "pixelmatch",
                comparatorOptions: {
                  threshold: 0.1,
                  allowedMismatchedPixels: 25,
                },
                resolveScreenshotPath: ({ arg, ext }) =>
                  path.join(baselineDir, `${arg}${ext}`),
                resolveDiffPath: ({ arg, ext }) =>
                  path.join(diffDir, `${arg}${ext}`),
              },
            },
          },
        },
      },
      {
        plugins: [
          storybookTest({ configDir, initialGlobals: { appearance: "dark" } }),
        ],
        test: {
          name: "storybook-dark",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser }],
          },
        },
      },
    ],
  },
});

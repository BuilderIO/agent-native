import { rmSync } from "node:fs";
import path from "node:path";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Every story renders in headless Chromium and runs its play function, plus
// the a11y addon's axe check (`a11y.test` in preview). The plugin applies
// preview.tsx and each addon's annotations itself; a setup file in
// .storybook that calls setProjectAnnotations turns that off.

// Screenshots only where the pixels are pinned: CI sets this on its Linux
// Chromium. A developer's fonts and display would fail every diff.
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

const visualDir = path.resolve(
  import.meta.dirname,
  "../../.tmp/storybook-visual",
);
const baselineDir = path.join(visualDir, "baseline");
const diffDir = path.join(visualDir, "diff");
const resultsDir = path.join(visualDir, "results");

if (visualMode) {
  // A previous run's results and diffs would read as this run's, and a
  // recorded baseline must not keep a story that has since been deleted.
  rmSync(resultsDir, { recursive: true, force: true });
  rmSync(diffDir, { recursive: true, force: true });
  rmSync(path.join(visualDir, "attachments"), { recursive: true, force: true });
  if (visualMode === "record") {
    rmSync(baselineDir, { recursive: true, force: true });
  }
}

const configDir = path.join(import.meta.dirname, ".storybook");

// One project per appearance, as the toolbar sets it, so axe checks every
// story's contrast in light and in dark. Screenshots ride on the light run:
// the visual setup shoots both appearances itself.
export default defineConfig({
  test: {
    update: visualMode === "record",
    // Vitest copies a mismatch's images here as test attachments.
    attachmentsDir: path.join(visualDir, "attachments"),
    projects: [
      {
        plugins: [
          storybookTest({ configDir, initialGlobals: { appearance: "light" } }),
        ],
        test: {
          name: "storybook-light",
          // Each story's afterEach takes two screenshots that must each settle.
          hookTimeout: visualMode ? 60_000 : undefined,
          setupFiles: visualMode ? ["./dev/visual-regression/setup.ts"] : [],
          provide: visualMode
            ? { storybookVisual: { mode: visualMode, resultsDir } }
            : {},
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: "chromium" }],
            // The Storybook plugin turns browser file writes off unless
            // asked; the visual setup writes each screenshot's outcome for
            // the report.
            ...(visualMode ? { api: { allowWrite: true } } : {}),
            expect: {
              toMatchScreenshot: {
                comparatorName: "pixelmatch",
                // Anti-aliased pixels are already ignored; this absorbs a few
                // stray subpixel edges without hiding a changed icon.
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
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});

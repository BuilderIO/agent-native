/**
 * Shared "could not launch Chromium" guidance for the qa smoke scripts.
 *
 * These scripts launch headless, so Playwright's headless shell is enough.
 * Plain `playwright install chromium` downloads the full headed browser on top
 * of that shell, and an agent following this text in a hosted container can
 * spend a large slice of a few-GB home volume on a browser nothing here uses.
 */
export const MISSING_BROWSER_HINT = [
  "Install the headless shell with `pnpm exec playwright install --only-shell chromium`; plain `install chromium` also downloads the full headed browser, several hundred MB more disk.",
  "Or set PLAYWRIGHT_CHANNEL to an already-installed browser channel.",
].join("\n");

/** Headed runs cannot use the headless shell, so they need the full browser. */
export const MISSING_HEADED_BROWSER_HINT =
  "Headed mode needs the full browser: `pnpm exec playwright install chromium` (several hundred MB).";

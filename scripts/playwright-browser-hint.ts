export const MISSING_BROWSER_HINT = [
  "Install the headless shell with `pnpm exec playwright install --only-shell chromium`; plain `install chromium` also downloads the full headed browser, several hundred MB more disk.",
  "Or set PLAYWRIGHT_CHANNEL to an already-installed browser channel.",
].join("\n");

export const MISSING_HEADED_BROWSER_HINT =
  "Headed mode needs the full browser: `pnpm exec playwright install chromium` (several hundred MB).";

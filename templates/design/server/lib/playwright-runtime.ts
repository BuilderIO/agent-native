/**
 * playwright-runtime.ts — shared headless-Chromium bootstrap used by every
 * server-side action that needs a real rendered DOM (as opposed to static
 * HTML/CSS analysis): `take-design-screenshot.ts`'s visual diagnostics pass
 * and `design-to-figma-svg.ts`'s scene extractor for the Figma SVG export.
 *
 * Extracted out of `take-design-screenshot.ts` (which originally owned this
 * logic) so `server/lib/*` modules can share it without an inverted
 * lib -> action dependency. `take-design-screenshot.ts` re-exports these same
 * names for backward compatibility with its existing spec/imports.
 */

export type PlaywrightModule = {
  chromium: import("@playwright/test").BrowserType;
};

/**
 * Dynamic import of a real Chromium-capable Playwright package.  Tries the
 * bare `"playwright"` package first (present when `@agent-native/core`'s
 * optional dependency resolved), then falls back to `@playwright/test` (a
 * direct devDependency of this template, used by its own e2e suite, which
 * re-exports the same chromium/Browser API). Loaded via a non-literal
 * specifier so bundlers don't try to statically resolve/include it — it's
 * optional and can be entirely absent (e.g. in a hosted deploy).
 */
export async function importPlaywright(): Promise<PlaywrightModule> {
  try {
    const specifier = "playwright";
    return (await import(
      /* @vite-ignore */ specifier
    )) as unknown as PlaywrightModule;
  } catch {
    return (await import("@playwright/test")) as unknown as PlaywrightModule;
  }
}

const SYSTEM_CHROME_EXECUTABLES = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

/** Pure classifier for "no Chromium binary available" errors. */
export function isMissingBrowserError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Executable doesn't exist|playwright install|browser.*not found|chromium.*not found/i.test(
    message,
  );
}

/** Launches Chromium, falling back to a system Chrome/Chromium binary when
 *  Playwright's bundled browser isn't installed (hosted/serverless deploys). */
export async function launchChromium(
  chromium: import("@playwright/test").BrowserType,
): Promise<import("@playwright/test").Browser> {
  const launchOptions = { args: ["--no-sandbox"] };
  try {
    return await chromium.launch(launchOptions);
  } catch (err) {
    if (!isMissingBrowserError(err)) throw err;
    const { existsSync } = await import("node:fs");
    for (const executablePath of SYSTEM_CHROME_EXECUTABLES) {
      if (!existsSync(executablePath)) continue;
      try {
        return await chromium.launch({ ...launchOptions, executablePath });
      } catch {
        // Try the next candidate; the original error is rethrown below.
      }
    }
    throw err;
  }
}

// NOTE: no shared `chromiumUnavailableReason` here on purpose — each caller's
// message should name ITS OWN fallback (e.g. `take-design-screenshot.ts`
// points at `run-design-audit`; the Figma SVG export points at `export-svg`),
// so that stays a small, action-local export next to each call site.

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

import { randomUUID } from "node:crypto";

export type PlaywrightModule = {
  chromium: import("@playwright/test").BrowserType;
};

/**
 * Dynamic import of the runtime `playwright` dependency. Falls back to
 * `@playwright/test` for local development setups that only install the test
 * runner. Loaded via a non-literal specifier so bundlers don't include browser
 * binaries; the runtime package remains available to server-side actions.
 *
 * When both are absent the FIRST error is what callers need: reporting the
 * fallback's "Cannot find package '@playwright/test'" names a package the user
 * never asked for and sends them installing the wrong thing.
 */
export async function importPlaywright(): Promise<PlaywrightModule> {
  try {
    const specifier = "playwright";
    return (await import(
      /* @vite-ignore */ specifier
    )) as unknown as PlaywrightModule;
  } catch (playwrightErr) {
    try {
      return (await import("@playwright/test")) as unknown as PlaywrightModule;
    } catch {
      throw playwrightErr;
    }
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

async function connectBuilderBrowser(
  chromium: import("@playwright/test").BrowserType,
): Promise<import("@playwright/test").Browser> {
  const server = (await import("@agent-native/core/server")) as unknown as {
    requestBuilderBrowserConnection?: (input: {
      sessionId: string;
    }) => Promise<Record<string, unknown>>;
  };
  if (!server.requestBuilderBrowserConnection) {
    throw new Error(
      "@agent-native/core/server does not export requestBuilderBrowserConnection.",
    );
  }
  const connection = await server.requestBuilderBrowserConnection({
    sessionId: `design-render-${randomUUID()}`,
  });
  const wsUrl = typeof connection.wsUrl === "string" ? connection.wsUrl : "";
  if (!wsUrl.trim()) throw new Error("Builder Browser did not return wsUrl.");
  return chromium.connectOverCDP(wsUrl);
}

async function launchLocalChromium(
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

/** Connects to Builder Browser first, then falls back to local/system Chrome. */
export async function launchChromium(
  chromium: import("@playwright/test").BrowserType,
): Promise<import("@playwright/test").Browser> {
  let hostedError: unknown;
  try {
    return await connectBuilderBrowser(chromium);
  } catch (error) {
    hostedError = error;
  }

  try {
    return await launchLocalChromium(chromium);
  } catch (localError) {
    const describe = (error: unknown) =>
      error instanceof Error ? error.message : String(error);
    throw new Error(
      `Builder Browser unavailable: ${describe(hostedError)}; local Chromium unavailable: ${describe(localError)}.`,
    );
  }
}

// NOTE: no shared `chromiumUnavailableReason` here on purpose — each caller's
// message should name ITS OWN fallback (e.g. `take-design-screenshot.ts`
// points at `run-design-audit`; the Figma SVG export points at `export-svg`),
// so that stays a small, action-local export next to each call site.

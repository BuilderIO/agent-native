
import { randomUUID } from "node:crypto";

import {
  chromiumPackUrl,
  loadOptionalServerlessChromium,
} from "@agent-native/creative-context/connectors/serverless-chromium";

export type PlaywrightModule = {
  chromium: import("@playwright/test").BrowserType;
};

export async function importPlaywright(
  loadModule: (specifier: string) => Promise<unknown> = (specifier) =>
    import(/* @vite-ignore */ specifier),
): Promise<PlaywrightModule> {
  try {
    return (await loadModule("playwright")) as PlaywrightModule;
  } catch (playwrightErr) {
    try {
      return (await loadModule("playwright-core")) as PlaywrightModule;
    } catch {
      try {
        return (await loadModule("@playwright/test")) as PlaywrightModule;
      } catch {
        throw playwrightErr;
      }
    }
  }
}

const SYSTEM_CHROME_EXECUTABLES = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

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
  let missingBrowserError: unknown;
  try {
    return await chromium.launch(launchOptions);
  } catch (err) {
    if (!isMissingBrowserError(err)) throw err;
    missingBrowserError = err;
  }

  const serverlessChromium = await loadOptionalServerlessChromium();
  if (serverlessChromium) {
    try {
      const executablePath =
        await serverlessChromium.executablePath(chromiumPackUrl());
      if (executablePath) {
        return await chromium.launch({
          ...launchOptions,
          args: [...launchOptions.args, ...(serverlessChromium.args ?? [])],
          executablePath,
        });
      }
    } catch (err) {
      missingBrowserError = err;
    }
  }

  const { existsSync } = await import("node:fs");
  for (const executablePath of SYSTEM_CHROME_EXECUTABLES) {
    if (!existsSync(executablePath)) continue;
    try {
      return await chromium.launch({ ...launchOptions, executablePath });
    } catch (err) {
      missingBrowserError = err;
    }
  }
  throw missingBrowserError;
}

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

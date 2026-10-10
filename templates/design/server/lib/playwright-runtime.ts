import { randomUUID } from "node:crypto";

export type PlaywrightModule = {
  chromium: import("@playwright/test").BrowserType;
};

export class ChromiumUnavailableError extends Error {
  readonly code = "chromium_unavailable" as const;
  readonly cause: unknown;

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Chromium unavailable: ${detail}`);
    this.name = "ChromiumUnavailableError";
    this.cause = cause;
  }
}

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

export function isMissingBrowserError(err: unknown): boolean {
  if (err instanceof ChromiumUnavailableError) return true;
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

export async function launchChromium(
  chromium: import("@playwright/test").BrowserType,
): Promise<import("@playwright/test").Browser> {
  let builderBrowserError: unknown;
  try {
    return await connectBuilderBrowser(chromium);
  } catch (error) {
    builderBrowserError = error;
  }

  try {
    return await chromium.launch({ chromiumSandbox: true });
  } catch (localBrowserError) {
    const describe = (error: unknown) =>
      error instanceof Error ? error.message : String(error);
    console.error(
      "Design export could not launch sandboxed local Chromium:",
      localBrowserError,
    );
    throw new ChromiumUnavailableError(
      new Error(
        `Builder Browser unavailable: ${describe(builderBrowserError)}; ` +
          `sandboxed local Chromium unavailable: ${describe(localBrowserError)}.`,
      ),
    );
  }
}

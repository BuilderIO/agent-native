import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

const MAX_PREVIEW_HTML_BYTES = 512 * 1024;
const MAX_PREVIEW_COUNT = 12;
const MAX_PREVIEW_DIMENSION = 1_600;
const MAX_PREVIEW_PNG_BYTES = 4 * 1024 * 1024;

export interface SafeNativeHtmlPreviewInput {
  id: string;
  html: string;
  width: number;
  height: number;
}

export interface SafeNativeHtmlPreviewResult {
  id: string;
  data: Uint8Array;
  width: number;
  height: number;
}

type PlaywrightModule = {
  chromium: import("playwright").BrowserType;
};

const SYSTEM_CHROME_EXECUTABLES = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function safeDimension(value: number) {
  return Math.max(200, Math.min(MAX_PREVIEW_DIMENSION, Math.round(value)));
}

export function sanitizeSafeNativePreviewHtml(html: string): string {
  return html
    .replace(
      /<(script|noscript|iframe|object|embed|form|meta|base|link)\b[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(
      /<(script|noscript|iframe|object|embed|form|meta|base|link)\b[^>]*\/?>/gi,
      "",
    )
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s+(?:x-[\w:-]+|@[\w:-]+|:[\w:-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    )
    .replace(/\s+(?:srcdoc|srcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s+(href|src|poster|action)\s*=\s*(["'])(?!\s*(?:data:image\/(?:png|jpe?g|gif|webp|svg\+xml);|#))[^"']*\2/gi,
      "",
    )
    .replace(
      /\s+(?:href|src|poster|action)\s*=\s*(?!["'])(?!data:image\/(?:png|jpe?g|gif|webp|svg\+xml);|#)[^\s>]+/gi,
      "",
    )
    .replace(/@import\s+(?:url\()?\s*["']?[^;"')]+["']?\s*\)?\s*;?/gi, "")
    .replace(
      /url\(\s*(["']?)(?!data:image\/(?:png|jpe?g|gif|webp|svg\+xml);)[^)]+\1\s*\)/gi,
      "none",
    );
}

async function importPlaywright(): Promise<PlaywrightModule> {
  return (await import(
    /* @vite-ignore */ "playwright"
  )) as unknown as PlaywrightModule;
}

function isMissingBrowserError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Executable doesn't exist|playwright install|browser.*not found|chromium.*not found/i.test(
    message,
  );
}

async function launchBrowser(chromium: import("playwright").BrowserType) {
  const launchOptions = {
    headless: true as const,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  };
  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    if (!isMissingBrowserError(error)) throw error;
    for (const executablePath of SYSTEM_CHROME_EXECUTABLES) {
      if (!existsSync(executablePath)) continue;
      try {
        return await chromium.launch({ ...launchOptions, executablePath });
      } catch {
        continue;
      }
    }
    throw error;
  }
}

async function connectHostedBrowser(
  chromium: import("playwright").BrowserType,
): Promise<import("playwright").Browser> {
  const server = (await import("@agent-native/core/server")) as unknown as {
    requestBuilderBrowserConnection?: (input: {
      sessionId: string;
    }) => Promise<Record<string, unknown>>;
  };
  if (!server.requestBuilderBrowserConnection) {
    throw new Error("Builder Browser is unavailable.");
  }
  const connection = await server.requestBuilderBrowserConnection({
    sessionId: `creative-context-preview-${randomUUID()}`,
  });
  const wsUrl = typeof connection.wsUrl === "string" ? connection.wsUrl : "";
  if (!wsUrl) throw new Error("Builder Browser did not return a connection.");
  return chromium.connectOverCDP(wsUrl);
}

export async function renderSafeNativeHtmlPreviews(
  inputs: SafeNativeHtmlPreviewInput[],
): Promise<SafeNativeHtmlPreviewResult[]> {
  const bounded = inputs.slice(0, MAX_PREVIEW_COUNT).flatMap((input) => {
    if (Buffer.byteLength(input.html, "utf8") > MAX_PREVIEW_HTML_BYTES) {
      return [];
    }
    return [
      {
        ...input,
        html: sanitizeSafeNativePreviewHtml(input.html),
        width: safeDimension(input.width),
        height: safeDimension(input.height),
      },
    ];
  });
  if (!bounded.length) return [];

  let browser: import("playwright").Browser | undefined;
  try {
    const playwright = await importPlaywright();
    browser = await connectHostedBrowser(playwright.chromium).catch(() =>
      launchBrowser(playwright.chromium),
    );
  } catch {
    return [];
  }

  const results: SafeNativeHtmlPreviewResult[] = [];
  try {
    for (const input of bounded) {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: "block",
        viewport: { width: input.width, height: input.height },
      });
      try {
        await context.route("**/*", async (route) => {
          const protocol = new URL(route.request().url()).protocol;
          if (
            protocol === "about:" ||
            protocol === "data:" ||
            protocol === "blob:"
          ) {
            await route.continue();
            return;
          }
          await route.abort("blockedbyclient");
        });
        const page = await context.newPage();
        await page.setContent(input.html, {
          waitUntil: "domcontentloaded",
          timeout: 5_000,
        });
        const png = await page.screenshot({
          type: "png",
          animations: "disabled",
          timeout: 5_000,
        });
        if (png.byteLength <= MAX_PREVIEW_PNG_BYTES) {
          results.push({
            id: input.id,
            data: new Uint8Array(png),
            width: input.width,
            height: input.height,
          });
        }
      } catch {
        continue;
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return results;
}

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import {
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "@agent-native/core/extensions/url-safety";
import {
  extractStaticWebsiteContext,
  rankColorSamples,
  readBoundedResponseBytes,
  type WebsiteExtraction,
} from "@agent-native/core/ingestion";

import { normalizeWhitespace } from "./normalize.js";

export type RenderedPageMethod =
  | "builder-browser"
  | "local-playwright"
  | "attached-chrome"
  | "static-html";

const MAX_RENDERED_TEXT_CHARS = 2_000_000;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const MAX_STATIC_HTML_BYTES = 5 * 1024 * 1024;
const MAX_EXTRACTED_ASSETS = 500;
const MAX_INTERNAL_LINKS = 500;
const MAX_COLORS = 256;
const MAX_TYPOGRAPHY = 100;
const MAX_SPACING = 100;
const MAX_RADII = 64;
const MAX_CSS_VARIABLES = 128;
const MAX_COMPONENT_STYLES = 24;
const FONT_READY_TIMEOUT_MS = 4_000;
const MAX_BROWSER_RESOURCE_BYTES = 12 * 1024 * 1024;
const MAX_BROWSER_RESOURCE_COUNT = 400;
const MAX_BROWSER_RESOURCE_BYTES_TOTAL = 64 * 1024 * 1024;
const BROWSER_RESOURCE_TIMEOUT_MS = 15_000;
const BROWSER_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "if-modified-since",
  "if-none-match",
  "origin",
  "range",
  "referer",
  "user-agent",
]);
const BROWSER_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface RenderedPageRequest {
  url: string;
  timeoutMs?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  preferHosted?: boolean;
}

export interface RenderedPageResult {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  method: RenderedPageMethod;
  rendered: boolean;
  warnings: string[];
  extraction: WebsiteExtraction;
  screenshots: Array<{
    viewport: "desktop" | "mobile";
    width: number;
    height: number;
    data: Uint8Array;
  }>;
  confidence: number;
  classification:
    | "homepage"
    | "marketing"
    | "documentation"
    | "content"
    | "unknown";
  diagnostics: string[];
  metadata: Record<string, unknown>;
}

export interface RenderedPageProvider {
  render(request: RenderedPageRequest): Promise<RenderedPageResult>;
}

interface PlaywrightRequestLike {
  url(): string;
  isNavigationRequest(): boolean;
  resourceType(): string;
  method?(): string;
  headers?(): Record<string, string>;
}

interface PlaywrightRouteLike {
  request(): PlaywrightRequestLike;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
  fulfill(options: {
    status: number;
    headers: Record<string, string>;
    body: Uint8Array;
  }): Promise<void>;
}

interface PlaywrightPageLike {
  route(
    pattern: string,
    handler: (route: PlaywrightRouteLike) => Promise<void>,
  ): Promise<void>;
  goto(
    url: string,
    options: { timeout: number; waitUntil: string },
  ): Promise<unknown>;
  waitForLoadState?(
    state: "load" | "domcontentloaded" | "networkidle",
    options?: { timeout: number },
  ): Promise<void>;
  title(): Promise<string>;
  url(): string;
  locator(selector: string): { innerText(): Promise<string> };
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  screenshot(options: { type: "png"; fullPage: boolean }): Promise<Uint8Array>;
  evaluate<T>(callback: () => T): Promise<T>;
}

interface PlaywrightContextLike {
  pages(): PlaywrightPageLike[];
  newPage(): Promise<PlaywrightPageLike>;
  close?(): Promise<void>;
}

interface PlaywrightBrowserLike {
  contexts(): PlaywrightContextLike[];
  newContext?(): Promise<PlaywrightContextLike>;
  close(): Promise<void>;
}

interface PlaywrightLike {
  chromium: {
    connectOverCDP(endpoint: string): Promise<PlaywrightBrowserLike>;
    launch(options: {
      headless: boolean;
      args?: string[];
      executablePath?: string;
    }): Promise<PlaywrightBrowserLike>;
  };
}

export interface LayeredRenderedPageProviderOptions {
  requestBuilderBrowserConnection?: (input: {
    sessionId: string;
  }) => Promise<Record<string, unknown>>;
  loadPlaywright?: () => Promise<PlaywrightLike | null>;
  requestAttachedBrowserConnection?: (input: {
    sessionId: string;
    url: string;
  }) => Promise<{ wsUrl: string }>;
  staticFetch?: typeof ssrfSafeFetch;
}

export class LayeredRenderedPageProvider implements RenderedPageProvider {
  readonly #requestBuilderBrowserConnection: (input: {
    sessionId: string;
  }) => Promise<Record<string, unknown>>;
  readonly #loadPlaywright: () => Promise<PlaywrightLike | null>;
  readonly #requestAttachedBrowserConnection?: NonNullable<
    LayeredRenderedPageProviderOptions["requestAttachedBrowserConnection"]
  >;
  readonly #staticFetch: typeof ssrfSafeFetch;

  constructor(options: LayeredRenderedPageProviderOptions = {}) {
    this.#requestBuilderBrowserConnection =
      options.requestBuilderBrowserConnection ?? defaultBuilderBrowserRequest;
    this.#loadPlaywright = options.loadPlaywright ?? loadOptionalPlaywright;
    this.#requestAttachedBrowserConnection =
      options.requestAttachedBrowserConnection;
    this.#staticFetch = options.staticFetch ?? ssrfSafeFetch;
  }

  async render(request: RenderedPageRequest): Promise<RenderedPageResult> {
    await assertPublicBrowserUrl(request.url);
    const warnings: string[] = [];
    const playwright = await this.#loadPlaywright().catch((error) => {
      warnings.push(`Playwright unavailable: ${errorMessage(error)}`);
      return null;
    });

    if (request.preferHosted !== false && playwright) {
      try {
        const connection = await this.#requestBuilderBrowserConnection({
          sessionId: `creative-context-${randomUUID()}`,
        });
        const wsUrl =
          typeof connection.wsUrl === "string" ? connection.wsUrl.trim() : "";
        if (!wsUrl) throw new Error("Builder Browser did not return wsUrl.");
        return await renderWithPlaywright(
          playwright,
          request,
          warnings,
          "builder-browser",
          wsUrl,
        );
      } catch (error) {
        warnings.push(`Builder Browser unavailable: ${errorMessage(error)}`);
      }
    }

    if (playwright) {
      try {
        return await renderWithPlaywright(
          playwright,
          request,
          warnings,
          "local-playwright",
        );
      } catch (error) {
        warnings.push(`Local Playwright unavailable: ${errorMessage(error)}`);
      }
    }

    if (playwright && this.#requestAttachedBrowserConnection) {
      try {
        const connection = await this.#requestAttachedBrowserConnection({
          sessionId: `creative-context-attached-${randomUUID()}`,
          url: request.url,
        });
        if (!connection.wsUrl?.trim()) {
          throw new Error("Approved attached browser did not return wsUrl.");
        }
        return await renderWithPlaywright(
          playwright,
          request,
          warnings,
          "attached-chrome",
          connection.wsUrl,
        );
      } catch (error) {
        warnings.push(`Attached Chrome unavailable: ${errorMessage(error)}`);
      }
    } else {
      warnings.push(
        "Attached Chrome unavailable: no approved browser connection adapter is configured.",
      );
    }

    return renderStatic(request, warnings, this.#staticFetch);
  }
}

export async function renderWithPlaywright(
  playwright: PlaywrightLike,
  request: RenderedPageRequest,
  warnings: string[],
  method: "builder-browser" | "local-playwright" | "attached-chrome",
  wsUrl?: string,
): Promise<RenderedPageResult> {
  const browser = wsUrl
    ? await playwright.chromium.connectOverCDP(wsUrl)
    : await launchChromium(playwright.chromium);
  let isolatedContext: PlaywrightContextLike | undefined;
  try {
    // Never reuse a connected browser's ambient context: it can carry cookies,
    // extensions, or tabs from another workflow. The safe proxy below is only
    // useful when the page itself is isolated from that state.
    if (!browser.newContext) {
      throw new Error("Browser did not provide isolated context support.");
    }
    isolatedContext = await browser.newContext();
    const page = await isolatedContext.newPage();
    const getFinalNavigationUrl = await installNavigationGuard(
      page,
      request,
      warnings,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(request.url, {
      timeout: boundedTimeout(request.timeoutMs),
      waitUntil: request.waitUntil ?? "domcontentloaded",
    });
    await page
      .waitForLoadState?.("load", {
        timeout: Math.min(8_000, boundedTimeout(request.timeoutMs)),
      })
      .catch((error) => {
        warnings.push(
          `Browser load stabilization unavailable: ${errorMessage(error)}`,
        );
      });
    // React hydration, CSS-in-JS insertion, and web fonts commonly finish just
    // after `load`. Give those layers a bounded chance to settle, then capture
    // the computed cascade rather than the server HTML.
    await page
      .waitForLoadState?.("networkidle", { timeout: 4_000 })
      .catch((error) => {
        warnings.push(
          `Browser network-idle stabilization unavailable: ${errorMessage(error)}`,
        );
      });
    await waitForFontReadiness(
      page,
      Math.min(FONT_READY_TIMEOUT_MS, boundedTimeout(request.timeoutMs)),
    ).catch((error) => {
      warnings.push(
        `Browser font readiness unavailable: ${errorMessage(error)}`,
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await page.evaluate(dismissConsentOverlays).catch(() => undefined);
    const finalUrl = getFinalNavigationUrl() ?? page.url();
    await assertPublicBrowserUrl(finalUrl);
    const [title, text, desktopScreenshot, extraction] = await Promise.all([
      page.title().catch((error) => {
        warnings.push(
          `Browser title extraction unavailable: ${errorMessage(error)}`,
        );
        return "";
      }),
      page
        .locator("body")
        .innerText()
        .catch((error) => {
          warnings.push(
            `Browser text extraction unavailable: ${errorMessage(error)}`,
          );
          return "";
        }),
      page
        .screenshot({ type: "png", fullPage: false })
        .then(boundedScreenshot)
        .catch((error) => {
          warnings.push(
            `Desktop screenshot unavailable: ${errorMessage(error)}`,
          );
          return undefined;
        }),
      page.evaluate(captureRenderedWebsiteContext).catch((error) => {
        warnings.push(
          `Browser style extraction unavailable: ${errorMessage(error)}`,
        );
        return emptyExtraction();
      }),
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileScreenshot = await page
      .screenshot({ type: "png", fullPage: false })
      .then(boundedScreenshot)
      .catch((error) => {
        warnings.push(`Mobile screenshot unavailable: ${errorMessage(error)}`);
        return undefined;
      });
    const unboundedText = normalizeWhitespace(text);
    const textTruncated = unboundedText.length > MAX_RENDERED_TEXT_CHARS;
    const normalizedText = unboundedText.slice(0, MAX_RENDERED_TEXT_CHARS);
    const resolvedExtraction = boundWebsiteExtraction({
      ...extraction,
      title: normalizeWhitespace(title) || extraction.title,
      text: normalizedText || extraction.text,
      designTokens: {
        ...extraction.designTokens,
        colors: rankColorSamples(extraction.designTokens.colors),
      },
    });
    const diagnostics = [
      ...warnings,
      `Captured ${resolvedExtraction.assets.length} assets and ${resolvedExtraction.internalLinks.length} same-origin links.`,
      ...(desktopScreenshot && mobileScreenshot
        ? []
        : ["One or more viewport screenshots could not be captured."]),
      ...(textTruncated
        ? [`Body text was truncated at ${MAX_RENDERED_TEXT_CHARS} characters.`]
        : []),
    ];
    return {
      url: request.url,
      finalUrl,
      title: normalizeWhitespace(title) || new URL(finalUrl).hostname,
      text: resolvedExtraction.text,
      method,
      rendered: true,
      warnings,
      extraction: resolvedExtraction,
      screenshots: [
        ...(desktopScreenshot
          ? [
              {
                viewport: "desktop" as const,
                width: 1440,
                height: 900,
                data: desktopScreenshot,
              },
            ]
          : []),
        ...(mobileScreenshot
          ? [
              {
                viewport: "mobile" as const,
                width: 390,
                height: 844,
                data: mobileScreenshot,
              },
            ]
          : []),
      ],
      confidence: 0.92,
      classification: classifyWebsite(resolvedExtraction, finalUrl),
      diagnostics,
      metadata: {
        browser: method,
        assetCount: resolvedExtraction.assets.length,
        internalLinkCount: resolvedExtraction.internalLinks.length,
      },
    };
  } finally {
    await isolatedContext?.close?.().catch((error) => {
      warnings.push(
        `Browser context cleanup unavailable: ${errorMessage(error)}`,
      );
    });
    await browser.close().catch(() => undefined);
  }
}

async function waitForFontReadiness(
  page: PlaywrightPageLike,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`font readiness timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function installNavigationGuard(
  page: PlaywrightPageLike,
  renderRequest: RenderedPageRequest,
  warnings: string[],
): Promise<() => string | undefined> {
  let finalNavigationUrl: string | undefined;
  let resourceCount = 0;
  let resourceBytes = 0;
  let resourceLimitWarningAdded = false;
  let blockedResourceWarningAdded = false;
  let failedResourceWarningAdded = false;

  const addWarning = (value: string): void => {
    if (!warnings.includes(value)) warnings.push(value);
  };

  await page.route("**/*", async (route) => {
    const browserRequest = route.request();
    let parsed: URL;
    try {
      parsed = new URL(browserRequest.url());
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    if (
      parsed.protocol === "about:" ||
      parsed.protocol === "data:" ||
      parsed.protocol === "blob:"
    ) {
      await route.continue();
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      await route.abort("blockedbyclient");
      return;
    }

    const method = (browserRequest.method?.() ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      await route.abort("blockedbyclient");
      if (!resourceLimitWarningAdded) {
        resourceLimitWarningAdded = true;
        addWarning(
          "Browser blocked a non-read-only resource request during extraction.",
        );
      }
      return;
    }
    if (resourceCount >= MAX_BROWSER_RESOURCE_COUNT) {
      await route.abort("blockedbyclient");
      if (!resourceLimitWarningAdded) {
        resourceLimitWarningAdded = true;
        addWarning(
          `Browser resource budget reached (${MAX_BROWSER_RESOURCE_COUNT} requests).`,
        );
      }
      return;
    }

    try {
      await assertPublicBrowserUrl(parsed.href);
      const response = await ssrfSafeFetch(
        parsed.href,
        {
          method,
          headers: browserRequestHeaders(browserRequest),
          signal: AbortSignal.timeout(
            Math.min(
              BROWSER_RESOURCE_TIMEOUT_MS,
              boundedTimeout(renderRequest.timeoutMs),
            ),
          ),
        },
        { maxRedirects: 5 },
      );
      const body = await readBoundedResponseBytes(
        response,
        MAX_BROWSER_RESOURCE_BYTES,
      );
      if (resourceBytes + body.byteLength > MAX_BROWSER_RESOURCE_BYTES_TOTAL) {
        await route.abort("blockedbyclient");
        if (!resourceLimitWarningAdded) {
          resourceLimitWarningAdded = true;
          addWarning(
            `Browser resource budget reached (${MAX_BROWSER_RESOURCE_BYTES_TOTAL} bytes).`,
          );
        }
        return;
      }
      resourceCount += 1;
      resourceBytes += body.byteLength;
      if (browserRequest.isNavigationRequest()) {
        finalNavigationUrl = response.url || parsed.href;
      }
      await route.fulfill({
        status: response.status,
        headers: browserResponseHeaders(response),
        body: Buffer.from(body),
      });
    } catch (error) {
      await route.abort("blockedbyclient");
      if (isSsrfError(error)) {
        if (!blockedResourceWarningAdded) {
          blockedResourceWarningAdded = true;
          addWarning(
            "Some browser resources were blocked by the SSRF safety policy.",
          );
        }
      } else if (!failedResourceWarningAdded) {
        failedResourceWarningAdded = true;
        addWarning(
          "Some browser resources could not be fetched through the safe network proxy.",
        );
      }
    }
  });
  return () => finalNavigationUrl;
}

function browserRequestHeaders(
  request: PlaywrightRequestLike,
): Record<string, string> {
  const source = request.headers?.() ?? {};
  return Object.fromEntries(
    Object.entries(source).filter(([name, value]) => {
      return BROWSER_REQUEST_HEADERS.has(name.toLowerCase()) && Boolean(value);
    }),
  );
}

function browserResponseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (!BROWSER_RESPONSE_HEADERS.has(name.toLowerCase())) {
      headers[name] = value;
    }
  });
  return headers;
}

function isSsrfError(error: unknown): boolean {
  return /ssrf blocked|private\/internal|connect blocked/i.test(
    errorMessage(error),
  );
}

const SYSTEM_CHROME_EXECUTABLES = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

async function launchChromium(
  chromium: PlaywrightLike["chromium"],
): Promise<PlaywrightBrowserLike> {
  const launchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  };
  let missingBrowserError: unknown;
  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    if (!isMissingBrowserError(error)) throw error;
    missingBrowserError = error;
  }

  const serverlessChromium = await loadOptionalServerlessChromium();
  if (serverlessChromium) {
    try {
      const executablePath = await serverlessChromium.executablePath();
      if (executablePath) {
        return await chromium.launch({
          ...launchOptions,
          args: [...launchOptions.args, ...(serverlessChromium.args ?? [])],
          executablePath,
        });
      }
    } catch (error) {
      if (!isMissingBrowserError(error)) throw error;
      missingBrowserError = error;
    }
  }

  for (const executablePath of SYSTEM_CHROME_EXECUTABLES) {
    if (!existsSync(executablePath)) continue;
    try {
      return await chromium.launch({ ...launchOptions, executablePath });
    } catch {
      continue;
    }
  }
  if (missingBrowserError) {
    throw missingBrowserError;
  }
  throw new Error(
    "No Chromium executable is available for browser extraction.",
  );
}

interface ServerlessChromiumLike {
  args?: string[];
  executablePath(): Promise<string>;
}

async function loadOptionalServerlessChromium(): Promise<ServerlessChromiumLike | null> {
  try {
    const module = (await import(
      /* @vite-ignore */ "@sparticuz/chromium"
    )) as unknown as {
      default?: Partial<ServerlessChromiumLike>;
    } & Partial<ServerlessChromiumLike>;
    const chromium = module.default ?? module;
    return typeof chromium.executablePath === "function"
      ? (chromium as ServerlessChromiumLike)
      : null;
  } catch {
    // coercion-ok: this optional capability is absent in non-serverless installs.
    return null;
  }
}

/*
 * Kept separate from Playwright loading so a deployment can omit the large
 * serverless Chromium package and still use Builder Browser or system Chrome.
 */
async function loadOptionalPlaywright(): Promise<PlaywrightLike | null> {
  const specifier = "playwright";
  try {
    return (await import(/* @vite-ignore */ specifier)) as PlaywrightLike;
  } catch (playwrightError) {
    try {
      const testSpecifier = "@playwright/test";
      return (await import(
        /* @vite-ignore */ testSpecifier
      )) as unknown as PlaywrightLike;
    } catch {
      // coercion-ok: the optional test-only browser package is absent in production installs.
      void playwrightError;
      return null;
    }
  }
}

async function defaultBuilderBrowserRequest(input: {
  sessionId: string;
}): Promise<Record<string, unknown>> {
  const server = (await import("@agent-native/core/server")) as unknown as {
    requestBuilderBrowserConnection?: (value: {
      sessionId: string;
    }) => Promise<Record<string, unknown>>;
  };
  if (!server.requestBuilderBrowserConnection) {
    throw new Error(
      "@agent-native/core/server does not export requestBuilderBrowserConnection.",
    );
  }
  return server.requestBuilderBrowserConnection(input);
}

function isMissingBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Executable doesn't exist|playwright install|browser.*not found|chromium.*not found/i.test(
    message,
  );
}

/** Close common consent banners without accepting tracking or changing page data. */
function dismissConsentOverlays(): void {
  const selectors = [
    '[aria-label*="reject" i]',
    '[aria-label*="decline" i]',
    '[aria-label*="close" i]',
    '[data-testid*="reject" i]',
    '[data-testid*="decline" i]',
    '[data-testid*="close" i]',
    'button[id*="reject" i]',
    'button[id*="decline" i]',
    'button[class*="reject" i]',
    'button[class*="decline" i]',
  ];
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    ) {
      element.click();
      return;
    }
  }
}

async function renderStatic(
  request: RenderedPageRequest,
  warnings: string[],
  fetcher: typeof ssrfSafeFetch,
): Promise<RenderedPageResult> {
  const response = await fetcher(
    request.url,
    {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
      },
      signal: AbortSignal.timeout(boundedTimeout(request.timeoutMs)),
    },
    { maxRedirects: 5 },
  );
  if (!response.ok) {
    throw new Error(`Static page fetch failed (${response.status}).`);
  }
  const html = new TextDecoder().decode(
    await readBoundedResponseBytes(response, MAX_STATIC_HTML_BYTES),
  );
  const finalUrl = response.url || request.url;
  const extraction = extractStaticWebsiteContext(html, finalUrl);
  const title = extraction.title || new URL(finalUrl).hostname;
  warnings.push(
    "Used the SSRF-safe static HTML fallback; client-rendered content may be missing.",
  );
  return {
    url: request.url,
    finalUrl,
    title,
    text: extraction.text,
    method: "static-html",
    rendered: false,
    warnings,
    extraction: { ...extraction, title },
    screenshots: [],
    confidence: 0.45,
    classification: classifyWebsite(extraction, finalUrl),
    diagnostics: [
      ...warnings,
      "Static extraction cannot verify client-rendered layout or viewport behavior.",
    ],
    metadata: {
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      staticFallback: true,
      assetCount: extraction.assets.length,
      internalLinkCount: extraction.internalLinks.length,
    },
  };
}

async function assertPublicBrowserUrl(value: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Website URL must be an absolute http(s) URL.");
  }
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) {
    throw new Error("Website URL must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Website URLs cannot contain credentials.");
  }
  if (await isBlockedExtensionUrlWithDns(parsed.href)) {
    throw new Error(
      "SSRF blocked: website resolved to a private/internal host.",
    );
  }
}

function captureRenderedWebsiteContext(): WebsiteExtraction {
  const MAX_ASSETS = 500;
  const MAX_LINKS = 500;
  const MAX_COLOR_VALUES = 256;
  const MAX_TYPE_STYLES = 100;
  const MAX_SPACING_VALUES = 100;
  const MAX_RADIUS_VALUES = 64;
  const MAX_SHADOWS = 32;
  const MAX_BACKGROUNDS = 32;
  const MAX_VARIABLES = 128;
  const MAX_TEXT = 2_000_000;
  const MAX_COMPONENT_STYLES = 24;
  const assets = new Map<string, WebsiteExtraction["assets"][number]>();
  const links = new Set<string>();
  const colors: string[] = [];
  const typography = new Map<
    string,
    WebsiteExtraction["designTokens"]["typography"][number]
  >();
  const spacing = new Set<string>();
  const radii = new Set<string>();
  const shadows = new Set<string>();
  const backgrounds = new Set<string>();
  const components: NonNullable<
    WebsiteExtraction["designTokens"]["components"]
  > = [];
  const cssVariables: Record<string, string> = {};
  const semanticColors: NonNullable<
    WebsiteExtraction["designTokens"]["semanticColors"]
  > = {};

  const isOpaque = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "transparent") return false;
    const functionBody = normalized.match(/^[a-z-]+\((.*)\)$/)?.[1];
    if (!functionBody) return true;
    const alphaValue = functionBody.includes("/")
      ? functionBody.split("/").at(-1)?.trim()
      : functionBody.split(",").length === 4
        ? functionBody.split(",").at(-1)?.trim()
        : undefined;
    if (!alphaValue) return true;
    const alpha = alphaValue.endsWith("%")
      ? Number.parseFloat(alphaValue) / 100
      : Number.parseFloat(alphaValue);
    return Number.isNaN(alpha) || alpha > 0.02;
  };

  const addColor = (value: string): void => {
    if (colors.length >= MAX_COLOR_VALUES || !isOpaque(value)) return;
    const normalized = value.trim();
    if (!colors.includes(normalized)) colors.push(normalized);
  };

  const visible = (element: Element): boolean => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0.02
    );
  };

  const firstVisible = (selector: string): Element | undefined =>
    Array.from(document.querySelectorAll(selector)).find(visible);

  const opaqueValue = (value: string): string | undefined =>
    isOpaque(value) ? value.trim() : undefined;

  const recordComputedStyle = (
    element: Element,
    role?: NonNullable<
      WebsiteExtraction["designTokens"]["components"]
    >[number]["role"],
  ) => {
    const style = getComputedStyle(element);
    const values = [
      style.color,
      style.backgroundColor,
      style.borderTopColor,
      style.borderRightColor,
      style.borderBottomColor,
      style.borderLeftColor,
    ];
    values.forEach(addColor);
    if (style.boxShadow && style.boxShadow !== "none") {
      if (shadows.size < MAX_SHADOWS) shadows.add(style.boxShadow);
    }
    if (style.backgroundImage && style.backgroundImage !== "none") {
      if (backgrounds.size < MAX_BACKGROUNDS) {
        backgrounds.add(style.backgroundImage);
      }
    }
    for (const value of [
      style.marginTop,
      style.marginRight,
      style.marginBottom,
      style.marginLeft,
      style.paddingTop,
      style.paddingRight,
      style.paddingBottom,
      style.paddingLeft,
      style.gap,
      style.rowGap,
      style.columnGap,
    ]) {
      if (
        spacing.size < MAX_SPACING_VALUES &&
        value &&
        value !== "0px" &&
        value !== "normal"
      ) {
        spacing.add(value);
      }
    }
    for (const value of [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ]) {
      if (radii.size < MAX_RADIUS_VALUES && value && value !== "0px") {
        radii.add(value);
      }
    }
    const type = {
      family: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
    };
    if (typography.size < MAX_TYPE_STYLES && type.family) {
      typography.set(JSON.stringify(type), type);
    }
    if (!role || components.length >= MAX_COMPONENT_STYLES) return style;
    components.push({
      role,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      color: opaqueValue(style.color),
      backgroundColor: opaqueValue(style.backgroundColor),
      backgroundImage:
        style.backgroundImage !== "none" ? style.backgroundImage : undefined,
      border:
        style.borderStyle !== "none" && style.borderWidth !== "0px"
          ? style.border
          : undefined,
      borderRadius:
        style.borderTopLeftRadius !== "0px" ? style.borderRadius : undefined,
      boxShadow: style.boxShadow !== "none" ? style.boxShadow : undefined,
      padding: style.padding !== "0px" ? style.padding : undefined,
      gap: style.gap !== "normal" ? style.gap : undefined,
      textTransform:
        style.textTransform !== "none" ? style.textTransform : undefined,
    });
    return style;
  };

  const styleFor = (
    selector: string,
    role?: NonNullable<
      WebsiteExtraction["designTokens"]["components"]
    >[number]["role"],
  ): CSSStyleDeclaration | undefined => {
    const element = firstVisible(selector);
    if (!element) return undefined;
    return recordComputedStyle(element, role);
  };

  const addAsset = (
    raw: string | null | undefined,
    kind: WebsiteExtraction["assets"][number]["kind"],
    role?: "logo" | "open-graph",
  ) => {
    if (!raw || assets.size >= MAX_ASSETS) return;
    try {
      const url = new URL(raw, document.baseURI);
      if (url.protocol === "http:" || url.protocol === "https:") {
        url.hash = "";
        assets.set(url.href, {
          url: url.href,
          kind,
          ...(role ? { role } : {}),
        });
      }
    } catch {
      return;
    }
  };
  for (const image of document.querySelectorAll("img")) {
    if (assets.size >= MAX_ASSETS) break;
    const identity = `${image.getAttribute("alt") ?? ""} ${image.getAttribute("class") ?? ""} ${image.id}`;
    addAsset(
      image.currentSrc || image.src,
      "image",
      /logo|wordmark|brandmark/i.test(identity) ? "logo" : undefined,
    );
  }
  for (const video of document.querySelectorAll("video")) {
    if (assets.size >= MAX_ASSETS) break;
    addAsset(video.currentSrc || video.src, "video");
  }
  for (const audio of document.querySelectorAll("audio")) {
    if (assets.size >= MAX_ASSETS) break;
    addAsset(audio.currentSrc || audio.src, "audio");
  }
  for (const script of document.querySelectorAll("script[src]")) {
    if (assets.size >= MAX_ASSETS) break;
    addAsset(script.getAttribute("src"), "script");
  }
  for (const link of document.querySelectorAll("link[href]")) {
    if (assets.size >= MAX_ASSETS) break;
    const rel = link.getAttribute("rel") ?? "";
    const icon = /icon/i.test(rel);
    addAsset(
      link.getAttribute("href"),
      icon ? "image" : /font|preload/i.test(rel) ? "font" : "stylesheet",
      icon ? "logo" : undefined,
    );
  }
  for (const meta of document.querySelectorAll(
    'meta[property="og:image"],meta[property="og:image:url"],meta[name="twitter:image"]',
  )) {
    if (assets.size >= MAX_ASSETS) break;
    addAsset(meta.getAttribute("content"), "image", "open-graph");
  }
  for (const anchor of document.querySelectorAll("a[href]")) {
    if (links.size >= MAX_LINKS) break;
    try {
      const url = new URL(anchor.getAttribute("href") ?? "", document.baseURI);
      if (url.origin === location.origin) {
        url.hash = "";
        links.add(url.href);
      }
    } catch {
      continue;
    }
  }
  const rootStyle = getComputedStyle(document.documentElement);
  let variableCount = 0;
  for (const name of rootStyle) {
    if (name.startsWith("--")) {
      const value = rootStyle.getPropertyValue(name).trim();
      if (value) {
        cssVariables[name] = value;
        variableCount++;
        if (variableCount >= MAX_VARIABLES) break;
      }
    }
  }

  const bodyStyle = document.body
    ? recordComputedStyle(document.body)
    : undefined;
  const rootBackground = opaqueValue(rootStyle.backgroundColor);
  const bodyBackground = bodyStyle
    ? opaqueValue(bodyStyle.backgroundColor)
    : undefined;
  const headingStyle = styleFor("h1, h2, h3", "heading");
  const textStyle = styleFor("p, li, label, body", "body");
  const buttonStyle = styleFor(
    'button, [role="button"], input[type="submit"], a[class*="button" i], a[class*="cta" i]',
    "button",
  );
  const linkStyle = styleFor("a[href]", "link");
  const cardStyle = styleFor(
    'article, [class*="card" i], [class*="panel" i], [class*="surface" i], section',
    "card",
  );
  styleFor("input, textarea, select", "input");
  styleFor("nav, header", "nav");
  styleFor('main, [class*="hero" i]', "hero");

  const setSemantic = (
    role: keyof NonNullable<
      WebsiteExtraction["designTokens"]["semanticColors"]
    >,
    value: string | undefined,
  ): void => {
    if (value) semanticColors[role] = value;
  };
  setSemantic("background", bodyBackground ?? rootBackground);
  setSemantic(
    "surface",
    cardStyle ? opaqueValue(cardStyle.backgroundColor) : undefined,
  );
  setSemantic("text", textStyle ? opaqueValue(textStyle.color) : undefined);
  const mutedElement = firstVisible("small, figcaption, [class*='muted' i]");
  setSemantic(
    "textMuted",
    mutedElement
      ? opaqueValue(getComputedStyle(mutedElement).color)
      : undefined,
  );
  setSemantic(
    "accent",
    linkStyle
      ? opaqueValue(linkStyle.color)
      : buttonStyle
        ? opaqueValue(buttonStyle.backgroundColor)
        : undefined,
  );
  setSemantic(
    "primary",
    buttonStyle
      ? (opaqueValue(buttonStyle.backgroundColor) ??
          opaqueValue(buttonStyle.color))
      : colors[0],
  );
  setSemantic(
    "secondary",
    semanticColors.surface ?? colors[1] ?? semanticColors.background,
  );

  const layoutElement = firstVisible("main, [role='main'], body > div");
  const layoutStyle = layoutElement
    ? getComputedStyle(layoutElement)
    : undefined;
  const layoutRect = layoutElement?.getBoundingClientRect();
  const layout = {
    contentWidth:
      layoutStyle?.maxWidth && layoutStyle.maxWidth !== "none"
        ? layoutStyle.maxWidth
        : layoutRect && layoutRect.width > 0
          ? `${Math.round(layoutRect.width)}px`
          : undefined,
    pagePadding:
      bodyStyle?.padding && bodyStyle.padding !== "0px"
        ? bodyStyle.padding
        : undefined,
    sectionGap:
      firstVisible("section, article") &&
      getComputedStyle(firstVisible("section, article")!).gap !== "normal" &&
      getComputedStyle(firstVisible("section, article")!).gap !== "0px"
        ? getComputedStyle(firstVisible("section, article")!).gap
        : undefined,
  };

  const elements = Array.from(document.querySelectorAll("body *"))
    .filter(visible)
    .slice(0, 700);
  for (const element of elements) {
    recordComputedStyle(element);
  }
  return {
    title: document.title,
    text: (document.body?.innerText ?? "").slice(0, MAX_TEXT),
    assets: [...assets.values()],
    internalLinks: [...links],
    designTokens: {
      colors,
      typography: [...typography.values()],
      spacing: [...spacing],
      radii: [...radii],
      cssVariables,
      semanticColors,
      shadows: [...shadows],
      backgrounds: [...backgrounds],
      components,
      layout,
    },
  };
}

export function boundWebsiteExtraction(
  extraction: WebsiteExtraction,
): WebsiteExtraction {
  const boundedComponents = extraction.designTokens.components
    ?.slice(0, MAX_COMPONENT_STYLES)
    .map((component) =>
      Object.fromEntries(
        Object.entries(component).map(([key, value]) => [
          key,
          typeof value === "string" ? value.slice(0, 500) : value,
        ]),
      ),
    ) as WebsiteExtraction["designTokens"]["components"];
  return {
    title: normalizeWhitespace(extraction.title).slice(0, 500),
    text: normalizeWhitespace(extraction.text).slice(
      0,
      MAX_RENDERED_TEXT_CHARS,
    ),
    assets: extraction.assets.slice(0, MAX_EXTRACTED_ASSETS).map((asset) => ({
      ...asset,
      url: asset.url.slice(0, 4_096),
    })),
    internalLinks: extraction.internalLinks
      .slice(0, MAX_INTERNAL_LINKS)
      .map((url) => url.slice(0, 4_096)),
    designTokens: {
      colors: extraction.designTokens.colors.slice(0, MAX_COLORS),
      typography: extraction.designTokens.typography.slice(0, MAX_TYPOGRAPHY),
      spacing: extraction.designTokens.spacing.slice(0, MAX_SPACING),
      radii: extraction.designTokens.radii.slice(0, MAX_RADII),
      cssVariables: Object.fromEntries(
        Object.entries(extraction.designTokens.cssVariables)
          .slice(0, MAX_CSS_VARIABLES)
          .map(([name, value]) => [name.slice(0, 500), value.slice(0, 4_096)]),
      ),
      ...(extraction.designTokens.semanticColors
        ? {
            semanticColors: Object.fromEntries(
              Object.entries(extraction.designTokens.semanticColors)
                .filter(([, value]) => typeof value === "string" && value)
                .map(([name, value]) => [name, value.slice(0, 200)]),
            ),
          }
        : {}),
      ...(extraction.designTokens.shadows
        ? {
            shadows: extraction.designTokens.shadows
              .slice(0, 32)
              .map((value) => value.slice(0, 500)),
          }
        : {}),
      ...(extraction.designTokens.backgrounds
        ? {
            backgrounds: extraction.designTokens.backgrounds
              .slice(0, 32)
              .map((value) => value.slice(0, 500)),
          }
        : {}),
      ...(boundedComponents ? { components: boundedComponents } : {}),
      ...(extraction.designTokens.layout
        ? {
            layout: Object.fromEntries(
              Object.entries(extraction.designTokens.layout)
                .filter(([, value]) => typeof value === "string" && value)
                .map(([name, value]) => [name, value.slice(0, 200)]),
            ),
          }
        : {}),
    },
  };
}

function emptyExtraction(): WebsiteExtraction {
  return {
    title: "",
    text: "",
    assets: [],
    internalLinks: [],
    designTokens: {
      colors: [],
      typography: [],
      spacing: [],
      radii: [],
      cssVariables: {},
    },
  };
}

function classifyWebsite(
  extraction: WebsiteExtraction,
  finalUrl: string,
): RenderedPageResult["classification"] {
  const path = new URL(finalUrl).pathname.replace(/\/+$/, "") || "/";
  const sample =
    `${extraction.title} ${extraction.text.slice(0, 2_000)}`.toLowerCase();
  if (path === "/") return "homepage";
  if (/\b(api|docs?|guide|reference|tutorial)\b/.test(sample)) {
    return "documentation";
  }
  if (/\b(blog|article|news|author|published)\b/.test(sample)) return "content";
  if (/\b(pricing|features|customers|solutions|product)\b/.test(sample)) {
    return "marketing";
  }
  return "unknown";
}

function boundedTimeout(value: number | undefined): number {
  return Number.isFinite(value)
    ? Math.max(1_000, Math.min(120_000, Math.floor(value!)))
    : 30_000;
}

function boundedScreenshot(value: Uint8Array): Uint8Array | undefined {
  return value.byteLength <= MAX_SCREENSHOT_BYTES ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

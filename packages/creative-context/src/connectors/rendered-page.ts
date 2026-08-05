import { randomUUID } from "node:crypto";

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
}

interface PlaywrightRouteLike {
  request(): PlaywrightRequestLike;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
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
}

interface PlaywrightBrowserLike {
  contexts(): PlaywrightContextLike[];
  newContext(): Promise<PlaywrightContextLike>;
  close(): Promise<void>;
}

interface PlaywrightLike {
  chromium: {
    connectOverCDP(endpoint: string): Promise<PlaywrightBrowserLike>;
    launch(options: { headless: boolean }): Promise<PlaywrightBrowserLike>;
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
        const wsUrl = stringValue(connection.wsUrl);
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

async function renderWithPlaywright(
  playwright: PlaywrightLike,
  request: RenderedPageRequest,
  warnings: string[],
  method: "builder-browser" | "local-playwright" | "attached-chrome",
  wsUrl?: string,
): Promise<RenderedPageResult> {
  const browser = wsUrl
    ? await playwright.chromium.connectOverCDP(wsUrl)
    : await playwright.chromium.launch({ headless: true });
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await installNavigationGuard(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(request.url, {
      timeout: boundedTimeout(request.timeoutMs),
      waitUntil: request.waitUntil ?? "domcontentloaded",
    });
    const finalUrl = page.url();
    await assertPublicBrowserUrl(finalUrl);
    const [title, text, desktopScreenshot, extraction] = await Promise.all([
      page.title().catch(() => ""),
      page
        .locator("body")
        .innerText()
        .catch(() => ""),
      page
        .screenshot({ type: "png", fullPage: false })
        .then(boundedScreenshot)
        .catch(() => undefined),
      page
        .evaluate(captureRenderedWebsiteContext)
        .catch(() => emptyExtraction()),
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileScreenshot = await page
      .screenshot({ type: "png", fullPage: false })
      .then(boundedScreenshot)
      .catch(() => undefined);
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
    await browser.close().catch(() => undefined);
  }
}

async function installNavigationGuard(page: PlaywrightPageLike): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    let parsed: URL;
    try {
      parsed = new URL(request.url());
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    if (parsed.protocol === "data:" || parsed.protocol === "blob:") {
      await route.continue();
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      await route.abort("blockedbyclient");
      return;
    }
    try {
      await assertPublicBrowserUrl(parsed.href);
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
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

async function loadOptionalPlaywright(): Promise<PlaywrightLike | null> {
  const specifier = "playwright";
  try {
    return (await import(specifier)) as PlaywrightLike;
  } catch {
    return null;
  }
}

function captureRenderedWebsiteContext(): WebsiteExtraction {
  const MAX_ASSETS = 500;
  const MAX_LINKS = 500;
  const MAX_COLOR_VALUES = 256;
  const MAX_TYPE_STYLES = 100;
  const MAX_SPACING_VALUES = 100;
  const MAX_RADIUS_VALUES = 64;
  const MAX_VARIABLES = 128;
  const MAX_TEXT = 2_000_000;
  const assets = new Map<string, WebsiteExtraction["assets"][number]>();
  const links = new Set<string>();
  const colors: string[] = [];
  const typography = new Map<
    string,
    WebsiteExtraction["designTokens"]["typography"][number]
  >();
  const spacing = new Set<string>();
  const radii = new Set<string>();
  const cssVariables: Record<string, string> = {};
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
  const elements = Array.from(document.querySelectorAll("body *")).slice(
    0,
    500,
  );
  for (const element of elements) {
    const style = getComputedStyle(element);
    if (colors.length < MAX_COLOR_VALUES) {
      colors.push(
        style.color,
        style.backgroundColor,
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor,
      );
    }
    const type = {
      family: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
    };
    if (typography.size < MAX_TYPE_STYLES) {
      typography.set(JSON.stringify(type), type);
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
    },
  };
}

export function boundWebsiteExtraction(
  extraction: WebsiteExtraction,
): WebsiteExtraction {
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

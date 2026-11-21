import {
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "@agent-native/core/extensions/url-safety";
import { downscaleImageToFit } from "@agent-native/core/ingestion";

import {
  buildFigmaSvgDocument,
  figmaSvgSceneExtent,
  collectRawFigmaSvgScene,
  hydrateRawFigmaSvgNode,
  type FigmaSvgExportReport,
  type FigmaSvgNode,
  type RawFigmaSvgNode,
  type RawFigmaSvgSceneResult,
} from "../../shared/figma-svg-scene.js";
import { importPlaywright, launchChromium } from "./playwright-runtime.js";

export * from "../../shared/figma-svg-scene.js";

export const MAX_EMBEDDED_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOWNSCALE_INPUT_MULTIPLE = 8;

export type EmbeddedImage =
  | { ok: true; dataUri: string }
  | { ok: false; reason: string };
const EMBEDDED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export interface RenderFigmaSvgOptions {
  html: string;
  width: number;
  height: number;
  title?: string | null;
  rootSelector?: string | null;
  embedImages?: boolean;
}

export async function embedRemoteImages(
  node: FigmaSvgNode,
  fetchImage: (url: string) => Promise<EmbeddedImage> = fetchImageAsDataUri,
): Promise<Array<{ node: string; reason: string }>> {
  const jobs: Array<Promise<void>> = [];
  const omitted: Array<{ node: string; reason: string }> = [];

  function visit(n: FigmaSvgNode) {
    if (n.kind === "image" && n.image && /^https?:\/\//i.test(n.image.href)) {
      jobs.push(
        fetchImage(n.image.href).then((embedded) => {
          if (!n.image) return;
          if (embedded.ok) {
            n.image.href = embedded.dataUri;
            return;
          }
          n.image.href = "";
          omitted.push({
            node: n.name || n.id,
            reason: `Remote image was not embedded: ${embedded.reason}`,
          });
        }),
      );
    }
    for (const fill of n.fills ?? []) {
      if (fill.kind === "image" && /^https?:\/\//i.test(fill.href)) {
        jobs.push(
          fetchImage(fill.href).then((embedded) => {
            if (embedded.ok) {
              fill.href = embedded.dataUri;
              return;
            }
            fill.href = "";
            omitted.push({
              node: n.name || n.id,
              reason: `Remote background image was not embedded: ${embedded.reason}`,
            });
          }),
        );
      }
    }
    for (const child of n.children ?? []) visit(child);
  }
  visit(node);
  await Promise.all(jobs);
  return omitted;
}

type SafeImageFetch = typeof ssrfSafeFetch;

export async function fetchImageAsDataUri(
  url: string,
  safeFetch: SafeImageFetch = ssrfSafeFetch,
): Promise<EmbeddedImage> {
  try {
    const res = await safeFetch(
      url,
      { signal: AbortSignal.timeout(10_000) },
      { maxRedirects: 3 },
    );
    if (!res.ok)
      return { ok: false, reason: `the server answered ${res.status}` };
    const contentType = (res.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!EMBEDDED_IMAGE_MIME_TYPES.has(contentType)) {
      await res.body?.cancel().catch(() => {});
      return {
        ok: false,
        reason: `the response was ${contentType || "an unnamed type"}, not an image`,
      };
    }
    const bytes = await readImageBytes(res);
    if (!bytes) {
      return {
        ok: false,
        reason: `it is larger than the ${MAX_EMBEDDED_IMAGE_BYTES}-byte read limit`,
      };
    }
    if (bytes.byteLength <= MAX_EMBEDDED_IMAGE_BYTES) {
      return {
        ok: true,
        dataUri: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
      };
    }
    const smaller = await downscaleImageToFit({
      data: bytes,
      maxBytes: MAX_EMBEDDED_IMAGE_BYTES,
    });
    if (!smaller) {
      return {
        ok: false,
        reason: `it is ${bytes.byteLength} bytes and could not be scaled under the ${MAX_EMBEDDED_IMAGE_BYTES}-byte embed limit`,
      };
    }
    return {
      ok: true,
      dataUri: `data:${smaller.mimeType};base64,${Buffer.from(smaller.data).toString("base64")}`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: (error as Error).message || "the fetch failed",
    };
  }
}

async function readImageBytes(res: Response): Promise<Uint8Array | null> {
  const maxRead = MAX_EMBEDDED_IMAGE_BYTES * MAX_DOWNSCALE_INPUT_MULTIPLE;
  const advertisedLength = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(advertisedLength) && advertisedLength > maxRead) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await res.arrayBuffer());
    return buffer.byteLength > maxRead ? null : buffer;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxRead) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new Uint8Array(
    Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      total,
    ),
  );
}

export async function isAllowedFigmaSvgRenderRequest(
  url: string,
  isBlocked: typeof isBlockedExtensionUrlWithDns = isBlockedExtensionUrlWithDns,
): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === "data:" ||
      parsed.protocol === "blob:" ||
      parsed.protocol === "about:"
    ) {
      return true;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    return !(await isBlocked(parsed.href));
  } catch {
    return false;
  }
}

const MAX_RENDER_REDIRECTS = 5;

function isTopLevelNavigation(
  request: import("@playwright/test").Request,
): boolean {
  return (
    request.isNavigationRequest() && request.frame().parentFrame() === null
  );
}

export class RenderNavigatedAwayError extends Error {
  readonly code = "render_navigated_away" as const;
  constructor(readonly url: string) {
    super(
      "The screen navigates the page away from its own document, so it cannot be rendered. Remove the script that changes the page location.",
    );
    this.name = "RenderNavigatedAwayError";
  }
}

function throwIfNavigatedAway(blockedNavigations: string[]): void {
  const [url] = blockedNavigations;
  if (url) throw new RenderNavigatedAwayError(url);
}

export async function routeAllowedRenderRequests(
  context: import("@playwright/test").BrowserContext,
  isAllowed: (url: string) => Promise<boolean> = (url) =>
    isAllowedFigmaSvgRenderRequest(url),
  safeFetch: SafeImageFetch = ssrfSafeFetch,
): Promise<{ blockedNavigations: string[] }> {
  const blockedNavigations: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (isTopLevelNavigation(request)) {
      blockedNavigations.push(request.url());
      await route.abort("blockedbyclient");
      return;
    }
    if (!(await isAllowed(request.url()))) {
      await route.abort("blockedbyclient");
      return;
    }
    if (!/^https?:/i.test(request.url())) {
      await route.continue();
      return;
    }
    const method = request.method();
    const headers = new Headers(request.headers());
    for (const name of [
      "host",
      "content-length",
      "connection",
      "accept-encoding",
    ]) {
      headers.delete(name);
    }
    const postData = request.postDataBuffer();
    let response: Response;
    try {
      response = await safeFetch(
        request.url(),
        {
          method,
          headers,
          ...(postData && method !== "GET" && method !== "HEAD"
            ? { body: new Uint8Array(postData) }
            : {}),
          signal: AbortSignal.timeout(30_000),
        },
        {
          maxRedirects: MAX_RENDER_REDIRECTS,
          requireDispatcher: true,
          assertUrlAllowed: async (hopUrl) => {
            if (!(await isAllowed(hopUrl))) {
              throw new Error(`Render request blocked (${hopUrl})`);
            }
          },
        },
      );
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    try {
      const body = Buffer.from(await response.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        if (
          name === "content-encoding" ||
          name === "content-length" ||
          name === "transfer-encoding"
        ) {
          return;
        }
        responseHeaders[name] = value;
      });
      await route.fulfill({
        status: response.status,
        headers: responseHeaders,
        body,
      });
    } catch {
      await route.abort("failed");
    }
  });
  return { blockedNavigations };
}

async function rasterizeUnsupportedNodes(
  page: import("@playwright/test").Page,
  node: RawFigmaSvgNode,
  originOffset: { x: number; y: number },
): Promise<void> {
  if (node.rasterReason && !node.rasterHref) {
    const viewport = page.viewportSize();
    const pageRight = viewport ? viewport.width : Number.POSITIVE_INFINITY;
    const pageBottom = viewport ? viewport.height : Number.POSITIVE_INFINITY;
    const x0 = Math.max(0, node.rect.x + originOffset.x);
    const y0 = Math.max(0, node.rect.y + originOffset.y);
    const x1 = Math.min(
      pageRight,
      node.rect.x + originOffset.x + node.rect.width,
    );
    const y1 = Math.min(
      pageBottom,
      node.rect.y + originOffset.y + node.rect.height,
    );
    const clip = {
      x: x0,
      y: y0,
      width: Math.max(1, Math.round(x1 - x0)),
      height: Math.max(1, Math.round(y1 - y0)),
    };
    try {
      const png = await page.screenshot({ clip, type: "png" });
      node.rasterHref = `data:image/png;base64,${png.toString("base64")}`;
      node.rect = {
        x: x0 - originOffset.x,
        y: y0 - originOffset.y,
        width: clip.width,
        height: clip.height,
      };
    } catch {
      // Leave rasterHref unset — hydrateRawFigmaSvgNode falls back to an
      // empty href, and the export report still names the node as
      // rasterized (with its reason) so the caller knows what's missing.
    }
  }
  for (const child of node.children) {
    await rasterizeUnsupportedNodes(page, child, originOffset);
  }
}

export class FigmaSvgRootSelectorNotFoundError extends Error {
  readonly rootSelector: string;
  constructor(rootSelector: string) {
    super(`No element matched rootSelector "${rootSelector}"`);
    this.name = "FigmaSvgRootSelectorNotFoundError";
    this.rootSelector = rootSelector;
  }
}

export function isMissingRootSelectorError(
  err: unknown,
): err is FigmaSvgRootSelectorNotFoundError {
  return err instanceof FigmaSvgRootSelectorNotFoundError;
}

export async function renderDesignToFigmaSvg(
  options: RenderFigmaSvgOptions,
): Promise<{
  svg: string;
  report: FigmaSvgExportReport;
  scene: FigmaSvgNode;
}> {
  const playwright = await importPlaywright();
  const browser = await launchChromium(playwright.chromium);
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
    });
    await context.routeWebSocket("**/*", (ws) => {
      void ws.close();
    });
    await context.addInitScript(
      "globalThis.__name = globalThis.__name || function (value) { return value; };",
    );
    const requests = await routeAllowedRenderRequests(context);
    const page = await context.newPage();
    try {
      await page.setContent(options.html, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      throwIfNavigatedAway(requests.blockedNavigations);

      const scene = (await page.evaluate(
        collectRawFigmaSvgScene,
        options.rootSelector ?? null,
      )) as RawFigmaSvgSceneResult | null;
      if (!scene) {
        if (options.rootSelector) {
          throw new FigmaSvgRootSelectorNotFoundError(options.rootSelector);
        }
        throw new Error("Design screen has no renderable content");
      }

      await rasterizeUnsupportedNodes(page, scene.root, scene.originOffset);

      const root = hydrateRawFigmaSvgNode(scene.root);
      const embeddedImageOmissions = options.embedImages
        ? await embedRemoteImages(root)
        : [];

      const wholeScreen = !options.rootSelector;
      const frameWidth = wholeScreen ? options.width : root.rect.width;
      const frameHeight = wholeScreen ? options.height : root.rect.height;
      const extent = figmaSvgSceneExtent(root);
      const result = buildFigmaSvgDocument({
        width: Math.max(frameWidth, extent.right),
        height: Math.max(frameHeight, extent.bottom),
        title: options.title,
        root,
      });
      result.report.omitted.push(...embeddedImageOmissions);
      return { ...result, scene: root };
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

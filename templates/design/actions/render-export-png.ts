import { defineAction, fail } from "@agent-native/core/action";
import { imageSize } from "image-size";
import { parse as parseHtml } from "parse5";
import { z } from "zod";

import {
  importPlaywright,
  launchChromium,
} from "../server/lib/playwright-runtime.js";

const MAX_RENDER_SIDE = 16_384;
const MAX_RENDER_PIXELS = 64 * 1024 * 1024;
const MAX_RENDER_REQUEST_BYTES = 5_000_000;
const MAX_RENDER_RESPONSE_BYTES = 20_000_000;
const MAX_RENDER_DURATION_MS = 45_000;
const MAX_DATA_IMAGE_PIXELS = 32 * 1024 * 1024;
const MAX_DATA_RESOURCES = 256;
const MAX_DATA_RESOURCE_BYTES = 4_000_000;
// ponytail: process-wide cap; add per-account admission if measured throughput needs it.
const MAX_CONCURRENT_RENDER_REQUESTS = 2;

type Browser = import("@playwright/test").Browser;
type BrowserContext = import("@playwright/test").BrowserContext;

class RenderDeadlineExceededError extends Error {}

class ChromiumUnavailableError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Chromium is unavailable for Design export.");
    this.name = "ChromiumUnavailableError";
    this.cause = cause;
  }
}

interface SharedBrowserEntry {
  promise: Promise<Browser>;
  browser?: Browser;
  activeRequests: number;
  closeWhenReady: boolean;
}

interface SharedBrowserLease {
  promise: Promise<Browser>;
  release: (abandoned: boolean) => void;
}

let sharedBrowser: SharedBrowserEntry | null = null;
let activeRenderRequests = 0;

function acquireRenderSlot(): () => void {
  if (activeRenderRequests >= MAX_CONCURRENT_RENDER_REQUESTS) {
    fail("PNG export renderer is busy.", {
      errorCode: "export_render_busy",
      statusCode: 503,
    });
  }
  activeRenderRequests += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeRenderRequests -= 1;
  };
}

function evictBrowser(entry: SharedBrowserEntry): void {
  if (sharedBrowser === entry) sharedBrowser = null;
}

function closeBrowserQuietly(browser: Browser): void {
  try {
    void browser.close().catch(() => {});
  } catch {
    // coercion-ok: Browser shutdown is best effort; it must not mask export outcome.
    // The browser may already be shutting down.
  }
}

function closeUnusedBrowser(entry: SharedBrowserEntry): void {
  if (entry.activeRequests > 0 || !entry.closeWhenReady || !entry.browser) {
    return;
  }
  entry.closeWhenReady = false;
  evictBrowser(entry);
  closeBrowserQuietly(entry.browser);
}

function acquireBrowser(): SharedBrowserLease {
  let entry = sharedBrowser;
  if (entry?.browser && !entry.browser.isConnected()) {
    evictBrowser(entry);
    entry = null;
  }
  if (!entry) {
    const nextEntry: SharedBrowserEntry = {
      promise: Promise.resolve().then(async () => {
        try {
          const playwright = await importPlaywright();
          const browser = await launchChromium(playwright.chromium);
          nextEntry.browser = browser;
          browser.on("disconnected", () => evictBrowser(nextEntry));
          closeUnusedBrowser(nextEntry);
          return browser;
        } catch (error) {
          evictBrowser(nextEntry);
          throw new ChromiumUnavailableError(error);
        }
      }),
      activeRequests: 0,
      closeWhenReady: false,
    };
    sharedBrowser = nextEntry;
    void nextEntry.promise.catch(() => {});
    entry = nextEntry;
  }

  entry.activeRequests += 1;
  entry.closeWhenReady = false;
  let released = false;
  return {
    promise: entry.promise,
    release(abandoned) {
      if (released) return;
      released = true;
      entry.activeRequests -= 1;
      if (abandoned) {
        entry.closeWhenReady = true;
        evictBrowser(entry);
      }
      closeUnusedBrowser(entry);
    },
  };
}

function assertRasterSize(width: number, height: number, scale: number): void {
  const rasterWidth = Math.ceil(width * scale);
  const rasterHeight = Math.ceil(height * scale);
  if (
    rasterWidth > MAX_RENDER_SIDE ||
    rasterHeight > MAX_RENDER_SIDE ||
    rasterWidth * rasterHeight > MAX_RENDER_PIXELS
  ) {
    fail("PNG export exceeds the maximum raster size.", {
      errorCode: "export_too_large",
      statusCode: 413,
    });
  }
}

function readPngDimensions(png: Buffer): { width: number; height: number } {
  if (
    png.length < 24 ||
    png[0] !== 0x89 ||
    png.toString("ascii", 1, 4) !== "PNG" ||
    png.toString("ascii", 12, 16) !== "IHDR"
  ) {
    // guard:allow-bare-error — invariant: Chromium screenshots must be valid PNGs.
    throw new Error("PNG export renderer returned an invalid image.");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

type SnapshotHtmlNode = {
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: SnapshotHtmlNode[];
  content?: { childNodes?: SnapshotHtmlNode[] };
  value?: string;
};

function addDataUrls(value: string, urls: Set<string>): void {
  const wholeValue = value.trim();
  if (wholeValue.toLowerCase().startsWith("data:")) {
    urls.add(dataUrlKey(wholeValue));
    if (urls.size > MAX_DATA_RESOURCES) {
      fail("PNG export contains too many embedded resources.", {
        errorCode: "export_too_large",
        statusCode: 413,
      });
    }
    return;
  }

  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (value.slice(index, index + 5).toLowerCase() === "data:") {
      let end = index + 5;
      while (end < value.length) {
        const next = value[end];
        if (quote ? next === quote : /[\s"'()<>]/.test(next)) break;
        end += 1;
      }
      urls.add(dataUrlKey(value.slice(index, end)));
      index = end - 1;
      if (urls.size > MAX_DATA_RESOURCES) {
        fail("PNG export contains too many embedded resources.", {
          errorCode: "export_too_large",
          statusCode: 413,
        });
      }
    }
  }
}

function findSnapshotDataUrls(html: string): string[] {
  const urls = new Set<string>();
  const add = (value: string) => addDataUrls(value, urls);
  const stack = [parseHtml(html) as unknown as SnapshotHtmlNode];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const attribute of node.attrs ?? []) {
      add(attribute.value);
    }
    if (node.tagName?.toLowerCase() === "style") {
      add((node.childNodes ?? []).map((child) => child.value ?? "").join(""));
    }
    stack.push(...(node.childNodes ?? []), ...(node.content?.childNodes ?? []));
  }
  return [...urls];
}

function dataUrlKey(url: string): string {
  const fragment = url.indexOf("#");
  const withoutFragment = fragment < 0 ? url : url.slice(0, fragment);
  const comma = withoutFragment.indexOf(",");
  if (comma < 0) return withoutFragment.toLowerCase();
  return `${withoutFragment.slice(0, comma).toLowerCase()}${withoutFragment.slice(comma)}`;
}

function decodeDataUrl(url: string): {
  mimeType: string;
  bytes: Buffer;
} | null {
  const comma = url.indexOf(",");
  if (!url.toLowerCase().startsWith("data:") || comma < 0) return null;
  const [mimeType, ...parameters] = url.slice(5, comma).split(";");
  const payload = url.slice(comma + 1);
  const isBase64 = parameters.some(
    (parameter) => parameter.toLowerCase() === "base64",
  );
  if (isBase64 && !/^[\da-z+/=_-]*$/i.test(payload)) return null;
  const bytes = isBase64
    ? Buffer.from(payload, "base64")
    : decodePercentEncodedBytes(payload);
  if (!bytes) return null;
  return { mimeType: (mimeType || "text/plain").toLowerCase(), bytes };
}

function decodePercentEncodedBytes(value: string): Buffer | null {
  const bytes = Buffer.allocUnsafe(Buffer.byteLength(value));
  let offset = 0;
  for (let index = 0; index < value.length; ) {
    if (value[index] === "%") {
      const byte = value.slice(index + 1, index + 3);
      if (!/^[\da-f]{2}$/i.test(byte)) return null;
      bytes[offset++] = Number.parseInt(byte, 16);
      index += 3;
      continue;
    }
    const codePoint = value.codePointAt(index)!;
    offset += Buffer.from(String.fromCodePoint(codePoint)).copy(bytes, offset);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return bytes.subarray(0, offset);
}

function readImageDimensions(bytes: Buffer): {
  type?: string;
  width: number;
  height: number;
} | null {
  try {
    return imageSize(bytes);
  } catch {
    // coercion-ok: the caller turns missing dimensions into a typed export failure.
    return null;
  }
}

function validateEmbeddedDataResources(html: string): Set<string> {
  const safeUrls = new Set<string>();
  const pendingUrls = findSnapshotDataUrls(html);
  const seenUrls = new Set<string>();
  let totalImagePixels = 0;

  while (pendingUrls.length > 0) {
    const url = pendingUrls.pop()!;
    const key = dataUrlKey(url);
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    if (seenUrls.size > MAX_DATA_RESOURCES) {
      fail("PNG export contains too many embedded resources.", {
        errorCode: "export_too_large",
        statusCode: 413,
      });
    }

    const resource = decodeDataUrl(key);
    if (!resource) {
      fail("PNG export snapshot contains an invalid embedded resource.", {
        errorCode: "export_resources_unavailable",
        statusCode: 424,
      });
    }
    if (
      resource.mimeType.startsWith("font/") ||
      /^application\/(?:font-|x-font-|vnd\.ms-fontobject)/.test(
        resource.mimeType,
      )
    ) {
      if (resource.bytes.byteLength > MAX_DATA_RESOURCE_BYTES) {
        fail("PNG export contains an embedded resource over the 4 MB limit.", {
          errorCode: "export_too_large",
          statusCode: 413,
        });
      }
      safeUrls.add(key);
      continue;
    }
    if (resource.mimeType === "text/css") {
      if (resource.bytes.byteLength > MAX_DATA_RESOURCE_BYTES) {
        fail("PNG export contains an embedded resource over the 4 MB limit.", {
          errorCode: "export_too_large",
          statusCode: 413,
        });
      }
      safeUrls.add(key);
      const nestedUrls = new Set<string>();
      addDataUrls(resource.bytes.toString("utf8"), nestedUrls);
      pendingUrls.push(...nestedUrls);
      continue;
    }
    if (!resource.mimeType.startsWith("image/")) continue;

    const dimensions = readImageDimensions(resource.bytes);
    const expectedType =
      resource.mimeType === "image/jpeg"
        ? "jpg"
        : resource.mimeType === "image/svg+xml"
          ? "svg"
          : resource.mimeType.slice("image/".length);
    if (
      !dimensions ||
      dimensions.type !== expectedType ||
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      !Number.isSafeInteger(dimensions.width) ||
      !Number.isSafeInteger(dimensions.height)
    ) {
      fail(
        "PNG export snapshot contains an image format that cannot be safely checked.",
        {
          errorCode: "export_resources_unavailable",
          statusCode: 424,
        },
      );
    }
    const imagePixels = dimensions.width * dimensions.height;
    totalImagePixels += imagePixels;
    if (
      dimensions.width > MAX_RENDER_SIDE ||
      dimensions.height > MAX_RENDER_SIDE ||
      imagePixels > MAX_DATA_IMAGE_PIXELS ||
      totalImagePixels > MAX_DATA_IMAGE_PIXELS
    ) {
      fail(
        "PNG export contains embedded images over the 32 megapixel decode limit.",
        {
          errorCode: "export_too_large",
          statusCode: 413,
        },
      );
    }
    safeUrls.add(key);
    if (dimensions.type === "svg") {
      pendingUrls.push(
        ...findSnapshotDataUrls(resource.bytes.toString("utf8")),
      );
    }
  }

  return safeUrls;
}

export default defineAction({
  description: "Render a self-contained Design export snapshot as a PNG.",
  schema: z.object({
    html: z.string().min(1),
    width: z.number().int().min(1).max(MAX_RENDER_SIDE),
    height: z.number().int().min(1).max(MAX_RENDER_SIDE),
    scale: z.number().min(0.1).max(4),
    clip: z
      .object({
        x: z.number().min(0),
        y: z.number().min(0),
        width: z.number().min(1).max(MAX_RENDER_SIDE),
        height: z.number().min(1).max(MAX_RENDER_SIDE),
      })
      .optional(),
  }),
  readOnly: true,
  uiOnly: true,
  agentTool: false,
  maxBodyBytes: MAX_RENDER_REQUEST_BYTES,
  http: { method: "POST" },
  run: async ({ html, width, height, scale, clip }) => {
    assertRasterSize(width, height, scale);
    if (clip) assertRasterSize(clip.width, clip.height, scale);
    const safeDataResources = validateEmbeddedDataResources(html);

    const releaseRenderSlot = acquireRenderSlot();
    const lease = acquireBrowser();
    let context: BrowserContext | undefined;
    let contextClose: Promise<void> | undefined;
    let timedOut = false;
    const closeContext = (): Promise<void> => {
      if (!context) return Promise.resolve();
      contextClose ??= context.close();
      return contextClose;
    };
    const throwIfTimedOut = (): void => {
      if (timedOut) throw new RenderDeadlineExceededError();
    };

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        void closeContext().catch(() => {});
        lease.release(true);
        reject(new RenderDeadlineExceededError());
      }, MAX_RENDER_DURATION_MS);
    });

    const render = async (): Promise<Response> => {
      let operationFailed = false;
      try {
        const browser = await lease.promise;
        throwIfTimedOut();

        context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: scale,
          javaScriptEnabled: false,
          serviceWorkers: "block",
        });
        if (timedOut) {
          void closeContext().catch(() => {});
          throw new RenderDeadlineExceededError();
        }

        const externalRequests: string[] = [];
        let rejectedDataRequests = 0;
        await context.route("**/*", async (route) => {
          const url = route.request().url();
          if (url.toLowerCase().startsWith("data:")) {
            if (!safeDataResources.has(dataUrlKey(url))) {
              rejectedDataRequests += 1;
              await route.abort("blockedbyclient");
              return;
            }
            await route.continue();
            return;
          }
          if (url === "about:blank") {
            await route.continue();
            return;
          }
          externalRequests.push(url);
          await route.abort("blockedbyclient");
        });
        await context.routeWebSocket("**/*", () => {});
        throwIfTimedOut();

        const page = await context.newPage();
        await page.setContent(html, { waitUntil: "load" });
        throwIfTimedOut();
        await page.evaluate(async () => {
          await Promise.race([
            document.fonts.ready,
            new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
          ]);
          await Promise.all(
            Array.from(document.images, (image) =>
              image.decode().catch(() => undefined),
            ),
          );
        });
        throwIfTimedOut();

        const missingResources = await page.evaluate(() => {
          const root = document.documentElement;
          return {
            marker: root.getAttribute(
              "data-agent-native-export-resource-failures",
            ),
            brokenImages: Array.from(document.images)
              .filter((image) => image.naturalWidth === 0)
              .map((image) => image.currentSrc || image.src),
            failedFonts: Array.from(document.fonts)
              .filter((font) => font.status === "error")
              .map((font) => font.family),
            loadingFonts: Array.from(document.fonts)
              .filter((font) => font.status === "loading")
              .map((font) => font.family),
          };
        });
        if (
          externalRequests.length > 0 ||
          missingResources.marker ||
          missingResources.brokenImages.length > 0 ||
          missingResources.failedFonts.length > 0 ||
          missingResources.loadingFonts.length > 0 ||
          rejectedDataRequests > 0
        ) {
          const failures = [
            `external=${externalRequests.length}`,
            `snapshot=${missingResources.marker ? 1 : 0}`,
            `images=${missingResources.brokenImages.length}`,
            `fonts=${missingResources.failedFonts.length}`,
            `loadingFonts=${missingResources.loadingFonts.length}`,
            `blockedDataResources=${rejectedDataRequests}`,
          ].join(",");
          fail(
            `PNG export snapshot has resources that could not be rendered exactly (${failures}).`,
            { errorCode: "export_resources_unavailable", statusCode: 424 },
          );
        }

        const documentSize = await page.evaluate(() => ({
          width: Math.max(
            document.documentElement.scrollWidth,
            document.body?.scrollWidth ?? 0,
            window.innerWidth,
          ),
          height: Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight ?? 0,
            window.innerHeight,
          ),
        }));
        assertRasterSize(
          clip?.width ?? documentSize.width,
          clip?.height ?? documentSize.height,
          scale,
        );
        throwIfTimedOut();

        const png = await page.screenshot({
          type: "png",
          fullPage: !clip,
          ...(clip ? { clip } : {}),
          animations: "disabled",
          omitBackground: true,
        });
        const dimensions = readPngDimensions(png);
        assertRasterSize(dimensions.width, dimensions.height, 1);
        if (png.byteLength > MAX_RENDER_RESPONSE_BYTES) {
          fail("PNG export exceeds the maximum download size.", {
            errorCode: "export_too_large",
            statusCode: 413,
          });
        }
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(png);
            controller.close();
          },
        });
        return new Response(body, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        operationFailed = true;
        throw error;
      } finally {
        if (context) {
          try {
            await closeContext();
          } catch (error) {
            if (!operationFailed) throw error;
          }
        }
      }
    };

    const renderPromise = render();
    try {
      return await Promise.race([renderPromise, deadline]);
    } catch (error) {
      if (error instanceof RenderDeadlineExceededError) {
        fail("PNG export rendering timed out after 45 seconds.", {
          errorCode: "export_render_timeout",
          statusCode: 504,
        });
      }
      if (error instanceof ChromiumUnavailableError) {
        fail("Chromium is unavailable for Design export.", {
          errorCode: "export_chromium_unavailable",
          statusCode: 503,
        });
      }
      throw error;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      lease.release(timedOut);
      if (timedOut) {
        void renderPromise.then(releaseRenderSlot, releaseRenderSlot);
      } else {
        releaseRenderSlot();
      }
    }
  },
});

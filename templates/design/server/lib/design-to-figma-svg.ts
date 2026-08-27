/**
 * design-to-figma-svg.ts — the SERVER half of the Figma SVG export: render
 * the design's stored HTML in headless Chromium (mirrors
 * `take-design-screenshot.ts`'s launch/import pattern), walk the live DOM,
 * and serialize the result into a standalone, GENUINELY VECTOR SVG document
 * that Figma imports as editable shapes — not the `foreignObject` wrapper
 * produced by `buildSvgForeignObject` in `design-export.ts` (that one
 * round-trips the live DOM/CSS for the editor's own "Download SVG" command,
 * but Figma cannot import `foreignObject` content as vectors — it stays an
 * opaque embedded HTML blob).
 *
 * The scene model, the pure scene -> SVG serializer, the raw -> scene
 * hydration, and the in-page DOM walk all live in
 * `shared/figma-svg-scene.ts`, because the editor's client-side "Copy as
 * SVG" path (`app/lib/figma-svg-copy.ts`) runs the exact same pipeline
 * against its already-rendered preview iframe. They are re-exported here so
 * this module's public API — and `design-to-figma-svg.spec.ts` /
 * `design-to-figma-svg.fidelity.spec.ts` — keep addressing one entry point.
 *
 * What stays here is everything that genuinely needs a server: Playwright,
 * SSRF-checked image fetching, and screenshot rasterization of the nodes the
 * DOM walk flagged as having no SVG equivalent.
 */

import {
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "@agent-native/core/extensions/url-safety";

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
const EMBEDDED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

// ---------------------------------------------------------------------------
// Orchestration — renders the design's HTML in headless Chromium (same
// launch/import pattern as take-design-screenshot.ts), walks the live DOM,
// hydrates the result into a FigmaSvgNode tree, and serializes it to SVG.
// ---------------------------------------------------------------------------

export interface RenderFigmaSvgOptions {
  html: string;
  width: number;
  height: number;
  title?: string | null;
  /** CSS selector to scope a subtree export (e.g. `[data-agent-native-node-id="..."]`). */
  rootSelector?: string | null;
  /** Fetch and inline http(s) image `src`/background-image URLs as data: URIs. */
  embedImages?: boolean;
}

export async function embedRemoteImages(
  node: FigmaSvgNode,
  fetchImage: (url: string) => Promise<string | null> = fetchImageAsDataUri,
): Promise<Array<{ node: string; reason: string }>> {
  const jobs: Array<Promise<void>> = [];
  const omitted: Array<{ node: string; reason: string }> = [];

  function visit(n: FigmaSvgNode) {
    if (n.kind === "image" && n.image && /^https?:\/\//i.test(n.image.href)) {
      jobs.push(
        fetchImage(n.image.href).then((dataUri) => {
          if (!n.image) return;
          if (dataUri) {
            n.image.href = dataUri;
          } else {
            n.image.href = "";
            omitted.push({
              node: n.name || n.id,
              reason: "Remote image could not be safely embedded",
            });
          }
        }),
      );
    }
    for (const fill of n.fills ?? []) {
      if (fill.kind === "image" && /^https?:\/\//i.test(fill.href)) {
        jobs.push(
          fetchImage(fill.href).then((dataUri) => {
            if (dataUri) {
              fill.href = dataUri;
            } else {
              fill.href = "";
              omitted.push({
                node: n.name || n.id,
                reason: "Remote background image could not be safely embedded",
              });
            }
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
): Promise<string | null> {
  try {
    const res = await safeFetch(
      url,
      { signal: AbortSignal.timeout(10_000) },
      { maxRedirects: 3 },
    );
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!EMBEDDED_IMAGE_MIME_TYPES.has(contentType)) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const advertisedLength = Number(res.headers.get("content-length") || 0);
    if (
      Number.isFinite(advertisedLength) &&
      advertisedLength > MAX_EMBEDDED_IMAGE_BYTES
    ) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > MAX_EMBEDDED_IMAGE_BYTES) return null;
      return `data:${contentType};base64,${buffer.toString("base64")}`;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_EMBEDDED_IMAGE_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const buffer = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      total,
    );
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
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

/**
 * Walks the RAW scene tree (before hydration) and, for every node flagged
 * `rasterReason` (video/canvas/iframe/backdrop-blur), takes a real cropped
 * screenshot of that element's exact bounds while the page is still live,
 * setting `rasterHref` to a `data:image/png` URI. Runs while `page` is still
 * open, since it needs the live rendered content — the same reason
 * `take-design-screenshot.ts` keeps its browser open for the whole capture.
 */
async function rasterizeUnsupportedNodes(
  page: import("@playwright/test").Page,
  node: RawFigmaSvgNode,
  originOffset: { x: number; y: number },
): Promise<void> {
  if (node.rasterReason && !node.rasterHref) {
    // The clip has to be INTERSECTED with the page, not just clamped at the
    // origin. A node that overhangs the viewport made Playwright return a
    // narrower bitmap than asked for, and `renderRaster` then drew that short
    // capture into the node's full-width `<image>` rect with
    // `preserveAspectRatio="none"` — stretching it sideways. Nothing compared
    // the requested clip with the bitmap that came back, so a truncated
    // screenshot rendered as a plausible-looking but wrong image.
    //
    // The intersected rect is written back onto the node so the `<image>` is
    // placed at exactly the box the pixels came from.
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

/**
 * Thrown when `rootSelector` doesn't match any element in the rendered page.
 * A dedicated, classifiable error (rather than a plain `Error` matched by
 * message text) so callers like `export-design-as-figma-svg`'s action can
 * fail SOFT — falling back to a whole-screen export with a warning — instead
 * of a raw 500, which is what happened when a caller passed a live-DOM
 * code-layer id (e.g. `html:<hash>`) that doesn't exist verbatim in the
 * persisted HTML this renders.
 */
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

/**
 * Renders `html` in headless Chromium, walks the live DOM to build a
 * `FigmaSvgNode` scene, and serializes it into a genuinely vector SVG
 * document via `buildFigmaSvgDocument`. Throws when no Chromium binary is
 * available — callers should catch and fall back (mirrors
 * `take-design-screenshot.ts`'s `chromiumUnavailableReason` pattern). Throws
 * `FigmaSvgRootSelectorNotFoundError` when `rootSelector` matches nothing —
 * callers should catch that specific error and fail soft (see
 * `isMissingRootSelectorError`).
 */
export async function renderDesignToFigmaSvg(
  options: RenderFigmaSvgOptions,
): Promise<{
  svg: string;
  report: FigmaSvgExportReport;
  /** The hydrated scene behind the SVG, so callers that want real Figma
   *  auto-layout nodes can run `buildFigmaNodeSpec` over it without paying
   *  for a second headless render. */
  scene: FigmaSvgNode;
}> {
  const playwright = await importPlaywright();
  const browser = await launchChromium(playwright.chromium);
  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
    });
    // `collectRawFigmaSvgScene` below is passed straight to `page.evaluate`,
    // which serializes it via `Function.prototype.toString()` and runs it
    // inside the page. Under esbuild's `keepNames` (on by default for
    // dev-time tsx runs of this action), every named helper function inside
    // it (`walk`, `extractTextLines`, `groupRectsByLine`, ...) gets rewritten
    // to `__name(function walk() {...}, "walk")`, and `__name` doesn't exist
    // in the page's isolated context — same root cause already fixed for
    // `packages/core/src/cli/recap.ts`'s `page.evaluate` calls (see
    // `RECAP_SHOT_NAME_SHIM`). Define it as a no-op identity function before
    // anything evaluates in the page; harmless on the tsc-built path, which
    // never emits `__name` in the first place.
    await context.addInitScript(
      "globalThis.__name = globalThis.__name || function (value) { return value; };",
    );
    // Stored HTML is untrusted input. Its <img>, CSS, font, script, and iframe
    // URLs must not turn headless Chromium into an SSRF primitive. Validate
    // every request, including redirects initiated by the browser, and fail
    // closed when DNS validation itself fails.
    await context.route("**/*", async (route) => {
      if (await isAllowedFigmaSvgRenderRequest(route.request().url())) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    try {
      await page.setContent(options.html, { waitUntil: "networkidle" });
      await page.waitForTimeout(300); // let Alpine.js / CDN Tailwind JIT settle.

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

      // Capture a real cropped screenshot for every node the DOM walk
      // flagged as unsupported (video/canvas/iframe/backdrop-blur), while
      // the page is still live — this is the "rasterize instead of fight
      // it" fallback the property-mapping matrix promises for those cases.
      await rasterizeUnsupportedNodes(page, scene.root, scene.originOffset);

      const root = hydrateRawFigmaSvgNode(scene.root);
      const embeddedImageOmissions = options.embedImages
        ? await embedRemoteImages(root)
        : [];

      // The SVG document's own width/height/viewBox must reflect the
      // EXPORTED SUBTREE's real bounds, not the Chromium viewport used to
      // lay it out — a 400x300 screen was exporting a 1440x1200 root
      // whenever the caller's render viewport didn't happen to match the
      // screen's own frame size (e.g. the action's legacy 1440x1200
      // default). `root.rect` is always relative to itself (x=0, y=0 by
      // construction — see `collectRawFigmaSvgScene`'s `originRect`
      // subtraction), so its width/height are exactly the rendered root
      // element's own bounding box, honest regardless of viewport size.
      //
      // That reasoning holds for a SUBTREE export. A WHOLE-SCREEN export is
      // sized by the screen frame instead, because the root is then `<body>`,
      // whose box is not the frame: any design that centres or pads its
      // artboard — every design derived from the built-in template presets
      // does, via `body { display:grid; place-items:center; padding:24px }` —
      // gave `<body>` a 1080x1128 box for a 1080x1080 screen, so the export
      // came out over-tall with the artboard inset and overflowing its edge.
      const wholeScreen = !options.rootSelector;
      const frameWidth = wholeScreen ? options.width : root.rect.width;
      const frameHeight = wholeScreen ? options.height : root.rect.height;
      // Cover what the design actually draws past the frame's right/bottom
      // edges; an SVG root clips to its viewBox, so a frame-sized artboard
      // dropped that content on the way to Figma.
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

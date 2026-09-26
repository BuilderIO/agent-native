
import { defineAction } from "@agent-native/core/action";
import { uploadFile } from "@agent-native/core/file-upload";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isAllowedFigmaSvgRenderRequest } from "../server/lib/design-to-figma-svg.js";
import { readLiveSourceFile } from "../server/source-workspace.js";
import "../server/db/index.js";


export interface ScreenshotViewport {
  label: string;
  widthPx: number;
  heightPx: number;
}

export interface DiagnosticsOverflowEntry {
  selector: string;
  overflowPx: number;
  kind: "viewport-horizontal" | "container";
}

export interface DiagnosticsContrastEntry {
  selector: string;
  text: string;
  ratio: number;
  requiredRatio: number;
  foreground: string;
  background: string;
}

export interface DiagnosticsZeroSizeEntry {
  selector: string;
  reason: "zero-size" | "off-screen";
}

export interface ScreenshotDiagnostics {
  viewport: ScreenshotViewport;
  documentWidthPx: number;
  documentHeightPx: number;
  horizontalOverflowPx: number;
  overflowingElements: DiagnosticsOverflowEntry[];
  lowContrastText: DiagnosticsContrastEntry[];
  brokenImages: string[];
  fontLoadFailures: string[];
  consoleErrors: string[];
  zeroSizeOrOffscreen: DiagnosticsZeroSizeEntry[];
}

export type ScreenshotUploadError =
  | {
      code: "file_storage_not_configured";
      message: string;
    }
  | {
      code: "file_upload_failed";
      message: string;
    };

export interface ScreenshotResult {
  viewport: ScreenshotViewport;
  url: string;
  persisted: boolean;
  uploadError?: ScreenshotUploadError;
  bytes: number;
  diagnostics: ScreenshotDiagnostics;
}


const DEFAULT_VIEWPORTS: ScreenshotViewport[] = [
  { label: "desktop", widthPx: 1280, heightPx: 800 },
  { label: "mobile", widthPx: 375, heightPx: 812 },
];

function heightForWidth(widthPx: number): number {
  if (widthPx <= 480) return Math.round(widthPx * (812 / 375));
  if (widthPx <= 900) return Math.round(widthPx * (1024 / 768));
  return Math.round(widthPx * (800 / 1280));
}

function labelForWidth(widthPx: number): string {
  if (widthPx <= 480) return `mobile-${widthPx}`;
  if (widthPx <= 900) return `tablet-${widthPx}`;
  return `desktop-${widthPx}`;
}

export function resolveViewports(
  widths?: number[],
  heights?: number[],
): ScreenshotViewport[] {
  if (!widths || widths.length === 0) return DEFAULT_VIEWPORTS;
  return widths.map((widthPx, index) => ({
    label: labelForWidth(widthPx),
    widthPx,
    heightPx: heights?.[index] || heightForWidth(widthPx),
  }));
}


export {
  importPlaywright,
  isMissingBrowserError,
  launchChromium,
} from "../server/lib/playwright-runtime.js";
import {
  importPlaywright,
  launchChromium,
  type PlaywrightModule,
} from "../server/lib/playwright-runtime.js";

export function chromiumUnavailableReason(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return (
    "A headless Chromium browser is not available in this environment, so the " +
    "visual screenshot pass cannot run here (this is expected in hosted/" +
    "serverless deploys, which do not bundle a Chromium binary). Fall back to " +
    "run-design-audit for a static a11y/contrast-hint check, and rely on the " +
    "manual by-eye pass instead of this action. " +
    `(${detail})`
  );
}


async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  return (
    await readLiveSourceFile({
      id: fileId,
      designId: "",
      filename: "index.html",
      fileType: "html",
      content: storedContent,
      createdAt: null,
      updatedAt: null,
    })
  ).content;
}

// cannot reference anything from this module's outer scope, so the

export function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(fg: number[], bg: number[]): number {
  const l1 = relativeLuminance(fg[0], fg[1], fg[2]) + 0.05;
  const l2 = relativeLuminance(bg[0], bg[1], bg[2]) + 0.05;
  return l1 > l2 ? l1 / l2 : l2 / l1;
}

export function parseRgbColor(color: string): number[] | null {
  const m = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/,
  );
  if (!m) return null;
  const alpha = m[4] !== undefined ? Number.parseFloat(m[4]) : 1;
  if (alpha === 0) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function requiredContrastRatio(
  fontSizePx: number,
  fontWeight: number,
): number {
  const isLarge =
    fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  return isLarge ? 3 : 4.5;
}


function collectPageDiagnostics(): {
  documentWidthPx: number;
  documentHeightPx: number;
  horizontalOverflowPx: number;
  overflowingElements: DiagnosticsOverflowEntry[];
  lowContrastText: DiagnosticsContrastEntry[];
  brokenImages: string[];
  zeroSizeOrOffscreen: DiagnosticsZeroSizeEntry[];
} {
  function describeSelector(el: Element): string {
    if (el.id) return `#${el.id}`;
    const nodeId = el.getAttribute("data-agent-native-node-id");
    if (nodeId) return `[data-agent-native-node-id="${nodeId}"]`;
    const cls = (el.getAttribute("class") || "").trim().split(/\s+/)[0];
    return cls
      ? `${el.tagName.toLowerCase()}.${cls}`
      : el.tagName.toLowerCase();
  }

  function relativeLuminance(r: number, g: number, b: number): number {
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function contrastRatio(fg: number[], bg: number[]): number {
    const l1 = relativeLuminance(fg[0], fg[1], fg[2]) + 0.05;
    const l2 = relativeLuminance(bg[0], bg[1], bg[2]) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }

  function parseRgb(color: string): number[] | null {
    const m = color.match(
      /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/,
    );
    if (!m) return null;
    const alpha = m[4] !== undefined ? Number.parseFloat(m[4]) : 1;
    if (alpha === 0) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  function effectiveBackground(el: Element): number[] {
    let node: Element | null = el;
    while (node) {
      const style = getComputedStyle(node);
      const rgb = parseRgb(style.backgroundColor);
      if (rgb) return rgb;
      node = node.parentElement;
    }
    return [255, 255, 255];
  }

  const docWidth = document.documentElement.scrollWidth;
  const docHeight = document.documentElement.scrollHeight;
  const viewportWidth = window.innerWidth;
  const horizontalOverflowPx = Math.max(0, docWidth - viewportWidth);

  const overflowingElements: DiagnosticsOverflowEntry[] = [];
  const lowContrastText: DiagnosticsContrastEntry[] = [];
  const brokenImages: string[] = [];
  const zeroSizeOrOffscreen: DiagnosticsZeroSizeEntry[] = [];

  const all = document.querySelectorAll<HTMLElement>("body *");
  let overflowCount = 0;
  let contrastCount = 0;
  let zeroSizeCount = 0;
  const MAX_FINDINGS_PER_KIND = 25;

  for (const el of Array.from(all)) {
    const rect = el.getBoundingClientRect();

    if (
      overflowCount < MAX_FINDINGS_PER_KIND &&
      rect.right > viewportWidth + 1 &&
      rect.width > 0
    ) {
      overflowingElements.push({
        selector: describeSelector(el),
        overflowPx: Math.round(rect.right - viewportWidth),
        kind: "viewport-horizontal",
      });
      overflowCount++;
    } else if (overflowCount < MAX_FINDINGS_PER_KIND && el.parentElement) {
      const parentRect = el.parentElement.getBoundingClientRect();
      const parentStyle = getComputedStyle(el.parentElement);
      const parentOverflow = `${parentStyle.overflowX} ${parentStyle.overflowY}`;
      const allowsOverflow = /(auto|scroll|visible)/.test(parentOverflow);
      if (
        !allowsOverflow &&
        rect.width > 0 &&
        rect.right - parentRect.right > 4
      ) {
        overflowingElements.push({
          selector: describeSelector(el),
          overflowPx: Math.round(rect.right - parentRect.right),
          kind: "container",
        });
        overflowCount++;
      }
    }

    if (zeroSizeCount < MAX_FINDINGS_PER_KIND) {
      const hasText = (el.textContent || "").trim().length > 0;
      const style = getComputedStyle(el);
      const isDisplayed =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0;
      if (hasText && isDisplayed && el.children.length === 0) {
        if (rect.width === 0 || rect.height === 0) {
          zeroSizeOrOffscreen.push({
            selector: describeSelector(el),
            reason: "zero-size",
          });
          zeroSizeCount++;
        } else if (
          rect.right < 0 ||
          rect.bottom < 0 ||
          rect.left > viewportWidth + docWidth
        ) {
          zeroSizeOrOffscreen.push({
            selector: describeSelector(el),
            reason: "off-screen",
          });
          zeroSizeCount++;
        }
      }
    }

    if (contrastCount < MAX_FINDINGS_PER_KIND) {
      const isLeafWithText =
        el.children.length === 0 && (el.textContent || "").trim().length >= 2;
      if (isLeafWithText && rect.width > 0 && rect.height > 0) {
        const style = getComputedStyle(el);
        const fg = parseRgb(style.color);
        if (fg) {
          const bg = effectiveBackground(el);
          const ratio = contrastRatio(fg, bg);
          const fontSizePx = Number.parseFloat(style.fontSize || "16");
          const fontWeight = Number.parseInt(style.fontWeight || "400", 10);
          const isLarge =
            fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
          const required = isLarge ? 3 : 4.5;
          if (ratio < required) {
            lowContrastText.push({
              selector: describeSelector(el),
              text: (el.textContent || "").trim().slice(0, 60),
              ratio: Math.round(ratio * 100) / 100,
              requiredRatio: required,
              foreground: style.color,
              background: `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`,
            });
            contrastCount++;
          }
        }
      }
    }
  }

  for (const img of Array.from(document.querySelectorAll("img"))) {
    if (
      !(img as HTMLImageElement).complete ||
      (img as HTMLImageElement).naturalWidth === 0
    ) {
      brokenImages.push(img.getAttribute("src") || describeSelector(img));
    }
  }

  return {
    documentWidthPx: docWidth,
    documentHeightPx: docHeight,
    horizontalOverflowPx,
    overflowingElements,
    lowContrastText,
    brokenImages,
    zeroSizeOrOffscreen,
  };
}


export default defineAction({
  description:
    "Render a design screen's stored HTML in headless Chromium and return a " +
    "viewable screenshot URL plus a computed diagnostics report (real DOM/CSS " +
    "contrast ratios, horizontal/container overflow, broken images, zero-size " +
    "or off-screen text, console errors) for each requested viewport (default: " +
    "1280px desktop + 375px mobile). Use this for the Phase 5 visual pass — " +
    "the diagnostics are actionable immediately; the screenshot URL is for " +
    "human review in chat today and becomes agent-visible once tool-result " +
    "images ship. Requires a headless Chromium binary; in hosted/serverless " +
    "deploys where one isn't available, returns `{ ok: false, reason }` " +
    "instead of throwing — fall back to run-design-audit in that case.",
  schema: z.object({
    designId: z
      .string()
      .optional()
      .describe(
        "Design project id. Required unless fileId is provided. Combined with filename to resolve the screen.",
      ),
    fileId: z
      .string()
      .optional()
      .describe(
        "Specific design_files.id to screenshot. Takes priority over designId/filename.",
      ),
    filename: z
      .string()
      .optional()
      .default("index.html")
      .describe(
        "Filename to screenshot when fileId is not provided. Defaults to index.html.",
      ),
    widths: z
      .array(z.number().int().min(200).max(3840))
      .optional()
      .describe(
        "Viewport widths in px to render. Defaults to [1280, 375] (desktop + mobile). " +
          "Height is derived per width using standard device aspect ratios.",
      ),
    heights: z
      .array(z.number().int().min(200).max(4096))
      .optional()
      .describe(
        "Exact viewport heights in px, matched index-for-index against `widths`. " +
          "Use when the caller needs the screenshot's aspect ratio to match a " +
          "known on-screen rect exactly (e.g. compositing an overlay on top) " +
          "instead of the device-heuristic default. Omit an index to fall back " +
          "to the standard derived height for that width.",
      ),
  }),
  readOnly: true,
  http: { method: "POST" },
  run: async ({ designId, fileId, filename, widths, heights }, ctx) => {
    if (!designId && !fileId) {
      throw new Error("designId or fileId is required.");
    }

    const db = getDb();
    const conditions = [
      accessFilter(schema.designs, schema.designShares, undefined, "viewer", {
        includePublic: true,
      }),
      fileId
        ? eq(schema.designFiles.id, fileId)
        : eq(schema.designFiles.designId, designId ?? ""),
    ];
    if (!fileId) {
      conditions.push(
        eq(schema.designFiles.filename, filename ?? "index.html"),
      );
    }

    const [file] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .limit(1);

    if (!file) {
      const err = new Error("Design file not found") as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }
    if (file.fileType !== "html") {
      throw new Error(
        `take-design-screenshot only supports HTML files (got "${file.fileType}").`,
      );
    }

    const html = await liveContent(file.id, file.content ?? "");

    let playwright: PlaywrightModule;
    try {
      playwright = await importPlaywright();
    } catch (err) {
      return { ok: false, reason: chromiumUnavailableReason(err) };
    }

    const viewports = resolveViewports(widths, heights);
    let browser: import("@playwright/test").Browser | undefined;
    try {
      browser = await launchChromium(playwright.chromium);
    } catch (err) {
      return { ok: false, reason: chromiumUnavailableReason(err) };
    }

    const ownerEmail = getRequestUserEmail() ?? undefined;
    const screenshots: ScreenshotResult[] = [];

    try {
      for (const viewport of viewports) {
        if (ctx?.signal?.aborted) break;
        const context = await browser.newContext({
          viewport: { width: viewport.widthPx, height: viewport.heightPx },
          deviceScaleFactor: 2,
        });
        await context.addInitScript(
          "globalThis.__name = globalThis.__name || function (value) { return value; };",
        );
        await context.route("**/*", async (route) => {
          if (await isAllowedFigmaSvgRenderRequest(route.request().url())) {
            await route.continue();
          } else {
            await route.abort("blockedbyclient");
          }
        });
        await context.routeWebSocket("**/*", () => {});
        const page = await context.newPage();
        const consoleErrors: string[] = [];
        const fontLoadFailures: string[] = [];
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            consoleErrors.push(msg.text().slice(0, 300));
            return;
          }
          if (msg.type() === "warning" && /Alpine/.test(msg.text())) {
            consoleErrors.push(msg.text().slice(0, 300));
          }
        });
        page.on("pageerror", (err) => {
          consoleErrors.push(String(err).slice(0, 300));
        });
        page.on("requestfailed", (req) => {
          const url = req.url();
          if (/\.(woff2?|ttf|otf)(\?|$)/i.test(url) || /fonts\./i.test(url)) {
            fontLoadFailures.push(url);
          }
        });

        try {
          await page.setContent(html, { waitUntil: "networkidle" });
          await page
            .evaluate(async () => {
              const fontsReady = document.fonts?.ready;
              if (!fontsReady) return;
              await Promise.race([
                fontsReady,
                new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
              ]);
            })
            .catch(() => {});
          await page
            .waitForFunction(
              () => {
                const win = window as unknown as {
                  __anExportRuleCounts?: number[];
                  __anExportRuleStart?: number;
                };
                win.__anExportRuleStart ??= Date.now();
                const count = Array.from(document.styleSheets).reduce(
                  (sum, sheet) => {
                    try {
                      return sum + (sheet.cssRules?.length ?? 0);
                    } catch {
                      return sum + 1;
                    }
                  },
                  0,
                );
                const history = [
                  ...(win.__anExportRuleCounts ?? []).slice(-5),
                  count,
                ];
                win.__anExportRuleCounts = history;
                return (
                  history.length >= 6 &&
                  history.every((value) => value === history[0]) &&
                  Date.now() - win.__anExportRuleStart >= 600
                );
              },
              { timeout: 2500, polling: 100 },
            )
            .catch(() => {});

          const pageDiagnostics = await page.evaluate(collectPageDiagnostics);
          const png = await page.screenshot({ type: "png", fullPage: true });

          let uploaded: Awaited<ReturnType<typeof uploadFile>> | null = null;
          let uploadError: ScreenshotUploadError | undefined;
          try {
            uploaded = await uploadFile({
              data: png,
              mimeType: "image/png",
              filename: `design-${file.designId}-${file.filename}-${viewport.label}.png`,
              ownerEmail,
            });
          } catch {
            uploadError = {
              code: "file_upload_failed",
              message:
                "Configured file storage rejected the screenshot upload.",
            };
          }
          if (!uploaded && !uploadError) {
            uploadError = {
              code: "file_storage_not_configured",
              message:
                "Screenshot was rendered but not returned because file storage is not configured.",
            };
          }

          screenshots.push({
            viewport,
            url: uploaded?.url ?? "",
            persisted: !!uploaded,
            ...(uploadError ? { uploadError } : {}),
            bytes: png.byteLength,
            diagnostics: {
              viewport,
              ...pageDiagnostics,
              fontLoadFailures,
              consoleErrors,
            },
          });
        } finally {
          await context.close().catch(() => {});
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }

    const totalIssues = screenshots.reduce((sum, s) => {
      const d = s.diagnostics;
      return (
        sum +
        (d.horizontalOverflowPx > 0 ? 1 : 0) +
        d.overflowingElements.length +
        d.lowContrastText.length +
        d.brokenImages.length +
        d.fontLoadFailures.length +
        d.consoleErrors.length +
        d.zeroSizeOrOffscreen.length
      );
    }, 0);

    return {
      ok: true,
      designId: file.designId,
      fileId: file.id,
      filename: file.filename,
      capturedAt: new Date().toISOString(),
      screenshots,
      summary: {
        viewportsRendered: screenshots.length,
        totalDiagnosticIssues: totalIssues,
      },
    };
  },
});

import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { getReviewThreadSummary } from "@agent-native/core/review";
import { getAppProductionUrl } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  DESIGN_SCREEN_CAPTURE_MAX_IMAGE_BYTES,
  DESIGN_SCREEN_CAPTURE_MAX_WIDTH,
  DESIGN_SCREEN_CAPTURE_MIN_WIDTH,
  designScreenUrl,
  type EmbedVisibility,
} from "@agent-native/core/shared";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";

import { externalPreviewUrlForContent } from "../../app/pages/design-editor/preview-html.js";
import { parseCanvasFrameGeometryById } from "../../shared/canvas-frames.js";
import { degradeWideColorsInHtml } from "../../shared/export-color-fallback.js";
import { parseEffectsFromHtml } from "../../shared/native-effects.js";
import { deviceViewportFloorForWidth } from "../../shared/responsive-frame-layout.js";
import { getDb, schema } from "../db/index.js";
import { readLiveSourceFile } from "../source-workspace.js";
import { routeAllowedRenderRequests } from "./design-to-figma-svg.js";
import { importPlaywright, launchChromium } from "./playwright-runtime.js";
import { prepareScreenshotPage } from "./screenshot-readiness.js";

const DEFAULT_WIDTH_PX = 1440;
const MAX_CAPTURE_PIXELS = 40_000_000;
const MAX_CONCURRENT_CAPTURES = 2;
const RENDER_DEADLINE_MS = 50_000;

let activeCaptures = 0;

export function fitsCapturePixelBudget(
  pageAreaCssPx: number,
  deviceScaleFactor: number,
): boolean {
  return (
    Number.isFinite(pageAreaCssPx) &&
    pageAreaCssPx * deviceScaleFactor * deviceScaleFactor <= MAX_CAPTURE_PIXELS
  );
}

export interface CaptureDesign {
  id: string;
  title: string;
  visibility: EmbedVisibility;
  data: Record<string, unknown>;
}

export interface CaptureScreen {
  id: string;
  filename: string;
  content: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDesignData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const data: unknown = JSON.parse(raw);
    return isPlainRecord(data) ? data : {};
    // coercion-ok: unreadable design data only loses the frame width, which falls back to the default
  } catch {
    return {};
  }
}

export function visibilityForRequest(
  visibility: unknown,
  designOrgId: unknown,
  requestOrgId: string | null | undefined,
): EmbedVisibility {
  if (visibility === "public") return "public";
  if (visibility === "org") {
    return typeof designOrgId === "string" &&
      designOrgId &&
      designOrgId === requestOrgId
      ? "org"
      : "private";
  }
  return "private";
}

export async function loadCaptureDesign(
  designId: string,
): Promise<CaptureDesign> {
  if (!getRequestUserEmail()) {
    fail("Sign in to Design to use its screens.", {
      errorCode: "design_screen_signed_out",
      statusCode: 401,
    });
  }
  const access = await resolveAccess("design", designId);
  if (!access) {
    fail("Design not found, or you can't open it.", {
      errorCode: "design_not_found",
      statusCode: 404,
    });
  }
  const resource = access.resource as Record<string, unknown>;
  return {
    id: designId,
    title:
      typeof resource.title === "string" && resource.title.trim()
        ? resource.title.trim().slice(0, 300)
        : "Untitled design",
    visibility: visibilityForRequest(
      resource.visibility,
      resource.orgId,
      getRequestOrgId(),
    ),
    data: readDesignData(resource.data),
  };
}

async function loadScreenRows(designId: string, screenIds: readonly string[]) {
  if (screenIds.length === 0) return [];
  const rows = await getDb()
    .select({
      id: schema.designFiles.id,
      designId: schema.designFiles.designId,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      content: schema.designFiles.content,
      createdAt: schema.designFiles.createdAt,
      updatedAt: schema.designFiles.updatedAt,
    })
    .from(schema.designFiles)
    .where(
      and(
        eq(schema.designFiles.designId, designId),
        inArray(schema.designFiles.id, [...screenIds]),
      ),
    );
  return rows.filter((row) => row.fileType === "html");
}

export async function loadCaptureScreens(
  designId: string,
  screenIds: readonly string[],
): Promise<Map<string, CaptureScreen>> {
  const screens = await Promise.all(
    (await loadScreenRows(designId, screenIds)).map(async (row) => ({
      id: row.id,
      filename: row.filename,
      content: (await readLiveSourceFile(row)).content,
    })),
  );
  return new Map(screens.map((screen) => [screen.id, screen]));
}

export async function loadStatusScreens(
  designId: string,
  screenIds: readonly string[],
): Promise<Map<string, CaptureScreen | null>> {
  const screens = await Promise.all(
    (await loadScreenRows(designId, screenIds)).map(
      async (row): Promise<[string, CaptureScreen | null]> => {
        try {
          return [
            row.id,
            {
              id: row.id,
              filename: row.filename,
              content: (await readLiveSourceFile(row)).content,
            },
          ];
        } catch (error) {
          console.warn(
            "[design-screen-status] couldn't read a screen's live source",
            {
              screenId: row.id,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          // coercion-ok: null marks a screen whose source couldn't be read, apart from one that's gone
          return [row.id, null];
        }
      },
    ),
  );
  return new Map(screens);
}

export function screenWidthPx(
  data: Record<string, unknown>,
  screenId: string,
): number {
  const metadata = isPlainRecord(data.screenMetadata)
    ? data.screenMetadata[screenId]
    : undefined;
  const metadataWidth = isPlainRecord(metadata) ? metadata.width : undefined;
  const width =
    typeof metadataWidth === "number" &&
    Number.isFinite(metadataWidth) &&
    metadataWidth > 0
      ? metadataWidth
      : parseCanvasFrameGeometryById(data.canvasFrames)[screenId]?.width;
  return width !== undefined && width > 0
    ? Math.min(
        DESIGN_SCREEN_CAPTURE_MAX_WIDTH,
        Math.max(DESIGN_SCREEN_CAPTURE_MIN_WIDTH, Math.round(width)),
      )
    : DEFAULT_WIDTH_PX;
}

export function screenName(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  return (base.replace(/\.html?$/i, "") || base).slice(0, 300);
}

export function screenFingerprint(
  screen: Pick<CaptureScreen, "content">,
  data: Record<string, unknown>,
  screenId: string,
): string {
  return createHash("sha256")
    .update(screen.content)
    .update("\u0000")
    .update(String(screenWidthPx(data, screenId)))
    .digest("hex")
    .slice(0, 12);
}

export async function openCommentCount(
  designId: string,
  screenId: string,
): Promise<number> {
  const summary = await getReviewThreadSummary({
    resourceType: "design",
    resourceId: designId,
    scope: {
      userEmail: getRequestUserEmail() ?? null,
      orgId: getRequestOrgId() ?? null,
    },
    bypassScope: true,
    targetId: screenId,
  });
  return summary.openCount;
}

export function captureLinks(
  designId: string,
  screenId: string,
): { designUrl: string; screenUrl: string } {
  const appUrl = getAppProductionUrl().replace(/\/+$/, "");
  return {
    designUrl: `${appUrl}/design/${encodeURIComponent(designId)}`,
    screenUrl: designScreenUrl(appUrl, designId, screenId),
  };
}

export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Not a PNG");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export async function renderScreenPng(
  screen: CaptureScreen,
  widthPx: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const html = screen.content;
  if (externalPreviewUrlForContent(html) !== null) {
    fail(
      "This screen shows a running app from its address, which only loads in the Design editor, so it can't be pinned as a picture.",
      { errorCode: "design_screen_live_app", statusCode: 422 },
    );
  }
  const native = parseEffectsFromHtml(html);
  if (
    native.errors.length ||
    native.document?.instances.some((instance) => instance.enabled)
  ) {
    fail(
      "This screen uses Design's live effects, which only render in the Design editor, so it can't be pinned as a picture.",
      { errorCode: "design_screen_live_effects", statusCode: 422 },
    );
  }

  if (activeCaptures >= MAX_CONCURRENT_CAPTURES) {
    fail(
      "Design is taking pictures of other screens right now. Try again in a minute.",
      { errorCode: "design_screen_render_busy", statusCode: 503 },
    );
  }
  activeCaptures += 1;
  try {
    let browser: import("@playwright/test").Browser;
    try {
      browser = await launchChromium((await importPlaywright()).chromium);
    } catch (error) {
      console.warn("[design-screen-capture] no browser to render with", {
        error: error instanceof Error ? error.message : String(error),
      });
      fail("Design can't render screens right now. Try again in a minute.", {
        errorCode: "design_screen_render_unavailable",
        statusCode: 503,
      });
    }
    const stopped = new AbortController();
    const stop = () => {
      stopped.abort();
      void browser.close().catch(() => {});
    };
    const deadline = setTimeout(stop, RENDER_DEADLINE_MS);
    signal?.addEventListener("abort", stop, { once: true });
    try {
      for (const deviceScaleFactor of [2, 1]) {
        signal?.throwIfAborted();
        const context = await browser.newContext({
          viewport: {
            width: widthPx,
            height: deviceViewportFloorForWidth(widthPx),
          },
          deviceScaleFactor,
        });
        try {
          await context.addInitScript(
            "globalThis.__name = globalThis.__name || function (value) { return value; };",
          );
          const requests = await routeAllowedRenderRequests(context);
          await context.routeWebSocket("**/*", () => {});
          const page = await context.newPage();
          await prepareScreenshotPage(page, degradeWideColorsInHtml(html));
          const pageArea = Number(
            await page.evaluate(() => {
              const root = document.documentElement;
              const body = document.body;
              return (
                Math.max(root.scrollWidth, body.scrollWidth) *
                Math.max(root.scrollHeight, body.scrollHeight)
              );
            }),
          );
          const png = fitsCapturePixelBudget(pageArea, deviceScaleFactor)
            ? await page.screenshot({
                type: "png",
                fullPage: true,
                timeout: 30_000,
              })
            : null;
          if (requests.blockedNavigations.length > 0) {
            fail(
              "This screen moves the page away from itself while it loads, so it can't be captured.",
              { errorCode: "design_screen_navigated_away", statusCode: 422 },
            );
          }
          if (png && png.length <= DESIGN_SCREEN_CAPTURE_MAX_IMAGE_BYTES) {
            return png;
          }
        } finally {
          await context.close().catch(() => {});
        }
      }
    } catch (error) {
      if (stopped.signal.aborted) {
        fail(
          "Design took too long to render this screen. Try again, or split it into shorter screens.",
          { errorCode: "design_screen_render_timeout", statusCode: 504 },
        );
      }
      throw error;
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener("abort", stop);
      await browser.close().catch(() => {});
    }
    fail(
      "This screen is too long to pin as one picture. Capture it at a narrower width, or split it into shorter screens.",
      { errorCode: "design_screen_too_large", statusCode: 413 },
    );
  } finally {
    activeCaptures -= 1;
  }
}

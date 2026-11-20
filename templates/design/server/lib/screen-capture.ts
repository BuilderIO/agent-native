/**
 * Design's side of a screen pinned in another app's page, such as a Content
 * page: one screen rendered for the signed-in person, handed back as image
 * bytes so no public copy is made, with what the other app keeps alongside
 * it (who can open the design, a fingerprint that moves when the screen
 * does, and the screen's open comment threads).
 */
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

import { parseCanvasFrameGeometryById } from "../../shared/canvas-frames.js";
import { degradeWideColorsInHtml } from "../../shared/export-color-fallback.js";
import { parseEffectsFromHtml } from "../../shared/native-effects.js";
import { getDb, schema } from "../db/index.js";
import { readLiveSourceFile } from "../source-workspace.js";
import { routeAllowedRenderRequests } from "./design-to-figma-svg.js";
import { importPlaywright, launchChromium } from "./playwright-runtime.js";
import { prepareScreenshotPage } from "./screenshot-readiness.js";

const DEFAULT_WIDTH_PX = 1440;

export interface CaptureDesign {
  id: string;
  title: string;
  /** Who can open the design, for the organization asking. */
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

/**
 * A design shared with an organization reaches only its own members, so
 * for a person asking from another organization (or none) it is private.
 */
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

/**
 * The design the signed-in person can open, or a refusal that says why.
 * Someone who can't open it gets the same answer as for a missing design.
 */
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

/** The design's HTML screens among `screenIds`, by id. */
export async function loadCaptureScreens(
  designId: string,
  screenIds: readonly string[],
): Promise<Map<string, CaptureScreen>> {
  if (screenIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      id: schema.designFiles.id,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      content: schema.designFiles.content,
    })
    .from(schema.designFiles)
    .where(
      and(
        eq(schema.designFiles.designId, designId),
        inArray(schema.designFiles.id, [...screenIds]),
      ),
    );
  return new Map(
    rows
      .filter((row) => row.fileType === "html")
      .map((row) => [
        row.id,
        { id: row.id, filename: row.filename, content: row.content },
      ]),
  );
}

/** The screen's own frame width, as export-png reads it, else 1440. */
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

/** The screen's name as Design lists it: its file name without `.html`. */
export function screenName(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  return (base.replace(/\.html?$/i, "") || base).slice(0, 300);
}

/**
 * Moves whenever the screen's saved source or its frame settings change, so
 * a page holding a picture of it can say the design moved on.
 */
export function screenFingerprint(
  screen: Pick<CaptureScreen, "content">,
  data: Record<string, unknown>,
  screenId: string,
): string {
  const metadata = isPlainRecord(data.screenMetadata)
    ? (data.screenMetadata[screenId] ?? null)
    : null;
  const frames = parseCanvasFrameGeometryById(data.canvasFrames);
  const frameWidth = Object.prototype.hasOwnProperty.call(frames, screenId)
    ? frames[screenId].width
    : null;
  return createHash("sha256")
    .update(screen.content)
    .update("\u0000")
    .update(JSON.stringify({ metadata, width: frameWidth }))
    .digest("hex")
    .slice(0, 12);
}

/** Open comment threads on one screen, as the comments panel counts them. */
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

/** The design's and the screen's links in this Design. */
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

async function liveContent(screen: CaptureScreen): Promise<string> {
  return (
    await readLiveSourceFile({
      id: screen.id,
      designId: "",
      filename: "index.html",
      fileType: "html",
      content: screen.content,
      createdAt: null,
      updatedAt: null,
    })
  ).content;
}

/** Reads a PNG's pixel size from its header. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Not a PNG");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Renders the whole screen at `widthPx` in headless Chromium, at 2x where
 * that fits the hand-over limit and at 1x where it doesn't. The PNG is
 * returned, never uploaded.
 */
export async function renderScreenPng(
  screen: CaptureScreen,
  widthPx: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const html = await liveContent(screen);
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
  try {
    for (const deviceScaleFactor of [2, 1]) {
      signal?.throwIfAborted();
      const context = await browser.newContext({
        viewport: { width: widthPx, height: Math.round(widthPx * 0.625) },
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
        const png = await page.screenshot({
          type: "png",
          fullPage: true,
          timeout: 30_000,
        });
        if (requests.blockedNavigations.length > 0) {
          fail(
            "This screen moves the page away from itself while it loads, so it can't be captured.",
            { errorCode: "design_screen_navigated_away", statusCode: 422 },
          );
        }
        if (png.length <= DESIGN_SCREEN_CAPTURE_MAX_IMAGE_BYTES) return png;
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  fail(
    "This screen is too long to pin as one picture. Capture it at a narrower width, or split it into shorter screens.",
    { errorCode: "design_screen_too_large", statusCode: 413 },
  );
}

import { defineAction, fail } from "@agent-native/core/action";
import {
  DESIGN_SCREEN_CAPTURE_MAX_IMAGE_BYTES,
  designScreenCaptureRequestSchema,
  designScreenCaptureSchema,
} from "@agent-native/core/shared";
import { track } from "@agent-native/core/tracking";

import {
  captureLinks,
  loadCaptureDesign,
  loadCaptureScreens,
  openCommentCount,
  pngSize,
  renderScreenPng,
  screenFingerprint,
  screenName,
  screenWidthPx,
} from "../server/lib/screen-capture.js";
import "../server/db/index.js";

const CAPTURE_MAX_RESULT_CHARS =
  Math.ceil(DESIGN_SCREEN_CAPTURE_MAX_IMAGE_BYTES / 3) * 4 + 20_000;

export default defineAction({
  description:
    "Read-only. Render one Design screen as the signed-in person and hand its picture back as PNG bytes, for another Agent-Native app to keep privately, such as a screen pinned in a Content page. Makes no public copy. Also returns the design's title and who can open it, the screen's name and width, a fingerprint that changes when the screen does, and its open comment threads. Only other apps can call it; for an image of a screen, use export-png.",
  schema: designScreenCaptureRequestSchema,
  outputSchema: designScreenCaptureSchema,
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  timeoutMs: 55_000,
  maxResultChars: CAPTURE_MAX_RESULT_CHARS,
  run: async (args, ctx) => {
    if (ctx?.caller !== "a2a") {
      fail(
        "capture-design-screen hands a screen's picture to another Agent-Native app. For an image of a screen, use export-png.",
        { errorCode: "design_screen_capture_app_only", statusCode: 403 },
      );
    }
    const design = await loadCaptureDesign(args.designId);
    const screen = (await loadCaptureScreens(design.id, [args.screenId])).get(
      args.screenId,
    );
    if (!screen) {
      fail("That screen isn't in this design anymore.", {
        errorCode: "design_screen_not_found",
        statusCode: 404,
      });
    }
    const width = args.width ?? screenWidthPx(design.data, screen.id);
    const png = await renderScreenPng(screen, width, ctx.signal);
    const size = pngSize(png);
    const sharing = await loadCaptureDesign(design.id);
    const { designUrl, screenUrl } = captureLinks(design.id, screen.id);
    const openComments = await openCommentCount(design.id, screen.id);

    track(
      "design_screen_captured",
      {
        app_name: "design",
        template_name: "design",
        width,
        image_bytes: png.length,
        open_comments: openComments,
        design_visibility: sharing.visibility,
      },
      ctx,
    );

    return {
      design: {
        id: design.id,
        title: sharing.title,
        url: designUrl,
        visibility: sharing.visibility,
      },
      screen: {
        id: screen.id,
        name: screenName(screen.filename),
        width,
        fingerprint: screenFingerprint(screen, design.data, screen.id),
        url: screenUrl,
      },
      openComments,
      image: {
        mimeType: "image/png" as const,
        data: png.toString("base64"),
        width: size.width,
        height: size.height,
      },
      capturedAt: new Date().toISOString(),
    };
  },
});

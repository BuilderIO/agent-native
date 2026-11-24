import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  deletePrivateMedia,
  PrivateMediaStorageUnavailableError,
  PrivateMediaValidationError,
  putPrivateMedia,
} from "@agent-native/core/private-media";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import {
  designScreenCaptureRequestSchema,
  designScreenCaptureSchema,
  parseDesignScreenLink,
  type EmbedAudienceReason,
} from "@agent-native/core/shared";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { designLinkOrigins, requestDesign } from "../server/lib/design-peer.js";
import { bindUploadedPrivateMedia } from "../server/lib/private-media-references.js";
import {
  describeDesignScreen,
  designScreenAudience,
  designScreenBlockRaw,
  designScreenSchema,
  DESIGN_SCREEN_BLOCK_TYPE,
  type DesignScreenData,
} from "../shared/design-screen-block.js";
import { isRegistryBlockId } from "../shared/nfm-registry.js";
import { privateMediaPath } from "../shared/private-media.js";
import {
  authorizeDesignScreenPage,
  designScreenDocumentIdSchema,
} from "./_design-screen-access.js";
import { visibilityForPageOrganization } from "./_embed-page-access.js";

const CAPTURE_TIMEOUT_MS = 58_000;

function isEditorCall(ctx: ActionRunContext | undefined): boolean {
  return ctx?.caller === "frontend" || ctx?.caller === "http";
}

function newBlockId(): string {
  return `${DESIGN_SCREEN_BLOCK_TYPE}-${crypto.randomUUID().slice(0, 8)}`;
}

function audienceMessage(reason: EmbedAudienceReason, title: string): string {
  const design = `the ${title} design`;
  if (reason === "public-page") {
    return `Anyone with the link can open this page, but not ${design}, so its screens can't be pinned here. Narrow the page's sharing first.`;
  }
  return `More people can open this page than ${design}. Everyone who can open the page will see this screen.`;
}

function claimsItsOwnSize(image: {
  data: string;
  width: number;
  height: number;
}): boolean {
  const header = Buffer.from(image.data.slice(0, 44), "base64");
  return (
    header.length >= 24 &&
    header.toString("ascii", 12, 16) === "IHDR" &&
    header.readUInt32BE(16) === image.width &&
    header.readUInt32BE(20) === image.height
  );
}

function capturerName(): string {
  return getRequestUserName()?.trim().slice(0, 200) ?? "";
}

async function storePicture(args: {
  documentId: string;
  orgId: string | null;
  screenId: string;
  data: string;
}): Promise<string> {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) {
    fail("Sign in to pin Design screens.", {
      errorCode: "design_screen_signed_out",
      statusCode: 401,
    });
  }
  let media: { id: string };
  try {
    media = await putPrivateMedia({
      ownerEmail,
      orgId: args.orgId,
      data: Buffer.from(args.data, "base64"),
      mimeType: "image/png",
      filename: `design-screen-${args.screenId}.png`,
    });
  } catch (error) {
    if (error instanceof PrivateMediaStorageUnavailableError) {
      fail(error.message, {
        errorCode: "design_screen_storage_unavailable",
        statusCode: 503,
      });
    }
    if (error instanceof PrivateMediaValidationError) {
      fail(`Design sent a picture Content can't keep: ${error.message}`, {
        errorCode: "design_screen_image_invalid",
        statusCode: error.statusCode,
      });
    }
    throw error;
  }
  try {
    await bindUploadedPrivateMedia({
      documentId: args.documentId,
      mediaId: media.id,
    });
  } catch (error) {
    try {
      await deletePrivateMedia(media.id);
    } catch (cleanupError) {
      console.warn(
        "[design-screen] could not remove a picture that failed to attach",
        cleanupError,
      );
    }
    throw error;
  }
  return privateMediaPath(media.id);
}

const audienceSchema = z.object({
  verdict: z.enum(["ok", "warn", "block"]),
  reason: z.enum(["public-page", "wider", "unknown-source"]).nullable(),
});

const outputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("captured"),
    blockId: z.string(),
    screen: designScreenSchema.optional(),
    openComments: z.number(),
    audience: audienceSchema,
    designScreenTag: z.string().optional(),
    next: z.string(),
  }),
  z.object({
    status: z.literal("needs_confirmation"),
    blockId: z.string(),
    design: z.object({ title: z.string() }),
    audience: audienceSchema,
    message: z.string(),
    next: z.string(),
  }),
]);

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Pin a picture of one Design screen in a page. Pass the screen's copied link from Design, or its designId and screenId, and optionally a width. Checks you can edit the page, then has Design render the screen as you, with your access, keeps the picture with the page's private images, and returns the DesignScreen tag to put in the page with edit-document. To refresh a screen already in the page, pass purpose \"refresh\" with its blockId and the designId, screenId and width from its tag, then replace the old tag with the new one. A screen from a design fewer people can open than the page comes back as needs_confirmation: ask the person first, then call again with acknowledgeWiderAudience. A page anyone with the link can open only takes screens from designs anyone with the link can open. A link to a whole board, and screens with live effects, are refused.",
  schema: z.object({
    documentId: designScreenDocumentIdSchema,
    link: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .describe(
        "The screen's copied link from Design (Copy link on the screen), e.g. https://…/design/<id>?screen=<screenId>.",
      ),
    designId: designScreenCaptureRequestSchema.shape.designId
      .optional()
      .describe("Design id, when there is no link."),
    screenId: designScreenCaptureRequestSchema.shape.screenId
      .optional()
      .describe("Screen id, when there is no link."),
    width: designScreenCaptureRequestSchema.shape.width,
    purpose: z
      .enum(["insert", "refresh"])
      .default("insert")
      .describe(
        "insert for a new screen; refresh for one already in the page.",
      ),
    blockId: z
      .string()
      .refine(isRegistryBlockId, "Not a block id")
      .optional()
      .describe(
        "The screen's block id, to refresh it in place. Required with purpose refresh.",
      ),
    acknowledgeWiderAudience: z
      .boolean()
      .optional()
      .describe(
        "Set only after the person agreed that everyone who can open the page may see this screen.",
      ),
  }),
  outputSchema,
  http: { method: "POST" },
  mcpTool: true,
  run: async (args, ctx) => {
    if (args.purpose === "refresh" && !args.blockId) {
      fail(
        "To refresh a screen, pass its blockId: the id in its DesignScreen tag.",
        { errorCode: "design_screen_block_id_required", statusCode: 400 },
      );
    }
    const page = await authorizeDesignScreenPage(args.documentId, "editor");

    const link = args.link
      ? parseDesignScreenLink(args.link, designLinkOrigins())
      : null;
    if (link?.kind === "board") {
      fail(
        "That link opens the whole board. Open one screen in Design and use Copy link on it.",
        { errorCode: "design_screen_board_link", statusCode: 400 },
      );
    }
    const request = link
      ? { designId: link.designId, screenId: link.screenId }
      : !args.link && args.designId && args.screenId
        ? { designId: args.designId, screenId: args.screenId }
        : null;
    if (!request) {
      fail(
        args.link
          ? "That isn't a screen link from this workspace's Design. Use Copy link on the screen."
          : "Pass the screen's link, or its designId and screenId.",
        { errorCode: "design_screen_link_invalid", statusCode: 400 },
      );
    }

    const answer = await requestDesign(
      "capture-design-screen",
      { ...request, ...(args.width ? { width: args.width } : {}) },
      designScreenCaptureSchema,
      CAPTURE_TIMEOUT_MS,
      page.authorityOrgId,
    );
    if (!answer.ok) {
      fail(answer.message, {
        errorCode: answer.code,
        statusCode:
          answer.code === "design_signed_out"
            ? 401
            : answer.code === "design_refused"
              ? 409
              : 502,
        ...(answer.peerCode
          ? { details: { designCode: answer.peerCode } }
          : {}),
      });
    }
    const capture = answer.data;
    if (!claimsItsOwnSize(capture.image)) {
      fail("Design sent a picture whose size doesn't match what it said.", {
        errorCode: "design_invalid_response",
        statusCode: 502,
      });
    }
    const pageNow = await authorizeDesignScreenPage(args.documentId, "editor");
    if (
      pageNow.orgId !== page.orgId ||
      pageNow.authorityOrgId !== page.authorityOrgId
    ) {
      fail(
        "The page moved to another organization while Design was taking the picture. Try again.",
        { errorCode: "design_screen_page_moved", statusCode: 409 },
      );
    }
    const design = {
      ...capture.design,
      visibility: visibilityForPageOrganization(
        capture.design.visibility,
        pageNow,
      ),
    };
    const audience = designScreenAudience("insert", pageNow.visibility, {
      design,
    });
    const blockId = args.blockId ?? newBlockId();

    if (audience.verdict === "block" && audience.reason) {
      fail(audienceMessage(audience.reason, design.title), {
        errorCode: "design_screen_wider_than_design",
        statusCode: 409,
        details: { reason: audience.reason },
      });
    }
    if (
      audience.verdict === "warn" &&
      audience.reason &&
      args.acknowledgeWiderAudience !== true
    ) {
      return {
        status: "needs_confirmation" as const,
        blockId,
        design: { title: design.title },
        audience,
        message: audienceMessage(audience.reason, design.title),
        next: "Tell the person who can open the page and the design, and call again with acknowledgeWiderAudience only if they agree.",
      };
    }

    const src = await storePicture({
      documentId: args.documentId,
      orgId: pageNow.orgId,
      screenId: capture.screen.id,
      data: capture.image.data,
    });
    track(
      args.purpose === "refresh"
        ? "design_screen_refreshed"
        : "design_screen_captured",
      {
        app_name: "content",
        template_name: "content",
        output_type: "design_screen",
        width: capture.screen.width,
        page_visibility: pageNow.visibility,
        design_visibility: design.visibility,
        audience_verdict: audience.verdict,
      },
      ctx,
    );
    const screen: DesignScreenData = {
      design,
      screen: capture.screen,
      image: {
        src,
        width: capture.image.width,
        height: capture.image.height,
        alt: describeDesignScreen({ design, screen: capture.screen }),
      },
      capturedAt: capture.capturedAt,
      capturedBy: capturerName(),
    };
    if (isEditorCall(ctx)) {
      return {
        status: "captured" as const,
        blockId,
        screen,
        openComments: capture.openComments,
        audience,
        next: "Show the screen in the page.",
      };
    }
    return {
      status: "captured" as const,
      blockId,
      openComments: capture.openComments,
      audience,
      designScreenTag: designScreenBlockRaw(blockId, screen),
      next:
        args.purpose === "refresh"
          ? "Replace the screen's old DesignScreen tag (same id) with designScreenTag using edit-document."
          : "Put designScreenTag in the page where the screen belongs with edit-document, as its own block, and leave the tag as it is.",
    };
  },
});

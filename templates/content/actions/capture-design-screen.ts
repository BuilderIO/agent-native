import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
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

// Design answers within 55 seconds; leave room for the hop.
const CAPTURE_TIMEOUT_MS = 58_000;

/** The editor draws the picture from the block data; agents place the tag. */
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

/** The name on the stamp: the person's name, else their email's first part. */
function capturerName(): string {
  const name = getRequestUserName()?.trim();
  if (name) return name.slice(0, 200);
  return (getRequestUserEmail() ?? "").split("@")[0]?.slice(0, 200) ?? "";
}

/** Keeps the picture as one of the page's private images. */
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
  try {
    const media = await putPrivateMedia({
      ownerEmail,
      orgId: args.orgId,
      data: Buffer.from(args.data, "base64"),
      mimeType: "image/png",
      filename: `design-screen-${args.screenId}.png`,
    });
    await bindUploadedPrivateMedia({
      documentId: args.documentId,
      mediaId: media.id,
    });
    return privateMediaPath(media.id);
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
}

const audienceSchema = z.object({
  verdict: z.enum(["ok", "warn", "block"]),
  reason: z.enum(["public-page", "wider", "unknown-source"]).nullable(),
});

// The pinned screen goes out once: as block data to the editor, or as the
// tag to agents.
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
    "Pin a picture of one Design screen in a page. Pass the screen's copied link from Design, or its designId and screenId, and optionally a width. Checks you can edit the page, then has Design render the screen as you, with your access, keeps the picture with the page's private images, and returns the DesignScreen tag to put in the page with edit-document. To refresh a screen already in the page, pass purpose \"refresh\" and its blockId, then replace the old tag with the new one. A screen from a design fewer people can open than the page comes back as needs_confirmation: ask the person first, then call again with acknowledgeWiderAudience. A page anyone with the link can open only takes screens from designs anyone with the link can open. A link to a whole board, and screens with live effects, are refused.",
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
  // An outside agent pins a screen as the app's own agent does: it gets the
  // tag to write with edit-document, under the same checks.
  mcpTool: true,
  run: async (args, ctx) => {
    // A refresh replaces the tag with the same id, so it must be given.
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
      });
    }
    const capture = answer.data;
    const design = {
      ...capture.design,
      visibility: visibilityForPageOrganization(
        capture.design.visibility,
        page,
      ),
    };
    const audience = designScreenAudience("insert", page.visibility, {
      design,
    });
    const blockId = args.blockId ?? newBlockId();

    track(
      args.purpose === "refresh"
        ? "design_screen_refreshed"
        : "design_screen_captured",
      {
        app_name: "content",
        template_name: "content",
        output_type: "design_screen",
        width: capture.screen.width,
        page_visibility: page.visibility,
        design_visibility: design.visibility,
        audience_verdict: audience.verdict,
      },
      ctx,
    );

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
      orgId: page.orgId,
      screenId: capture.screen.id,
      data: capture.image.data,
    });
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

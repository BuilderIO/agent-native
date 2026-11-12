import { z } from "zod";

import { defineAction } from "../../action.js";
import { ForbiddenError } from "../../sharing/access.js";
import { roleSatisfies } from "../../sharing/schema.js";
import {
  assertReviewCommentHasContent,
  sanitizeReviewCommentAttachmentEdit,
} from "../attachments.js";
import { extractReviewMentions, normalizeReviewMentions } from "../mentions.js";
import {
  assertPersonReviewAnchorKind,
  canCommentOnReviewableResource,
  resolveReviewableResourceAccess,
} from "../registry.js";
import { getReviewCommentById, updateReviewComment } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const mentionSchema = z.object({
  label: z.string().min(1),
  email: z.string().email().nullable().optional(),
  id: z.string().nullable().optional(),
});

const attachmentSchema = z.object({
  url: z.string().min(1),
  name: z.string().optional(),
  contentType: z.string().optional(),
  provider: z.string().optional(),
});

const schema = z
  .object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    commentId: z.string().min(1),
    body: z
      .string()
      .optional()
      .describe("Inline Markdown; may be empty when the comment has an image"),
    attachments: z
      .array(attachmentSchema)
      .optional()
      .describe("The comment's images, in place of the ones it has"),
    anchor: z.unknown().optional(),
    anchorKind: z.string().min(1).nullable().optional(),
    anchorVersion: z.number().int().positive().nullable().optional(),
    mentions: z.array(mentionSchema).optional(),
    expectedRevision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "The comment's revision when read; a newer one refuses the edit with revision_conflict",
      ),
  })
  .refine(
    (args) =>
      args.body !== undefined ||
      args.attachments !== undefined ||
      args.anchor !== undefined,
    { message: "Provide a body, attachments or anchor to update" },
  );

export default defineAction({
  description:
    "Update an authored review comment's body or images, or its canvas anchor.",
  schema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const scope = {
      userEmail: actionCtx?.userEmail ?? null,
      orgId: actionCtx?.orgId ?? null,
    };
    const access = await resolveReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
    );
    const comment = await getReviewCommentById(args.commentId, scope, {
      bypassScope: Boolean(access),
    });
    if (
      !comment ||
      comment.resourceType !== args.resourceType ||
      comment.resourceId !== args.resourceId
    ) {
      throw new Error("Review comment not found");
    }
    const isAuthor =
      Boolean(actionCtx?.userEmail) &&
      normalizeEmail(comment.authorEmail) ===
        normalizeEmail(actionCtx?.userEmail);
    const changesContent =
      args.body !== undefined ||
      args.mentions !== undefined ||
      args.attachments !== undefined;
    if (
      !access ||
      !canCommentOnReviewableResource(args.resourceType, access) ||
      (changesContent
        ? !isAuthor
        : !isAuthor && !roleSatisfies(access.role, "editor"))
    ) {
      throw new ForbiddenError("Not allowed to update this review comment");
    }
    if (args.anchor !== undefined) {
      // The kind the moved anchor ends up with, worked out as the store does.
      assertPersonReviewAnchorKind(
        args.anchorKind !== undefined
          ? args.anchorKind
          : args.anchor === null
            ? null
            : comment.anchorKind,
      );
    }
    // New images that fail a new comment's checks are dropped here too; the
    // ones the comment already keeps stay as they are.
    const attachments =
      args.attachments === undefined
        ? undefined
        : await sanitizeReviewCommentAttachmentEdit(
            args.attachments,
            comment.metadata,
          );
    // Checked here for a quick answer, and again by the store against the
    // locked row, so a change made meanwhile can't empty the comment.
    if (changesContent) {
      assertReviewCommentHasContent(
        args.body ?? comment.body,
        attachments === undefined ? comment.metadata : { attachments },
      );
    }
    const mentions =
      args.body === undefined
        ? undefined
        : normalizeReviewMentions([
            ...normalizeReviewMentions(args.mentions),
            ...extractReviewMentions(args.body),
          ]);
    const updated = await updateReviewComment(
      args.commentId,
      {
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
        ...(args.anchor !== undefined ? { anchor: args.anchor } : {}),
        ...(args.anchor !== undefined && args.anchorKind !== undefined
          ? { anchorKind: args.anchorKind }
          : {}),
        ...(args.anchor !== undefined && args.anchorVersion !== undefined
          ? { anchorVersion: args.anchorVersion }
          : {}),
        ...(mentions !== undefined ? { mentions } : {}),
      },
      { resourceType: args.resourceType, resourceId: args.resourceId },
      {
        expectedRevision: args.expectedRevision,
        requireContent: changesContent,
        actorEmail: actionCtx?.userEmail ?? null,
      },
    );
    if (!updated) throw new Error("Review comment not found");
    return updated;
  },
  audit: {
    target: (args) => ({
      type: args.resourceType,
      id: args.resourceId,
    }),
  },
});

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

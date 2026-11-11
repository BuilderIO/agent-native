import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  assertReviewCommentHasContent,
  sanitizeReviewCommentMetadata,
} from "../attachments.js";
import { reviewAuthorNameFromContext } from "../identity.js";
import { extractReviewMentions, normalizeReviewMentions } from "../mentions.js";
import {
  notifyReviewComment,
  notifyReviewCommentWithReceipt,
} from "../notifications.js";
import {
  assertReviewCommentAccess,
  normalizeReviewVisibility,
} from "../registry.js";
import {
  getReviewCommentById,
  getReviewThreadRoot,
  insertReviewReply,
  insertReviewReplyIdempotently,
  ReviewCommentDeletedError,
  ReviewThreadNotFoundError,
  ReviewThreadNotOpenError,
  reviewCommentIdForClientOperation,
} from "../store.js";
import type { ReviewActorKind, ReviewResourceContext } from "../types.js";

const mentionSchema = z.object({
  label: z.string().min(1),
  email: z.string().email().nullable().optional(),
  id: z.string().nullable().optional(),
});

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  commentId: z.string().min(1),
  body: z
    .string()
    .describe("Inline Markdown; may be empty when the reply has an image"),
  authorName: z.string().nullable().optional(),
  resolutionTarget: z.enum(["agent", "human"]).nullable().optional(),
  mentions: z.array(mentionSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  clientOperationId: z
    .string()
    .uuid()
    .optional()
    .describe("Stable UUID for retrying the same reply submission"),
});

export default defineAction({
  description:
    "Reply to an existing review comment thread with inline Markdown text without headings.",
  schema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const scope = {
      userEmail: actionCtx?.userEmail ?? null,
      orgId: actionCtx?.orgId ?? null,
    };
    const access = await assertReviewCommentAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
    );
    const clientOperationCommentId = args.clientOperationId
      ? reviewCommentIdForClientOperation(args.clientOperationId)
      : null;
    const existingReply = clientOperationCommentId
      ? await getReviewCommentById(clientOperationCommentId, scope, {
          bypassScope: true,
        })
      : null;
    const parent = await getReviewCommentById(args.commentId, scope, {
      bypassScope: true,
    });
    if (
      !parent ||
      parent.resourceType !== args.resourceType ||
      parent.resourceId !== args.resourceId
    ) {
      fail("Review comment not found", {
        statusCode: 404,
        errorCode: "not_found",
      });
    }
    // A retry of a reply that already saved goes on to the store, which
    // replays it while the thread is still there.
    if (parent.status === "deleted" && !existingReply) {
      const root = parent.parentCommentId
        ? await getReviewThreadRoot(
            parent.threadId,
            { resourceType: args.resourceType, resourceId: args.resourceId },
            scope,
            { bypassScope: true },
          )
        : parent;
      fail(
        !root || root.status === "deleted"
          ? "This thread was deleted."
          : "This comment was deleted.",
        { statusCode: 404, errorCode: "not_found" },
      );
    }
    if (parent.status !== "open" && !existingReply) {
      fail("This thread is resolved. Reopen it to reply.", {
        statusCode: 409,
        errorCode: "thread_not_open",
      });
    }
    const metadata = await sanitizeReviewCommentMetadata(args.metadata);
    assertReviewCommentHasContent(args.body, metadata);
    const mentions = normalizeReviewMentions([
      ...normalizeReviewMentions(args.mentions),
      ...extractReviewMentions(args.body),
    ]);

    const routeTarget =
      args.resolutionTarget ?? (mentions.length > 0 ? "human" : null);
    const input = {
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      threadId: parent.threadId,
      parentCommentId: parent.id,
      targetId: parent.targetId,
      surfaceId: parent.surfaceId,
      kind: parent.kind,
      // A retry rebuilds the reply from its parent, whose anchor may have moved
      // since, or been cleared when the parent was deleted. The saved reply
      // keeps the anchor it was sent with, and its kind and version with it.
      ...(existingReply?.parentCommentId === parent.id
        ? {
            anchor: existingReply.anchor,
            anchorKind: existingReply.anchorKind,
            anchorVersion: existingReply.anchorVersion,
          }
        : {
            anchor: parent.anchor,
            anchorKind: parent.anchorKind,
            anchorVersion: parent.anchorVersion,
          }),
      body: args.body,
      authorEmail: actionCtx?.userEmail ?? null,
      authorName: args.authorName ?? reviewAuthorNameFromContext(actionCtx),
      createdBy: actorKindFromContext(actionCtx),
      resolutionTarget: null,
      mentions,
      ownerEmail: access.ownerEmail ?? actionCtx?.userEmail ?? null,
      orgId: access.orgId ?? actionCtx?.orgId ?? null,
      visibility: normalizeReviewVisibility(access.visibility),
      metadata,
    };
    const resource = {
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    };
    const result = await (
      clientOperationCommentId
        ? insertReviewReplyIdempotently(
            {
              ...input,
              id: clientOperationCommentId,
            },
            routeTarget,
            resource,
          )
        : insertReviewReply(input, routeTarget, resource).then((comment) => ({
            comment,
            replayed: false,
          }))
    ).catch((error: unknown) => {
      // The thread changed between reading the parent and saving the reply, as
      // a delete or resolve in another tab does.
      if (error instanceof ReviewThreadNotOpenError) {
        fail("This thread is resolved. Reopen it to reply.", {
          statusCode: 409,
          errorCode: "thread_not_open",
        });
      }
      if (error instanceof ReviewThreadNotFoundError) {
        fail("This thread was deleted or resolved. Refresh to see it.", {
          statusCode: 404,
          errorCode: "not_found",
        });
      }
      // A retry of a reply that saved and was then deleted.
      if (error instanceof ReviewCommentDeletedError) {
        fail("This reply was deleted.", {
          statusCode: 404,
          errorCode: "not_found",
        });
      }
      throw error;
    });

    return {
      ...result.comment,
      replayed: result.replayed,
      notified: args.clientOperationId
        ? await notifyReviewCommentWithReceipt(result.comment)
        : await notifyReviewComment(result.comment),
    };
  },
  audit: {
    target: (args, result) => {
      const comment = result as {
        ownerEmail?: string | null;
        orgId?: string | null;
        visibility?: "private" | "org" | "public";
      };
      return {
        type: args.resourceType,
        id: args.resourceId,
        ownerEmail: comment.ownerEmail,
        orgId: comment.orgId,
        visibility: comment.visibility,
      };
    },
  },
});

function actorKindFromContext(
  ctx: ReviewResourceContext | undefined,
): ReviewActorKind {
  const caller = typeof ctx?.caller === "string" ? ctx.caller : "";
  if (caller === "agent" || caller === "tool") {
    return "agent";
  }
  return ctx?.userEmail ? "human" : "system";
}

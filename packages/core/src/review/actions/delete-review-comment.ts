import { z } from "zod";

import { currentInvocationEvidence } from "../../action-frame.js";
import {
  defineAction,
  fail,
  isOutsideAgentCall,
  type ActionRunContext,
} from "../../action.js";
import { ForbiddenError } from "../../sharing/access.js";
import { roleSatisfies } from "../../sharing/schema.js";
import {
  canCommentOnReviewableResource,
  resolveReviewableResourceAccess,
  reviewCommentPolicy,
  reviewWriteRefusal,
} from "../registry.js";
import {
  deleteReviewComment,
  getLiveReviewAuthorsByThread,
  getReviewCommentById,
} from "../store.js";
import { canDeleteReviewThread } from "../thread-delete.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  commentId: z.string().min(1),
  onlyOwnComments: z
    .boolean()
    .optional()
    .describe(
      "Refuse a delete that would take anyone else's comment, checked as the thread is locked, even for an editor. An agent deleting without its person's approval sets it.",
    ),
});

const PERSON_CALLERS = new Set(["frontend", "mcp-widget", "mcp-widget-write"]);

function agentNeedsDeleteApproval(
  resourceType: string,
  ctx: ReviewResourceContext | undefined,
): boolean {
  const caller = ctx?.caller;
  if (!caller || PERSON_CALLERS.has(caller)) return false;
  return (
    reviewCommentPolicy(resourceType).agentDeleteApproval ||
    isOutsideAgentCall(ctx as ActionRunContext | undefined)
  );
}

function deleteWasApproved(ctx: ActionRunContext | undefined): boolean {
  const evidence = currentInvocationEvidence();
  return Boolean(
    ctx?.approvedToolCallKey ||
    evidence?.approvedToolCallKey ||
    evidence?.mcpClientAccepted ||
    evidence?.auditOverride?.approval,
  );
}

export default defineAction({
  description:
    "Delete a review comment, clearing its text, mentions, anchor, image attachments and any resolution note. Deleting a thread's first comment deletes the whole thread, replies included, so it is allowed only to an editor or to the author of a thread that holds no one else's reply; deleting a reply removes only that reply.",
  schema,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  needsApproval: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    if (!agentNeedsDeleteApproval(args.resourceType, actionCtx)) return false;
    const access = await resolveReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
    );
    if (!access || !roleSatisfies(access.role, "editor")) return false;
    const comment = await getReviewCommentById(
      args.commentId,
      {},
      { bypassScope: true },
    );
    if (
      !comment ||
      comment.status === "deleted" ||
      comment.resourceType !== args.resourceType ||
      comment.resourceId !== args.resourceId
    ) {
      return false;
    }
    const authors = comment.parentCommentId
      ? [comment.authorEmail]
      : ((
          await getLiveReviewAuthorsByThread([comment.threadId], {
            resourceType: args.resourceType,
            resourceId: args.resourceId,
          })
        ).get(comment.threadId) ?? [comment.authorEmail]);
    const viewer = normalizeEmail(actionCtx?.userEmail);
    return authors.some((email) => normalizeEmail(email) !== viewer);
  },
  mcpTool: "search",
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const onlyOwnComments =
      Boolean(args.onlyOwnComments) ||
      (agentNeedsDeleteApproval(args.resourceType, actionCtx) &&
        !deleteWasApproved(ctx as ActionRunContext | undefined));
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
      fail("Review comment not found", {
        statusCode: 404,
        errorCode: "not_found",
      });
    }
    const isAuthor =
      Boolean(actionCtx?.userEmail) &&
      normalizeEmail(comment.authorEmail) ===
        normalizeEmail(actionCtx?.userEmail);
    if (!access || !canCommentOnReviewableResource(args.resourceType, access)) {
      throw new ForbiddenError(
        reviewWriteRefusal(
          args.resourceType,
          access,
          "Not allowed to delete this review comment",
        ),
      );
    }
    const isEditor = roleSatisfies(access.role, "editor");
    if (!isAuthor && !isEditor) {
      throw new ForbiddenError("Not allowed to delete this review comment");
    }
    const refuseOthers = () =>
      fail("This would delete another person's comment.", {
        statusCode: 409,
        errorCode: "approval_required",
      });
    if (!isAuthor && onlyOwnComments) refuseOthers();
    // raw-sql-ok: the helper's statements are constant text; the ids are bound.
    const updatedCount = await deleteReviewComment(
      comment.id,
      actionCtx?.userEmail ?? null,
      {
        assertThreadDeletable: (replyAuthorEmails) => {
          if (
            !canDeleteReviewThread({
              isEditor: isEditor && !onlyOwnComments,
              actorEmail: actionCtx?.userEmail,
              rootAuthorEmail: comment.authorEmail,
              replyAuthorEmails,
            })
          ) {
            if (isEditor) refuseOthers();
            throw new ForbiddenError(
              "Not allowed to delete a thread that has replies from other people",
            );
          }
        },
      },
    );
    if (updatedCount < 1) {
      // A comment already deleted, as a repeated request finds it, stays as
      // its first delete left it, and the request still succeeds.
      // raw-sql-ok: the helper's statement is constant text; the id is bound.
      const current = await getReviewCommentById(comment.id, scope, {
        bypassScope: true,
      });
      if (current?.status !== "deleted") {
        fail("Review comment not found", {
          statusCode: 404,
          errorCode: "not_found",
        });
      }
    }
    return { commentId: comment.id, deleted: true as const, updatedCount };
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

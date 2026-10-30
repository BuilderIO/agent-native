import { z } from "zod";

import { defineAction } from "../../action.js";
import { ForbiddenError } from "../../sharing/access.js";
import { roleSatisfies } from "../../sharing/schema.js";
import { resolveReviewableResourceAccess } from "../registry.js";
import { deleteReviewComment, getReviewCommentById } from "../store.js";
import { canDeleteReviewThread } from "../thread-delete.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  commentId: z.string().min(1),
});

export default defineAction({
  description:
    "Delete a review comment, clearing its text, mentions and image attachments. Deleting a thread's first comment deletes the whole thread, replies included, so it is allowed only to an editor or to the author of a thread that holds no one else's reply; deleting a reply removes only that reply.",
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
    if (!access || !roleSatisfies(access.role, "commenter")) {
      throw new ForbiddenError("Not allowed to delete this review comment");
    }
    const isEditor = roleSatisfies(access.role, "editor");
    if (!isAuthor && !isEditor) {
      throw new ForbiddenError("Not allowed to delete this review comment");
    }
    // raw-sql-ok: the helper's statements are constant text; the ids are bound.
    const updatedCount = await deleteReviewComment(
      comment.id,
      actionCtx?.userEmail ?? null,
      {
        assertThreadDeletable: (replyAuthorEmails) => {
          if (
            !canDeleteReviewThread({
              isEditor,
              actorEmail: actionCtx?.userEmail,
              rootAuthorEmail: comment.authorEmail,
              replyAuthorEmails,
            })
          ) {
            throw new ForbiddenError(
              "Not allowed to delete a thread that has replies from other people",
            );
          }
        },
      },
    );
    if (updatedCount < 1) {
      throw new Error("Review comment not found");
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

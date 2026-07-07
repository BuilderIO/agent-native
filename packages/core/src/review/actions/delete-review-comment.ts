import { z } from "zod";

import { defineAction } from "../../action.js";
import { ForbiddenError } from "../../sharing/access.js";
import { roleSatisfies } from "../../sharing/schema.js";
import { resolveReviewableResourceAccess } from "../registry.js";
import { deleteReviewComment, getReviewCommentById } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  commentId: z.string().min(1),
});

export default defineAction({
  description: "Soft-delete a review comment.",
  schema,
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
      comment.authorEmail === actionCtx?.userEmail;
    if (!isAuthor && (!access || !roleSatisfies(access.role, "editor"))) {
      throw new ForbiddenError("Not allowed to delete this review comment");
    }
    await deleteReviewComment(comment.id, actionCtx?.userEmail ?? null);
    return { commentId: comment.id, deleted: true };
  },
  audit: {
    target: (args) => ({
      type: args.resourceType,
      id: args.resourceId,
    }),
  },
});

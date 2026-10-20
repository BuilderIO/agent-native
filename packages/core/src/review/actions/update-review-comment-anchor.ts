import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { ForbiddenError } from "../../sharing/access.js";
import { roleSatisfies } from "../../sharing/schema.js";
import { resolveReviewableResourceAccess } from "../registry.js";
import { getReviewCommentById, updateReviewCommentAnchor } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  commentId: z.string().min(1),
  anchor: z.unknown().nullable(),
});

export default defineAction({
  description: "Move an anchored review comment to a new canvas position.",
  schema,
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const userEmail = actionCtx?.userEmail?.trim().toLowerCase();
    if (!userEmail) {
      fail("A signed-in user is required", {
        statusCode: 401,
        errorCode: "unauthenticated",
      });
    }
    const access = await resolveReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
    );
    const comment = await getReviewCommentById(
      args.commentId,
      {
        userEmail: actionCtx?.userEmail ?? null,
        orgId: actionCtx?.orgId ?? null,
      },
      { bypassScope: Boolean(access) },
    );
    if (
      !comment ||
      comment.resourceType !== args.resourceType ||
      comment.resourceId !== args.resourceId ||
      comment.status === "deleted"
    ) {
      fail("Review comment not found", {
        statusCode: 404,
        errorCode: "not_found",
      });
    }
    const isAuthor = comment.authorEmail?.trim().toLowerCase() === userEmail;
    if (!access || !roleSatisfies(access.role, "commenter")) {
      throw new ForbiddenError("Not allowed to move this review comment");
    }
    if (!isAuthor && !roleSatisfies(access.role, "editor")) {
      throw new ForbiddenError("Not allowed to move this review comment");
    }
    const updatedCount = await updateReviewCommentAnchor({
      commentId: comment.id,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      anchor: args.anchor,
    });
    if (updatedCount < 1) {
      fail("Review comment could not be moved", {
        statusCode: 404,
        errorCode: "not_found",
      });
    }
    return { commentId: comment.id, anchor: args.anchor, updatedCount };
  },
  audit: {
    target: (args) => ({
      type: args.resourceType,
      id: args.resourceId,
    }),
  },
});

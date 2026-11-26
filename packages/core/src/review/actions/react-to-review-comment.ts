import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { reviewReactionActor } from "../identity.js";
import { assertReviewCommentAccess } from "../registry.js";
import { getReviewCommentById, setReviewCommentReaction } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

export default defineAction({
  description:
    "Add or remove your reaction on a review comment. Leave out active to toggle it.",
  schema: z.object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    commentId: z.string().min(1),
    reaction: z.string().trim().min(1).max(32),
    active: z.boolean().optional(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  mcpTool: "search",
  run: async (args, ctx) => {
    await assertReviewCommentAccess(
      args.resourceType,
      args.resourceId,
      ctx as any,
    );
    const comment = await getReviewCommentById(
      args.commentId,
      {
        userEmail: (ctx as any)?.userEmail,
        orgId: (ctx as any)?.orgId,
      },
      { bypassScope: true },
    );
    if (
      !comment ||
      comment.status === "deleted" ||
      comment.resourceType !== args.resourceType ||
      comment.resourceId !== args.resourceId
    )
      fail("Review comment not found", {
        statusCode: 404,
        errorCode: "not_found",
      });
    const actorEmail = reviewReactionActor(ctx as ReviewResourceContext);
    if (!actorEmail)
      fail("A signed-in actor is required", {
        statusCode: 401,
        errorCode: "unauthenticated",
      });
    return setReviewCommentReaction({
      commentId: comment.id,
      actorEmail,
      reaction: args.reaction,
      ...(args.active === undefined ? {} : { active: args.active }),
    });
  },
});

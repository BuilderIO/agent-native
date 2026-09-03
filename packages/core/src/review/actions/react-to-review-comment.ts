import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertReviewableResourceAccess } from "../registry.js";
import { getReviewCommentById, setReviewCommentReaction } from "../store.js";

export default defineAction({
  description: "Add or remove your reaction on a review comment.",
  schema: z.object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    commentId: z.string().min(1),
    reaction: z.string().trim().min(1).max(32),
    active: z.boolean(),
  }),
  run: async (args, ctx) => {
    await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      ctx as any,
      "commenter",
    );
    const comment = await getReviewCommentById(args.commentId, {
      userEmail: (ctx as any)?.userEmail,
      orgId: (ctx as any)?.orgId,
    });
    if (
      !comment ||
      comment.resourceType !== args.resourceType ||
      comment.resourceId !== args.resourceId
    )
      throw new Error("Review comment not found");
    const actorEmail = (ctx as any)?.userEmail;
    if (!actorEmail) throw new Error("A signed-in actor is required");
    return setReviewCommentReaction({
      commentId: comment.id,
      actorEmail,
      reaction: args.reaction,
      active: args.active,
    });
  },
});

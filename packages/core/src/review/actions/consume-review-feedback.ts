import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertReviewableResourceAccess } from "../registry.js";
import { consumeReviewFeedback } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  commentIds: z.array(z.string().min(1)).min(1),
});

export default defineAction({
  description:
    "Mark review feedback as consumed by the agent or reviewer workflow.",
  schema,
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "editor",
    );
    const updatedCount = await consumeReviewFeedback(
      args.commentIds,
      undefined,
      {
        resourceType: args.resourceType,
        resourceId: args.resourceId,
      },
    );
    if (updatedCount < 1) {
      throw new Error("No matching review comments to consume");
    }
    return {
      consumedCommentIds: args.commentIds,
      updatedCount,
    };
  },
  audit: {
    target: (args) => ({
      type: args.resourceType,
      id: args.resourceId,
    }),
  },
});

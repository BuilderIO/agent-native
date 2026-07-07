import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertReviewableResourceAccess } from "../registry.js";
import { getReviewCommentById, resolveReviewThread } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  threadId: z.string().optional(),
  commentId: z.string().optional(),
});

export default defineAction({
  description: "Resolve an inline comment or review thread.",
  schema,
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "editor",
    );
    let threadId = args.threadId;
    if (!threadId && args.commentId) {
      const comment = await getReviewCommentById(
        args.commentId,
        {
          userEmail: actionCtx?.userEmail ?? null,
          orgId: actionCtx?.orgId ?? null,
        },
        { bypassScope: true },
      );
      if (
        !comment ||
        comment.resourceType !== args.resourceType ||
        comment.resourceId !== args.resourceId
      ) {
        throw new Error("Review comment not found");
      }
      threadId = comment.threadId;
    }
    if (!threadId) {
      throw new Error("Provide threadId or commentId");
    }
    const updatedCount = await resolveReviewThread(
      threadId,
      actionCtx?.userEmail ?? null,
      {
        resourceType: args.resourceType,
        resourceId: args.resourceId,
      },
    );
    if (updatedCount < 1) {
      throw new Error("Review thread not found");
    }
    return { threadId, resolved: true as const, updatedCount };
  },
  audit: {
    target: (args) => ({
      type: args.resourceType,
      id: args.resourceId,
    }),
  },
});

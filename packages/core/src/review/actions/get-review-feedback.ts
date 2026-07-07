import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertReviewableResourceAccess } from "../registry.js";
import { queryReviewComments } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  includeHumanTargeted: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export default defineAction({
  description:
    "Get open review feedback that is ready for the agent to consider.",
  schema,
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "viewer",
    );
    const comments = await queryReviewComments({
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      scope: {
        userEmail: actionCtx?.userEmail ?? null,
        orgId: actionCtx?.orgId ?? null,
      },
      bypassScope: true,
      includeResolved: false,
      includeDeleted: false,
      limit: args.limit,
    });
    return {
      comments: comments.filter((comment) => {
        if (comment.consumedAt) {
          return false;
        }
        if (args.includeHumanTargeted) {
          return true;
        }
        return comment.resolutionTarget !== "human";
      }),
    };
  },
});

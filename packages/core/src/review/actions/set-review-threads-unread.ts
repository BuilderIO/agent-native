import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { assertReviewableResourceAccess } from "../registry.js";
import { setReviewThreadUnreadPreferences } from "../store.js";

export default defineAction({
  description:
    "Mark multiple review threads unread or read for the current user.",
  schema: z.object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    threadIds: z.array(z.string().min(1)).min(1).max(500),
    unread: z.boolean(),
  }),
  run: async (args, ctx) => {
    await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      ctx as any,
      "viewer",
    );
    const userEmail = (ctx as any)?.userEmail;
    if (!userEmail)
      fail("A signed-in user is required", {
        statusCode: 401,
        errorCode: "unauthenticated",
      });
    try {
      return await setReviewThreadUnreadPreferences({
        threadIds: args.threadIds,
        userEmail,
        unread: args.unread,
        resource: {
          resourceType: args.resourceType,
          resourceId: args.resourceId,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Review thread not found")
        fail("Review thread not found", {
          statusCode: 404,
          errorCode: "not_found",
        });
      throw error;
    }
  },
});

import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertReviewableResourceAccess } from "../registry.js";
import { getReviewThreadRoot, setReviewThreadPreference } from "../store.js";

export default defineAction({
  description: "Mark a review thread unread or read for the current user.",
  schema: z.object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    threadId: z.string().min(1),
    unread: z.boolean(),
  }),
  run: async (args, ctx) => {
    await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      ctx as any,
      "viewer",
    );
    const root = await getReviewThreadRoot(
      args.threadId,
      { resourceType: args.resourceType, resourceId: args.resourceId },
      { userEmail: (ctx as any)?.userEmail, orgId: (ctx as any)?.orgId },
    );
    if (!root) throw new Error("Review thread not found");
    const userEmail = (ctx as any)?.userEmail;
    if (!userEmail) throw new Error("A signed-in user is required");
    return setReviewThreadPreference({
      threadId: args.threadId,
      userEmail,
      unread: args.unread,
    });
  },
});

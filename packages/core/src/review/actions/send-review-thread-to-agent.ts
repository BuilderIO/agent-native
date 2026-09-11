import { z } from "zod";

import { defineAction } from "../../action.js";
import { assertReviewableResourceAccess } from "../registry.js";
import { sendReviewThreadToAgent } from "../store.js";
import type { ReviewResourceContext } from "../types.js";

const schema = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  threadId: z.string().min(1),
});

export default defineAction({
  description:
    "Send one open review thread to the agent queue without routing other threads.",
  schema,
  run: async (args, ctx) => {
    const actionCtx = ctx as ReviewResourceContext | undefined;
    const access = await assertReviewableResourceAccess(
      args.resourceType,
      args.resourceId,
      actionCtx,
      "editor",
    );
    const updatedCount = await sendReviewThreadToAgent(args.threadId, {
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    });
    if (updatedCount < 1) {
      throw new Error("Open review thread not found");
    }
    return {
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      threadId: args.threadId,
      resolutionTarget: "agent" as const,
      consumedAt: null,
      updatedCount,
      ownerEmail: access.ownerEmail ?? actionCtx?.userEmail ?? null,
      orgId: access.orgId ?? actionCtx?.orgId ?? null,
      visibility: access.visibility ?? "private",
    };
  },
  audit: {
    target: (args, result) => {
      const routed = result as {
        ownerEmail?: string | null;
        orgId?: string | null;
        visibility?: "private" | "org" | "public";
      };
      return {
        type: args.resourceType,
        id: args.resourceId,
        ownerEmail: routed.ownerEmail,
        orgId: routed.orgId,
        visibility: routed.visibility,
      };
    },
    summary: (args) => `Sent review thread ${args.threadId} to the agent`,
  },
});

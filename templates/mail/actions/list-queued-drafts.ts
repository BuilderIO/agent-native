import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listQueuedDrafts } from "../server/lib/queued-drafts.js";

export default defineAction({
  description:
    "List queued email drafts for review, drafts requested by the current user, or all accessible queued drafts.",
  schema: z.object({
    scope: z
      .enum(["review", "requested", "all"])
      .optional()
      .describe(
        "review = drafts assigned to me, requested = drafts I asked others to send, all = both/admin view",
      ),
    status: z
      .enum(["queued", "in_review", "sent", "dismissed", "active", "all"])
      .optional()
      .describe("Filter by status. active includes queued and in_review."),
    ownerEmail: z
      .string()
      .optional()
      .describe("Admin-only: list another member's review queue"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Maximum drafts to return"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const drafts = await listQueuedDrafts({
      scope: args.scope,
      status: args.status,
      ownerEmail: args.ownerEmail,
      limit: args.limit,
    });
    return { drafts, count: drafts.length };
  },
});

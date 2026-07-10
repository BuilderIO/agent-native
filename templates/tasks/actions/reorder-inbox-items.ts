import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { reorderInboxItems, requireUserEmail } from "../server/inbox/store.js";

export default defineAction({
  description:
    "Reorder the inbox list by passing inbox item ids top-to-bottom.",
  schema: z.object({
    inboxItemIds: z
      .array(z.string())
      .min(1)
      .describe("Inbox item ids in the desired order from top to bottom."),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return reorderInboxItems({
      ownerEmail,
      inboxItemIds: args.inboxItemIds,
    });
  },
});

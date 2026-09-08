import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { reorderInboxItems, requireUserEmail } from "../server/inbox/store.js";
import { BULK_ID_LIMIT } from "../shared/bulk-limits.js";

export const reorderInboxItemsSchema = z.object({
  inboxItemIds: z
    .array(z.string())
    .min(1)
    .max(BULK_ID_LIMIT)
    .describe("Inbox item ids in the desired order from top to bottom."),
});

export default defineAction({
  description:
    "Reorder the inbox list by passing inbox item ids top-to-bottom.",
  schema: reorderInboxItemsSchema,
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return reorderInboxItems({
      ownerEmail,
      inboxItemIds: args.inboxItemIds,
    });
  },
});

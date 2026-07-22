import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { deleteInboxItems, requireUserEmail } from "../server/inbox/store.js";
import { BULK_ID_LIMIT } from "../shared/bulk-limits.js";

export const bulkDeleteInboxItemsSchema = z.object({
  inboxItemIds: z
    .array(z.string())
    .min(1)
    .max(BULK_ID_LIMIT)
    .describe("Inbox item ids to delete"),
});

export default defineAction({
  description:
    "Delete multiple inbox items permanently. Ask the user to confirm before calling.",
  schema: bulkDeleteInboxItemsSchema,
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return deleteInboxItems({
      ownerEmail,
      ids: args.inboxItemIds,
    });
  },
});

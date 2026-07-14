import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  bulkDeleteInboxItems,
  requireUserEmail,
} from "../server/inbox/store.js";
import { BULK_ID_LIMIT } from "../shared/bulk-limits.js";

export default defineAction({
  description:
    "Delete multiple inbox items permanently. Ask the user to confirm before calling.",
  schema: z.object({
    inboxItemIds: z
      .array(z.string())
      .min(1)
      .max(BULK_ID_LIMIT)
      .describe("Inbox item ids to delete"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return bulkDeleteInboxItems({
      ownerEmail,
      inboxItemIds: args.inboxItemIds,
    });
  },
});

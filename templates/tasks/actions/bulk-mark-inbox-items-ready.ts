import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  bulkMarkInboxItemsReady,
  requireUserEmail,
} from "../server/inbox/store.js";
import { BULK_ID_LIMIT } from "../shared/bulk-limits.js";

export default defineAction({
  description:
    "Promote multiple inbox items to incomplete tasks in one atomic batch.",
  schema: z.object({
    inboxItemIds: z
      .array(z.string())
      .min(1)
      .max(BULK_ID_LIMIT)
      .describe("Inbox item ids to mark ready"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    return bulkMarkInboxItemsReady({
      ownerEmail,
      inboxItemIds: args.inboxItemIds,
    });
  },
});

import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { deleteInboxItem, requireUserEmail } from "../server/inbox/store.js";

export const deleteInboxItemSchema = z.object({
  inboxItemId: z.string().describe("Inbox item id"),
});

export default defineAction({
  description:
    "Delete one inbox item permanently. Use bulk-delete-inbox-items for multiple items. Ask the user to confirm before calling.",
  schema: deleteInboxItemSchema,
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    await deleteInboxItem({ ownerEmail, id: args.inboxItemId });
    return { ok: true as const };
  },
});

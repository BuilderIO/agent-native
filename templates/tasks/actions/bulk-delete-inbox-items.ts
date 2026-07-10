import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { deleteInboxItem, requireUserEmail } from "../server/inbox/store.js";

export default defineAction({
  description:
    "Delete multiple inbox items permanently. Ask the user to confirm before calling.",
  schema: z.object({
    inboxItemIds: z
      .array(z.string())
      .min(1)
      .describe("Inbox item ids to delete"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    for (const id of args.inboxItemIds) {
      await deleteInboxItem({ ownerEmail, id });
    }
    return { ok: true as const, deleted: args.inboxItemIds.length };
  },
});

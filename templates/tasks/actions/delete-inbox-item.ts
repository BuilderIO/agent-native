import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { deleteInboxItem, requireUserEmail } from "../server/inbox/store.js";

export default defineAction({
  description:
    "Delete an inbox item permanently. Ask the user to confirm before calling.",
  schema: z.object({
    inboxItemId: z.string().describe("Inbox item id"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    await deleteInboxItem({ ownerEmail, id: args.inboxItemId });
    return { ok: true as const };
  },
});

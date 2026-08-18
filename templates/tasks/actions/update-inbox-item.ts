import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { UserInputError } from "../server/errors.js";
import { requireUserEmail, updateInboxItem } from "../server/inbox/store.js";

export const updateInboxItemSchema = z.object({
  inboxItemId: z.string().describe("Inbox item id"),
  title: z.string().min(1).optional().describe("New inbox item title"),
});

export default defineAction({
  description: "Update an inbox item title.",
  schema: updateInboxItemSchema,
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    if (args.title === undefined) {
      throw new UserInputError("Provide title to update.");
    }
    return updateInboxItem({
      ownerEmail,
      id: args.inboxItemId,
      title: args.title,
    });
  },
});

import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";
import { createInboxItem, requireUserEmail } from "../server/inbox/store.js";
import type { InboxItem } from "../server/inbox/store.js";

export default defineAction({
  description: "Create a not-ready inbox item with a title.",
  schema: z.object({
    title: z.string().min(1).describe("Inbox item title"),
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    const item = await createInboxItem({ ownerEmail, title: args.title });
    return item;
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const item = result as InboxItem;
    if (!item.id || !item.title) return null;
    return {
      url: buildDeepLink({
        view: "inbox",
        params: { inboxItemId: item.id },
      }),
      label: item.title,
    };
  },
});

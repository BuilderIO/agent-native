import { defineAction } from "@agent-native/core/action";
import { z } from "zod";
import { listInboxItems, requireUserEmail } from "../server/inbox/store.js";

export default defineAction({
  description: "List inbox items for the current user (not-ready capture).",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    const items = await listInboxItems({ ownerEmail });
    return { items };
  },
});

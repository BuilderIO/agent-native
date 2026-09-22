import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listInboxItems, requireUserEmail } from "../server/inbox/store.js";

export const listInboxItemsSchema = z.object({});

export default defineAction({
  description: "List not-ready inbox items awaiting triage.",
  schema: listInboxItemsSchema,
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const ownerEmail = requireUserEmail(ctx?.userEmail);
    const items = await listInboxItems({ ownerEmail });
    return { items };
  },
});

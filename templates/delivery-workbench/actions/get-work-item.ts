import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getWorkItem } from "../server/lib/work-items.js";

export default defineAction({
  description:
    "Get one canonical delivery work item with recent snapshots and routing suggestions.",
  schema: z.object({
    id: z.string().min(1),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    const item = await getWorkItem(id);
    if (!item) throw new Error(`Work item not found or inaccessible: ${id}`);
    return item;
  },
});

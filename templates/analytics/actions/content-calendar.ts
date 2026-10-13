import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getContentCalendar } from "../server/lib/notion";

export default defineAction({
  readOnly: true,
  description:
    "Get all entries from a Notion content calendar. Pass databaseId when a workspace has multiple matching databases; otherwise the action discovers the uniquely matching database by schema.",
  schema: z.object({
    databaseId: z
      .string()
      .optional()
      .describe(
        "Optional Notion database ID. Omit to discover a unique database with Topic, Status, and Publish Date properties.",
      ),
  }),
  http: { method: "GET" },
  grounding: true,
  run: async ({ databaseId }) => {
    const entries = await getContentCalendar(databaseId);
    return { entries, total: Array.isArray(entries) ? entries.length : 0 };
  },
});

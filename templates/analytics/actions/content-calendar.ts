import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getContentCalendar } from "../server/lib/notion";

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
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
  run: async ({ databaseId }) => {
    const entries = await getContentCalendar(databaseId);
    return { entries, total: Array.isArray(entries) ? entries.length : 0 };
  },
});

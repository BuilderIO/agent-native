import { defineAction } from "@agent-native/core";
import { getContentCalendar } from "../server/lib/notion";

export default defineAction({
  description: "Get all entries from the Notion content calendar.",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const entries = await getContentCalendar();
    return { entries, total: Array.isArray(entries) ? entries.length : 0 };
  },
});

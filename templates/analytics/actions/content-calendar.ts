import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getContentCalendar } from "../server/lib/notion";

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description: "Get all entries from the Notion content calendar.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const entries = await getContentCalendar();
    return { entries, total: Array.isArray(entries) ? entries.length : 0 };
  },
});

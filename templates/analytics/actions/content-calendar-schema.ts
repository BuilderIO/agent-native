import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getContentCalendarSchema } from "../server/lib/notion";

export default defineAction({
  description:
    "Get a Notion content calendar database schema. Pass databaseId when discovery would be ambiguous.",
  schema: z.object({
    databaseId: z.string().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ databaseId }) => {
    return await getContentCalendarSchema(databaseId);
  },
});

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getContentCalendarSchema } from "../server/lib/notion";

export default defineAction({
  description: "Get the Notion content calendar database schema.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    return await getContentCalendarSchema();
  },
});

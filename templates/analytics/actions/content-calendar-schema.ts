import { defineAction } from "@agent-native/core";
import { getContentCalendarSchema } from "../server/lib/notion";

export default defineAction({
  description: "Get the Notion content calendar database schema.",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    return await getContentCalendarSchema();
  },
});

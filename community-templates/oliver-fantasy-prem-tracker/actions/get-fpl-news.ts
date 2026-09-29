import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getNews } from "../server/lib/fpl.js";

export default defineAction({
  description:
    "Get the latest Fantasy Premier League news, tips, and team news headlines.",
  schema: z.object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(8)
      .describe("How many news items to return. Defaults to 8."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ limit }) => {
    const news = await getNews();
    return { news: news.slice(0, limit) };
  },
});

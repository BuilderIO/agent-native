import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getAllTopBlogKeywords } from "../server/lib/dataforseo";

export default defineAction({
  readOnly: true,
  description:
    "Get top ranked blog keywords across all blog pages, sorted by ETV.",
  schema: z.object({
    limit: z.coerce
      .number()
      .optional()
      .describe("Max keywords to return (default 500)"),
  }),
  http: { method: "GET" },
  grounding: true,
  run: async (args) => {
    const limit = Math.min(args.limit ?? 500, 1000);
    const keywords = await getAllTopBlogKeywords(limit);
    return { keywords, total: keywords.length };
  },
});

import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { searchProviderImages } from "../server/lib/media-search-providers.js";

export default defineAction({
  description: "Search for images using Google Custom Search API.",
  schema: z.object({
    q: z.string().optional().describe("Search query (required)"),
    count: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(10)
      .describe("Maximum number of image results to return."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const q = args.q;
    if (!q) {
      fail("Missing query parameter 'q'", {
        errorCode: "search_query_required",
        statusCode: 400,
      });
    }
    return searchProviderImages(q, args.count);
  },
});

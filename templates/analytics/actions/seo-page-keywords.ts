import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getRankedKeywordsForPage } from "../server/lib/dataforseo";

export default defineAction({
  description: "Get the top ranked keywords for a specific blog page by slug.",
  schema: z.object({
    slug: z
      .string()
      .optional()
      .describe("Blog page slug (e.g. micro-frontends)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (!args.slug) return { error: "slug is required" };
    const keywords = await getRankedKeywordsForPage(args.slug, 20);
    return { keywords };
  },
});

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getAllBlogPagesSeo } from "../server/lib/dataforseo";

export default defineAction({
  description: "Get SEO metrics for all blog pages.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const pages = await getAllBlogPagesSeo();
    return { pages, total: Object.keys(pages).length };
  },
});

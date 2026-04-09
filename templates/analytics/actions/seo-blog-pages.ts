import { defineAction } from "@agent-native/core";
import { getAllBlogPagesSeo } from "../server/lib/dataforseo";

export default defineAction({
  description: "Get SEO metrics for all blog pages.",
  parameters: {},
  http: { method: "GET" },
  run: async () => {
    const pages = await getAllBlogPagesSeo();
    return { pages, total: Object.keys(pages).length };
  },
});

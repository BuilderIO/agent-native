import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getAllBlogPagesSeo } from "../server/lib/dataforseo";

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description: "Get SEO metrics for all blog pages.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const pages = await getAllBlogPagesSeo();
    return { pages, total: Object.keys(pages).length };
  },
});

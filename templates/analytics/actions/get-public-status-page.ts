import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getPublicStatusPage } from "../server/lib/status-pages";

export default defineAction({
  description:
    "Read a published public status page by slug (unauthenticated, safe fields only).",
  schema: z.object({
    slug: z.string().describe("Public status page slug."),
  }),
  http: { method: "GET" },
  requiresAuth: false,
  readOnly: true,
  agentTool: false,
  run: async ({ slug }) => {
    const page = await getPublicStatusPage(slug);
    if (!page) {
      throw Object.assign(new Error("Status page not found"), {
        statusCode: 404,
      });
    }
    return page;
  },
});

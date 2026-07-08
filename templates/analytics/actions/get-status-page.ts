import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { getStatusPagePreview } from "../server/lib/status-pages";

export default defineAction({
  description:
    "Get one of the current user's status pages by id, with its config and a live preview (the same sanitized view the public page renders, including drafts).",
  schema: z.object({
    id: z.string().describe("Status page id."),
  }),
  http: { method: "GET" },
  run: async ({ id }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const result = await getStatusPagePreview(id, { email, orgId });
    if (!result) {
      throw Object.assign(new Error("Status page not found"), {
        statusCode: 404,
      });
    }
    return result;
  },
});

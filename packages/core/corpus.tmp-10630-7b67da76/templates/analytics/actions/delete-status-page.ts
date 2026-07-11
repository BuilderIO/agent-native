import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { deleteStatusPage } from "../server/lib/status-pages";

export default defineAction({
  description: "Delete one of the current user's public status pages by id.",
  schema: z.object({
    id: z.string().describe("Status page id."),
  }),
  http: { method: "DELETE" },
  run: async ({ id }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    await deleteStatusPage(id, { email, orgId });
    return { id, deleted: true };
  },
});

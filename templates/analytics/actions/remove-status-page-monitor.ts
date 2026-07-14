import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { removeStatusPageMonitor } from "../server/lib/status-pages";

export default defineAction({
  description: "Remove a monitor from a status page.",
  schema: z.object({
    id: z.string().describe("Status page id."),
    monitorId: z.string().describe("Monitor id to remove."),
  }),
  run: async ({ id, monitorId }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return removeStatusPageMonitor(id, monitorId, { email, orgId });
  },
});

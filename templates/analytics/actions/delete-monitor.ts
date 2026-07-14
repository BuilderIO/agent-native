import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { deleteMonitor } from "../server/lib/uptime-monitors";

export default defineAction({
  description:
    "Delete an uptime monitor and its check history and incident records.",
  schema: z.object({
    id: z.string().describe("Monitor id to delete."),
  }),
  http: { method: "POST" },
  run: async ({ id }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    await deleteMonitor(id, { email, orgId });
    return { ok: true, id };
  },
});

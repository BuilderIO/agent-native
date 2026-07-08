import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { reorderStatusPageMonitors } from "../server/lib/status-pages";

export default defineAction({
  description:
    "Reorder the monitors on a status page. Pass the full list of monitor ids in the desired display order.",
  schema: z.object({
    id: z.string().describe("Status page id."),
    monitorIds: z
      .array(z.string())
      .describe("All included monitor ids, in the desired order."),
  }),
  run: async ({ id, monitorIds }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return reorderStatusPageMonitors(id, monitorIds, { email, orgId });
  },
});

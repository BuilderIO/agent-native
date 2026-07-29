import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listDashboardViews } from "../server/lib/dashboards-store";

export default defineAction({
  agentTool: false,
  description: "List the saved filter views for a dashboard.",
  schema: z.object({
    dashboardId: z.string().min(1).describe("The dashboard ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const views = await listDashboardViews(args.dashboardId, { email, orgId });
    return { views };
  },
});

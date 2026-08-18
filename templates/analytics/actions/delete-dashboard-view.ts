import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { deleteDashboardView } from "../server/lib/dashboards-store";

export default defineAction({
  agentTool: false,
  description: "Delete a saved filter view from a dashboard.",
  schema: z.object({
    dashboardId: z.string().min(1).describe("The dashboard ID"),
    viewId: z.string().min(1).describe("The view ID to delete"),
  }),
  http: { method: "DELETE" },
  run: async (args) => {
    const email = getRequestUserEmail() ?? "";
    const orgId = getRequestOrgId() || null;
    await deleteDashboardView(args.dashboardId, args.viewId, { email, orgId });
    return { success: true };
  },
});

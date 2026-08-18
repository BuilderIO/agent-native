import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { saveDashboardView } from "../server/lib/dashboards-store";

export default defineAction({
  agentTool: false,
  description: "Create or update a saved filter view on a dashboard.",
  schema: z.object({
    dashboardId: z.string().min(1).describe("The dashboard ID"),
    id: z.string().optional().describe("Existing view ID when updating"),
    name: z.string().min(1).describe("View name"),
    filters: z
      .record(z.string(), z.string())
      .optional()
      .describe("Filter params to apply, e.g. { f_recentOnly: '2026-01-01' }"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const email = getRequestUserEmail() ?? "";
    const orgId = getRequestOrgId() || null;
    const view = await saveDashboardView(
      args.dashboardId,
      { id: args.id, name: args.name, filters: args.filters ?? {} },
      { email, orgId },
    );
    return { success: true, view };
  },
});

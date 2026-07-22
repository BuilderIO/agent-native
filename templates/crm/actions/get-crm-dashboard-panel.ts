import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { createProgramPanelSourceResolver } from "@agent-native/core/dashboard-storage";
import { z } from "zod";

import { crmDashboardStore } from "../server/db/index.js";
import { CRM_APP_ID } from "../server/lib/provider-api.js";
import { requireDashboardAccess } from "./_crm-dashboard.js";

const programResolver = createProgramPanelSourceResolver({ appId: CRM_APP_ID });

export default defineAction({
  description:
    "Resolve one program-backed panel from an access-scoped CRM dashboard for the dashboard UI.",
  schema: z.object({
    dashboardId: z.string().trim().min(1).max(200),
    panelId: z.string().trim().min(1).max(120),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ dashboardId, panelId }, ctx?: ActionRunContext) => {
    const access = requireDashboardAccess(ctx);
    const dashboard = await crmDashboardStore.get(dashboardId, access);
    if (!dashboard) throw new Error("CRM dashboard was not found.");
    const panel = dashboard.config.panels.find((item) => item.id === panelId);
    if (!panel) throw new Error("CRM dashboard panel was not found.");
    return programResolver.resolve(
      { source: panel.source, query: panel.query },
      { userEmail: access.userEmail, orgId: access.orgId ?? null },
    );
  },
});

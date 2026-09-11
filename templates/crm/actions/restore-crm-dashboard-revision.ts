import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import { crmDashboardStore } from "../server/db/index.js";
import { requireDashboardAccess } from "./_crm-dashboard.js";

export default defineAction({
  description:
    "Restore one revision of an access-scoped CRM dashboard. The restore is revision-aware and fails if the dashboard changed concurrently.",
  schema: z.object({
    id: z.string().trim().min(1).max(200),
    revisionId: z.string().trim().min(1).max(200),
  }),
  run: async ({ id, revisionId }, ctx?: ActionRunContext) => {
    const dashboard = await crmDashboardStore.restore(
      id,
      revisionId,
      requireDashboardAccess(ctx),
    );
    if (!dashboard) throw new Error("CRM dashboard revision was not found.");
    return dashboard;
  },
});

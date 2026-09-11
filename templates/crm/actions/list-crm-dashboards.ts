import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import { crmDashboardStore } from "../server/db/index.js";
import { requireDashboardAccess } from "./_crm-dashboard.js";

export default defineAction({
  description:
    "List up to 50 active CRM dashboards the current user can access.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx?: ActionRunContext) =>
    (await crmDashboardStore.list(requireDashboardAccess(ctx))).slice(0, 50),
});

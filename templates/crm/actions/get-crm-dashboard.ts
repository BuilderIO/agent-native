import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import { crmDashboardStore } from "../server/db/index.js";
import { requireDashboardAccess } from "./_crm-dashboard.js";

export default defineAction({
  description: "Get one access-scoped CRM dashboard by ID.",
  schema: z.object({ id: z.string().trim().min(1).max(200) }),
  http: { method: "GET" },
  readOnly: true,
  run: ({ id }, ctx?: ActionRunContext) =>
    crmDashboardStore.get(id, requireDashboardAccess(ctx)),
});

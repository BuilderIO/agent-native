import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { listDashboardReportSubscriptions } from "../server/lib/dashboard-report-subscriptions";

export default defineAction({
  description:
    "List daily email report subscriptions for an analytics dashboard.",
  schema: z.object({
    dashboardId: z.string().optional().describe("Optional dashboard ID filter"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return listDashboardReportSubscriptions({ email, orgId }, args.dashboardId);
  },
});

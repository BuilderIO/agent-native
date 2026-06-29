import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { deleteDashboardReportSubscription } from "../server/lib/dashboard-report-subscriptions";

export default defineAction({
  description:
    "Delete a daily email report subscription for an analytics dashboard.",
  schema: z.object({
    id: z.string().describe("Subscription ID to delete"),
  }),
  http: { method: "DELETE" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    await deleteDashboardReportSubscription(args.id, { email, orgId });
    return { id: args.id, success: true };
  },
});

import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { sendDashboardReportSubscription } from "../server/lib/dashboard-report";
import {
  getDashboardReportSubscription,
  markDashboardReportResult,
  markDashboardReportRunning,
} from "../server/lib/dashboard-report-subscriptions";

export default defineAction({
  description:
    "Send a dashboard email report subscription immediately to its saved recipients.",
  schema: z.object({
    id: z.string().describe("Subscription ID to send now"),
  }),
  http: { method: "POST" },
  needsApproval: true,
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const sub = await getDashboardReportSubscription(args.id, {
      email,
      orgId,
    });
    if (!sub) {
      throw Object.assign(new Error("Report subscription not found"), {
        statusCode: 404,
      });
    }

    const startedAt = new Date().toISOString();
    await markDashboardReportRunning(sub.id, startedAt);
    try {
      const result = await sendDashboardReportSubscription(sub);
      await markDashboardReportResult(sub, "success");
      return { id: sub.id, success: true, ...result };
    } catch (err: any) {
      await markDashboardReportResult(
        sub,
        "error",
        err?.message ?? String(err),
      );
      throw err;
    }
  },
});

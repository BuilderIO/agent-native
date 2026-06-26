import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { sendDashboardReportSubscription } from "../server/lib/dashboard-report";
import {
  claimDashboardReportSubscription,
  getDashboardReportSubscription,
  markDashboardReportResult,
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

    const claimed = await claimDashboardReportSubscription(sub.id, {
      email,
      orgId,
    });
    if (!claimed) {
      throw Object.assign(new Error("Report subscription is already sending"), {
        statusCode: 409,
      });
    }

    try {
      const result = await sendDashboardReportSubscription(claimed);
      await markDashboardReportResult(claimed, "success");
      return { id: claimed.id, success: true, ...result };
    } catch (err: any) {
      await markDashboardReportResult(
        claimed,
        "error",
        err?.message ?? String(err),
      );
      throw err;
    }
  },
});

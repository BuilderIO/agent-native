import { defineAction } from "@agent-native/core";
import {
  getAppProductionUrl,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { runDashboardReportsOnce } from "../server/jobs/dashboard-report";
import {
  getDashboardReportSubscription,
  queueDashboardReportSubscriptionNow,
} from "../server/lib/dashboard-report-subscriptions";

function netlifyOwnsDashboardReportSweep(): boolean {
  return process.env.NETLIFY === "true";
}

function appOrigin(): string {
  return (
    process.env.URL ||
    process.env.DEPLOY_URL ||
    getAppProductionUrl()
  ).replace(/\/+$/, "");
}

async function triggerDashboardReportSweep(): Promise<{
  mode: "netlify-background" | "inline-sweep";
  triggerStatus?: number;
  processed?: number;
  failed?: number;
  remaining?: number;
}> {
  if (netlifyOwnsDashboardReportSweep()) {
    const response = await fetch(
      new URL("/.netlify/functions/dashboard-report-cron", `${appOrigin()}/`),
      { method: "POST" },
    );
    if (!response.ok && response.status !== 202 && response.status !== 204) {
      throw Object.assign(
        new Error(
          `Dashboard report background trigger failed with ${response.status}`,
        ),
        { statusCode: 502 },
      );
    }
    return { mode: "netlify-background", triggerStatus: response.status };
  }

  return { mode: "inline-sweep", ...(await runDashboardReportsOnce()) };
}

export default defineAction({
  description:
    "Queue a dashboard email report subscription to send immediately to its saved recipients.",
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

    const queued = await queueDashboardReportSubscriptionNow(sub.id, {
      email,
      orgId,
    });
    if (!queued) {
      throw Object.assign(new Error("Report subscription not found"), {
        statusCode: 404,
      });
    }
    const trigger = await triggerDashboardReportSweep();
    return { id: queued.id, success: true, queued: true, ...trigger };
  },
});

import { defineAction } from "@agent-native/core/action";
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
import { guardWrite, idempotencyKeyArg } from "../server/lib/guarded-writes";

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

function subscriptionNotFound(): never {
  throw Object.assign(new Error("Report subscription not found"), {
    statusCode: 404,
  });
}

export default defineAction({
  description:
    "Queue a dashboard email report subscription to send immediately to its saved recipients.",
  schema: z.object({
    id: z.string().min(1).describe("Subscription ID to send now"),
    idempotencyKey: idempotencyKeyArg,
  }),
  http: { method: "POST" },
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  needsApproval: true,
  retrySafe: ({ idempotencyKey }) => idempotencyKey !== undefined,
  run: async ({ id, idempotencyKey }, actionContext) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const ctx = { email, orgId: getRequestOrgId() || null };
    const guard = guardWrite({
      action: "send-dashboard-report-now",
      target: { kind: "report-subscription", id },
      caller: actionContext?.caller,
      scope: ctx,
      idempotencyKey,
      request: {},
    });
    guard.requireKey();
    const outcome = await guard.run(
      async () =>
        (await getDashboardReportSubscription(id, ctx)) ??
        subscriptionNotFound(),
      async () =>
        (await queueDashboardReportSubscriptionNow(
          id,
          ctx,
          new Date(),
          guard.onCommit,
        )) ?? subscriptionNotFound(),
    );
    if ("replayed" in outcome) {
      return {
        id,
        success: true,
        queued: true,
        ...outcome.replayed,
        message: `Already queued at ${outcome.replayed.writeReceipt.appliedAt} by an earlier request with this idempotencyKey; nothing was sent again.`,
      };
    }
    const trigger = await triggerDashboardReportSweep();
    return {
      id: outcome.written.id,
      success: true,
      queued: true,
      ...trigger,
      ...(guard.receipt ? { writeReceipt: guard.receipt } : {}),
    };
  },
});

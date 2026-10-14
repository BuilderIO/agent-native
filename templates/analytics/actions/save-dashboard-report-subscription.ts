import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  isSlackWebhookUrl,
  MAX_DASHBOARD_REPORT_RECIPIENTS,
  SLACK_WEBHOOK_URL_MESSAGE,
  saveDashboardReportSubscription,
} from "../server/lib/dashboard-report-subscriptions";

export default defineAction({
  description:
    "Create or update a daily report subscription for an analytics dashboard. Delivers by email to recipients, to a Slack channel through its incoming webhook, or both.",
  schema: z.object({
    id: z.string().optional().describe("Existing subscription ID to update"),
    dashboardId: z.string().describe("Dashboard ID to email"),
    name: z.string().optional().describe("Human-readable subscription name"),
    recipients: z
      .array(z.string().email())
      .default([])
      .describe(
        `Email recipients (maximum ${MAX_DASHBOARD_REPORT_RECIPIENTS}; use a mailing-list address for larger audiences). Optional when slackWebhookUrl is set.`,
      ),
    slackWebhookUrl: z
      .string()
      .refine((value) => !value.trim() || isSlackWebhookUrl(value), {
        message: SLACK_WEBHOOK_URL_MESSAGE,
      })
      .nullable()
      .optional()
      .describe(
        "Slack incoming webhook URL (https://hooks.slack.com/...) for the channel to post the report summary and dashboard link to. Optional when recipients are set.",
      ),
    filters: z
      .record(z.string(), z.string())
      .optional()
      .describe("Dashboard URL filters to apply, including f_ keys"),
    timeOfDay: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
      .describe("Local send time in HH:mm"),
    timezone: z.string().describe("IANA timezone for the send time"),
    enabled: z.boolean().default(true),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return saveDashboardReportSubscription(args, { email, orgId });
  },
});

import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { saveAnalyticsAlertRule } from "../server/lib/analytics-alerts";

const filterSchema = z.object({
  field: z
    .string()
    .describe(
      "Analytics field path, e.g. event_name, app, template, properties.error_code, or context.url.",
    ),
  op: z
    .enum(["equals", "not_equals", "contains", "in", "exists"])
    .optional()
    .describe("Filter operator; defaults to equals."),
  value: z.unknown().optional().describe("Value to compare against."),
});

export default defineAction({
  description:
    "Create or update a reusable alert rule over first-party analytics events.",
  schema: z.object({
    id: z.string().optional().describe("Existing alert rule ID to update"),
    name: z.string().describe("Human-readable alert name"),
    description: z.string().optional(),
    eventName: z
      .string()
      .optional()
      .nullable()
      .describe("Optional exact event name to target before filters run."),
    filters: z
      .array(filterSchema)
      .optional()
      .describe("Generic event filters evaluated over columns/properties."),
    thresholdMode: z
      .enum(["event_count", "distinct_count"])
      .optional()
      .describe("Count matching events or distinct values."),
    distinctBy: z
      .string()
      .optional()
      .nullable()
      .describe("Field path used when thresholdMode is distinct_count."),
    threshold: z.number().int().min(1),
    windowMinutes: z.number().int().min(1).max(1440),
    cooldownMinutes: z.number().int().min(0).max(1440).optional(),
    severity: z.enum(["warning", "critical"]).optional(),
    channels: z
      .array(z.string())
      .optional()
      .describe("Notification channels, e.g. inbox, email, slack, webhook."),
    emailRecipients: z
      .array(z.string().email())
      .optional()
      .describe("Email recipients passed to the generic email channel."),
    slackWebhookUrl: z
      .string()
      .optional()
      .nullable()
      .describe(
        "Optional Slack incoming webhook URL for this alert rule. Overrides NOTIFICATIONS_SLACK_WEBHOOK_URL when set.",
      ),
    webhookUrl: z
      .string()
      .optional()
      .nullable()
      .describe(
        "Optional generic webhook URL for this alert rule. Overrides NOTIFICATIONS_WEBHOOK_URL when set.",
      ),
    enabled: z.boolean().optional(),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    return saveAnalyticsAlertRule(args, { email, orgId });
  },
});

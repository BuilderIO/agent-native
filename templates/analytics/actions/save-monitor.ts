import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
  buildDeepLink,
  getAppProductionUrl,
} from "@agent-native/core/server";
import { z } from "zod";

import { hostFromUrl, saveMonitor } from "../server/lib/uptime-monitors";

/**
 * Friendly default name from a URL: the host without a leading `www.`
 * (e.g. `example.com` from `https://www.example.com/health`). Keeps
 * agent-created monitors sensible when no name is provided.
 */
function deriveNameFromUrl(url: string): string {
  return hostFromUrl((url ?? "").trim()).replace(/^www\./i, "");
}

const assertionSchema = z.object({
  type: z
    .enum([
      "body_contains",
      "body_absent",
      "header_contains",
      "header_equals",
      "max_latency_ms",
    ])
    .describe(
      "Assertion type: body_contains/body_absent check the response text; header_contains/header_equals check a response header; max_latency_ms flags a slow response (degraded).",
    ),
  value: z
    .union([z.string(), z.number()])
    .describe(
      "Expected value: text for body/header checks, milliseconds for max_latency_ms.",
    ),
  header: z
    .string()
    .optional()
    .describe("Header name (required for header_contains / header_equals)."),
});

const statusMatcherSchema = z
  .union([
    z.object({
      mode: z.literal("class"),
      classes: z
        .array(z.string())
        .describe('Status classes to accept, e.g. ["2xx","3xx"].'),
    }),
    z.object({
      mode: z.literal("list"),
      codes: z
        .array(z.number().int())
        .describe("Exact status codes to accept, e.g. [200,204]."),
    }),
    z.object({
      mode: z.literal("range"),
      min: z.number().int(),
      max: z.number().int(),
    }),
  ])
  .describe(
    "Which HTTP status counts as healthy. Defaults to the 2xx class when omitted.",
  );

export default defineAction({
  description:
    "Create or update an uptime monitor that pings a URL on a schedule and alerts when it is down, returns the wrong status, is too slow, or its body is missing/contains specific text. Returns the saved monitor and a focused Analytics link.",
  schema: z.object({
    id: z.string().optional().describe("Existing monitor id to update."),
    name: z
      .string()
      .optional()
      .describe(
        "Human-readable monitor name. Optional — defaults to the URL host (without www) when omitted or blank.",
      ),
    url: z.string().describe("Absolute http(s) URL to probe."),
    method: z
      .enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
      .optional()
      .describe("HTTP method for the probe (default GET)."),
    requestHeaders: z
      .record(z.string(), z.string())
      .optional()
      .describe("Extra request headers as a key/value object."),
    requestBody: z
      .string()
      .nullable()
      .optional()
      .describe("Optional request body for POST/PUT/PATCH."),
    intervalSeconds: z
      .number()
      .int()
      .min(30)
      .max(86400)
      .optional()
      .describe("How often to check, in seconds (default 300, min 30)."),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(120000)
      .optional()
      .describe("Request timeout in milliseconds (default 10000)."),
    expectedStatus: statusMatcherSchema.optional(),
    assertions: z
      .array(assertionSchema)
      .optional()
      .describe("Response-body/header/latency assertions to evaluate."),
    followRedirects: z
      .boolean()
      .optional()
      .describe("Follow 3xx redirects to allowed hosts (default true)."),
    severity: z
      .enum(["warning", "critical"])
      .optional()
      .describe("Alert severity when the monitor fails (default critical)."),
    channels: z
      .array(z.string())
      .optional()
      .describe("Notification channels, e.g. inbox, email, slack, webhook."),
    emailRecipients: z
      .array(z.string().email())
      .optional()
      .describe("Email recipients used by the email channel."),
    slackWebhookUrl: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Optional Slack incoming webhook URL for this monitor. Overrides NOTIFICATIONS_SLACK_WEBHOOK_URL when set.",
      ),
    webhookUrl: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Optional generic webhook URL for this monitor. Overrides NOTIFICATIONS_WEBHOOK_URL when set.",
      ),
    cooldownMinutes: z
      .number()
      .int()
      .min(0)
      .max(1440)
      .optional()
      .describe(
        "Minutes to suppress a repeat 'down' alert after a recent recovery (anti-flap; default 15).",
      ),
    enabled: z.boolean().optional().describe("Whether the monitor is active."),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const name = args.name?.trim() || deriveNameFromUrl(args.url);
    const monitor = await saveMonitor({ ...args, name }, { email, orgId });
    return {
      ...monitor,
      monitorAppUrl: `${getAppProductionUrl()}/monitoring?view=uptime&monitor=${encodeURIComponent(monitor.id)}`,
    };
  },
  link: ({ result }) => {
    const saved = result as { id?: string; monitorAppUrl?: string } | null;
    const id = saved?.id;
    if (!id) return null;
    return {
      url:
        saved?.monitorAppUrl ??
        buildDeepLink({
          app: "analytics",
          view: "monitoring",
          to: `/monitoring?view=uptime&monitor=${encodeURIComponent(id)}`,
          params: { monitoringView: "uptime", monitorId: id },
        }),
      label: "Open monitor in Analytics",
      view: "monitoring",
    };
  },
});

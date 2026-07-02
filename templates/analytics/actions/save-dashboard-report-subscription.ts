import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { saveDashboardReportSubscription } from "../server/lib/dashboard-report-subscriptions";

export default defineAction({
  description:
    "Create or update a daily email report subscription for an analytics dashboard.",
  schema: z.object({
    id: z.string().optional().describe("Existing subscription ID to update"),
    dashboardId: z.string().describe("Dashboard ID to email"),
    name: z.string().optional().describe("Human-readable subscription name"),
    recipients: z.array(z.string().email()).min(1).describe("Email recipients"),
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

import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  getMonitorStats,
  listOwnedMonitorIds,
  type MonitorStats,
} from "../server/lib/monitor-stats";

export default defineAction({
  description:
    "Get aggregated uptime stats for the current user's monitors: current status, uptime % over 24h/7d/30d/90d, a bucketed uptime timeline, a recent response-time series, incident count, and MTBF. Pass monitorIds to scope to specific monitors, or omit to include all.",
  schema: z.object({
    monitorIds: z
      .array(z.string())
      .optional()
      .describe("Monitor ids to include. Omit for all of the user's monitors."),
    timelineDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("Trailing daily buckets for the uptime timeline (default 90)."),
    responseWindowHours: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .optional()
      .describe(
        "Trailing hours for the hourly response-time series (default 24).",
      ),
  }),
  http: { method: "GET" },
  run: async ({ monitorIds, timelineDays, responseWindowHours }) => {
    const email = getRequestUserEmail();
    if (!email) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() || null;
    const ctx = { email, orgId };
    const ids =
      monitorIds && monitorIds.length > 0
        ? monitorIds
        : await listOwnedMonitorIds(ctx);
    const stats = await getMonitorStats(ctx, ids, {
      timelineDays,
      responseWindowHours,
    });
    return Array.from(stats.values()) satisfies MonitorStats[];
  },
});

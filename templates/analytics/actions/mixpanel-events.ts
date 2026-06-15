import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { queryEvents, getTopEvents } from "../server/lib/mixpanel";

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description:
    "Query Mixpanel event data. Supports date-range event export and top-events lookup. " +
    "For advanced Mixpanel queries (funnels, segmentation, retention, insights, cohorts), " +
    "use provider-api-request with provider: 'mixpanel' to call the Mixpanel API directly.",
  schema: z.object({
    event: z.string().optional().describe("Event name to filter by"),
    days: z.coerce
      .number()
      .optional()
      .describe("Number of days to look back (default 30)"),
    startDate: z
      .string()
      .optional()
      .describe(
        "Start date in YYYY-MM-DD format (overrides days if provided with endDate)",
      ),
    endDate: z
      .string()
      .optional()
      .describe(
        "End date in YYYY-MM-DD format (overrides days if provided with startDate)",
      ),
    topEvents: z
      .enum(["general", "average", "unique"])
      .optional()
      .describe(
        "Instead of querying specific events, return the top N events by type: 'general' (total), 'average' (per-user avg), or 'unique' (unique users)",
      ),
    topEventsLimit: z.coerce
      .number()
      .optional()
      .describe(
        "Number of top events to return when topEvents is set (default 10)",
      ),
  }),
  http: false,
  run: async (args) => {
    if (args.topEvents) {
      return await getTopEvents(args.topEvents, args.topEventsLimit ?? 10);
    }

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    let start: string;
    let end: string;

    if (args.startDate && args.endDate) {
      start = args.startDate;
      end = args.endDate;
    } else {
      const days = args.days ?? 30;
      const endDate = new Date();
      const startDate = new Date(
        endDate.getTime() - days * 24 * 60 * 60 * 1000,
      );
      start = fmt(startDate);
      end = fmt(endDate);
    }

    const eventNames = args.event ? [args.event] : undefined;
    return await queryEvents(start, end, eventNames);
  },
});

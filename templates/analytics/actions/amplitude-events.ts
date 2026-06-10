import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { queryEvents, getUserSegmentation } from "../server/lib/amplitude";

export default defineAction({
  description:
    "Query Amplitude analytics event data. Returns daily event counts segmented over time. " +
    "For more advanced Amplitude queries (user segmentation, funnels, retention, property filters, cohorts), " +
    "use provider-api-request with provider: 'amplitude' to call the Amplitude API directly.",
  schema: z.object({
    event: z.string().optional().describe("Event name to query (required)"),
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
    groupBy: z
      .string()
      .optional()
      .describe(
        "Event property to group results by (e.g. 'country', 'platform', 'version')",
      ),
  }),
  http: false,
  run: async (args) => {
    if (!args.event) return { error: "event is required" };

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

    if (args.groupBy) {
      return await getUserSegmentation(args.event, start, end, args.groupBy);
    }
    return await queryEvents(args.event, start, end);
  },
});

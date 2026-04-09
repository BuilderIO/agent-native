import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { queryEvents } from "../server/lib/mixpanel";

export default defineAction({
  description: "Query Mixpanel event data.",
  schema: z.object({
    event: z.string().optional().describe("Event name to filter by"),
    days: z.coerce
      .number()
      .optional()
      .describe("Number of days to look back (default 30)"),
  }),
  http: false,
  run: async (args) => {
    const days = args.days ?? 30;
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const eventNames = args.event ? [args.event] : undefined;
    return await queryEvents(fmt(start), fmt(end), eventNames);
  },
});

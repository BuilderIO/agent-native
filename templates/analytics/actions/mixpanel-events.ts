import { defineAction } from "@agent-native/core";
import { queryEvents } from "../server/lib/mixpanel";

export default defineAction({
  description: "Query Mixpanel event data.",
  parameters: {
    event: { type: "string", description: "Event name to filter by" },
    days: {
      type: "string",
      description: "Number of days to look back (default 30)",
    },
  },
  http: false,
  run: async (args) => {
    const days = parseInt(args.days || "30", 10);
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const eventNames = args.event ? [args.event] : undefined;
    return await queryEvents(fmt(start), fmt(end), eventNames);
  },
});

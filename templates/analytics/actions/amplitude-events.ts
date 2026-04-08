import { defineAction } from "@agent-native/core";
import { queryEvents } from "../server/lib/amplitude";

export default defineAction({
  description: "Query Amplitude analytics event data.",
  parameters: {
    event: { type: "string", description: "Event name to query (required)" },
    days: {
      type: "string",
      description: "Number of days to look back (default 30)",
    },
  },
  http: false,
  run: async (args) => {
    if (!args.event) return { error: "event is required" };

    const days = parseInt(args.days || "30", 10);
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    return await queryEvents(args.event, fmt(start), fmt(end));
  },
});

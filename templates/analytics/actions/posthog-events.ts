import { defineAction } from "@agent-native/core";
import { queryEvents } from "../server/lib/posthog";

export default defineAction({
  description: "Query PostHog analytics event data.",
  parameters: {
    event: { type: "string", description: "Event name to filter by" },
    limit: { type: "string", description: "Max results (default 100)" },
  },
  http: false,
  run: async (args) => {
    const event = args.event || undefined;
    const limit = parseInt(args.limit || "100", 10);
    return await queryEvents(event, limit);
  },
});

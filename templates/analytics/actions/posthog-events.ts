import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { queryEvents } from "../server/lib/posthog";

export default defineAction({
  description: "Query PostHog analytics event data.",
  schema: z.object({
    event: z.string().optional().describe("Event name to filter by"),
    limit: z.coerce.number().optional().describe("Max results (default 100)"),
  }),
  http: false,
  run: async (args) => {
    const event = args.event || undefined;
    const limit = args.limit ?? 100;
    return await queryEvents(event, limit);
  },
});

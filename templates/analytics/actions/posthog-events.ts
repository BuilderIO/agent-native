import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { queryEvents } from "../server/lib/posthog";

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description:
    "Query PostHog analytics event data. Returns raw event records for a given event name. " +
    "For advanced PostHog queries (trends, funnels, retention, cohorts, feature flags, persons), " +
    "use provider-api-request with provider: 'posthog' to call the PostHog API directly.",
  schema: z.object({
    event: z.string().optional().describe("Event name to filter by"),
    limit: z.coerce
      .number()
      .optional()
      .describe(
        "Max results to return (default 100, increase for broader coverage)",
      ),
    after: z
      .string()
      .optional()
      .describe(
        "ISO timestamp to return events after (for pagination or date filtering, e.g. '2026-01-01T00:00:00Z')",
      ),
  }),
  http: false,
  run: async (args) => {
    const event = args.event || undefined;
    const limit = args.limit ?? 100;
    const after = args.after || undefined;
    return await queryEvents(event, limit, after);
  },
});

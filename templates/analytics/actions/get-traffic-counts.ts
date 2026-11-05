import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { queryFirstPartyAnalytics } from "../server/lib/first-party-analytics.js";
import {
  readTrafficCounts,
  trafficCountsSql,
} from "../server/lib/traffic-environment.js";

const DEFAULT_DAYS = 7;

export default defineAction({
  description:
    "Count first-party events from recent days by traffic: `production`, `beta` (including PR previews and local runs), and `unknown`, the events with no host and no recorded environment. Unknown events are also inside `production`, because they count as production when a read filters by traffic. Excludes `http.response` events.",
  schema: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe(
        `How many calendar days to count, today included. Defaults to ${DEFAULT_DAYS}.`,
      ),
  }),
  outputSchema: z.object({
    days: z.number(),
    production: z.number(),
    beta: z.number(),
    unknown: z.number(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ days = DEFAULT_DAYS }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("no authenticated user", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 10);
    const result = await queryFirstPartyAnalytics(
      trafficCountsSql(since),
      { userEmail, orgId: getRequestOrgId() || null },
      { cache: true },
    );
    return { days, ...readTrafficCounts(result.rows) };
  },
});

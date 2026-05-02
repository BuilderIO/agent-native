import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { queryFirstPartyAnalytics } from "../server/lib/first-party-analytics.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Query first-party analytics events recorded through this app's analytics collector endpoint (/track). Use this for questions about pageviews, events, app/site traffic, template/app usage, and other first-party event data in the analytics_events table when the user is asking about data collected by this analytics app. Use source-specific actions such as BigQuery, GA4, Mixpanel, PostHog, or Amplitude when the user asks for those sources or the relevant data lives there. SQL may read analytics_events only; reads are automatically scoped to the current user/org.",
  schema: z.object({
    sql: z
      .string()
      .describe(
        "Read-only SQL over analytics_events, e.g. SELECT COUNT(*) AS pageviews FROM analytics_events WHERE event_name = 'pageview' AND timestamp >= '2026-05-01T04:00:00Z' AND timestamp < '2026-05-02T04:00:00Z'",
      ),
  }),
  http: false,
  run: async (args) => {
    return queryFirstPartyAnalytics(args.sql, resolveScope());
  },
});

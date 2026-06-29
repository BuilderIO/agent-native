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
    "Query first-party analytics events recorded through this app's analytics collector endpoint (/track) and session replay summaries recorded through /api/analytics/replay. Use this for questions about app/site traffic, product events, template/app usage, conversions, session recordings, and other first-party data collected by this analytics app. Use source-specific actions such as BigQuery, GA4, Mixpanel, PostHog, or Amplitude when the user asks for those sources or the relevant data lives there. SQL may read analytics_events and session_recordings only; session_replay_chunks is intentionally unavailable, and reads are automatically scoped to the current user/org. analytics_events columns include event_name, timestamp, event_date, user_id, anonymous_id, user_key, session_id, app, template, signed_in, url, path, hostname, referrer, properties, and context. session_recordings columns include id, session_id, user_id, anonymous_id, user_key, started_at, ended_at, duration_ms, chunk_count, event_count, page_count, error_count, rage_click_count, app, template, status, first_url, last_url, path, hostname, referrer, and metadata.",
  schema: z.object({
    sql: z
      .string()
      .describe(
        "Read-only SQL over analytics_events and session_recordings. Use literal values, not bind placeholders. Example: SELECT event_name, COUNT(*) AS events FROM analytics_events WHERE timestamp >= '2026-05-01T04:00:00Z' AND timestamp < '2026-05-02T04:00:00Z' GROUP BY event_name ORDER BY events DESC",
      ),
  }),
  outputSchema: z.object({
    rows: z.array(z.record(z.string(), z.unknown())),
    schema: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
      }),
    ),
  }),
  readOnly: true,
  http: false,
  run: async (args) => {
    return queryFirstPartyAnalytics(args.sql, resolveScope());
  },
});

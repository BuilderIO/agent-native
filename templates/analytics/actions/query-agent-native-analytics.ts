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
    "Query the built-in first-party Analytics source: events recorded through this app's analytics collector endpoint (/track), compact daily rollups, identifiable user-day rollups, and session replay summaries recorded through /api/analytics/replay. This source does not require an external provider connection. Use it for questions about app/site traffic, product events, template/app usage, conversions, session recordings, LLM/agent observability, model cost, token volume, latency, and other first-party data collected by this analytics app. Use source-specific actions such as BigQuery, GA4, Mixpanel, PostHog, or Amplitude when the user asks for those sources or the relevant data lives there. SQL may read analytics_events, analytics_event_daily_rollups, analytics_user_days, and session_recordings; session_replay_chunks is intentionally unavailable, and reads are automatically scoped to the current user/org. Prefer analytics_event_daily_rollups for event counts and analytics_user_days for active-user or retention questions. The rollups are backfilled from existing analytics_events when this schema is upgraded and are updated transactionally with new ingest. Use analytics_events only for bounded recent drill-downs with an explicit event_date or timestamp range. Aggregate, project only needed columns, and add a LIMIT for raw or high-cardinality reads; do not issue an unbounded raw-event scan or paginate a large cohort. An explicit all-time or lifetime request remains all-time, so do not invent a default lower time bound. Safe scoped results are cached for up to five minutes for this agent action. analytics_events columns include event_name, timestamp, event_date, user_id, anonymous_id, user_key, session_id, app, template, signed_in, url, path, hostname, referrer, properties, and context. analytics_event_daily_rollups columns include tenant_key, owner_email, org_id, event_date, event_name, app, template, and event_count. analytics_user_days columns include tenant_key, owner_email, org_id, event_date, and user_key. LLM observability events use event_name = '$ai_generation'; useful properties include $ai_trace_id/run_id, $ai_session_id/thread_id, $ai_model/model, $ai_provider/provider, $ai_input_tokens/input_tokens, $ai_output_tokens/output_tokens, cache_read_tokens, cache_write_tokens, cost_cents_x100, $ai_total_cost_usd/cost_usd, duration_ms/$ai_latency, status, tool_calls, successful_tools, failed_tools, tools, tools_truncated, delegated, delegation_protocol, caller_app, delegation_task_id, a2a_task_id, parent_run_id, parent_turn_id, and error_message/$ai_error. Agent Teams child runs use delegation_protocol = 'agent-team' and retain their own run_id while linking to the launching run through parent_run_id. The bounded tools array contains names, relative start times, durations, statuses, and coarse error classes only, never args or results; failed runs and interrupted tools remain queryable. session_recordings columns include id, session_id, user_id, anonymous_id, user_key, started_at, ended_at, duration_ms, chunk_count, event_count, page_count, error_count, rage_click_count, app, template, status, first_url, last_url, path, hostname, referrer, and metadata.",
  schema: z.object({
    sql: z
      .string()
      .describe(
        "Read-only SQL over analytics_events, analytics_event_daily_rollups, analytics_user_days, and session_recordings. Use literal values, not bind placeholders. Prefer the daily rollups for counts, active-user, and retention questions. For raw analytics_events reads, use an explicit event_date or timestamp range, aggregate or project only needed columns, and add a LIMIT; do not issue an unbounded raw-event scan or paginate a large cohort. An explicit all-time or lifetime request remains all-time, so do not invent a default lower time bound. Example: SELECT event_date, event_name, SUM(event_count) AS events FROM analytics_event_daily_rollups WHERE event_date >= '2026-05-01' AND event_date < '2026-06-01' GROUP BY event_date, event_name ORDER BY event_date, events DESC",
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
  // No raw HTTP or connector-catalog route: SQL would land in query strings,
  // logs, or a caller that lacks this app's schema and data dictionary. This
  // remains an internal Analytics-agent tool; sibling agents ask Analytics a
  // natural-language question and Analytics forms the query.
  http: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args) => {
    return queryFirstPartyAnalytics(args.sql, resolveScope(), { cache: true });
  },
});

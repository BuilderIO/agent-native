import { dataTableWidgetResultSchema, defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { createDataTableWidgetResult } from "@agent-native/core/data-widgets";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { queryFirstPartyAnalytics } from "../server/lib/first-party-analytics.js";
import {
  ANALYTICS_ANALYSIS_RESULT_RENDERER,
  getSingleNumericAnalysisResult,
} from "../shared/analysis-result.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

function toDataTableResult(result: {
  rows: Record<string, unknown>[];
  schema: { name: string; type: string }[];
  truncated?: boolean;
}) {
  const numericTypes = new Set([
    "number",
    "integer",
    "float",
    "double",
    "decimal",
    "numeric",
  ]);

  return createDataTableWidgetResult({
    widgetId: "analytics.query.v1",
    title: "Analytics query result",
    table: {
      title: "Analytics query result",
      columns: result.schema.map(({ name, type }) => ({
        key: name,
        label: name,
        ...(numericTypes.has(type.toLowerCase()) ? { align: "right" } : {}),
      })),
      rows: result.rows,
      ...(result.truncated ? { truncated: true } : {}),
    },
  });
}

export default defineAction({
  description:
    "Query the built-in first-party Analytics source: events recorded through this app's analytics collector endpoint (/track), compact daily rollups updated transactionally with new ingest, identifiable user-day rollups, and session replay summaries. It needs no external provider connection. Use it for app/site traffic, product events, template/app usage, conversions, session recordings, and LLM/agent observability (event_name = '$ai_generation': model cost, tokens, latency); use the BigQuery, GA4, Mixpanel, PostHog, or Amplitude actions when the user asks for those or the data lives there. " +
    "SQL may read analytics_events, analytics_event_daily_rollups, analytics_user_days, and session_recordings; session_replay_chunks is unavailable. Reads are scoped to the current user/org and exclude test identities (QA/E2E) unless includeTestIdentities is true. Prefer analytics_event_daily_rollups for event counts and analytics_user_days for active-user or retention questions. On the Builder.io production organization after the explicit BigQuery cutover, events and rollups read from BigQuery while session_recordings stays in the SQL store; cross-backend joins are not supported. " +
    "Before a large or historical query, call get-first-party-analytics-health. Aggregate, project only needed columns, use bounded recent drill-downs, and add a LIMIT for raw or high-cardinality reads; an explicit all-time or lifetime request remains all-time. Safe scoped results are cached for up to five minutes. " +
    "Columns. analytics_events: event_name, timestamp, event_date, user_id, anonymous_id, user_key, session_id, app, template, signed_in, url, path, hostname, referrer, properties, context. analytics_event_daily_rollups: tenant_key, owner_email, org_id, event_date, event_name, app, template, event_count. analytics_user_days: tenant_key, owner_email, org_id, event_date, user_key. session_recordings: id, session_id, user_id, anonymous_id, user_key, started_at, ended_at, duration_ms, chunk_count, event_count, page_count, error_count, rage_click_count, app, template, status, first_url, last_url, path, hostname, referrer, metadata. " +
    "The data-querying skill lists the `$ai_generation` properties and backend routing.",
  schema: z.object({
    sql: z
      .string()
      .describe(
        "Read-only SQL over the tables above. Use literal values, not bind placeholders. Do not issue an unbounded raw-event scan or paginate a large cohort. Example: SELECT event_date, event_name, SUM(event_count) AS events FROM analytics_event_daily_rollups WHERE event_date >= '2026-05-01' AND event_date < '2026-06-01' GROUP BY event_date, event_name ORDER BY event_date, events DESC",
      ),
    includeTestIdentities: z
      .boolean()
      .optional()
      .describe(
        "Debugging only: set true when the user asks about QA/E2E test identities, which every read otherwise excludes.",
      ),
    showTable: z
      .boolean()
      .optional()
      .describe(
        "Set true only when the user explicitly asks to see the query rows as a table.",
      ),
  }),
  outputSchema: z.union([
    dataTableWidgetResultSchema,
    z.object({
      rows: z.array(z.record(z.string(), z.unknown())),
      schema: z.array(z.object({ name: z.string(), type: z.string() })),
      truncated: z.boolean().optional(),
    }),
  ]),
  chatUI: {
    renderer: ANALYTICS_ANALYSIS_RESULT_RENDERER,
    when: (args, result) =>
      args.showTable === true ||
      getSingleNumericAnalysisResult(result) !== null,
  },
  readOnly: true,
  mcpTool: false,
  http: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  grounding: true,
  run: async (args, actionContext?: ActionRunContext) => {
    const scope = resolveScope();
    track(
      "query_asked",
      {
        app_name: "analytics",
        template_name: "analytics",
        query_mode: "first_party",
        surface: "agent",
        query_length: args.sql.length,
      },
      actionContext,
    );
    const result = await queryFirstPartyAnalytics(args.sql, scope, {
      cache: true,
      includeTestIdentities: args.includeTestIdentities === true,
    });
    track(
      "query_executed",
      {
        app_name: "analytics",
        template_name: "analytics",
        query_mode: "first_party",
        surface: "agent",
        row_count: result.rows.length,
        column_count: result.schema.length,
      },
      actionContext,
    );
    return args.showTable ? toDataTableResult(result) : result;
  },
});

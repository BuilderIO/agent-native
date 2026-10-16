import { dataTableWidgetResultSchema, defineAction } from "@agent-native/core";
import { fail, type ActionRunContext } from "@agent-native/core/action";
import { createDataTableWidgetResult } from "@agent-native/core/data-widgets";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { FirstPartyAnalyticsValidationError } from "../server/lib/first-party-analytics-errors.js";
import {
  FirstPartyAnalyticsBackendNotPostgresError,
  queryFirstPartyAnalyticsWithBackend,
  type FirstPartyAnalyticsQueryResultWithBackend,
} from "../server/lib/first-party-analytics.js";
import {
  ANALYTICS_ANALYSIS_RESULT_RENDERER,
  getSingleNumericAnalysisResult,
} from "../shared/analysis-result.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

function toDataTableResult(result: FirstPartyAnalyticsQueryResultWithBackend) {
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
    backend: result.backend,
  });
}

function isQueryCancellation(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

type QueryFailureClass =
  | "unsupported_sql"
  | "invalid_query"
  | "invalid_shape"
  | "disallowed_source"
  | "cross_backend_join"
  | "missing_source"
  | "permission_denied"
  | "quota_exceeded"
  | "rate_limited"
  | "backend_error"
  | "timeout"
  | "query_error"
  | "unknown";

type QueryRecovery =
  | "rewrite_once"
  | "check_schema"
  | "narrow_query"
  | "retry_once"
  | "stop";

type QuerySqlConstruct =
  | "filter"
  | "ilike"
  | "distinct_on"
  | "set_returning"
  | "json_operator"
  | "postgres_cast";

type QueryFailure = {
  failureClass: QueryFailureClass;
  recovery: QueryRecovery;
  message: string;
  sqlConstruct?: QuerySqlConstruct;
};

const QUERY_FAILURES: Record<
  Exclude<QueryFailureClass, "unknown">,
  QueryFailure
> = {
  unsupported_sql: {
    failureClass: "unsupported_sql",
    recovery: "rewrite_once",
    message:
      "The first-party BigQuery path cannot translate this PostgreSQL construct. Rewrite the unsupported part once: use conditional aggregation instead of FILTER (WHERE ...), LOWER(...) LIKE LOWER(...) instead of ILIKE, or a ROW_NUMBER() CTE with an outer filter instead of DISTINCT ON. For GoogleSQL-only syntax, use the separate BigQuery action.",
  },
  invalid_query: {
    failureClass: "invalid_query",
    recovery: "rewrite_once",
    message:
      "The warehouse rejected the translated query. Check table and column names with find-data or search-bigquery-schema, then make one corrected attempt.",
  },
  invalid_shape: {
    failureClass: "invalid_shape",
    recovery: "rewrite_once",
    message:
      "The first-party Analytics action accepts one read-only SELECT or WITH query over supported first-party tables. Rewrite the request as a single query and do not include writes, multiple statements, or unsupported table syntax.",
  },
  disallowed_source: {
    failureClass: "disallowed_source",
    recovery: "check_schema",
    message:
      "The requested table is not part of the built-in first-party Analytics source. Check the exact source with find-data or search-bigquery-schema; use the BigQuery action for a different warehouse source.",
  },
  cross_backend_join: {
    failureClass: "cross_backend_join",
    recovery: "stop",
    message:
      "The first-party Analytics query cannot join session recordings to event data because they are in different backends. Query each source separately and join only the bounded results in analysis.",
  },
  missing_source: {
    failureClass: "missing_source",
    recovery: "check_schema",
    message:
      "The warehouse could not find a referenced source. Use find-data or search-bigquery-schema to verify the exact table and column names before another query.",
  },
  permission_denied: {
    failureClass: "permission_denied",
    recovery: "stop",
    message:
      "The warehouse denied access. Do not retry this query; report the permission issue and use another authorized source only if it answers the same question.",
  },
  quota_exceeded: {
    failureClass: "quota_exceeded",
    recovery: "narrow_query",
    message:
      "The query exceeded its configured billed-byte limit. Narrow the date range and selected columns, or use a suitable rollup; do not repeat the same scan.",
  },
  rate_limited: {
    failureClass: "rate_limited",
    recovery: "retry_once",
    message:
      "The warehouse is rate-limiting queries. Retry this query once unchanged; if it fails again, stop and report the source issue.",
  },
  backend_error: {
    failureClass: "backend_error",
    recovery: "retry_once",
    message:
      "The warehouse had a temporary backend failure. Retry this query once unchanged; if it fails again, stop and report the source issue.",
  },
  timeout: {
    failureClass: "timeout",
    recovery: "retry_once",
    message:
      "The first-party query timed out. Retry once unchanged; if it times out again, narrow the query or report the limit rather than repeating it.",
  },
  query_error: {
    failureClass: "query_error",
    recovery: "stop",
    message:
      "The first-party query did not complete for an unclassified reason. Do not repeat it unchanged. Check the source and schema, then report the failure if the cause is still unclear.",
  },
};

function queryFailure(error: unknown): QueryFailure {
  if (error instanceof FirstPartyAnalyticsValidationError) {
    switch (error.code) {
      case "disallowed_source":
        return QUERY_FAILURES.disallowed_source;
      case "invalid_shape":
        return QUERY_FAILURES.invalid_shape;
      case "cross_backend_join":
        return QUERY_FAILURES.cross_backend_join;
      case "unsupported_function":
        return {
          ...QUERY_FAILURES.unsupported_sql,
          message: /\bunapproved SQL function div\b/i.test(error.message)
            ? "The first-party Analytics SQL policy rejects DIV(). For a ratio, use CAST(numerator AS NUMERIC) / NULLIF(denominator, 0) so integer operands do not truncate the result. Use FLOOR(CAST(numerator AS NUMERIC) / NULLIF(denominator, 0)) only when both operands are nonnegative and floor division is intended; otherwise clarify the requested rounding. Retry once with the same source, filters, and grain, and do not repeat DIV()."
            : "The first-party Analytics source rejected a SQL function it does not support. Rewrite with supported functions, or use the BigQuery action if the query needs GoogleSQL-specific syntax.",
        };
      case "invalid_query":
        return QUERY_FAILURES.invalid_query;
    }
  }
  if (!(error instanceof Error)) {
    return {
      ...QUERY_FAILURES.query_error,
      failureClass: "unknown",
    };
  }

  if (error.name === "FirstPartyAnalyticsUnsupportedSqlError") {
    const construct = (error as Error & { construct?: unknown }).construct;
    switch (construct) {
      case "FILTER (WHERE ...)":
        return {
          ...QUERY_FAILURES.unsupported_sql,
          sqlConstruct: "filter",
          message:
            "The first-party BigQuery path cannot translate FILTER (WHERE ...). Rewrite this aggregate with CASE WHEN, such as SUM(CASE WHEN condition THEN value ELSE 0 END), then retry once.",
        };
      case "ILIKE/SIMILAR TO":
        return {
          ...QUERY_FAILURES.unsupported_sql,
          sqlConstruct: "ilike",
          message:
            "The first-party BigQuery path cannot translate ILIKE or SIMILAR TO. For case-insensitive matching, use LOWER(left_expression) LIKE LOWER(right_expression), then retry once.",
        };
      case "SELECT DISTINCT ON":
        return {
          ...QUERY_FAILURES.unsupported_sql,
          sqlConstruct: "distinct_on",
          message:
            "The first-party BigQuery path cannot translate DISTINCT ON. Use ROW_NUMBER() in a CTE and filter the row number in an outer WHERE clause, then retry once.",
        };
      case "set-returning PostgreSQL functions":
        return {
          ...QUERY_FAILURES.unsupported_sql,
          sqlConstruct: "set_returning",
          message:
            "The first-party BigQuery path cannot translate set-returning PostgreSQL functions such as LATERAL, unnest, or generate_series. Use a supported source and join, or use the separate BigQuery action for GoogleSQL-specific work.",
        };
      case "PostgreSQL JSON operators":
        return {
          ...QUERY_FAILURES.unsupported_sql,
          sqlConstruct: "json_operator",
          message:
            "The first-party BigQuery path does not translate bare PostgreSQL JSON operators. For event properties, use properties::jsonb ->> 'key' and retry once.",
        };
      case "PostgreSQL casts":
        return {
          ...QUERY_FAILURES.unsupported_sql,
          sqlConstruct: "postgres_cast",
          message:
            "The first-party BigQuery path cannot translate this PostgreSQL cast. Use a supported cast type, or use the separate BigQuery action if the required cast is GoogleSQL-specific.",
        };
      default:
        return QUERY_FAILURES.unsupported_sql;
    }
  }

  if (
    [
      "FirstPartyAnalyticsQueryTimeoutError",
      "BigQueryQueryTimeoutError",
      "DbTimeoutError",
    ].includes(error.name) ||
    (error as Error & { code?: unknown }).code === "CONNECT_TIMEOUT"
  ) {
    return QUERY_FAILURES.timeout;
  }

  if (error.name === "BigQueryMaximumBytesBilledError") {
    return QUERY_FAILURES.quota_exceeded;
  }

  if (error.name === "BigQueryBackendError") {
    const reason = (error as Error & { backendReason?: unknown }).backendReason;
    switch (reason) {
      case "invalid_query":
        return QUERY_FAILURES.invalid_query;
      case "not_found":
        return QUERY_FAILURES.missing_source;
      case "access_denied":
        return QUERY_FAILURES.permission_denied;
      case "quota_exceeded":
        return QUERY_FAILURES.quota_exceeded;
      case "rate_limited":
        return QUERY_FAILURES.rate_limited;
      case "backend_error":
        return QUERY_FAILURES.backend_error;
      case "timeout":
        return QUERY_FAILURES.timeout;
      default:
        return QUERY_FAILURES.query_error;
    }
  }

  return QUERY_FAILURES.query_error;
}

class FirstPartyAnalyticsActionQueryError extends Error {
  constructor(readonly failure: QueryFailure) {
    const rewriteInstruction =
      failure.recovery === "rewrite_once"
        ? " Do not repeat unchanged SQL."
        : "";
    super(
      `[${failure.failureClass}; recovery=${failure.recovery}] ${failure.message}${rewriteInstruction}`,
    );
    this.name = "FirstPartyAnalyticsActionQueryError";
  }
}

function safeCancellationError(): Error {
  const error = new Error("First-party Analytics query was cancelled");
  error.name = "AbortError";
  return error;
}

export default defineAction({
  description:
    "Query the built-in first-party Analytics source: events recorded through this app's analytics collector endpoint (/track), compact daily rollups updated transactionally with new ingest, identifiable user-day rollups, and session replay summaries. It needs no external provider connection. Use it for app/site traffic, product events, template/app usage, conversions, session recordings, and LLM/agent observability (event_name = '$ai_generation': model cost, tokens, latency); use the BigQuery, GA4, Mixpanel, PostHog, or Amplitude actions when the user asks for those or the data lives there. " +
    "SQL may read analytics_events, analytics_event_daily_rollups, analytics_user_days, and session_recordings; session_replay_chunks is unavailable. Reads are scoped to the current user/org and exclude test identities (QA/E2E) unless includeTestIdentities is true. Prefer analytics_event_daily_rollups for event counts and analytics_user_days for active-user or retention questions. On the Builder.io production organization after the explicit BigQuery cutover, events and rollups read from BigQuery while session_recordings stays in the SQL store; cross-backend joins are not supported. Results include `backend` (`postgres` or `bigquery`). The BigQuery path translates a restricted PostgreSQL-compatible SQL subset: extract event properties with `properties::jsonb ->> 'key'`; bare JSON operators, LATERAL/unnest/generate_series, FILTER (WHERE ...), DISTINCT ON, and ILIKE are unsupported. Use `||` explicitly between strings. Do not call DIV(); the first-party SQL function policy rejects it. For ratios, use `CAST(numerator AS NUMERIC) / NULLIF(denominator, 0)` to avoid integer truncation. " +
    'On query errors, follow the typed recovery instruction: rewrite unsupported or invalid SQL once, check schema for a missing source, narrow a billed-byte-limit query, retry only timeouts/rate limits/temporary backend errors once, and stop on permission or unclassified errors. Never repeat unchanged SQL after a non-retryable failure. When the user rules out BigQuery, pass backend: "postgres" and skip get-first-party-analytics-health, which queries BigQuery on a BigQuery-backed scope; get-first-party-analytics-backend reports the routing without querying BigQuery. Otherwise, before a large or historical query, call get-first-party-analytics-health. Aggregate, project only needed columns, use bounded recent drill-downs, and add a LIMIT for raw or high-cardinality reads; an explicit all-time or lifetime request remains all-time. Safe scoped results are cached for up to five minutes. ' +
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
    backend: z
      .enum(["postgres"])
      .optional()
      .describe(
        'Set "postgres" when the user rules out BigQuery. A query that would read BigQuery then fails with errorCode first_party_backend_not_postgres before anything runs; it is never rerouted.',
      ),
  }),
  outputSchema: z.union([
    dataTableWidgetResultSchema,
    z.object({
      rows: z.array(z.record(z.string(), z.unknown())),
      schema: z.array(z.object({ name: z.string(), type: z.string() })),
      truncated: z.boolean().optional(),
      backend: z.enum(["postgres", "bigquery"]),
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
    let result: FirstPartyAnalyticsQueryResultWithBackend;
    try {
      result = await queryFirstPartyAnalyticsWithBackend(args.sql, scope, {
        cache: true,
        includeTestIdentities: args.includeTestIdentities === true,
        ...(args.backend ? { requireBackend: args.backend } : {}),
        ...(actionContext?.signal ? { signal: actionContext.signal } : {}),
      });
    } catch (error) {
      if (isQueryCancellation(error, actionContext?.signal)) {
        try {
          track(
            "query_cancelled",
            {
              app_name: "analytics",
              template_name: "analytics",
              query_mode: "first_party",
              surface: "agent",
              cancellation_class: actionContext?.signal?.aborted
                ? "caller_abort"
                : "query_abort",
            },
            actionContext,
          );
        } catch {
          // Telemetry is best-effort and must not replace the cancellation.
        }
        throw safeCancellationError();
      }
      if (error instanceof FirstPartyAnalyticsBackendNotPostgresError) {
        fail(error.message, {
          errorCode: error.code,
          details: { bigQueryTables: error.bigQueryTables },
        });
      }

      const failure = queryFailure(error);
      try {
        track(
          "query_failed",
          {
            app_name: "analytics",
            template_name: "analytics",
            query_mode: "first_party",
            surface: "agent",
            failure_class: failure.failureClass,
            ...(failure.sqlConstruct
              ? { sql_construct: failure.sqlConstruct }
              : {}),
          },
          actionContext,
        );
      } catch {
        // Telemetry is best-effort and must not replace the safe query error.
      }
      throw new FirstPartyAnalyticsActionQueryError(failure);
    }
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

import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import {
  allowanceApprovalNotice,
  allowanceBudget,
  allowanceToAskAbout,
  firstPartyQueriesRunOnBigQuery,
  needsAllowanceApproval,
  recordReviewedAllowance,
} from "../server/lib/bigquery-agent-approval.js";
import { outsideAgentIdentity } from "../server/lib/bigquery-agent-budget.js";
import {
  outsideAgentBigQueryReportSchema,
  outsideAgentCallReportOf,
  outsideAgentRefusalReport,
  runOutsideAgentBigQueryCall,
} from "../server/lib/bigquery-agent-calls.js";
import {
  isOutsideAgentCaller,
  OutsideAgentBigQueryRefusalError,
} from "../server/lib/bigquery-agent-context.js";
import { BigQueryMaximumBytesBilledError } from "../server/lib/bigquery.js";
import {
  FIRST_PARTY_ANALYTICS_HEALTH_MAX_BYTES_BILLED,
  getFirstPartyAnalyticsHealth,
  unavailableFirstPartyAnalyticsHealth,
} from "../server/lib/first-party-analytics-health.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

const healthSchema = z.object({
  status: z.enum(["healthy", "monitor", "recommend_bigquery", "unavailable"]),
  recommendation: z.enum(["none", "connect_bigquery", "use_bigquery"]),
  externalBackendRecommendation: z.enum(["none", "connect", "use", "unknown"]),
  externalBackends: z.array(
    z.object({
      id: z.enum(["bigquery", "amplitude"]),
      label: z.string(),
      role: z.enum(["warehouse", "product-analytics"]),
      configured: z.boolean().nullable(),
      missingRequiredKeys: z.array(z.string()),
      setupLink: z.string(),
    }),
  ),
  reasons: z.array(
    z.enum([
      "event_volume",
      "slow_queries",
      "query_timeout",
      "delivery_backlog",
    ]),
  ),
  observedAt: z.string(),
  metrics: z.object({
    coverage: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("all_time") }),
      z.object({
        kind: z.literal("recent_window"),
        startDate: z.string(),
        endDate: z.string(),
      }),
      z.object({
        kind: z.literal("unavailable"),
        reason: z.enum([
          "maximum_bytes_billed",
          "health_read_failed",
          "outside_agent_budget",
        ]),
      }),
    ]),
    eventCount: z.number().nullable(),
    dailyRollupRows: z.number().nullable(),
    firstEventDate: z.string().nullable(),
    firstEventDateUnavailableReason: z
      .enum(["bounded_bigquery_read", "health_unavailable"])
      .nullable(),
    lastEventDate: z.string().nullable(),
    spanDays: z.number().nullable(),
    slowQueryCount24h: z.number().nullable(),
    timeoutCount24h: z.number().nullable(),
    errorCount24h: z.number().nullable(),
    maxQueryDurationMs24h: z.number().nullable(),
  }),
  thresholds: z.object({
    slowQueryMs: z.number(),
    recommendEventCount: z.number(),
    recommendSlowQueries24h: z.number(),
    recommendMaxQueryMs: z.number(),
  }),
  delivery: z
    .object({
      pendingCount: z.number(),
      oldestPendingAt: z.string().nullable(),
      lastDeliveredAt: z.string().nullable(),
      lastError: z.string().nullable(),
    })
    .nullable(),
  bigQuery: z.object({
    id: z.literal("bigquery"),
    label: z.string(),
    role: z.literal("warehouse"),
    configured: z.boolean().nullable(),
    missingRequiredKeys: z.array(z.string()),
    setupLink: z.string(),
  }),
  bigQueryBudget: outsideAgentBigQueryReportSchema.optional(),
});

export default defineAction({
  description:
    "Check first-party Analytics source health before a large or historical query. Returns query pressure, delivery health, and external backend recommendations. Neon/Postgres reads compact all-time daily rollups; BigQuery reads at most the last 30 UTC calendar days (including today) with a small billed-byte cap. BigQuery eventCount, dailyRollupRows, and lastEventDate cover only the dates in metrics.coverage (kind recent_window), while all-time firstEventDate and spanDays are null with an explicit reason. A cap failure returns unavailable coverage, null event metrics, and reason maximum_bytes_billed. Both sinks read the small query-pressure ledger. To learn only where queries run, without querying BigQuery, call get-first-party-analytics-backend. For Neon/Postgres, event volume or query pressure can recommend BigQuery; for an existing BigQuery sink, only query pressure or delivery lag can produce monitor. A pending delivery-queue migration is reported as degraded delivery health. External options include BigQuery for warehouse SQL and history and Amplitude for product analytics, with safe setup links. Connecting a backend does not reroute /track or backfill existing events. For an outside agent over MCP, the BigQuery read counts against its daily BigQuery budget and the response adds bigQueryBudget; a budget refusal returns unavailable coverage with reason outside_agent_budget and bigQueryBudget.refusal naming when it resets.",
  schema: z.object({}),
  outputSchema: healthSchema,
  outputErrorStrategy: "strict",
  mcpOutputSchema: true,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  mcpNeedsApproval: async (_args, ctx) => {
    const read = await allowanceBudget(ctx);
    return (
      read !== null &&
      (await firstPartyQueriesRunOnBigQuery(read.identity)) &&
      needsAllowanceApproval(
        read.budget,
        FIRST_PARTY_ANALYTICS_HEALTH_MAX_BYTES_BILLED,
      )
    );
  },
  approvalNotice: async (_args, ctx) =>
    allowanceApprovalNotice(
      await allowanceToAskAbout(
        ctx,
        FIRST_PARTY_ANALYTICS_HEALTH_MAX_BYTES_BILLED,
      ),
      FIRST_PARTY_ANALYTICS_HEALTH_MAX_BYTES_BILLED,
    ),
  approvalProof: "review-page",
  run: async (_args, context?: ActionRunContext) => {
    const scope = resolveScope();
    try {
      if (isOutsideAgentCaller(context?.caller)) {
        const identity = outsideAgentIdentity(scope.userEmail, scope.orgId);
        if (await firstPartyQueriesRunOnBigQuery(identity)) {
          await recordReviewedAllowance(identity);
        }
        const { value, report } = await runOutsideAgentBigQueryCall(
          {
            identity,
            source: "get-first-party-analytics-health",
            reservation: "full-cap",
            leaseMs: 60_000,
            ...(context?.caller === "mcp"
              ? { askVia: "get-first-party-analytics-health" }
              : {}),
          },
          () => getFirstPartyAnalyticsHealth(scope),
        );
        return { ...value, bigQueryBudget: report };
      }
      return await getFirstPartyAnalyticsHealth(scope);
    } catch (error) {
      if (error instanceof OutsideAgentBigQueryRefusalError) {
        return {
          ...unavailableFirstPartyAnalyticsHealth("outside_agent_budget"),
          bigQueryBudget: outsideAgentRefusalReport(error),
        };
      }
      console.warn("[first-party-analytics] Health check unavailable:", error);
      const unavailable = unavailableFirstPartyAnalyticsHealth(
        error instanceof BigQueryMaximumBytesBilledError
          ? "maximum_bytes_billed"
          : "health_read_failed",
      );
      const report = outsideAgentCallReportOf(error);
      return report ? { ...unavailable, bigQueryBudget: report } : unavailable;
    }
  },
});

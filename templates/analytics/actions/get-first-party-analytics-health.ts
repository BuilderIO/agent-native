import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { BigQueryMaximumBytesBilledError } from "../server/lib/bigquery.js";
import {
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
        reason: z.enum(["maximum_bytes_billed", "health_read_failed"]),
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
    slowQueryCount24h: z.number(),
    timeoutCount24h: z.number(),
    errorCount24h: z.number(),
    maxQueryDurationMs24h: z.number(),
  }),
  thresholds: z.object({
    slowQueryMs: z.number(),
    recommendEventCount: z.number(),
    recommendSlowQueries24h: z.number(),
    recommendMaxQueryMs: z.number(),
  }),
  delivery: z.object({
    pendingCount: z.number(),
    oldestPendingAt: z.string().nullable(),
    lastDeliveredAt: z.string().nullable(),
    lastError: z.string().nullable(),
  }),
  bigQuery: z.object({
    id: z.literal("bigquery"),
    label: z.string(),
    role: z.literal("warehouse"),
    configured: z.boolean().nullable(),
    missingRequiredKeys: z.array(z.string()),
    setupLink: z.string(),
  }),
});

export default defineAction({
  description:
    "Check first-party Analytics source health before a large or historical query. Returns query pressure, delivery health, and external backend recommendations. Neon/Postgres reads compact all-time daily rollups; BigQuery reads at most the last 30 UTC calendar days (including today) with a small billed-byte cap. BigQuery eventCount, dailyRollupRows, and lastEventDate cover only the dates in metrics.coverage (kind recent_window), while all-time firstEventDate and spanDays are null with an explicit reason. A cap failure returns unavailable coverage, null event metrics, and reason maximum_bytes_billed. Both sinks read the small query-pressure ledger. For Neon/Postgres, event volume or query pressure can recommend BigQuery; for an existing BigQuery sink, only query pressure or delivery lag can produce monitor. A pending delivery-queue migration is reported as degraded delivery health. External options include BigQuery for warehouse SQL and history and Amplitude for product analytics, with safe setup links. Connecting a backend does not reroute /track or backfill existing events.",
  schema: z.object({}),
  outputSchema: healthSchema,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async () => {
    const scope = resolveScope();
    try {
      return await getFirstPartyAnalyticsHealth(scope);
    } catch (error) {
      console.warn("[first-party-analytics] Health check unavailable:", error);
      return unavailableFirstPartyAnalyticsHealth(
        error instanceof BigQueryMaximumBytesBilledError
          ? "maximum_bytes_billed"
          : "health_read_failed",
      );
    }
  },
});

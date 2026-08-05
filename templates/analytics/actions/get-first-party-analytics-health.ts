import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

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
  reasons: z.array(z.enum(["event_volume", "slow_queries", "query_timeout"])),
  observedAt: z.string(),
  metrics: z.object({
    eventCount: z.number(),
    dailyRollupRows: z.number(),
    firstEventDate: z.string().nullable(),
    lastEventDate: z.string().nullable(),
    spanDays: z.number(),
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
    "Check whether the built-in first-party Analytics source is still a good fit for Neon/Postgres. Use this before a large or historical query. It reads compact daily rollups and the small slow-query pressure ledger, never the raw event table. `healthy` means Neon is fine, `monitor` means keep Neon but watch growth, and `recommend_bigquery` means use a configured external analytics backend for high-volume or historical queries. The result reports the two supported external options with safe setup links: BigQuery for warehouse SQL and history, and Amplitude for product analytics, funnels, and retention. A recommendation is based on 1M+ observed events, three or more slow queries in 24 hours, or any query timeout/30-second query. Connecting a backend does not silently reroute `/track` events or backfill existing Neon events.",
  schema: z.object({}),
  outputSchema: healthSchema,
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async () => {
    const scope = resolveScope();
    try {
      return await getFirstPartyAnalyticsHealth(scope);
    } catch (error) {
      console.warn("[first-party-analytics] Health check unavailable:", error);
      return unavailableFirstPartyAnalyticsHealth();
    }
  },
});

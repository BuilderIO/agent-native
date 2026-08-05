import { sql } from "@agent-native/core/db/schema";
import { buildDeepLink } from "@agent-native/core/server";
import { and, gte, inArray, lte } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { hasCredential } from "./credentials.js";
import type { AnalyticsScope } from "./first-party-analytics.js";

export const FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS = {
  slowQueryMs: 5_000,
  recommendEventCount: 1_000_000,
  recommendSlowQueries24h: 3,
  recommendMaxQueryMs: 30_000,
} as const;

const BIGQUERY_SETUP_LINK = buildDeepLink({
  app: "analytics",
  view: "data-sources",
  to: "/data-sources?source=bigquery",
});

export type FirstPartyAnalyticsQueryClass =
  | "raw-events"
  | "rollups"
  | "session-replay"
  | "mixed"
  | "other";

export type FirstPartyAnalyticsQueryOutcome = "success" | "timeout" | "error";

export type FirstPartyAnalyticsHealthStatus =
  | "healthy"
  | "monitor"
  | "recommend_bigquery"
  | "unavailable";

export type FirstPartyAnalyticsRecommendation =
  | "none"
  | "connect_bigquery"
  | "use_bigquery";

export interface FirstPartyAnalyticsHealth {
  status: FirstPartyAnalyticsHealthStatus;
  recommendation: FirstPartyAnalyticsRecommendation;
  reasons: Array<"event_volume" | "slow_queries" | "query_timeout">;
  observedAt: string;
  metrics: {
    eventCount: number;
    dailyRollupRows: number;
    firstEventDate: string | null;
    lastEventDate: string | null;
    spanDays: number;
    slowQueryCount24h: number;
    timeoutCount24h: number;
    errorCount24h: number;
    maxQueryDurationMs24h: number;
  };
  thresholds: typeof FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS;
  bigQuery: {
    configured: boolean | null;
    missingRequiredKeys: string[];
    setupLink: string;
  };
}

interface QueryPressureEvent {
  durationMs: number;
  outcome: FirstPartyAnalyticsQueryOutcome;
  queryClass: FirstPartyAnalyticsQueryClass;
}

function nowIso(): string {
  return new Date().toISOString();
}

function tenantKey(scope: AnalyticsScope): string {
  return scope.orgId ? `org:${scope.orgId}` : `user:${scope.userEmail}`;
}

function stableId(parts: readonly string[]): string {
  return `aqpd_${parts.map((part) => encodeURIComponent(part)).join("|")}`;
}

function finiteNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizedDurationMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|statement deadline|cancelled by deadline/i.test(
    message,
  );
}

export function queryOutcomeFromError(
  error: unknown,
): FirstPartyAnalyticsQueryOutcome {
  return isTimeoutError(error) ? "timeout" : "error";
}

export function classifyFirstPartyAnalyticsQuery(
  query: string,
): FirstPartyAnalyticsQueryClass {
  const normalized = query.toLowerCase();
  const usesRawEvents = /\banalytics_events\b/.test(normalized);
  const usesRollups =
    /\banalytics_event_daily_rollups\b|\banalytics_user_days\b/.test(
      normalized,
    );
  const usesSessionReplay = /\bsession_recordings\b/.test(normalized);
  const sourceCount =
    Number(usesRawEvents) + Number(usesRollups) + Number(usesSessionReplay);

  if (sourceCount > 1) return "mixed";
  if (usesRawEvents) return "raw-events";
  if (usesRollups) return "rollups";
  if (usesSessionReplay) return "session-replay";
  return "other";
}

function shouldRecordPressure(event: QueryPressureEvent): boolean {
  return (
    event.outcome !== "success" ||
    normalizedDurationMs(event.durationMs) >=
      FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS.slowQueryMs
  );
}

/**
 * Persist only slow/failing query aggregates. This intentionally sits outside
 * the raw event stream so diagnosing database pressure cannot recursively add
 * more analytics events to the same database.
 */
export async function recordFirstPartyAnalyticsQueryPressure(
  scope: AnalyticsScope,
  event: QueryPressureEvent,
): Promise<void> {
  if (!shouldRecordPressure(event)) return;

  const durationMs = normalizedDurationMs(event.durationMs);
  // New rows use the exact event timestamp in the legacy event_date column.
  // This keeps the existing unique key additive while letting health reads use
  // a real 24-hour cutoff. Older date-only rows are not reconstructed; a
  // current-day legacy row is bounded by the start of the current day.
  const eventDate = nowIso();
  const key = tenantKey(scope);
  const table = schema.analyticsQueryPressureDaily;
  const db = getDb() as any;
  const isSlow =
    event.outcome !== "success" ||
    durationMs >= FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS.slowQueryMs;

  await db
    .insert(table)
    .values({
      id: stableId([key, eventDate, event.queryClass]),
      tenantKey: key,
      ownerEmail: scope.userEmail,
      orgId: scope.orgId,
      eventDate,
      queryClass: event.queryClass,
      slowQueryCount: isSlow ? 1 : 0,
      timeoutCount: event.outcome === "timeout" ? 1 : 0,
      errorCount: event.outcome === "error" ? 1 : 0,
      totalDurationMs: durationMs,
      maxDurationMs: durationMs,
      lastSeenAt: eventDate,
    })
    .onConflictDoUpdate({
      target: [table.tenantKey, table.eventDate, table.queryClass],
      set: {
        slowQueryCount: sql`${table.slowQueryCount} + ${isSlow ? 1 : 0}`,
        timeoutCount: sql`${table.timeoutCount} + ${event.outcome === "timeout" ? 1 : 0}`,
        errorCount: sql`${table.errorCount} + ${event.outcome === "error" ? 1 : 0}`,
        totalDurationMs: sql`${table.totalDurationMs} + ${durationMs}`,
        maxDurationMs: sql`CASE WHEN ${table.maxDurationMs} > ${durationMs} THEN ${table.maxDurationMs} ELSE ${durationMs} END`,
        lastSeenAt: eventDate,
      },
    });
}

function dateSpanDays(
  firstEventDate: string | null,
  lastEventDate: string | null,
): number {
  if (!firstEventDate || !lastEventDate) return 0;
  const first = Date.parse(`${firstEventDate}T00:00:00.000Z`);
  const last = Date.parse(`${lastEventDate}T00:00:00.000Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) {
    return 0;
  }
  return Math.floor((last - first) / 86_400_000) + 1;
}

async function bigQueryStatus(scope: AnalyticsScope): Promise<{
  configured: boolean | null;
  missingRequiredKeys: string[];
  setupLink: string;
}> {
  const requiredKeys = [
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "BIGQUERY_PROJECT_ID",
  ];
  try {
    const configured = await Promise.all(
      requiredKeys.map((key) =>
        hasCredential(key, {
          userEmail: scope.userEmail,
          orgId: scope.orgId,
        }),
      ),
    );
    return {
      configured: configured.every(Boolean),
      missingRequiredKeys: requiredKeys.filter(
        (_, index) => !configured[index],
      ),
      setupLink: BIGQUERY_SETUP_LINK,
    };
  } catch (error) {
    console.warn("[first-party-analytics] BigQuery status unavailable:", error);
    return {
      configured: null,
      missingRequiredKeys: [],
      setupLink: BIGQUERY_SETUP_LINK,
    };
  }
}

function recommendationFor(
  status: FirstPartyAnalyticsHealthStatus,
  configured: boolean | null,
): FirstPartyAnalyticsRecommendation {
  if (status !== "recommend_bigquery") return "none";
  return configured === true ? "use_bigquery" : "connect_bigquery";
}

export async function getFirstPartyAnalyticsHealth(
  scope: AnalyticsScope,
): Promise<FirstPartyAnalyticsHealth> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nowTimestamp = now.toISOString();
  const since24h = new Date(now.getTime() - 86_400_000).toISOString();
  const keys = scope.orgId
    ? [`org:${scope.orgId}`, `user:${scope.userEmail}`]
    : [`user:${scope.userEmail}`];
  const rollups = schema.analyticsEventDailyRollups;
  const pressure = schema.analyticsQueryPressureDaily;
  const db = getDb() as any;

  const [rollupRows, pressureRows, bigQuery] = await Promise.all([
    db
      .select({
        eventCount: sql<number>`coalesce(sum(${rollups.eventCount}), 0)`,
        dailyRollupRows: sql<number>`count(*)`,
        firstEventDate: sql<string | null>`min(${rollups.eventDate})`,
        lastEventDate: sql<string | null>`max(${rollups.eventDate})`,
      })
      .from(rollups)
      .where(
        and(inArray(rollups.tenantKey, keys), lte(rollups.eventDate, today)),
      ),
    db
      .select({
        queryClass: pressure.queryClass,
        slowQueryCount: pressure.slowQueryCount,
        timeoutCount: pressure.timeoutCount,
        errorCount: pressure.errorCount,
        maxDurationMs: pressure.maxDurationMs,
      })
      .from(pressure)
      .where(
        and(
          inArray(pressure.tenantKey, keys),
          gte(pressure.eventDate, since24h),
          lte(pressure.eventDate, nowTimestamp),
        ),
      ),
    bigQueryStatus(scope),
  ]);

  const rollup = (rollupRows[0] ?? {}) as Record<string, unknown>;
  const eventCount = finiteNumber(rollup.eventCount);
  const dailyRollupRows = finiteNumber(rollup.dailyRollupRows);
  const firstEventDate =
    typeof rollup.firstEventDate === "string" ? rollup.firstEventDate : null;
  const lastEventDate =
    typeof rollup.lastEventDate === "string" ? rollup.lastEventDate : null;
  const slowQueryCount24h = pressureRows.reduce(
    (sum: number, row: Record<string, unknown>) =>
      sum + finiteNumber(row.slowQueryCount),
    0,
  );
  const timeoutCount24h = pressureRows.reduce(
    (sum: number, row: Record<string, unknown>) =>
      sum + finiteNumber(row.timeoutCount),
    0,
  );
  const errorCount24h = pressureRows.reduce(
    (sum: number, row: Record<string, unknown>) =>
      sum + finiteNumber(row.errorCount),
    0,
  );
  const maxQueryDurationMs24h = pressureRows.reduce(
    (max: number, row: Record<string, unknown>) =>
      Math.max(max, finiteNumber(row.maxDurationMs)),
    0,
  );
  const reasons: FirstPartyAnalyticsHealth["reasons"] = [];
  if (
    eventCount >= FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS.recommendEventCount
  ) {
    reasons.push("event_volume");
  }
  if (
    slowQueryCount24h >=
    FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS.recommendSlowQueries24h
  ) {
    reasons.push("slow_queries");
  }
  if (
    timeoutCount24h > 0 ||
    maxQueryDurationMs24h >=
      FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS.recommendMaxQueryMs
  ) {
    reasons.push("query_timeout");
  }

  const hasMonitorSignal =
    eventCount >=
      FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS.recommendEventCount / 4 ||
    slowQueryCount24h > 0;
  const status: FirstPartyAnalyticsHealthStatus =
    reasons.length > 0
      ? "recommend_bigquery"
      : hasMonitorSignal
        ? "monitor"
        : "healthy";

  return {
    status,
    recommendation: recommendationFor(status, bigQuery.configured),
    reasons,
    observedAt: nowIso(),
    metrics: {
      eventCount,
      dailyRollupRows,
      firstEventDate,
      lastEventDate,
      spanDays: dateSpanDays(firstEventDate, lastEventDate),
      slowQueryCount24h,
      timeoutCount24h,
      errorCount24h,
      maxQueryDurationMs24h,
    },
    thresholds: FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS,
    bigQuery,
  };
}

export function unavailableFirstPartyAnalyticsHealth(): FirstPartyAnalyticsHealth {
  return {
    status: "unavailable",
    recommendation: "none",
    reasons: [],
    observedAt: nowIso(),
    metrics: {
      eventCount: 0,
      dailyRollupRows: 0,
      firstEventDate: null,
      lastEventDate: null,
      spanDays: 0,
      slowQueryCount24h: 0,
      timeoutCount24h: 0,
      errorCount24h: 0,
      maxQueryDurationMs24h: 0,
    },
    thresholds: FIRST_PARTY_ANALYTICS_PRESSURE_THRESHOLDS,
    bigQuery: {
      configured: null,
      missingRequiredKeys: [],
      setupLink: BIGQUERY_SETUP_LINK,
    },
  };
}

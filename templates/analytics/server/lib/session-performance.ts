import { fail } from "@agent-native/core/action";
import {
  and,
  type AnyColumn,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import {
  histogramBucket,
  histogramEdges,
  PERFORMANCE_HISTOGRAM_VERSION,
  PERFORMANCE_METRICS,
  type PerformanceMetric,
  type RoutePerformanceResult,
  type RoutePerformanceRow,
  type SessionPerformanceSummary,
  type SlowSessionFilter,
  summarizeHistogram,
  summarizeRequestHistogram,
  WEB_VITAL_THRESHOLDS,
  WEB_VITALS_EVENT_NAME,
} from "../../shared/session-performance.js";
import { isSlowRequest } from "../../shared/slow-request.js";
import { getDb, schema } from "../db/index.js";
import {
  boundedText,
  isoDate,
  sessionEventTenantKey,
  type SessionEventIndexInputRow,
  type SessionEventScope,
  sessionIdOf,
  stableId,
  viewerTenantKeys,
  warnIndexFailure,
} from "./session-event-index.js";

/**
 * Performance aggregates.
 *
 * Ingest derives them from `web_vitals` and `action.response` events into
 * Analytics' own Postgres tables, whatever the storage sink, so no view
 * queries raw events or BigQuery. Session maxima are written inside the
 * transaction that stores the events; per-route histograms are written right
 * after it commits, since popular routes are hot rows. A write that fails
 * records a gap, so reads can say which days are incomplete instead of
 * reporting a partial day as a quiet one.
 */

const ACTION_RESPONSE_EVENT_NAME = "action.response";
const MAX_ROUTE_LENGTH = 200;
const MAX_APP_LENGTH = 100;
const MAX_DURATION_MS = 10 * 60_000;
const MAX_CLS = 100;
const MAX_SAMPLE_WEIGHT = 10_000;
const SESSION_PERFORMANCE_RETENTION_BUFFER_DAYS = 2;
export const ROUTE_PERFORMANCE_RETENTION_DAYS = 180;
export const ROUTE_PERFORMANCE_MAX_RANGE_DAYS = 90;
export const ROUTE_PERFORMANCE_DEFAULT_LIMIT = 50;
export const ROUTE_PERFORMANCE_MAX_LIMIT = 200;
const DAY_MS = 24 * 60 * 60_000;
const BUCKETS_PER_ROUTE = PERFORMANCE_METRICS.reduce(
  (sum, metric) => sum + histogramEdges(metric).length,
  0,
);

let performanceTablesReady = false;

interface PerformanceSample {
  metric: PerformanceMetric;
  value: number;
  weight: number;
}

interface ParsedPerformanceRow {
  tenantKey: string;
  ownerEmail: string;
  orgId: string | null;
  sessionId: string | null;
  eventDate: string;
  timestamp: string;
  app: string;
  route: string | null;
  pageView: boolean;
  samples: PerformanceSample[];
}

function numberOf(value: unknown, max: number): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max
    ? parsed
    : null;
}

function routeOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const route = boundedText(value, MAX_ROUTE_LENGTH);
  return route.startsWith("/") ? route : null;
}

/**
 * Sampled responses carry the inverse of their sampling rate. One without a
 * usable weight is skipped: counting it once would skew every percentile
 * toward the unsampled slow and failed responses.
 */
function requestWeight(properties: Record<string, unknown>): number | null {
  const weight = numberOf(properties.sample_weight, MAX_SAMPLE_WEIGHT);
  return weight !== null && weight >= 1 ? weight : null;
}

function parseProperties(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // coercion-ok: unparseable properties carry no measurement to aggregate.
    return null;
  }
}

function parsePerformanceRow(
  row: SessionEventIndexInputRow,
): ParsedPerformanceRow | null {
  if (
    row.eventName !== WEB_VITALS_EVENT_NAME &&
    row.eventName !== ACTION_RESPONSE_EVENT_NAME
  ) {
    return null;
  }
  if (!row.ownerEmail) return null;
  const properties = parseProperties(row.properties);
  if (!properties) return null;
  const samples: PerformanceSample[] = [];
  if (row.eventName === WEB_VITALS_EVENT_NAME) {
    for (const [metric, key, max] of [
      ["ttfb", "ttfb_ms", MAX_DURATION_MS],
      ["lcp", "lcp_ms", MAX_DURATION_MS],
      ["inp", "inp_ms", MAX_DURATION_MS],
      ["cls", "cls", MAX_CLS],
    ] as const) {
      const value = numberOf(properties[key], max);
      if (value !== null) samples.push({ metric, value, weight: 1 });
    }
  } else {
    // Background tabs throttle timers and cancelled requests never finish,
    // so neither duration is what a person waited for.
    if (properties.page_hidden === true) return null;
    if (properties.outcome === "cancelled") return null;
    const value = numberOf(properties.duration_ms, MAX_DURATION_MS);
    const weight = requestWeight(properties);
    if (value === null || weight === null) return null;
    samples.push({ metric: "request", value, weight });
  }
  if (!samples.length) return null;
  const orgId = row.orgId || null;
  return {
    tenantKey: sessionEventTenantKey(row.ownerEmail, orgId),
    ownerEmail: row.ownerEmail,
    orgId,
    sessionId: sessionIdOf(row.sessionId),
    eventDate: row.eventDate || row.timestamp.slice(0, 10),
    timestamp: row.timestamp,
    app: boundedText(row.app, MAX_APP_LENGTH),
    route: routeOf(properties.route),
    pageView: row.eventName === WEB_VITALS_EVENT_NAME,
    samples,
  };
}

export interface SessionPerformanceRow {
  id: string;
  tenantKey: string;
  ownerEmail: string;
  orgId: string | null;
  sessionId: string;
  app: string;
  pageViews: number;
  maxTtfbMs: number | null;
  maxLcpMs: number | null;
  maxInpMs: number | null;
  maxCls: number | null;
  slowRequests: number;
  maxRequestMs: number | null;
  firstAt: string;
  lastAt: string;
}

export interface RoutePerformanceBucketRow {
  id: string;
  tenantKey: string;
  ownerEmail: string;
  orgId: string | null;
  eventDate: string;
  app: string;
  route: string;
  metric: PerformanceMetric;
  histogramVersion: number;
  bucket: number;
  weight: number;
}

interface TenantRow {
  tenantKey: string;
  ownerEmail: string;
  orgId: string | null;
}

const SESSION_MAX_COLUMN: Record<
  PerformanceMetric,
  "maxTtfbMs" | "maxLcpMs" | "maxInpMs" | "maxCls" | "maxRequestMs"
> = {
  ttfb: "maxTtfbMs",
  lcp: "maxLcpMs",
  inp: "maxInpMs",
  cls: "maxCls",
  request: "maxRequestMs",
};

function maxOf(current: number | null, value: number): number {
  return current === null ? value : Math.max(current, value);
}

/** Sorted by id, so concurrent batches lock shared rows in the same order. */
function sortedById<T extends { id: string }>(rows: Iterable<T>): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function aggregatePerformanceRows(
  rows: readonly SessionEventIndexInputRow[],
): {
  sessions: SessionPerformanceRow[];
  routeBuckets: RoutePerformanceBucketRow[];
  tenants: TenantRow[];
} {
  const sessions = new Map<string, SessionPerformanceRow>();
  const buckets = new Map<string, RoutePerformanceBucketRow>();
  const tenants = new Map<string, TenantRow>();
  for (const row of rows) {
    const parsed = parsePerformanceRow(row);
    if (!parsed) continue;
    tenants.set(parsed.tenantKey, {
      tenantKey: parsed.tenantKey,
      ownerEmail: parsed.ownerEmail,
      orgId: parsed.orgId,
    });
    if (parsed.sessionId) {
      const id = stableId("asp", [parsed.tenantKey, parsed.sessionId]);
      const session = sessions.get(id) ?? {
        id,
        tenantKey: parsed.tenantKey,
        ownerEmail: parsed.ownerEmail,
        orgId: parsed.orgId,
        sessionId: parsed.sessionId,
        app: "",
        pageViews: 0,
        maxTtfbMs: null,
        maxLcpMs: null,
        maxInpMs: null,
        maxCls: null,
        slowRequests: 0,
        maxRequestMs: null,
        firstAt: parsed.timestamp,
        lastAt: parsed.timestamp,
      };
      if (parsed.app) session.app = parsed.app;
      if (parsed.pageView) session.pageViews += 1;
      for (const sample of parsed.samples) {
        const column = SESSION_MAX_COLUMN[sample.metric];
        session[column] = maxOf(session[column], sample.value);
        if (sample.metric === "request" && isSlowRequest(sample.value)) {
          session.slowRequests += 1;
        }
      }
      if (parsed.timestamp < session.firstAt)
        session.firstAt = parsed.timestamp;
      if (parsed.timestamp > session.lastAt) session.lastAt = parsed.timestamp;
      sessions.set(id, session);
    }
    if (parsed.route) {
      for (const sample of parsed.samples) {
        const bucket = histogramBucket(sample.metric, sample.value);
        const parts = [
          parsed.tenantKey,
          parsed.eventDate,
          parsed.app,
          parsed.route,
          sample.metric,
          String(PERFORMANCE_HISTOGRAM_VERSION),
          String(bucket),
        ];
        const id = stableId("arpd", parts);
        const existing = buckets.get(id);
        if (existing) {
          existing.weight += sample.weight;
          continue;
        }
        buckets.set(id, {
          id,
          tenantKey: parsed.tenantKey,
          ownerEmail: parsed.ownerEmail,
          orgId: parsed.orgId,
          eventDate: parsed.eventDate,
          app: parsed.app,
          route: parsed.route,
          metric: sample.metric,
          histogramVersion: PERFORMANCE_HISTOGRAM_VERSION,
          bucket,
          weight: sample.weight,
        });
      }
    }
  }
  return {
    sessions: sortedById(sessions.values()),
    routeBuckets: sortedById(buckets.values()),
    tenants: [...tenants.values()].sort((a, b) =>
      a.tenantKey < b.tenantKey ? -1 : a.tenantKey > b.tenantKey ? 1 : 0,
    ),
  };
}

async function coverageTableExists(db: any): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT to_regclass('analytics_performance_coverage') AS table_name`,
  );
  const rows = Array.isArray(result) ? result : result?.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Postgres table existence check returned no row array");
  }
  const value = rows[0]?.table_name;
  if (value === null) return false;
  if (typeof value === "string" && value) return true;
  throw new Error("Postgres table existence check returned an invalid value");
}

/**
 * Reads run between a deploy and the scheduled migration too. Until the
 * coverage table exists no tenant has coverage, and reads report exactly that.
 * Tables are only ever added, so only a positive answer is cached.
 */
async function performanceTablesExist(db: any): Promise<boolean> {
  performanceTablesReady ||= await coverageTableExists(db);
  return performanceTablesReady;
}

function gapRows(
  rows: ReadonlyArray<{
    tenantKey: string;
    ownerEmail: string;
    orgId: string | null;
    eventDate: string;
    sessionId: string;
  }>,
  recordedAt: string,
) {
  const gaps = new Map<string, Record<string, unknown> & { id: string }>();
  for (const row of rows) {
    const id = stableId("apg", [row.tenantKey, row.eventDate, row.sessionId]);
    gaps.set(id, { ...row, id, recordedAt });
  }
  return sortedById(gaps.values());
}

/**
 * Runs inside the transaction that stores the events. A failure rolls back
 * to a savepoint and never fails ingest; only a failed gap marker does,
 * taking the events with it, so no session silently loses its measurements.
 */
export async function recordSessionPerformance(
  tx: any,
  rows: readonly SessionEventIndexInputRow[],
  receivedAt: string,
): Promise<void> {
  const parsedSessions: Array<{
    tenantKey: string;
    ownerEmail: string;
    orgId: string | null;
    eventDate: string;
    sessionId: string;
  }> = [];
  try {
    const { sessions, tenants } = aggregatePerformanceRows(rows);
    if (!tenants.length) return;
    for (const session of sessions) {
      parsedSessions.push({
        tenantKey: session.tenantKey,
        ownerEmail: session.ownerEmail,
        orgId: session.orgId,
        eventDate: session.lastAt.slice(0, 10),
        sessionId: session.sessionId,
      });
    }
    await tx.transaction(async (savepoint: any) => {
      const t = schema.analyticsSessionPerformance;
      if (sessions.length) {
        await savepoint
          .insert(t)
          .values(sessions)
          .onConflictDoUpdate({
            target: [t.tenantKey, t.sessionId],
            set: {
              pageViews: sql`${t.pageViews} + excluded.page_views`,
              maxTtfbMs: sql`greatest(${t.maxTtfbMs}, excluded.max_ttfb_ms)`,
              maxLcpMs: sql`greatest(${t.maxLcpMs}, excluded.max_lcp_ms)`,
              maxInpMs: sql`greatest(${t.maxInpMs}, excluded.max_inp_ms)`,
              maxCls: sql`greatest(${t.maxCls}, excluded.max_cls)`,
              slowRequests: sql`${t.slowRequests} + excluded.slow_requests`,
              maxRequestMs: sql`greatest(${t.maxRequestMs}, excluded.max_request_ms)`,
              firstAt: sql`least(${t.firstAt}, excluded.first_at)`,
              lastAt: sql`greatest(${t.lastAt}, excluded.last_at)`,
              app: sql`case when excluded.app <> '' then excluded.app else ${t.app} end`,
            },
          });
      }
      await savepoint
        .insert(schema.analyticsPerformanceCoverage)
        .values(tenants.map((tenant) => ({ ...tenant, startedAt: receivedAt })))
        .onConflictDoNothing();
    });
  } catch (error) {
    if (!(await coverageTableExists(tx))) {
      warnIndexFailure(
        "Performance tables are not migrated yet; events were stored without performance aggregates:",
        error,
      );
      return;
    }
    if (parsedSessions.length) {
      await tx
        .insert(schema.analyticsPerformanceGaps)
        .values(gapRows(parsedSessions, receivedAt))
        .onConflictDoNothing();
    }
    warnIndexFailure(
      "Session performance write failed; its sessions are marked incomplete:",
      error,
    );
  }
}

/**
 * After the events commit, in its own short transaction, so a popular route's
 * rows are never locked for a whole ingest. A failure marks the day's route
 * aggregates incomplete; the events are already stored either way.
 */
export async function recordRoutePerformance(
  rows: readonly SessionEventIndexInputRow[],
  receivedAt: string,
): Promise<void> {
  const db = getDb() as any;
  let routeBuckets: RoutePerformanceBucketRow[] = [];
  try {
    routeBuckets = aggregatePerformanceRows(rows).routeBuckets;
    if (!routeBuckets.length) return;
    const t = schema.analyticsRoutePerformanceDaily;
    await db.transaction(async (tx: any) => {
      await tx
        .insert(t)
        .values(routeBuckets)
        .onConflictDoUpdate({
          target: [
            t.tenantKey,
            t.eventDate,
            t.app,
            t.route,
            t.metric,
            t.histogramVersion,
            t.bucket,
          ],
          set: { weight: sql`${t.weight} + excluded.weight` },
        });
    });
  } catch (error) {
    try {
      if (!(await coverageTableExists(db))) {
        warnIndexFailure(
          "Performance tables are not migrated yet; events were stored without route aggregates:",
          error,
        );
        return;
      }
      await db
        .insert(schema.analyticsPerformanceGaps)
        .values(
          gapRows(
            routeBuckets.map((row) => ({
              tenantKey: row.tenantKey,
              ownerEmail: row.ownerEmail,
              orgId: row.orgId,
              eventDate: row.eventDate,
              sessionId: "",
            })),
            receivedAt,
          ),
        )
        .onConflictDoNothing();
      warnIndexFailure(
        "Route performance write failed; its days are marked incomplete:",
        error,
      );
    } catch (gapError) {
      // The events committed already, so this is reported, not thrown.
      console.error(
        "[first-party-analytics] Route performance write and its gap marker both failed; route percentiles for this batch are undercounted:",
        error,
        gapError,
      );
    }
  }
}

function tenantOf(recording: { orgId: AnyColumn; ownerEmail: AnyColumn }) {
  return sql`(case when ${recording.orgId} is not null then 'org:' || ${recording.orgId} else 'user:' || ${recording.ownerEmail} end)`;
}

/**
 * Conditions on `session_recordings` for the slow-session filter, correlated
 * to each recording's own tenant and session so they can never widen the
 * recording access filter they are combined with. A session without
 * measurements is never slow, and never shown as fast either.
 */
export async function slowSessionConditions(
  filter: SlowSessionFilter | undefined,
) {
  if (!filter) return [];
  if (!(await performanceTablesExist(getDb()))) return [sql`false`];
  const r = schema.sessionRecordings;
  const p = schema.analyticsSessionPerformance;
  const poorVitals = sql`(${p.maxLcpMs} > ${WEB_VITAL_THRESHOLDS.lcp.poor} or ${p.maxInpMs} > ${WEB_VITAL_THRESHOLDS.inp.poor} or ${p.maxCls} > ${WEB_VITAL_THRESHOLDS.cls.poor} or ${p.maxTtfbMs} > ${WEB_VITAL_THRESHOLDS.ttfb.poor})`;
  const slowRequests = sql`${p.slowRequests} > 0`;
  const slow =
    filter === "vitals"
      ? poorVitals
      : filter === "requests"
        ? slowRequests
        : sql`(${poorVitals} or ${slowRequests})`;
  return [
    sql`exists (select 1 from ${p} where ${p.tenantKey} = ${tenantOf(r)} and ${p.sessionId} = ${r.sessionId} and ${slow})`,
  ];
}

/**
 * The latest coverage start among the viewer's tenants. Each recording is
 * matched against its own tenant's aggregates, so only the latest holds for
 * all of them.
 */
export async function getPerformanceCoverageStart(
  scope: SessionEventScope,
): Promise<string | null> {
  const db = getDb() as any;
  if (!(await performanceTablesExist(db))) return null;
  const coverage = schema.analyticsPerformanceCoverage;
  const rows = await db
    .select({ startedAt: coverage.startedAt })
    .from(coverage)
    .where(inArray(coverage.tenantKey, viewerTenantKeys(scope)));
  const starts = rows
    .map((row: { startedAt: string }) => row.startedAt)
    .filter(Boolean)
    .sort();
  return starts.at(-1) ?? null;
}

/**
 * Performance summaries for a page of recordings the caller already read
 * through the recording access filter. Recordings the aggregates never
 * measured are absent from the map.
 */
export async function getSessionPerformanceSummaries(
  recordings: ReadonlyArray<{
    id: string;
    sessionId: string;
    ownerEmail: string;
    orgId: string | null;
  }>,
): Promise<Map<string, SessionPerformanceSummary>> {
  const summaries = new Map<string, SessionPerformanceSummary>();
  if (!recordings.length) return summaries;
  const db = getDb() as any;
  if (!(await performanceTablesExist(db))) return summaries;
  const p = schema.analyticsSessionPerformance;
  const tenantKeys = [
    ...new Set(
      recordings.map((recording) =>
        sessionEventTenantKey(recording.ownerEmail, recording.orgId),
      ),
    ),
  ];
  const sessionIds = [
    ...new Set(recordings.map((recording) => recording.sessionId)),
  ];
  const rows = await db
    .select({
      tenantKey: p.tenantKey,
      sessionId: p.sessionId,
      maxTtfbMs: p.maxTtfbMs,
      maxLcpMs: p.maxLcpMs,
      maxInpMs: p.maxInpMs,
      maxCls: p.maxCls,
      slowRequests: p.slowRequests,
      maxRequestMs: p.maxRequestMs,
    })
    .from(p)
    .where(
      and(inArray(p.tenantKey, tenantKeys), inArray(p.sessionId, sessionIds)),
    )
    .limit(tenantKeys.length * sessionIds.length);
  const byKey = new Map<string, SessionPerformanceSummary>();
  const nullable = (value: unknown) =>
    value === null || value === undefined ? null : Number(value);
  for (const row of rows) {
    byKey.set(`${row.tenantKey}\u0000${row.sessionId}`, {
      ttfbMs: nullable(row.maxTtfbMs),
      lcpMs: nullable(row.maxLcpMs),
      inpMs: nullable(row.maxInpMs),
      cls: nullable(row.maxCls),
      slowRequests: Number(row.slowRequests),
      maxRequestMs: nullable(row.maxRequestMs),
    });
  }
  for (const recording of recordings) {
    const summary = byKey.get(
      `${sessionEventTenantKey(recording.ownerEmail, recording.orgId)}\u0000${recording.sessionId}`,
    );
    if (summary) summaries.set(recording.id, summary);
  }
  return summaries;
}

export async function listRoutePerformance(
  scope: SessionEventScope,
  filters: {
    app?: string;
    from?: string;
    to?: string;
    limit?: number;
    now?: Date;
  } = {},
): Promise<RoutePerformanceResult & { from: string; to: string }> {
  const now = filters.now ?? new Date();
  const toDate = isoDate(filters.to, now);
  const fromDate = isoDate(
    filters.from,
    new Date(Date.parse(`${toDate}T00:00:00.000Z`) - 6 * DAY_MS),
  );
  if (fromDate > toDate) {
    fail("Route performance range starts after it ends", {
      errorCode: "invalid_range",
      statusCode: 400,
    });
  }
  const days =
    (Date.parse(`${toDate}T00:00:00.000Z`) -
      Date.parse(`${fromDate}T00:00:00.000Z`)) /
      DAY_MS +
    1;
  if (days > ROUTE_PERFORMANCE_MAX_RANGE_DAYS) {
    fail(
      `Route performance covers at most ${ROUTE_PERFORMANCE_MAX_RANGE_DAYS} days at a time`,
      { errorCode: "invalid_range", statusCode: 400 },
    );
  }
  const limit = Math.min(
    ROUTE_PERFORMANCE_MAX_LIMIT,
    Math.max(1, filters.limit ?? ROUTE_PERFORMANCE_DEFAULT_LIMIT),
  );
  const empty = {
    from: fromDate,
    to: toDate,
    routes: [],
    coverageStartedAt: null,
    incompleteDates: [],
    truncated: false,
  };
  const db = getDb() as any;
  if (!(await performanceTablesExist(db))) return empty;
  const coverageStartedAt = await getPerformanceCoverageStart(scope);
  if (!coverageStartedAt) return empty;

  const t = schema.analyticsRoutePerformanceDaily;
  const tenantKeys = viewerTenantKeys(scope);
  const inRange = [
    inArray(t.tenantKey, tenantKeys),
    gte(t.eventDate, fromDate),
    lte(t.eventDate, toDate),
    eq(t.histogramVersion, PERFORMANCE_HISTOGRAM_VERSION),
    ...(filters.app !== undefined ? [eq(t.app, filters.app)] : []),
  ];
  // Routes ranked by how much was measured on them, so the busiest pages
  // come first and the response stays bounded.
  const ranked = await db
    .select({
      app: t.app,
      route: t.route,
      total: sql<number>`sum(${t.weight})`,
    })
    .from(t)
    .where(and(...inRange))
    .groupBy(t.app, t.route)
    .orderBy(desc(sql`sum(${t.weight})`), t.app, t.route)
    .limit(limit + 1);
  const truncated = ranked.length > limit;
  const listed = ranked.slice(0, limit) as Array<{
    app: string;
    route: string;
  }>;

  const gaps = schema.analyticsPerformanceGaps;
  const gapRowsInRange = await db
    .selectDistinct({ eventDate: gaps.eventDate })
    .from(gaps)
    .where(
      and(
        inArray(gaps.tenantKey, tenantKeys),
        gte(gaps.eventDate, fromDate),
        lte(gaps.eventDate, toDate),
      ),
    )
    .orderBy(gaps.eventDate)
    .limit(ROUTE_PERFORMANCE_MAX_RANGE_DAYS);
  const incompleteDates = gapRowsInRange.map(
    (row: { eventDate: string }) => row.eventDate,
  );
  if (!listed.length) {
    return { ...empty, coverageStartedAt, incompleteDates };
  }

  const bucketRows = await db
    .select({
      app: t.app,
      route: t.route,
      metric: t.metric,
      bucket: t.bucket,
      weight: sql<number>`sum(${t.weight})`,
    })
    .from(t)
    .where(
      and(
        ...inRange,
        or(
          ...listed.map((row) =>
            and(eq(t.app, row.app), eq(t.route, row.route)),
          ),
        ),
      ),
    )
    .groupBy(t.app, t.route, t.metric, t.bucket)
    .limit(listed.length * BUCKETS_PER_ROUTE);
  const histograms = new Map<string, Map<PerformanceMetric, number[]>>();
  const routeKey = (app: string, route: string) => `${app}\u0000${route}`;
  for (const row of bucketRows) {
    const metric = row.metric as PerformanceMetric;
    if (!PERFORMANCE_METRICS.includes(metric)) continue;
    const bucket = Number(row.bucket);
    if (!Number.isInteger(bucket) || bucket < 0) continue;
    if (bucket >= histogramEdges(metric).length) continue;
    const key = routeKey(row.app, row.route);
    const byMetric = histograms.get(key) ?? new Map();
    const weights =
      byMetric.get(metric) ??
      new Array<number>(histogramEdges(metric).length).fill(0);
    weights[bucket] += Number(row.weight);
    byMetric.set(metric, weights);
    histograms.set(key, byMetric);
  }
  const routes: RoutePerformanceRow[] = listed.map((row) => {
    const byMetric = histograms.get(routeKey(row.app, row.route));
    const weights = (metric: PerformanceMetric) => byMetric?.get(metric) ?? [];
    return {
      app: row.app,
      route: row.route,
      ttfb: summarizeHistogram("ttfb", weights("ttfb")),
      lcp: summarizeHistogram("lcp", weights("lcp")),
      inp: summarizeHistogram("inp", weights("inp")),
      cls: summarizeHistogram("cls", weights("cls")),
      request: summarizeRequestHistogram(weights("request")),
    };
  });
  return {
    from: fromDate,
    to: toDate,
    routes,
    coverageStartedAt,
    incompleteDates,
    truncated,
  };
}

/**
 * Session rows outlive the replays they describe by a little, and route days
 * are kept for a fixed window.
 */
export async function prunePerformanceAggregates(
  replayRetentionDays: number,
  now = new Date(),
): Promise<{ sessions: number; routeDays: number }> {
  const db = getDb() as any;
  if (!(await performanceTablesExist(db))) return { sessions: 0, routeDays: 0 };
  const sessionCutoff = new Date(
    now.getTime() -
      (replayRetentionDays + SESSION_PERFORMANCE_RETENTION_BUFFER_DAYS) *
        DAY_MS,
  ).toISOString();
  const routeCutoff = new Date(
    now.getTime() - ROUTE_PERFORMANCE_RETENTION_DAYS * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  // guard:allow-unscoped -- retention intentionally sweeps expired session aggregates across tenants.
  const sessionResult = await db
    .delete(schema.analyticsSessionPerformance)
    .where(lt(schema.analyticsSessionPerformance.lastAt, sessionCutoff));
  // guard:allow-unscoped -- retention intentionally sweeps expired route days across tenants.
  const routeResult = await db
    .delete(schema.analyticsRoutePerformanceDaily)
    .where(lt(schema.analyticsRoutePerformanceDaily.eventDate, routeCutoff));
  // guard:allow-unscoped -- retention intentionally sweeps gap markers older than any aggregate they describe.
  await db
    .delete(schema.analyticsPerformanceGaps)
    .where(
      lt(
        schema.analyticsPerformanceGaps.eventDate,
        sessionCutoff.slice(0, 10) < routeCutoff
          ? sessionCutoff.slice(0, 10)
          : routeCutoff,
      ),
    );
  return {
    sessions: Number(sessionResult?.rowCount ?? 0),
    routeDays: Number(routeResult?.rowCount ?? 0),
  };
}

export function __resetSessionPerformanceForTests(): void {
  performanceTablesReady = false;
}

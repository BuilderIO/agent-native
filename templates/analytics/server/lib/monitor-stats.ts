/**
 * Aggregated uptime statistics for the monitoring feature.
 *
 * This module turns the raw `monitor_check_results` / `monitor_incidents`
 * history into the numbers a status dashboard needs: current status, uptime %
 * over 24h / 7d / 30d / 90d, a bucketed uptime timeline (green/amber/red/no
 * data), a downsampled response-time series, incident count, and MTBF.
 *
 * Design notes (see the `performance` skill):
 *  - Reads are done as a small fixed set of GROUPED, column-projected queries
 *    (one per shape), never one query per monitor — no N+1. All aggregation
 *    (uptime %, daily buckets, hourly response averages) happens IN SQL so we
 *    never pull the full result history across the wire.
 *  - Every query is scoped by owner_email + org_id, mirroring
 *    server/lib/uptime-monitors.ts. The in-app stats action passes the request
 *    user; the public status page passes the PAGE OWNER's scope.
 *  - The math (`computeUptimePercents`, `assembleDailyTimeline`, `computeMtbf`,
 *    `bucketStatusFromCounts`) is pure and unit-tested (monitor-stats.spec.ts).
 */
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type { AccessCtx, MonitorStatus } from "./uptime-monitors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Coarse health of a single timeline bucket. */
export type BucketStatus = "up" | "down" | "degraded" | "no-data";

export interface UptimeWindows {
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  uptime90d: number | null;
}

export interface UptimeBucket {
  /** ISO timestamp for the inclusive start of the bucket. */
  start: string;
  /** ISO timestamp for the exclusive end of the bucket. */
  end: string;
  status: BucketStatus;
  /** Uptime percentage in the bucket (null when there were no checks). */
  uptimePct: number | null;
  total: number;
  downCount: number;
  degradedCount: number;
}

export interface ResponseTimePoint {
  /** ISO timestamp for the start of the bucket. */
  bucketStart: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

export interface MonitorStats {
  monitorId: string;
  /** Current status from the monitor row (up/down/degraded/…), null if never run. */
  status: MonitorStatus | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  windows: UptimeWindows;
  /** Bucketed uptime timeline, oldest → newest (default: 90 daily buckets). */
  timeline: UptimeBucket[];
  /** Downsampled recent response-time series, oldest → newest. */
  responseSeries: ResponseTimePoint[];
  /** Count-weighted average response time across `responseSeries`. */
  avgResponseMs: number | null;
  incidentCount: number;
  /** Mean time between failures over the 90d window, in ms (null if <1 failure). */
  mtbfMs: number | null;
}

export interface MonitorStatsOptions {
  now?: Date;
  /** How many trailing daily buckets to include in `timeline`. Default 90. */
  timelineDays?: number;
  /** Trailing window (hours) for the hourly `responseSeries`. Default 24. */
  responseWindowHours?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_TIMELINE_DAYS = 90;
const DEFAULT_RESPONSE_WINDOW_HOURS = 24;
const MAX_TIMELINE_DAYS = 365;
const MAX_RESPONSE_WINDOW_HOURS = 24 * 90;

// ---------------------------------------------------------------------------
// Pure math (unit-tested)
// ---------------------------------------------------------------------------

export interface UptimeWindowAggregate {
  total24h: number;
  ok24h: number;
  total7d: number;
  ok7d: number;
  total30d: number;
  ok30d: number;
  total90d: number;
  ok90d: number;
}

function pct(ok: number, total: number): number | null {
  return total > 0 ? (ok / total) * 100 : null;
}

export function computeUptimePercents(
  agg: UptimeWindowAggregate,
): UptimeWindows {
  return {
    uptime24h: pct(agg.ok24h, agg.total24h),
    uptime7d: pct(agg.ok7d, agg.total7d),
    uptime30d: pct(agg.ok30d, agg.total30d),
    uptime90d: pct(agg.ok90d, agg.total90d),
  };
}

/** Daily aggregate for a single monitor+day, as produced by the DB reader. */
export interface DailyBucketRow {
  /** UTC calendar day key, `YYYY-MM-DD`. */
  day: string;
  total: number;
  ok: number;
  down: number;
  degraded: number;
}

export function bucketStatusFromCounts(
  total: number,
  down: number,
  degraded: number,
): BucketStatus {
  if (total <= 0) return "no-data";
  if (down > 0) return "down";
  if (degraded > 0) return "degraded";
  return "up";
}

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Expand per-day aggregates into a dense, gap-filled trailing timeline of
 * `days` calendar-day buckets (oldest → newest). Days with no checks become
 * `no-data` buckets so the rendered strip stays a fixed width.
 */
export function assembleDailyTimeline(
  rows: DailyBucketRow[],
  opts: { now?: Date; days?: number } = {},
): UptimeBucket[] {
  const now = opts.now ?? new Date();
  const days = Math.max(
    1,
    Math.min(opts.days ?? DEFAULT_TIMELINE_DAYS, MAX_TIMELINE_DAYS),
  );
  const byDay = new Map<string, DailyBucketRow>();
  for (const row of rows) byDay.set(row.day, row);

  const nowMs = now.getTime();
  const buckets: UptimeBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayMs = nowMs - i * DAY_MS;
    const dayKey = utcDayKey(dayMs);
    const startMs = Date.parse(`${dayKey}T00:00:00.000Z`);
    const nextDayStartMs = startMs + DAY_MS;
    // The most recent bucket ends "now", not at the end of the calendar day.
    const endMs = i === 0 ? Math.max(nowMs, startMs) : nextDayStartMs;
    const row = byDay.get(dayKey);
    const total = row?.total ?? 0;
    const down = row?.down ?? 0;
    const degraded = row?.degraded ?? 0;
    const ok = row?.ok ?? 0;
    buckets.push({
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      status: bucketStatusFromCounts(total, down, degraded),
      uptimePct: pct(ok, total),
      total,
      downCount: down,
      degradedCount: degraded,
    });
  }
  return buckets;
}

export interface IncidentWindowRow {
  startedAt: string;
  resolvedAt: string | null;
}

/**
 * Mean time between failures over a window, in ms. Defined as operational time
 * (window length minus clamped downtime) divided by the number of failures.
 * Returns null when there were no failures in the window.
 */
export function computeMtbf(
  incidents: IncidentWindowRow[],
  opts: { windowStartMs: number; nowMs: number },
): number | null {
  const failures = incidents.length;
  if (failures === 0) return null;
  const { windowStartMs, nowMs } = opts;
  const windowMs = Math.max(0, nowMs - windowStartMs);
  let downtime = 0;
  for (const incident of incidents) {
    const startedMs = Date.parse(incident.startedAt);
    if (!Number.isFinite(startedMs)) continue;
    const resolvedMs = incident.resolvedAt
      ? Date.parse(incident.resolvedAt)
      : nowMs;
    const start = Math.max(startedMs, windowStartMs);
    const end = Math.min(
      Number.isFinite(resolvedMs) ? resolvedMs : nowMs,
      nowMs,
    );
    if (end > start) downtime += end - start;
  }
  const operational = Math.max(0, windowMs - downtime);
  return operational / failures;
}

export function averageResponse(series: ResponseTimePoint[]): number | null {
  let weighted = 0;
  let count = 0;
  for (const point of series) {
    if (point.avg == null || point.count <= 0) continue;
    weighted += point.avg * point.count;
    count += point.count;
  }
  return count > 0 ? weighted / count : null;
}

// ---------------------------------------------------------------------------
// Owner scoping (mirrors uptime-monitors.ts)
// ---------------------------------------------------------------------------

function ownerScope(table: { ownerEmail: any; orgId: any }, ctx: AccessCtx) {
  return and(
    sql`lower(${table.ownerEmail}) = ${ctx.email.toLowerCase()}`,
    ctx.orgId ? eq(table.orgId, ctx.orgId) : isNull(table.orgId),
  );
}

/** All monitor ids owned by `ctx` (used when a caller wants stats for "all"). */
export async function listOwnedMonitorIds(ctx: AccessCtx): Promise<string[]> {
  const db = getDb() as any;
  const rows = await db
    .select({ id: schema.monitors.id })
    .from(schema.monitors)
    .where(ownerScope(schema.monitors, ctx));
  return rows.map((row: any) => row.id as string);
}

// ---------------------------------------------------------------------------
// DB reader
// ---------------------------------------------------------------------------

/**
 * Compute aggregated stats for the given monitor ids, scoped to `ctx`. Returns
 * a Map keyed by monitor id. Ids the caller doesn't own are simply absent.
 */
export async function getMonitorStats(
  ctx: AccessCtx,
  monitorIds: string[],
  opts: MonitorStatsOptions = {},
): Promise<Map<string, MonitorStats>> {
  const result = new Map<string, MonitorStats>();
  const ids = Array.from(new Set(monitorIds.filter(Boolean)));
  if (ids.length === 0) return result;

  const db = getDb() as any;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const timelineDays = Math.max(
    1,
    Math.min(opts.timelineDays ?? DEFAULT_TIMELINE_DAYS, MAX_TIMELINE_DAYS),
  );
  const responseWindowHours = Math.max(
    1,
    Math.min(
      opts.responseWindowHours ?? DEFAULT_RESPONSE_WINDOW_HOURS,
      MAX_RESPONSE_WINDOW_HOURS,
    ),
  );

  const since24h = new Date(nowMs - 24 * HOUR_MS).toISOString();
  const since7d = new Date(nowMs - 7 * DAY_MS).toISOString();
  const since30d = new Date(nowMs - 30 * DAY_MS).toISOString();
  const since90d = new Date(nowMs - 90 * DAY_MS).toISOString();
  const sinceTimeline = new Date(
    nowMs - (timelineDays - 1) * DAY_MS - DAY_MS,
  ).toISOString();
  const sinceResponse = new Date(
    nowMs - responseWindowHours * HOUR_MS,
  ).toISOString();

  const monitorsTable = schema.monitors;
  const resultsTable = schema.monitorCheckResults;
  const incidentsTable = schema.monitorIncidents;

  const [monitorRows, windowRows, dailyRows, responseRows, incidentRows] =
    await Promise.all([
      db
        .select({
          id: monitorsTable.id,
          lastStatus: monitorsTable.lastStatus,
          lastCheckedAt: monitorsTable.lastCheckedAt,
          lastLatencyMs: monitorsTable.lastLatencyMs,
        })
        .from(monitorsTable)
        .where(
          and(ownerScope(monitorsTable, ctx), inArray(monitorsTable.id, ids)),
        ),
      db
        .select({
          monitorId: resultsTable.monitorId,
          total24h: sql<number>`sum(case when ${resultsTable.checkedAt} >= ${since24h} then 1 else 0 end)`,
          ok24h: sql<number>`sum(case when ${resultsTable.checkedAt} >= ${since24h} and ${resultsTable.ok} then 1 else 0 end)`,
          total7d: sql<number>`sum(case when ${resultsTable.checkedAt} >= ${since7d} then 1 else 0 end)`,
          ok7d: sql<number>`sum(case when ${resultsTable.checkedAt} >= ${since7d} and ${resultsTable.ok} then 1 else 0 end)`,
          total30d: sql<number>`sum(case when ${resultsTable.checkedAt} >= ${since30d} then 1 else 0 end)`,
          ok30d: sql<number>`sum(case when ${resultsTable.checkedAt} >= ${since30d} and ${resultsTable.ok} then 1 else 0 end)`,
          total90d: sql<number>`sum(case when ${resultsTable.checkedAt} >= ${since90d} then 1 else 0 end)`,
          ok90d: sql<number>`sum(case when ${resultsTable.checkedAt} >= ${since90d} and ${resultsTable.ok} then 1 else 0 end)`,
        })
        .from(resultsTable)
        .where(
          and(
            ownerScope(resultsTable, ctx),
            inArray(resultsTable.monitorId, ids),
            gte(resultsTable.checkedAt, since90d),
          ),
        )
        .groupBy(resultsTable.monitorId),
      db
        .select({
          monitorId: resultsTable.monitorId,
          day: sql<string>`substr(${resultsTable.checkedAt}, 1, 10)`,
          total: sql<number>`count(*)`,
          ok: sql<number>`sum(case when ${resultsTable.ok} then 1 else 0 end)`,
          down: sql<number>`sum(case when ${resultsTable.status} in ('down','error') then 1 else 0 end)`,
          degraded: sql<number>`sum(case when ${resultsTable.status} = 'degraded' then 1 else 0 end)`,
        })
        .from(resultsTable)
        .where(
          and(
            ownerScope(resultsTable, ctx),
            inArray(resultsTable.monitorId, ids),
            gte(resultsTable.checkedAt, sinceTimeline),
          ),
        )
        .groupBy(
          resultsTable.monitorId,
          sql`substr(${resultsTable.checkedAt}, 1, 10)`,
        ),
      db
        .select({
          monitorId: resultsTable.monitorId,
          hour: sql<string>`substr(${resultsTable.checkedAt}, 1, 13)`,
          avg: sql<number>`avg(${resultsTable.latencyMs})`,
          min: sql<number>`min(${resultsTable.latencyMs})`,
          max: sql<number>`max(${resultsTable.latencyMs})`,
          count: sql<number>`count(${resultsTable.latencyMs})`,
        })
        .from(resultsTable)
        .where(
          and(
            ownerScope(resultsTable, ctx),
            inArray(resultsTable.monitorId, ids),
            gte(resultsTable.checkedAt, sinceResponse),
            sql`${resultsTable.latencyMs} is not null`,
          ),
        )
        .groupBy(
          resultsTable.monitorId,
          sql`substr(${resultsTable.checkedAt}, 1, 13)`,
        ),
      db
        .select({
          monitorId: incidentsTable.monitorId,
          startedAt: incidentsTable.startedAt,
          resolvedAt: incidentsTable.resolvedAt,
        })
        .from(incidentsTable)
        .where(
          and(
            ownerScope(incidentsTable, ctx),
            inArray(incidentsTable.monitorId, ids),
            gte(incidentsTable.startedAt, since90d),
          ),
        ),
    ]);

  const windowById = new Map<string, UptimeWindowAggregate>();
  for (const row of windowRows) {
    windowById.set(row.monitorId, {
      total24h: Number(row.total24h ?? 0),
      ok24h: Number(row.ok24h ?? 0),
      total7d: Number(row.total7d ?? 0),
      ok7d: Number(row.ok7d ?? 0),
      total30d: Number(row.total30d ?? 0),
      ok30d: Number(row.ok30d ?? 0),
      total90d: Number(row.total90d ?? 0),
      ok90d: Number(row.ok90d ?? 0),
    });
  }

  const dailyById = new Map<string, DailyBucketRow[]>();
  for (const row of dailyRows) {
    const list = dailyById.get(row.monitorId) ?? [];
    list.push({
      day: String(row.day),
      total: Number(row.total ?? 0),
      ok: Number(row.ok ?? 0),
      down: Number(row.down ?? 0),
      degraded: Number(row.degraded ?? 0),
    });
    dailyById.set(row.monitorId, list);
  }

  const responseById = new Map<string, ResponseTimePoint[]>();
  for (const row of responseRows) {
    const list = responseById.get(row.monitorId) ?? [];
    const hourKey = String(row.hour);
    list.push({
      bucketStart: new Date(`${hourKey}:00:00.000Z`).toISOString(),
      avg: row.avg == null ? null : Number(row.avg),
      min: row.min == null ? null : Number(row.min),
      max: row.max == null ? null : Number(row.max),
      count: Number(row.count ?? 0),
    });
    responseById.set(row.monitorId, list);
  }

  const incidentsById = new Map<string, IncidentWindowRow[]>();
  for (const row of incidentRows) {
    const list = incidentsById.get(row.monitorId) ?? [];
    list.push({ startedAt: row.startedAt, resolvedAt: row.resolvedAt ?? null });
    incidentsById.set(row.monitorId, list);
  }

  const since90dMs = nowMs - 90 * DAY_MS;

  for (const monitor of monitorRows) {
    const id = monitor.id as string;
    const windowAgg = windowById.get(id) ?? {
      total24h: 0,
      ok24h: 0,
      total7d: 0,
      ok7d: 0,
      total30d: 0,
      ok30d: 0,
      total90d: 0,
      ok90d: 0,
    };
    const timeline = assembleDailyTimeline(dailyById.get(id) ?? [], {
      now,
      days: timelineDays,
    });
    const responseSeries = (responseById.get(id) ?? []).sort((a, b) =>
      a.bucketStart < b.bucketStart
        ? -1
        : a.bucketStart > b.bucketStart
          ? 1
          : 0,
    );
    const incidents = incidentsById.get(id) ?? [];
    result.set(id, {
      monitorId: id,
      status: (monitor.lastStatus ?? null) as MonitorStatus | null,
      lastCheckedAt: monitor.lastCheckedAt ?? null,
      lastLatencyMs: monitor.lastLatencyMs ?? null,
      windows: computeUptimePercents(windowAgg),
      timeline,
      responseSeries,
      avgResponseMs: averageResponse(responseSeries),
      incidentCount: incidents.length,
      mtbfMs: computeMtbf(incidents, { windowStartMs: since90dMs, nowMs }),
    });
  }

  return result;
}

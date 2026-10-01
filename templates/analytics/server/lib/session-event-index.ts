import {
  and,
  type AnyColumn,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  AUTOMATIC_ANALYTICS_EVENT_NAMES,
  type EventCatalogApp,
  type EventCatalogEntry,
  type EventCatalogResult,
  type SessionEventNameCount,
} from "../../shared/session-events.js";
import { getDb, schema } from "../db/index.js";

/**
 * Session event index.
 *
 * `recordAnalyticsEvents` writes every accepted event here after it persists
 * the event, whatever the storage sink. Session filters, event-name options,
 * and the event catalog read only these Postgres tables, so no view queries
 * BigQuery. Event filters exclude sessions that started before a tenant's index
 * began, because their coverage is incomplete. "Didn't" conditions also
 * exclude sessions the index never saw.
 */

export interface SessionEventIndexInputRow {
  eventName: string;
  sessionId: string | null;
  timestamp: string;
  eventDate: string | null;
  app: string | null;
  properties: string;
  ownerEmail: string;
  orgId: string | null;
}

export interface SessionEventScope {
  userEmail: string;
  orgId?: string | null;
}

const MAX_PROPERTY_KEYS = 30;
const PROPERTY_KEY_PATTERN = /^[A-Za-z0-9_.$:-]{1,64}$/;
const MAX_EVENT_NAME_LENGTH = 200;
const STOPPED_FIRING_DAYS = 7;
const SESSION_EVENT_INDEX_RETENTION_BUFFER_DAYS = 2;
export const EVENT_CATALOG_RETENTION_DAYS = 180;
const WARN_INTERVAL_MS = 60_000;

let lastWarnAt = 0;
const coverageTenants = new Set<string>();

export function sessionEventTenantKey(
  ownerEmail: string,
  orgId: string | null | undefined,
): string {
  return orgId ? `org:${orgId}` : `user:${ownerEmail}`;
}

function viewerTenantKeys(scope: SessionEventScope): string[] {
  return scope.orgId
    ? [
        sessionEventTenantKey(scope.userEmail, scope.orgId),
        sessionEventTenantKey(scope.userEmail, null),
      ]
    : [sessionEventTenantKey(scope.userEmail, null)];
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}_${parts.map((part) => encodeURIComponent(part)).join("|")}`;
}

export function samplePropertyKeys(properties: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(properties);
    // coercion-ok: unparseable properties only mean no sample keys; the event still indexes.
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  return Object.keys(parsed)
    .filter((key) => PROPERTY_KEY_PATTERN.test(key))
    .sort()
    .slice(0, MAX_PROPERTY_KEYS);
}

type SessionEventRow = typeof schema.analyticsSessionEvents.$inferInsert;
type CatalogRow = typeof schema.analyticsEventCatalogDaily.$inferInsert;

export function aggregateSessionEventIndexRows(
  rows: readonly SessionEventIndexInputRow[],
): {
  sessionEvents: SessionEventRow[];
  catalog: CatalogRow[];
} {
  const sessionEvents = new Map<string, SessionEventRow>();
  const catalog = new Map<
    string,
    { row: CatalogRow; latestProperties: string }
  >();

  for (const row of rows) {
    const eventName = row.eventName?.trim().slice(0, MAX_EVENT_NAME_LENGTH);
    if (!eventName || !row.ownerEmail || !row.timestamp) continue;
    const orgId = row.orgId || null;
    const tenantKey = sessionEventTenantKey(row.ownerEmail, orgId);
    const app = row.app?.trim() ?? "";

    const sessionId = row.sessionId?.trim();
    if (sessionId) {
      const key = JSON.stringify([tenantKey, sessionId, eventName]);
      const existing = sessionEvents.get(key);
      if (existing) {
        existing.eventCount = (existing.eventCount ?? 0) + 1;
        if (row.timestamp < existing.firstAt) existing.firstAt = row.timestamp;
        if (row.timestamp > existing.lastAt) existing.lastAt = row.timestamp;
        if (app) existing.app = app;
      } else {
        sessionEvents.set(key, {
          id: stableId("ase", [tenantKey, sessionId, eventName]),
          tenantKey,
          ownerEmail: row.ownerEmail,
          orgId,
          sessionId,
          eventName,
          app,
          eventCount: 1,
          firstAt: row.timestamp,
          lastAt: row.timestamp,
        });
      }
    }

    const eventDate = row.eventDate || row.timestamp.slice(0, 10);
    const catalogKey = JSON.stringify([tenantKey, eventDate, eventName, app]);
    const existingCatalog = catalog.get(catalogKey);
    if (existingCatalog) {
      existingCatalog.row.eventCount =
        (existingCatalog.row.eventCount ?? 0) + 1;
      if (row.timestamp >= existingCatalog.row.lastSeenAt) {
        existingCatalog.row.lastSeenAt = row.timestamp;
        existingCatalog.latestProperties = row.properties;
      }
    } else {
      catalog.set(catalogKey, {
        row: {
          id: stableId("aecd", [tenantKey, eventDate, eventName, app]),
          tenantKey,
          ownerEmail: row.ownerEmail,
          orgId,
          eventDate,
          eventName,
          app,
          eventCount: 1,
          lastSeenAt: row.timestamp,
          propertyKeys: "[]",
        },
        latestProperties: row.properties,
      });
    }
  }

  // Sort by the conflict key so concurrent batches take row locks in the
  // same order.
  const sortedSessionEvents = [...sessionEvents.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => row);
  const sortedCatalog = [...catalog.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => ({
      ...entry.row,
      propertyKeys: JSON.stringify(samplePropertyKeys(entry.latestProperties)),
    }));
  return { sessionEvents: sortedSessionEvents, catalog: sortedCatalog };
}

/**
 * Best-effort: indexing never fails ingest. Events are already persisted
 * when this runs.
 */
export async function recordSessionEventIndex(
  rows: readonly SessionEventIndexInputRow[],
  receivedAt: string,
): Promise<void> {
  if (!rows.length) return;
  try {
    const { sessionEvents, catalog } = aggregateSessionEventIndexRows(rows);
    const db = getDb() as any;
    const t = schema.analyticsSessionEvents;
    const c = schema.analyticsEventCatalogDaily;

    if (sessionEvents.length) {
      await db
        .insert(t)
        .values(sessionEvents)
        .onConflictDoUpdate({
          target: [t.tenantKey, t.sessionId, t.eventName],
          set: {
            eventCount: sql`${t.eventCount} + excluded.event_count`,
            firstAt: sql`least(${t.firstAt}, excluded.first_at)`,
            lastAt: sql`greatest(${t.lastAt}, excluded.last_at)`,
            app: sql`case when excluded.app <> '' then excluded.app else ${t.app} end`,
          },
        });
    }

    // Coverage starts only once a session write has succeeded, so a failed
    // first write never opens coverage over sessions the index missed.
    const tenants = new Map<
      string,
      { ownerEmail: string; orgId: string | null }
    >();
    for (const row of sessionEvents) {
      if (!coverageTenants.has(row.tenantKey)) {
        tenants.set(row.tenantKey, {
          ownerEmail: row.ownerEmail,
          orgId: row.orgId ?? null,
        });
      }
    }
    if (tenants.size) {
      await db
        .insert(schema.analyticsSessionEventCoverage)
        .values(
          [...tenants.entries()].map(([tenantKey, tenant]) => ({
            tenantKey,
            ownerEmail: tenant.ownerEmail,
            orgId: tenant.orgId,
            startedAt: receivedAt,
          })),
        )
        .onConflictDoNothing();
      for (const tenantKey of tenants.keys()) coverageTenants.add(tenantKey);
    }

    if (catalog.length) {
      await db
        .insert(c)
        .values(catalog)
        .onConflictDoUpdate({
          target: [c.tenantKey, c.eventDate, c.eventName, c.app],
          set: {
            eventCount: sql`${c.eventCount} + excluded.event_count`,
            lastSeenAt: sql`greatest(${c.lastSeenAt}, excluded.last_seen_at)`,
            propertyKeys: sql`case when excluded.last_seen_at >= ${c.lastSeenAt} then excluded.property_keys else ${c.propertyKeys} end`,
          },
        });
    }
  } catch (error) {
    const now = Date.now();
    if (now - lastWarnAt >= WARN_INTERVAL_MS) {
      lastWarnAt = now;
      console.warn(
        "[first-party-analytics] Session event index write failed; events were stored:",
        error,
      );
    }
  }
}

export interface SessionEventFilters {
  didEvents?: readonly string[];
  didNotEvents?: readonly string[];
}

export function normalizeSessionEventNames(
  names: readonly string[] | undefined,
): string[] {
  return [
    ...new Set(
      (names ?? [])
        .map((name) => name.trim().slice(0, MAX_EVENT_NAME_LENGTH))
        .filter(Boolean),
    ),
  ];
}

export function hasSessionEventFilters(filters: SessionEventFilters): boolean {
  return (
    normalizeSessionEventNames(filters.didEvents).length > 0 ||
    normalizeSessionEventNames(filters.didNotEvents).length > 0
  );
}

/**
 * Conditions on `session_recordings` for did/didn't event filters. Each lookup
 * is correlated to the recording's own tenant and session, so it can never
 * widen the recording access filter it is combined with.
 */
export function sessionEventFilterConditions(filters: SessionEventFilters) {
  const didEvents = normalizeSessionEventNames(filters.didEvents);
  const didNotEvents = normalizeSessionEventNames(filters.didNotEvents);
  if (!didEvents.length && !didNotEvents.length) return [];

  const r = schema.sessionRecordings;
  const sibling = alias(schema.sessionRecordings, "session_event_sibling");
  const se = schema.analyticsSessionEvents;
  const coverage = schema.analyticsSessionEventCoverage;
  const tenantOf = (recording: { orgId: AnyColumn; ownerEmail: AnyColumn }) =>
    sql`(case when ${recording.orgId} is not null then 'org:' || ${recording.orgId} else 'user:' || ${recording.ownerEmail} end)`;
  const recordingTenant = tenantOf(r);
  const coverageStart = sql`(select ${coverage.startedAt} from ${coverage} where ${coverage.tenantKey} = ${recordingTenant})`;
  const sessionIndexed = (eventName?: string) =>
    sql`exists (select 1 from ${se} where ${se.tenantKey} = ${recordingTenant} and ${se.sessionId} = ${r.sessionId}${eventName === undefined ? sql`` : sql` and ${se.eventName} = ${eventName}`})`;

  return [
    sql`${r.startedAt} >= ${coverageStart}`,
    // One analytics session can span tabs, each with its own recording. A
    // session that had a recording before coverage began may have events the
    // index never saw.
    sql`not exists (select 1 from ${r} as ${sibling} where ${sibling.sessionId} = ${r.sessionId} and ${tenantOf(sibling)} = ${recordingTenant} and ${sibling.startedAt} < ${coverageStart})`,
    ...didEvents.map((eventName) => sessionIndexed(eventName)),
    // "Didn't" needs a session the index saw, so a failed or pruned index
    // write never reads as the event's absence.
    ...(didNotEvents.length ? [sessionIndexed()] : []),
    ...didNotEvents.map((eventName) => sql`not ${sessionIndexed(eventName)}`),
  ];
}

export async function getSessionEventCoverageStart(
  scope: SessionEventScope,
): Promise<string | null> {
  const db = getDb() as any;
  const coverage = schema.analyticsSessionEventCoverage;
  const rows = await db
    .select({ startedAt: coverage.startedAt })
    .from(coverage)
    .where(inArray(coverage.tenantKey, viewerTenantKeys(scope)));
  const starts = rows
    .map((row: { startedAt: string }) => row.startedAt)
    .filter(Boolean)
    .sort();
  return starts[0] ?? null;
}

export async function listSessionEventNames(
  scope: SessionEventScope,
  filters: { from?: string; to?: string; app?: string; limit?: number } = {},
): Promise<{
  events: SessionEventNameCount[];
  coverageStartedAt: string | null;
}> {
  const db = getDb() as any;
  const se = schema.analyticsSessionEvents;
  const conditions: any[] = [inArray(se.tenantKey, viewerTenantKeys(scope))];
  if (filters.from) conditions.push(gte(se.lastAt, filters.from));
  if (filters.to) conditions.push(lte(se.firstAt, filters.to));
  if (filters.app) conditions.push(eq(se.app, filters.app));
  const limit = Math.min(500, Math.max(1, filters.limit ?? 200));
  const [rows, coverageStartedAt] = await Promise.all([
    db
      .select({
        eventName: se.eventName,
        sessionCount: sql<number>`count(*)`,
      })
      .from(se)
      .where(and(...conditions))
      .groupBy(se.eventName)
      .orderBy(desc(sql`count(*)`), se.eventName)
      .limit(limit),
    getSessionEventCoverageStart(scope),
  ]);
  return {
    events: rows.map((row: { eventName: string; sessionCount: unknown }) => ({
      eventName: row.eventName,
      sessionCount: Number(row.sessionCount),
    })),
    coverageStartedAt,
  };
}

export function isAutomaticAnalyticsEvent(eventName: string): boolean {
  return AUTOMATIC_ANALYTICS_EVENT_NAMES.has(eventName);
}

function isoDate(value: string | undefined, fallback: Date): string {
  const date = value ? new Date(value) : fallback;
  return (Number.isNaN(date.getTime()) ? fallback : date)
    .toISOString()
    .slice(0, 10);
}

export async function listEventCatalog(
  scope: SessionEventScope,
  filters: {
    from?: string;
    to?: string;
    app?: string;
    now?: Date;
  } = {},
): Promise<EventCatalogResult> {
  const now = filters.now ?? new Date();
  const fromDate = isoDate(
    filters.from,
    new Date(now.getTime() - 30 * 24 * 60 * 60_000),
  );
  const toDate = isoDate(filters.to, now);
  const stoppedBefore = new Date(
    now.getTime() - STOPPED_FIRING_DAYS * 24 * 60 * 60_000,
  ).toISOString();
  const db = getDb() as any;
  const c = schema.analyticsEventCatalogDaily;
  const tenantCondition = inArray(c.tenantKey, viewerTenantKeys(scope));
  const appCondition = filters.app ? [eq(c.app, filters.app)] : [];

  // Volume is scoped to the range; last seen and property keys use every
  // retained day so an event that stopped firing still shows when it last did.
  const [volumeRows, lastSeenRows] = await Promise.all([
    db
      .select({
        eventName: c.eventName,
        app: c.app,
        volume: sql<number>`sum(${c.eventCount})`,
      })
      .from(c)
      .where(
        and(
          tenantCondition,
          gte(c.eventDate, fromDate),
          lte(c.eventDate, toDate),
          ...appCondition,
        ),
      )
      .groupBy(c.eventName, c.app),
    db
      .selectDistinctOn([c.eventName, c.app], {
        eventName: c.eventName,
        app: c.app,
        lastSeenAt: c.lastSeenAt,
        propertyKeys: c.propertyKeys,
      })
      .from(c)
      .where(and(tenantCondition, lte(c.eventDate, toDate), ...appCondition))
      .orderBy(c.eventName, c.app, desc(c.lastSeenAt)),
  ]);

  const volumes = new Map<string, number>();
  for (const row of volumeRows) {
    volumes.set(JSON.stringify([row.eventName, row.app]), Number(row.volume));
  }

  const entries: EventCatalogEntry[] = lastSeenRows.map(
    (row: {
      eventName: string;
      app: string;
      lastSeenAt: string;
      propertyKeys: string;
    }) => {
      let propertyKeys: string[] = [];
      try {
        const parsed = JSON.parse(row.propertyKeys);
        if (Array.isArray(parsed)) {
          propertyKeys = parsed.filter(
            (key): key is string => typeof key === "string",
          );
        }
      } catch {
        propertyKeys = [];
      }
      return {
        eventName: row.eventName,
        app: row.app || null,
        volume: volumes.get(JSON.stringify([row.eventName, row.app])) ?? 0,
        lastSeenAt: row.lastSeenAt,
        propertyKeys,
        description: null,
        automatic: isAutomaticAnalyticsEvent(row.eventName),
        stoppedFiring: false,
      };
    },
  );

  const appLastSeen = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.app ?? "";
    const current = appLastSeen.get(key);
    if (!current || entry.lastSeenAt > current) {
      appLastSeen.set(key, entry.lastSeenAt);
    }
  }
  for (const entry of entries) {
    // An event stopped firing when its app is still sending other events.
    entry.stoppedFiring =
      entry.lastSeenAt < stoppedBefore &&
      (appLastSeen.get(entry.app ?? "") ?? "") >= stoppedBefore;
  }

  const apps = new Map<string, EventCatalogApp>();
  for (const entry of entries) {
    if (entry.volume <= 0) continue;
    const key = entry.app ?? "";
    const app = apps.get(key) ?? {
      app: entry.app,
      eventCount: 0,
      volume: 0,
      onlyAutomaticEvents: true,
    };
    app.eventCount += 1;
    app.volume += entry.volume;
    if (!entry.automatic) app.onlyAutomaticEvents = false;
    apps.set(key, app);
  }

  entries.sort(
    (a, b) =>
      b.volume - a.volume ||
      a.eventName.localeCompare(b.eventName) ||
      (a.app ?? "").localeCompare(b.app ?? ""),
  );
  return {
    from: fromDate,
    to: toDate,
    entries,
    apps: [...apps.values()].sort((a, b) => b.volume - a.volume),
  };
}

/**
 * Keep session rows a little longer than the replays they describe, so a
 * retained recording never loses index rows and falsely matches "didn't".
 */
export async function pruneSessionEventIndex(
  replayRetentionDays: number,
  now = new Date(),
): Promise<{
  sessionEvents: number;
  catalogDays: number;
}> {
  const db = getDb() as any;
  const sessionCutoff = new Date(
    now.getTime() -
      (replayRetentionDays + SESSION_EVENT_INDEX_RETENTION_BUFFER_DAYS) *
        24 *
        60 *
        60_000,
  ).toISOString();
  const catalogCutoff = new Date(
    now.getTime() - EVENT_CATALOG_RETENTION_DAYS * 24 * 60 * 60_000,
  )
    .toISOString()
    .slice(0, 10);
  // guard:allow-unscoped -- retention intentionally sweeps expired index rows across tenants.
  const sessionResult = await db
    .delete(schema.analyticsSessionEvents)
    .where(lt(schema.analyticsSessionEvents.lastAt, sessionCutoff));
  // guard:allow-unscoped -- retention intentionally sweeps expired catalog days across tenants.
  const catalogResult = await db
    .delete(schema.analyticsEventCatalogDaily)
    .where(lt(schema.analyticsEventCatalogDaily.eventDate, catalogCutoff));
  return {
    sessionEvents: Number(sessionResult?.rowCount ?? 0),
    catalogDays: Number(catalogResult?.rowCount ?? 0),
  };
}

export function __resetSessionEventIndexForTests(): void {
  coverageTenants.clear();
  lastWarnAt = 0;
}

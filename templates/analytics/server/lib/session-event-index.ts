import { createHash } from "node:crypto";

import {
  and,
  type AnyColumn,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  AUTOMATIC_ANALYTICS_EVENT_NAMES,
  type EventCatalogApp,
  type EventCatalogEntry,
  type EventCatalogResult,
  sessionEventBoundSchema,
  type SessionEventNameCount,
} from "../../shared/session-events.js";
import { getDb, schema } from "../db/index.js";
import {
  MAX_APP_LENGTH,
  MAX_EVENT_NAME_LENGTH,
  boundedText,
} from "./indexed-text.js";

/**
 * Session event index.
 *
 * `recordAnalyticsEvents` indexes every accepted event's session in the
 * transaction that persists the event, whatever the storage sink, and updates
 * the event catalog after it commits. Session filters, event-name options, and
 * the event catalog read only these Postgres tables, so no view queries
 * BigQuery. Event filters exclude sessions that started before a tenant's index
 * began, because their coverage is incomplete. "Didn't" conditions also
 * exclude sessions the index never saw or failed to write.
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
const MAX_SESSION_ID_LENGTH = 256;
const STOPPED_FIRING_DAYS = 7;
const SESSION_EVENT_INDEX_RETENTION_BUFFER_DAYS = 2;
export const EVENT_CATALOG_RETENTION_DAYS = 180;
export const EVENT_CATALOG_MAX_ENTRIES = 1000;
const WARN_INTERVAL_MS = 60_000;

const lastWarnAt = new Map<string, number>();
let indexTablesReady = false;

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

/**
 * An id too long for a unique index entry would fail the gap marker too, and
 * with it the batch. Such a session never gets an index row, so "didn't"
 * excludes it.
 */
function sessionIdOf(value: string | null | undefined): string | null {
  const sessionId = value?.trim();
  return sessionId && sessionId.length <= MAX_SESSION_ID_LENGTH
    ? sessionId
    : null;
}

/** Hashed, so caller text never makes a primary key too long to index. */
function stableId(prefix: string, parts: readonly string[]): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex");
  return `${prefix}_${digest}`;
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
type CatalogLatestRow = typeof schema.analyticsEventCatalogLatest.$inferInsert;
type SessionGapRow = typeof schema.analyticsSessionEventGaps.$inferInsert;

function sortedByKey<T>(entries: Iterable<[string, T]>): T[] {
  return [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, row]) => row);
}

export function aggregateSessionEventIndexRows(
  rows: readonly SessionEventIndexInputRow[],
): {
  sessionEvents: SessionEventRow[];
  catalog: CatalogRow[];
  catalogLatest: CatalogLatestRow[];
} {
  const sessionEvents = new Map<string, SessionEventRow>();
  const catalog = new Map<
    string,
    { row: CatalogRow; latestProperties: string }
  >();

  for (const row of rows) {
    const eventName = boundedText(row.eventName, MAX_EVENT_NAME_LENGTH);
    if (!eventName || !row.ownerEmail || !row.timestamp) continue;
    const orgId = row.orgId || null;
    const tenantKey = sessionEventTenantKey(row.ownerEmail, orgId);
    const app = boundedText(row.app, MAX_APP_LENGTH);

    const sessionId = sessionIdOf(row.sessionId);
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

  const sortedCatalog = sortedByKey(catalog.entries()).map((entry) => ({
    ...entry.row,
    propertyKeys: JSON.stringify(samplePropertyKeys(entry.latestProperties)),
  }));
  const catalogLatest = new Map<string, CatalogLatestRow>();
  for (const row of sortedCatalog) {
    const key = JSON.stringify([row.tenantKey, row.eventName, row.app]);
    const existing = catalogLatest.get(key);
    if (existing && existing.lastSeenAt >= row.lastSeenAt) continue;
    catalogLatest.set(key, {
      id: stableId("aecl", [row.tenantKey, row.eventName, row.app ?? ""]),
      tenantKey: row.tenantKey,
      ownerEmail: row.ownerEmail,
      orgId: row.orgId,
      eventName: row.eventName,
      app: row.app,
      lastSeenAt: row.lastSeenAt,
      propertyKeys: row.propertyKeys,
    });
  }
  // Sort by the conflict key so concurrent batches take row locks in the
  // same order.
  return {
    sessionEvents: sortedByKey(sessionEvents.entries()),
    catalog: sortedCatalog,
    catalogLatest: sortedByKey(catalogLatest.entries()),
  };
}

function sessionEventGapRows(
  rows: readonly SessionEventIndexInputRow[],
  receivedAt: string,
): SessionGapRow[] {
  const gaps = new Map<string, SessionGapRow>();
  for (const row of rows) {
    const sessionId = sessionIdOf(row.sessionId);
    if (!sessionId || !row.ownerEmail) continue;
    const orgId = row.orgId || null;
    const tenantKey = sessionEventTenantKey(row.ownerEmail, orgId);
    const id = stableId("aseg", [tenantKey, sessionId]);
    if (gaps.has(id)) continue;
    gaps.set(id, {
      id,
      tenantKey,
      ownerEmail: row.ownerEmail,
      orgId,
      sessionId,
      recordedAt: receivedAt,
    });
  }
  return sortedByKey(gaps.entries());
}

async function coverageTableExists(tx: any): Promise<boolean> {
  const result = await tx.execute(
    sql`SELECT to_regclass('analytics_session_event_coverage') AS table_name`,
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
async function sessionEventIndexReady(db: any): Promise<boolean> {
  indexTablesReady ||= await coverageTableExists(db);
  return indexTablesReady;
}

function warnIndexFailure(message: string, error: unknown): void {
  const now = Date.now();
  if (now - (lastWarnAt.get(message) ?? 0) < WARN_INTERVAL_MS) return;
  lastWarnAt.set(message, now);
  console.warn(`[first-party-analytics] ${message}`, error);
}

/**
 * Runs inside the transaction that stores the events, so a batch's events
 * commit with either their session rows or a gap marker for their sessions.
 * An index failure rolls back to a savepoint and never fails ingest; only a
 * failed gap marker does, taking the events with it.
 */
export async function recordSessionEventIndex(
  tx: any,
  rows: readonly SessionEventIndexInputRow[],
  receivedAt: string,
): Promise<void> {
  try {
    const { sessionEvents } = aggregateSessionEventIndexRows(rows);
    if (!sessionEvents.length) return;
    await tx.transaction(async (savepoint: any) => {
      const t = schema.analyticsSessionEvents;
      await savepoint
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

      const tenants = new Map<
        string,
        { ownerEmail: string; orgId: string | null }
      >();
      for (const row of sessionEvents) {
        tenants.set(row.tenantKey, {
          ownerEmail: row.ownerEmail,
          orgId: row.orgId ?? null,
        });
      }
      await savepoint
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
    });
  } catch (error) {
    // Deploys ship code before the scheduled migration creates these tables.
    // Without the coverage table no tenant has coverage, so no session can
    // be read as complete, whatever the error was.
    if (!(await coverageTableExists(tx))) {
      warnIndexFailure(
        "Session event index tables are not migrated yet; events were stored unindexed:",
        error,
      );
      return;
    }
    // A later batch can still index these sessions, so the gap must be
    // recorded or "didn't" would read their missing events as absence.
    await tx
      .insert(schema.analyticsSessionEventGaps)
      .values(sessionEventGapRows(rows, receivedAt))
      .onConflictDoNothing();
    warnIndexFailure(
      "Session event index write failed; its sessions are marked incomplete:",
      error,
    );
  }
}

/**
 * Best-effort, after the events commit. The catalog never decides a filter,
 * and its own short transaction keeps hot rows like `pageview` from staying
 * locked for the whole ingest transaction. The catalog lists events from the
 * latest table only, so a daily row committed without its latest sighting
 * would hide that event until it fires again.
 */
export async function recordEventCatalog(
  rows: readonly SessionEventIndexInputRow[],
): Promise<void> {
  try {
    const { catalog, catalogLatest } = aggregateSessionEventIndexRows(rows);
    const c = schema.analyticsEventCatalogDaily;
    const l = schema.analyticsEventCatalogLatest;
    if (!catalog.length) return;
    await (getDb() as any).transaction(async (tx: any) => {
      await tx
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
      await tx
        .insert(l)
        .values(catalogLatest)
        .onConflictDoUpdate({
          target: [l.tenantKey, l.eventName, l.app],
          set: {
            lastSeenAt: sql`greatest(${l.lastSeenAt}, excluded.last_seen_at)`,
            propertyKeys: sql`case when excluded.last_seen_at >= ${l.lastSeenAt} then excluded.property_keys else ${l.propertyKeys} end`,
          },
        });
    });
  } catch (error) {
    warnIndexFailure("Event catalog write failed; events were stored:", error);
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
export async function sessionEventFilterConditions(
  filters: SessionEventFilters,
) {
  const didEvents = normalizeSessionEventNames(filters.didEvents);
  const didNotEvents = normalizeSessionEventNames(filters.didNotEvents);
  if (!didEvents.length && !didNotEvents.length) return [];
  if (!(await sessionEventIndexReady(getDb()))) return [sql`false`];

  const r = schema.sessionRecordings;
  const sibling = alias(schema.sessionRecordings, "session_event_sibling");
  const se = schema.analyticsSessionEvents;
  const coverage = schema.analyticsSessionEventCoverage;
  const gaps = schema.analyticsSessionEventGaps;
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
    // "Didn't" needs a session the index saw completely, so a failed or
    // pruned index write never reads as the event's absence.
    ...(didNotEvents.length
      ? [
          sessionIndexed(),
          sql`not exists (select 1 from ${gaps} where ${gaps.tenantKey} = ${recordingTenant} and ${gaps.sessionId} = ${r.sessionId})`,
        ]
      : []),
    ...didNotEvents.map((eventName) => sql`not ${sessionIndexed(eventName)}`),
  ];
}

/**
 * The latest coverage start among the viewer's tenants. Each recording is
 * filtered by its own tenant's start, so only the latest holds for all.
 */
export async function getSessionEventCoverageStart(
  scope: SessionEventScope,
): Promise<string | null> {
  const db = getDb() as any;
  if (!(await sessionEventIndexReady(db))) return null;
  const coverage = schema.analyticsSessionEventCoverage;
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
  if (filters.from) {
    conditions.push(gte(se.lastAt, isoTimestamp(filters.from)));
  }
  if (filters.to) {
    conditions.push(lte(se.firstAt, isoTimestamp(filters.to, true)));
  }
  if (filters.app) conditions.push(eq(se.app, filters.app));
  if (!(await sessionEventIndexReady(db))) {
    return { events: [], coverageStartedAt: null };
  }
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

function isoTimestamp(value: string, endOfDay = false): string {
  if (!sessionEventBoundSchema.safeParse(value).success) {
    throw new Error(`Invalid event range bound: ${value}`);
  }
  // A date-only upper bound covers that whole day, as it does in the catalog.
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T23:59:59.999Z`;
  }
  return new Date(value).toISOString();
}

function isoDate(value: string | undefined, fallback: Date): string {
  return (
    value === undefined ? fallback.toISOString() : isoTimestamp(value)
  ).slice(0, 10);
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
  if (!(await sessionEventIndexReady(db))) {
    return {
      from: fromDate,
      to: toDate,
      entries: [],
      apps: [],
      truncated: false,
    };
  }
  const c = schema.analyticsEventCatalogDaily;
  const l = schema.analyticsEventCatalogLatest;
  const tenantKeys = viewerTenantKeys(scope);
  const latestPerEvent = db
    .selectDistinctOn([l.eventName, l.app], {
      eventName: l.eventName,
      app: l.app,
      lastSeenAt: l.lastSeenAt,
      propertyKeys: l.propertyKeys,
    })
    .from(l)
    .where(
      and(
        inArray(l.tenantKey, tenantKeys),
        ...(filters.app ? [eq(l.app, filters.app)] : []),
      ),
    )
    .orderBy(l.eventName, l.app, desc(l.lastSeenAt))
    .as("latest_per_event");

  // Last seen and property keys come from each event's latest sighting, so an
  // event that stopped firing still shows; volume is scoped to the range.
  const latestRows = await db
    .select()
    .from(latestPerEvent)
    .orderBy(
      desc(latestPerEvent.lastSeenAt),
      latestPerEvent.eventName,
      latestPerEvent.app,
    )
    .limit(EVENT_CATALOG_MAX_ENTRIES + 1);
  const truncated = latestRows.length > EVENT_CATALOG_MAX_ENTRIES;
  const lastSeenRows = latestRows.slice(0, EVENT_CATALOG_MAX_ENTRIES);
  const listedNames: string[] = [
    ...new Set<string>(
      lastSeenRows.map((row: { eventName: string }) => row.eventName),
    ),
  ];
  const inRange = and(
    inArray(c.tenantKey, tenantKeys),
    gte(c.eventDate, fromDate),
    lte(c.eventDate, toDate),
    ...(filters.app ? [eq(c.app, filters.app)] : []),
  );
  // App totals come from every event in range, not just the listed ones, so a
  // truncated list cannot make an app look like it sends only automatic events.
  const [volumeRows, appRows] = await Promise.all([
    listedNames.length
      ? db
          .select({
            eventName: c.eventName,
            app: c.app,
            volume: sql<number>`sum(${c.eventCount})`,
          })
          .from(c)
          .where(and(inRange, inArray(c.eventName, listedNames)))
          .groupBy(c.eventName, c.app)
      : [],
    db
      .select({
        app: c.app,
        eventCount: sql<number>`count(distinct ${c.eventName})`,
        customEventCount: sql<number>`count(distinct ${c.eventName}) filter (where ${notInArray(c.eventName, [...AUTOMATIC_ANALYTICS_EVENT_NAMES])})`,
        volume: sql<number>`sum(${c.eventCount})`,
      })
      .from(c)
      .where(inRange)
      .groupBy(c.app),
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

  const apps: EventCatalogApp[] = appRows.map(
    (row: {
      app: string;
      eventCount: unknown;
      customEventCount: unknown;
      volume: unknown;
    }) => ({
      app: row.app || null,
      eventCount: Number(row.eventCount),
      volume: Number(row.volume),
      onlyAutomaticEvents: Number(row.customEventCount) === 0,
    }),
  );

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
    apps: apps.sort((a, b) => b.volume - a.volume),
    truncated,
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
  const se = schema.analyticsSessionEvents;
  const recent = alias(schema.analyticsSessionEvents, "session_event_recent");
  // A session's rows go together: dropping only its old rows would make
  // "didn't" match events the session did.
  // guard:allow-unscoped -- retention intentionally sweeps expired index rows across tenants.
  const sessionResult = await db
    .delete(se)
    .where(
      and(
        lt(se.lastAt, sessionCutoff),
        sql`not exists (select 1 from ${se} as ${recent} where ${recent.tenantKey} = ${se.tenantKey} and ${recent.sessionId} = ${se.sessionId} and ${recent.lastAt} >= ${sessionCutoff})`,
      ),
    );
  const gaps = schema.analyticsSessionEventGaps;
  // guard:allow-unscoped -- retention intentionally sweeps expired gap markers across tenants.
  await db
    .delete(gaps)
    .where(
      and(
        lt(gaps.recordedAt, sessionCutoff),
        sql`not exists (select 1 from ${se} where ${se.tenantKey} = ${gaps.tenantKey} and ${se.sessionId} = ${gaps.sessionId})`,
      ),
    );
  // guard:allow-unscoped -- retention intentionally sweeps expired catalog days across tenants.
  const catalogResult = await db
    .delete(schema.analyticsEventCatalogDaily)
    .where(lt(schema.analyticsEventCatalogDaily.eventDate, catalogCutoff));
  // guard:allow-unscoped -- retention intentionally sweeps events unseen for the whole catalog window across tenants.
  await db
    .delete(schema.analyticsEventCatalogLatest)
    .where(lt(schema.analyticsEventCatalogLatest.lastSeenAt, catalogCutoff));
  return {
    sessionEvents: Number(sessionResult?.rowCount ?? 0),
    catalogDays: Number(catalogResult?.rowCount ?? 0),
  };
}

export function __resetSessionEventIndexForTests(): void {
  lastWarnAt.clear();
  indexTablesReady = false;
}

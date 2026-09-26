
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import { setActionChangeFastPath } from "../action-change-fast-path.js";
import {
  actionChangeDedupeKey,
  ACTION_CHANGE_MARKER_KEY,
  parseActionChangeMarker,
  type ActionChangeTarget,
} from "../action-change-marker.js";
import { getAppStateEmitter } from "../application-state/emitter.js";
import { type DbExec, getDbExec } from "../db/client.js";
import {
  ensureIndexExists,
  ensureIndexExistsConcurrently,
  ensureTableExists,
} from "../db/ddl-guard.js";
import {
  EXTENSION_CHANGE_MARKER_KEY,
  parseExtensionChangeMarker,
  type ExtensionChangeTarget,
} from "../extensions/change-marker.js";
import { REALTIME_REGISTRATION_SETTING_KEY } from "../realtime-registration-key.js";
import { getSettingsEmitter } from "../settings/store.js";

export interface ChangeEvent {
  version: number;
  cursorId?: string;
  source: string;
  type: string;
  key?: string;
  owner?: string;
  orgId?: string;
  resourceType?: string;
  resourceId?: string;
  visibility?: "public";
  [k: string]: unknown;
}

export interface TransactionalChange {
  persist(transaction: DbExec): Promise<ChangeEvent>;
  isPersisted(): boolean;
  publish(): ChangeEvent;
}

const MAX_BUFFER = 200;
const DURABLE_READ_LIMIT = 1000;
const DURABLE_RETENTION_MS = 24 * 60 * 60 * 1000;
const DURABLE_PRUNE_BATCH = 10_000;
const DURABLE_PRUNE_MAX_BATCHES = 40;
const DURABLE_PRUNE_LOCK_KEY = "agent-native:sync-events-prune";
const ACTION_MARKER_REPLAY_WINDOW_MS = 60_000;
const LEGACY_DB_CHECK_INTERVAL_MS = 1000;
export const DURABLE_LEGACY_DB_CHECK_INTERVAL_MS = 30_000;
export const POLL_CHANGE_EVENT = "poll-change";

const ACCESS_CACHE_TTL_MS = 30_000;
const ACCESS_CACHE_DENY_TTL_MS = 5_000;
const ACCESS_CACHE_MAX = 500;
const SCREEN_REFRESH_KEY = "__screen_refresh__";
const SCREEN_REFRESH_QUERY_LIMIT = 256;

const SEED_SYNC_VERSION_SQL = `
  INSERT INTO sync_version (id, v)
  SELECT 1, GREATEST(
    COALESCE((SELECT MAX(version) FROM sync_events), 0),
    (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
  )
  ON CONFLICT (id) DO NOTHING
`;
const ALLOCATING_INSERT_SQL = `
  WITH alloc AS (
    UPDATE sync_version
       SET v = GREATEST(v + 1, (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT, (?)::BIGINT)
     WHERE id = 1
     RETURNING v
  )
  INSERT INTO sync_events (id, version, event_json, source, type, event_key, owner, org_id, resource_type, resource_id, created_at)
  SELECT ?, alloc.v, jsonb_set((?)::jsonb, '{version}', to_jsonb(alloc.v))::text, ?, ?, ?, ?, ?, ?, ?, ?
    FROM alloc
  ON CONFLICT (id) DO UPDATE SET id = excluded.id
  RETURNING version
`;

function timestampValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sqlWatermarkValue(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

type SyncCursor = { version: number; id: string };

function compareSyncCursors(a: SyncCursor, b: SyncCursor): number {
  if (a.version !== b.version) return a.version - b.version;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function cursorForEvent(event: ChangeEvent): SyncCursor {
  return { version: event.version, id: event.cursorId ?? "" };
}

function encodeSyncCursor(cursor: SyncCursor): string {
  return `${cursor.version}.${cursor.id}`;
}

function decodeSyncCursor(value: unknown): SyncCursor | undefined {
  if (typeof value !== "string") return undefined;
  const separator = value.indexOf(".");
  if (separator < 1) return undefined;
  const version = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (!Number.isSafeInteger(version) || version < 0) return undefined;
  return { version, id };
}

function isEventAfterCursor(event: ChangeEvent, cursor: SyncCursor): boolean {
  return compareSyncCursors(cursorForEvent(event), cursor) > 0;
}

function syncEventsDisabled(): boolean {
  return (
    process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE === "1" ||
    (process.env.VITEST === "true" &&
      process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS !== "1")
  );
}

async function readMaxUpdatedAtRaw(
  db: {
    execute: (
      query: string | { sql: string; args?: unknown[] },
    ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  table: "application_state" | "settings" | "tools",
  excludeKey?: string,
): Promise<unknown> {
  try {
    const result = await db.execute(
      excludeKey
        ? {
            sql: `SELECT MAX(updated_at) as max_ts FROM ${table} WHERE key != ?`,
            args: [excludeKey],
          }
        : `SELECT MAX(updated_at) as max_ts FROM ${table}`,
    );
    return result.rows[0]?.max_ts;
  } catch {
    return undefined;
  }
}

async function readMaxUpdatedAt(
  db: {
    execute: (
      query: string | { sql: string; args?: unknown[] },
    ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  table: "application_state" | "settings" | "tools",
  excludeKey?: string,
): Promise<number> {
  return timestampValue(await readMaxUpdatedAtRaw(db, table, excludeKey));
}

async function readSettingsMaxUpdatedAt(db: {
  execute: (
    query: string | { sql: string; args?: unknown[] },
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<number> {
  return readMaxUpdatedAt(db, "settings", REALTIME_REGISTRATION_SETTING_KEY);
}

async function readExtensionMarkerMaxUpdatedAt(db: {
  execute: (
    query: string | { sql: string; args?: unknown[] },
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<number> {
  try {
    const result = await db.execute({
      sql: "SELECT MAX(updated_at) as max_ts FROM application_state WHERE key = ?",
      args: [EXTENSION_CHANGE_MARKER_KEY],
    });
    return timestampValue(result.rows[0]?.max_ts);
  } catch {
    return 0;
  }
}

async function readActionMarkerMaxUpdatedAt(db: {
  execute: (
    query: string | { sql: string; args?: unknown[] },
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<number> {
  try {
    const result = await db.execute({
      sql: "SELECT MAX(updated_at) as max_ts FROM application_state WHERE key = ?",
      args: [ACTION_CHANGE_MARKER_KEY],
    });
    return timestampValue(result.rows[0]?.max_ts);
  } catch {
    return 0;
  }
}

function accessCacheKey(
  userEmail: string,
  orgId: string | undefined,
  resourceType: string,
  resourceId: string,
): string {
  return `${userEmail}|${orgId ?? ""}|${resourceType}|${resourceId}`;
}

function accessResourceKey(resourceType: string, resourceId: string): string {
  return `${resourceType}|${resourceId}`;
}

function extensionTargetKey(target: ExtensionChangeTarget): string | null {
  if (target.owner) return `owner:${target.owner}`;
  if (target.orgId) return `org:${target.orgId}`;
  return null;
}

function addExtensionTarget(
  targets: Map<string, ExtensionChangeTarget>,
  target: ExtensionChangeTarget,
): void {
  const key = extensionTargetKey(target);
  if (key) targets.set(key, target);
}

function extensionTargetsForRow(
  row: Record<string, unknown>,
  shareRows: Array<Record<string, unknown>>,
): ExtensionChangeTarget[] {
  const targets = new Map<string, ExtensionChangeTarget>();
  const owner = typeof row.owner_email === "string" ? row.owner_email : "";
  const orgId = typeof row.org_id === "string" ? row.org_id : "";
  const visibility =
    typeof row.visibility === "string" ? row.visibility : "private";

  if (owner) addExtensionTarget(targets, { owner });
  if (visibility === "org" && orgId) addExtensionTarget(targets, { orgId });

  for (const share of shareRows) {
    const principalType =
      typeof share.principal_type === "string" ? share.principal_type : "";
    const principalId =
      typeof share.principal_id === "string" ? share.principal_id : "";
    if (principalType === "user" && principalId) {
      addExtensionTarget(targets, { owner: principalId });
    } else if (principalType === "org" && principalId) {
      addExtensionTarget(targets, { orgId: principalId });
    } else if (principalType === "group" && orgId) {
      addExtensionTarget(targets, { orgId });
    }
  }

  return Array.from(targets.values());
}

async function readExtensionTargetsForRows(
  db: {
    execute: (
      query: string | { sql: string; args?: unknown[] },
    ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  },
  rows: Array<Record<string, unknown>>,
): Promise<ExtensionChangeTarget[][]> {
  const ids = rows
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter(Boolean);
  const sharesByResourceId = new Map<string, Array<Record<string, unknown>>>();

  if (ids.length > 0) {
    try {
      const placeholders = ids.map(() => "?").join(", ");
      const shareResult = await db.execute({
        sql: `SELECT resource_id, principal_type, principal_id FROM tool_shares WHERE resource_id IN (${placeholders})`,
        args: ids,
      });
      for (const share of shareResult.rows) {
        const resourceId =
          typeof share.resource_id === "string" ? share.resource_id : "";
        if (!resourceId) continue;
        const bucket = sharesByResourceId.get(resourceId) ?? [];
        bucket.push(share);
        sharesByResourceId.set(resourceId, bucket);
      }
    } catch {
      // Sharing tables are optional during early app initialization.
    }
  }

  return rows.map((row) =>
    extensionTargetsForRow(
      row,
      sharesByResourceId.get(typeof row.id === "string" ? row.id : "") ?? [],
    ),
  );
}

type ChangeVisibility = "visible" | "hidden" | "pending";

export type ChangeReadResult = {
  version: number;
  events: ChangeEvent[];
  cursor?: string;
  cursorLimited?: boolean;
};

export type AccessResolver = (
  resourceType: string,
  resourceId: string,
  ctx: { userEmail: string; orgId: string | undefined },
) => Promise<unknown>;

const defaultResolveAccess: AccessResolver = async (
  resourceType,
  resourceId,
  ctx,
) => {
  const { resolveAccess } = await import("../sharing/access.js");
  return resolveAccess(resourceType, resourceId, ctx);
};

export interface AppSyncStateOptions {
  getDb?: () => DbExec;
  resolveAccess?: AccessResolver;
  deterministicEventIds?: boolean;
  dbAssignedVersions?: boolean;
  accessAllowTtlMs?: number;
}

export class AppSyncState {
  private readonly getDb: () => DbExec;
  private readonly resolveAccessFn: AccessResolver;
  private readonly deterministicEventIds: boolean;
  private readonly dbAssignedVersions: boolean;
  private recordChain: Promise<void> = Promise.resolve();
  private dbVersionFallbacks = 0;
  private warnedListenerThrow = false;

  private version = 0;
  private latestCursor: SyncCursor = { version: 0, id: "" };
  private readonly buffer: ChangeEvent[] = [];
  private readonly pollEmitter = new EventEmitter();
  private syncEventsInitPromise: Promise<boolean> | undefined;
  private lastDurablePrune = Date.now();
  private durablePruneFailures = 0;
  private durableWriteFailures = 0;
  private allocatorReseedFailures = 0;

  private versionSeeded = false;

  private lastDbCheck = 0;
  private checkPromise: Promise<void> | null = null;
  private lastAppStateTs = 0;
  private lastSettingsTs = 0;
  private lastExtensionsTs = 0;
  private lastExtensionsUpdatedAt: string | number | undefined;
  private lastExtensionMarkerTs = 0;
  private lastActionMarkerTs = 0;
  private replayActionMarkerOnce = false;

  private lastScreenRefreshTs = 0;
  private lastScreenRefreshSessionId = "";
  private screenRefreshInitialized = false;
  private screenRefreshHasMore = false;
  private localEmittersWired = false;

  private readonly accessCache = new Map<
    string,
    { allowed: boolean; checkedAt: number }
  >();
  private readonly accessInFlight = new Set<string>();
  private readonly accessInvalidationEpoch = new Map<string, number>();
  private readonly accessAllowTtlMs: number;

  constructor(options: AppSyncStateOptions = {}) {
    this.getDb = options.getDb ?? getDbExec;
    this.resolveAccessFn = options.resolveAccess ?? defaultResolveAccess;
    this.deterministicEventIds = options.deterministicEventIds ?? false;
    this.dbAssignedVersions = options.dbAssignedVersions ?? false;
    this.accessAllowTtlMs = options.accessAllowTtlMs ?? ACCESS_CACHE_TTL_MS;
    this.pollEmitter.setMaxListeners(0);
  }

  private accessCacheTtl(allowed: boolean): number {
    return allowed ? this.accessAllowTtlMs : ACCESS_CACHE_DENY_TTL_MS;
  }

  private durableEventId(event: ChangeEvent, dedupeKey?: string): string {
    if (this.deterministicEventIds && dedupeKey !== undefined) {
      const identity = [
        event.source,
        event.type,
        event.key ?? "",
        event.owner ?? "",
        event.orgId ?? "",
        event.resourceType ?? "",
        event.resourceId ?? "",
        dedupeKey,
      ].join("\u0000");
      return createHash("sha256").update(identity).digest("hex").slice(0, 32);
    }
    return `${event.version}-${Math.random().toString(36).slice(2, 10)}`;
  }

  getVersion(): number {
    return this.version;
  }

  getPollEmitter(): EventEmitter {
    return this.pollEmitter;
  }

  wireLocalEmitters(): void {
    if (this.localEmittersWired) return;
    this.localEmittersWired = true;
    getAppStateEmitter().on("app-state", (event) => {
      if (
        event.key === EXTENSION_CHANGE_MARKER_KEY ||
        event.key === ACTION_CHANGE_MARKER_KEY
      ) {
        return;
      }
      this.recordChange(event);
    });
    getSettingsEmitter().on("settings", (event) => {
      if (event.key === REALTIME_REGISTRATION_SETTING_KEY) return;
      this.recordChange(event);
    });
  }

  async ensureSyncEventsTable(): Promise<boolean> {
    if (syncEventsDisabled()) return false;
    if (!this.syncEventsInitPromise) {
      this.syncEventsInitPromise = (async () => {
        const client = this.getDb();
        const createSql = `
        CREATE TABLE IF NOT EXISTS sync_events (
          id TEXT PRIMARY KEY,
          version BIGINT NOT NULL,
          event_json TEXT NOT NULL,
          source TEXT NOT NULL,
          type TEXT NOT NULL,
          event_key TEXT,
          owner TEXT,
          org_id TEXT,
          resource_type TEXT,
          resource_id TEXT,
          created_at BIGINT NOT NULL
        )
      `;

        const guardOptions = { injectedClient: client };
        await ensureTableExists("sync_events", createSql, guardOptions);
        await ensureIndexExists(
          "sync_events_version_idx",
          "CREATE INDEX IF NOT EXISTS sync_events_version_idx ON sync_events (version)",
          guardOptions,
        );
        await ensureIndexExists(
          "sync_events_owner_version_idx",
          "CREATE INDEX IF NOT EXISTS sync_events_owner_version_idx ON sync_events (owner, version)",
          guardOptions,
        );
        await ensureIndexExists(
          "sync_events_org_version_idx",
          "CREATE INDEX IF NOT EXISTS sync_events_org_version_idx ON sync_events (org_id, version)",
          guardOptions,
        );
        await ensureIndexExistsConcurrently(
          "sync_events_created_at_id_idx",
          "CREATE INDEX CONCURRENTLY IF NOT EXISTS sync_events_created_at_id_idx ON sync_events (created_at, id)",
          guardOptions,
        );
        if (this.dbAssignedVersions) {
          await ensureTableExists(
            "sync_version",
            "CREATE TABLE IF NOT EXISTS sync_version (id INT PRIMARY KEY, v BIGINT NOT NULL)",
            guardOptions,
          );
          await client.execute(SEED_SYNC_VERSION_SQL);
        }
        return true;
      })().catch(() => {
        this.syncEventsInitPromise = undefined;
        return false;
      });
    }
    return this.syncEventsInitPromise;
  }

  private async pruneDurableEvents(client: DbExec): Promise<void> {
    const now = Date.now();
    if (now - this.lastDurablePrune < 5 * 60 * 1000) return;
    this.lastDurablePrune = now;
    const cutoff = now - DURABLE_RETENTION_MS;
    let deleted = 0;
    try {
      for (let batch = 0; batch < DURABLE_PRUNE_MAX_BATCHES; batch++) {
        const rowsAffected = (
          await client.execute({
            sql: `WITH prune_lease AS MATERIALIZED (
                   SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0::bigint)) AS acquired
                 ), prune_batch AS MATERIALIZED (
                   SELECT sync_events.id
                   FROM sync_events CROSS JOIN prune_lease
                   WHERE prune_lease.acquired AND sync_events.created_at < ?
                   ORDER BY sync_events.created_at, sync_events.id LIMIT ?
                 )
                 DELETE FROM sync_events WHERE id IN (
                   SELECT id FROM prune_batch
                 )`,
            args: [DURABLE_PRUNE_LOCK_KEY, cutoff, DURABLE_PRUNE_BATCH],
          })
        ).rowsAffected;
        deleted += rowsAffected;
        if (rowsAffected < DURABLE_PRUNE_BATCH) break;
      }
      this.durablePruneFailures = 0;
    } catch (err) {
      this.durablePruneFailures++;
      if (this.durablePruneFailures === 1) {
        console.warn(
          `[agent-native] sync_events prune failed after deleting ${deleted} row(s); the table will grow until this succeeds:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  private reportDurableWriteFailure(
    error: unknown,
    event: Pick<ChangeEvent, "source" | "type" | "key">,
  ): void {
    this.durableWriteFailures++;
    if (this.durableWriteFailures === 1) {
      console.warn(
        `[agent-native] sync_events write failed for ${event.source}/${event.type}${event.key ? `/${event.key}` : ""}; durable replay is unavailable until the database recovers:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private reportAllocatorReseedFailure(error: unknown): void {
    this.allocatorReseedFailures++;
    if (this.allocatorReseedFailures === 1) {
      console.warn(
        "[agent-native] sync version allocator reseed failed; retrying allocation:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async persistSyncEvent(
    event: ChangeEvent,
    dedupeKey?: string,
    presetId?: string,
  ): Promise<void> {
    if (!(await this.ensureSyncEventsTable())) return;
    const client = this.getDb();
    await client.execute({
      sql: `INSERT INTO sync_events (id, version, event_json, source, type, event_key, owner, org_id, resource_type, resource_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      args: [
        presetId ?? this.durableEventId(event, dedupeKey),
        event.version,
        JSON.stringify(event),
        event.source,
        event.type,
        event.key ?? null,
        event.owner ?? null,
        event.orgId ?? null,
        event.resourceType ?? null,
        event.resourceId ?? null,
        Date.now(),
      ],
    });
    this.durableWriteFailures = 0;
    await this.pruneDurableEvents(client);
  }

  private async persistWithDbAssignedVersion(
    event: { source: string; type: string; key?: string; [k: string]: unknown },
    id: string,
  ): Promise<number | null> {
    if (!(await this.ensureSyncEventsTable())) return null;
    const client = this.getDb();
    const args = [
      this.version + 1,
      id,
      JSON.stringify(event).split("\\u0000").join(""),
      event.source,
      event.type,
      event.key ?? null,
      (event.owner as string | undefined) ?? null,
      (event.orgId as string | undefined) ?? null,
      (event.resourceType as string | undefined) ?? null,
      (event.resourceId as string | undefined) ?? null,
      Date.now(),
    ];
    let result = await client.execute({ sql: ALLOCATING_INSERT_SQL, args });
    if (result.rows.length === 0) {
      try {
        await client.execute(SEED_SYNC_VERSION_SQL);
        this.allocatorReseedFailures = 0;
      } catch (error) {
        this.reportAllocatorReseedFailure(error);
      }
      result = await client.execute({ sql: ALLOCATING_INSERT_SQL, args });
    }
    if (result.rows.length > 0) this.allocatorReseedFailures = 0;
    const version = timestampValue(result.rows[0]?.version);
    await this.pruneDurableEvents(client);
    return version > 0 ? version : null;
  }

  private async recoverCommittedVersion(id: string): Promise<number | null> {
    try {
      const result = await this.getDb().execute({
        sql: "SELECT version FROM sync_events WHERE id = ?",
        args: [id],
      });
      const version = timestampValue(result.rows[0]?.version);
      return version > 0 ? version : null;
    } catch {
      return null;
    }
  }

  private async alignVersionAllocator(floor: number): Promise<void> {
    if (floor <= 0) return;
    try {
      if (!(await this.ensureSyncEventsTable())) return;
      await this.getDb().execute({
        sql: "UPDATE sync_version SET v = GREATEST(v, (?)::BIGINT) WHERE id = 1",
        args: [floor],
      });
    } catch {
      // Soft guarantee under DB failure, matching the clock fallback.
    }
  }

  async readMaxSyncEventVersion(): Promise<number> {
    if (!(await this.ensureSyncEventsTable())) return 0;
    try {
      const result = await this.getDb().execute(
        "SELECT MAX(version) as max_version FROM sync_events",
      );
      return timestampValue(result.rows[0]?.max_version);
    } catch {
      return 0;
    }
  }

  async readMinSyncEventVersion(): Promise<number> {
    if (!(await this.ensureSyncEventsTable())) return 0;
    try {
      const result = await this.getDb().execute(
        "SELECT MIN(version) as min_version FROM sync_events",
      );
      return timestampValue(result.rows[0]?.min_version);
    } catch {
      return 0;
    }
  }

  invalidateCollabAccessCache(resourceType: string, resourceId: string): void {
    const resourceKey = accessResourceKey(resourceType, resourceId);
    this.accessInvalidationEpoch.set(
      resourceKey,
      (this.accessInvalidationEpoch.get(resourceKey) ?? 0) + 1,
    );
    const suffix = `|${resourceKey}`;
    for (const key of Array.from(this.accessCache.keys())) {
      if (key.endsWith(suffix)) this.accessCache.delete(key);
    }
    for (const key of Array.from(this.accessInFlight)) {
      if (key.endsWith(suffix)) this.accessInFlight.delete(key);
    }
  }

  private setAccessCache(key: string, allowed: boolean, now: number): void {
    this.accessCache.delete(key);
    this.accessCache.set(key, { allowed, checkedAt: now });
    if (this.accessCache.size > ACCESS_CACHE_MAX) {
      const overflow = this.accessCache.size - ACCESS_CACHE_MAX;
      let removed = 0;
      for (const oldestKey of this.accessCache.keys()) {
        this.accessCache.delete(oldestKey);
        if (++removed >= overflow) break;
      }
    }
  }

  private scheduleAccessCheck(
    key: string,
    resourceType: string,
    resourceId: string,
    userEmail: string,
    orgId: string | undefined,
  ): void {
    if (this.accessInFlight.has(key)) return;
    this.accessInFlight.add(key);
    const resourceKey = accessResourceKey(resourceType, resourceId);
    const epoch = this.accessInvalidationEpoch.get(resourceKey) ?? 0;
    void (async () => {
      try {
        const access = await this.resolveAccessFn(resourceType, resourceId, {
          userEmail,
          orgId,
        });
        if ((this.accessInvalidationEpoch.get(resourceKey) ?? 0) !== epoch) {
          return;
        }
        this.setAccessCache(key, access != null, Date.now());
      } catch {
        if ((this.accessInvalidationEpoch.get(resourceKey) ?? 0) !== epoch) {
          return;
        }
        this.setAccessCache(key, false, Date.now());
      } finally {
        this.accessInFlight.delete(key);
      }
    })();
  }

  __resetAccessCacheForTests(): void {
    this.accessCache.clear();
    this.accessInFlight.clear();
    this.accessInvalidationEpoch.clear();
  }

  /**
   * Decide whether a poll/SSE change event should be delivered to a user.
   *
   * SYNC-CACHE VARIANT — WHY THIS IS SYNCHRONOUS:
   * This function is called on hot, synchronous paths: the SSE emitter callback
   * `push(change)` in poll-events.ts (fires per event) and the
   * `getChangesSinceForUser` loop in this file. Making it async would be
   * invasive. Instead, for the access-aware branch we consult an in-memory
   * cache and, on a miss, fire a NON-BLOCKING background access check and
   * return `false` for the current event. Because the poll fallback re-evaluates
   * with the now-populated cache, delivery is eventually guaranteed — the only
   * cost is that the very first event for a fresh (user, resource) pair goes
   * over poll instead of push, and every subsequent event within the TTL is
   * pushed.
   *
   * Security: a cache MISS returns `false`, so we NEVER deliver to a user before
   * their access has been affirmatively confirmed by the resolver — the same
   * authority that gates the HTTP routes. Errors fail closed (cached deny). The
   * owner/org fast paths below are unchanged and evaluated first.
   */
  canSeeChangeForUser(
    event: Pick<
      ChangeEvent,
      "owner" | "orgId" | "resourceType" | "resourceId" | "visibility"
    >,
    userEmail: string,
    orgId: string | undefined,
  ): boolean {
    return (
      this.getChangeVisibilityForUser(event, userEmail, orgId) === "visible"
    );
  }

  private getChangeVisibilityForUser(
    event: Pick<
      ChangeEvent,
      "owner" | "orgId" | "resourceType" | "resourceId" | "visibility"
    >,
    userEmail: string,
    orgId: string | undefined,
  ): ChangeVisibility {
    const normalizedUserEmail = userEmail.trim().toLowerCase();
    if (!event.owner && !event.orgId && !event.resourceType) return "visible";
    if (
      typeof event.owner === "string" &&
      event.owner.trim().toLowerCase() === normalizedUserEmail
    ) {
      return "visible";
    }
    if (event.orgId && orgId && event.orgId === orgId) return "visible";
    if (event.visibility === "public") return "visible";

    if (event.resourceType && event.resourceId) {
      const key = accessCacheKey(
        normalizedUserEmail,
        orgId,
        event.resourceType,
        event.resourceId,
      );
      const cached = this.accessCache.get(key);
      const now = Date.now();
      if (
        cached &&
        now - cached.checkedAt < this.accessCacheTtl(cached.allowed)
      ) {
        return cached.allowed ? "visible" : "hidden";
      }
      this.scheduleAccessCheck(
        key,
        event.resourceType,
        event.resourceId,
        normalizedUserEmail,
        orgId,
      );
      return "pending";
    }

    return "hidden";
  }

  recordChange(
    event: {
      source: string;
      type: string;
      key?: string;
      [k: string]: unknown;
    },
    opts?: { dedupeKey?: string },
  ): void {
    if (this.dbAssignedVersions && !syncEventsDisabled()) {
      this.recordChain = this.recordChain
        .then(() => this.recordWithDbVersion(event, opts?.dedupeKey))
        .catch((error) => {
          this.reportDurableWriteFailure(error, event);
        });
      return;
    }
    this.version = Math.max(this.version + 1, Date.now());
    const provisional: ChangeEvent = { ...event, version: this.version };
    const cursorId = this.durableEventId(provisional, opts?.dedupeKey);
    const entry: ChangeEvent = { ...provisional, cursorId };
    this.commitEntry(entry);
    void this.persistSyncEvent(entry, opts?.dedupeKey, cursorId).catch(
      (error) => {
        this.reportDurableWriteFailure(error, entry);
      },
    );
  }

  async prepareTransactionalChange(event: {
    source: string;
    type: string;
    key?: string;
    [k: string]: unknown;
  }): Promise<TransactionalChange> {
    if (!(await this.ensureSyncEventsTable())) {
      throw new Error(
        "Transactional change delivery requires durable sync events",
      );
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let persisted: ChangeEvent | null = null;
    return {
      persist: async (transaction) => {
        if (persisted) return persisted;
        let version: number;
        if (this.dbAssignedVersions) {
          const result = await transaction.execute({
            sql: ALLOCATING_INSERT_SQL,
            args: [
              this.version + 1,
              id,
              JSON.stringify({ ...event, cursorId: id })
                .split("\\u0000")
                .join(""),
              event.source,
              event.type,
              event.key ?? null,
              (event.owner as string | undefined) ?? null,
              (event.orgId as string | undefined) ?? null,
              (event.resourceType as string | undefined) ?? null,
              (event.resourceId as string | undefined) ?? null,
              Date.now(),
            ],
          });
          version = timestampValue(result.rows[0]?.version);
          if (version <= 0) {
            throw new Error("Durable sync version allocation failed");
          }
        } else {
          version = Math.max(this.version + 1, Date.now());
          const entry = { ...event, version, cursorId: id } as ChangeEvent;
          const result = await transaction.execute({
            sql: `INSERT INTO sync_events (id, version, event_json, source, type, event_key, owner, org_id, resource_type, resource_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
            args: [
              id,
              version,
              JSON.stringify(entry),
              entry.source,
              entry.type,
              entry.key ?? null,
              entry.owner ?? null,
              entry.orgId ?? null,
              entry.resourceType ?? null,
              entry.resourceId ?? null,
              Date.now(),
            ],
          });
          if (result.rowsAffected !== 1) {
            throw new Error("Durable sync event was not persisted");
          }
        }
        persisted = { ...event, version, cursorId: id } as ChangeEvent;
        return persisted;
      },
      isPersisted: () => persisted !== null,
      publish: () => {
        if (!persisted) {
          throw new Error(
            "Transactional change cannot publish before persistence commits",
          );
        }
        this.version = Math.max(this.version, persisted.version);
        this.commitEntryForChain(persisted);
        return persisted;
      },
    };
  }

  private commitEntry(entry: ChangeEvent): void {
    this.buffer.push(entry);
    const cursor = cursorForEvent(entry);
    if (compareSyncCursors(cursor, this.latestCursor) > 0) {
      this.latestCursor = cursor;
    }
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    }
    this.pollEmitter.emit(POLL_CHANGE_EVENT, entry);
  }

  private async recordWithDbVersion(
    event: { source: string; type: string; key?: string; [k: string]: unknown },
    dedupeKey?: string,
  ): Promise<void> {
    const id =
      this.deterministicEventIds && dedupeKey !== undefined
        ? this.durableEventId(
            { ...event, version: 0 } as ChangeEvent,
            dedupeKey,
          )
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let version: number | null = null;
    try {
      version = await this.persistWithDbAssignedVersion(
        { ...event, cursorId: id },
        id,
      );
    } catch {
      version = null;
    }
    if (version == null) {
      version = await this.recoverCommittedVersion(id);
    }
    if (version == null) {
      this.dbVersionFallbacks++;
      if (this.dbVersionFallbacks === 1) {
        console.warn(
          "[agent-native] sync version allocation failed; falling back to clock-assigned versions",
        );
      }
      this.version = Math.max(this.version + 1, Date.now());
      const entry: ChangeEvent = {
        ...event,
        version: this.version,
        cursorId: id,
      };
      await this.alignVersionAllocator(this.version);
      this.commitEntryForChain(entry);
      void this.persistSyncEvent(entry, dedupeKey, id).catch((error) => {
        this.reportDurableWriteFailure(error, entry);
      });
      return;
    }
    this.version = Math.max(this.version, version);
    this.commitEntryForChain({ ...event, version, cursorId: id });
  }

  private commitEntryForChain(entry: ChangeEvent): void {
    try {
      this.commitEntry(entry);
    } catch (err) {
      if (!this.warnedListenerThrow) {
        this.warnedListenerThrow = true;
        console.warn(
          "[agent-native] poll listener threw during deferred emit",
          err,
        );
      }
    }
  }

  private recordExtensionChanges(
    targets: ExtensionChangeTarget[],
    dedupeKey?: string,
  ): void {
    const uniqueTargets = new Map<string, ExtensionChangeTarget>();
    for (const target of targets) addExtensionTarget(uniqueTargets, target);
    for (const target of uniqueTargets.values()) {
      this.recordChange(
        {
          source: "extensions",
          type: "change",
          key: "*",
          ...(target.owner ? { owner: target.owner } : {}),
          ...(target.orgId ? { orgId: target.orgId } : {}),
        },
        dedupeKey !== undefined
          ? {
              dedupeKey: `${dedupeKey}|${target.owner ?? ""}|${target.orgId ?? ""}`,
            }
          : undefined,
      );
    }
  }

  private recordActionChanges(
    targets: ActionChangeTarget[],
    dedupeKey?: string,
  ): void {
    for (const target of targets) {
      this.recordChange(
        {
          source: "action",
          type: "change",
          key: target.actionName ?? "*",
          ...(target.owner ? { owner: target.owner } : {}),
          ...(target.orgId ? { orgId: target.orgId } : {}),
          ...(target.requestSource
            ? { requestSource: target.requestSource }
            : {}),
        },
        dedupeKey !== undefined
          ? {
              dedupeKey: actionChangeDedupeKey(target, dedupeKey),
            }
          : undefined,
      );
    }
  }

  getChangesSince(since: number): { version: number; events: ChangeEvent[] } {
    if (since >= this.version) {
      return { version: this.version, events: [] };
    }
    const events = this.buffer.filter((e) => e.version > since);
    return { version: this.version, events };
  }

  getChangesSinceForUser(
    since: number,
    userEmail: string,
    orgId: string | undefined,
    cursor?: SyncCursor,
  ): ChangeReadResult {
    const readCursor = cursor ?? { version: since, id: "" };
    if (
      (!cursor && since >= this.version) ||
      (cursor && compareSyncCursors(this.latestCursor, readCursor) <= 0)
    ) {
      return {
        version: this.version,
        events: [],
        ...(cursor ? { cursor: encodeSyncCursor(readCursor) } : {}),
      };
    }
    const events: ChangeEvent[] = [];
    let version = this.version;
    let lastCursor = readCursor;
    for (const event of this.buffer) {
      if (
        cursor ? !isEventAfterCursor(event, readCursor) : event.version <= since
      ) {
        continue;
      }
      const visibility = this.getChangeVisibilityForUser(
        event,
        userEmail,
        orgId,
      );
      if (visibility === "visible") {
        events.push(event);
        lastCursor = cursorForEvent(event);
        continue;
      }
      if (visibility === "pending") {
        version = Math.max(since, event.version - 1);
        return {
          version,
          events,
          cursorLimited: true,
          ...(cursor && lastCursor !== readCursor
            ? { cursor: encodeSyncCursor(lastCursor) }
            : {}),
        };
      }
      lastCursor = cursorForEvent(event);
    }
    return {
      version,
      events,
      ...(cursor && compareSyncCursors(lastCursor, readCursor) > 0
        ? { cursor: encodeSyncCursor(lastCursor) }
        : {}),
    };
  }

  async getDurableChangesSinceForUser(
    since: number,
    userEmail: string,
    orgId: string | undefined,
    cursor?: SyncCursor,
  ): Promise<ChangeReadResult> {
    if (
      (!cursor && since <= 0) ||
      (cursor && cursor.version <= 0 && cursor.id === "") ||
      !(await this.ensureSyncEventsTable())
    ) {
      return { version: this.version, events: [] };
    }

    try {
      const readCursor = cursor ?? { version: since, id: "" };
      const compositeCursorSql = cursor
        ? "(version > ? OR (version = ? AND id > ?))"
        : "version > ?";
      const result = await this.getDb().execute({
        sql: `SELECT id, version, event_json FROM sync_events WHERE ${compositeCursorSql}
              AND (
                (owner IS NULL AND org_id IS NULL)
                OR owner = ?
                OR org_id = ?
                OR resource_type IS NOT NULL
              )
            ORDER BY version ASC, id ASC LIMIT ?`,
        args: cursor
          ? [
              cursor.version,
              cursor.version,
              cursor.id,
              userEmail,
              orgId ?? null,
              DURABLE_READ_LIMIT + 1,
            ]
          : [since, userEmail, orgId ?? null, DURABLE_READ_LIMIT + 1],
      });
      const events: ChangeEvent[] = [];
      let version = Math.max(this.version, since);
      let lastDurableVersion = since;
      let lastCursor = readCursor;
      const rows = result.rows.slice(0, DURABLE_READ_LIMIT);
      const overflowVersion = timestampValue(
        result.rows[DURABLE_READ_LIMIT]?.version,
      );

      for (const row of rows) {
        const rawVersion = timestampValue(row.version);
        if (rawVersion > lastDurableVersion) lastDurableVersion = rawVersion;
        if (rawVersion > version) version = rawVersion;
        const rowId = typeof row.id === "string" ? row.id : "";
        let rowCursor = rowId ? { version: rawVersion, id: rowId } : undefined;
        let event: ChangeEvent | null = null;
        try {
          const parsed = JSON.parse(String(row.event_json));
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.source === "string" &&
            typeof parsed.type === "string"
          ) {
            event = {
              ...(parsed as ChangeEvent),
              version: rawVersion || (parsed as ChangeEvent).version,
              ...(rowId || typeof (parsed as ChangeEvent).cursorId === "string"
                ? {
                    cursorId: rowId || (parsed as ChangeEvent).cursorId,
                  }
                : {}),
            };
          }
        } catch {
          event = null;
        }
        if (!event) {
          if (rowCursor) lastCursor = rowCursor;
          continue;
        }
        if (!rowCursor && typeof event.cursorId === "string") {
          rowCursor = { version: event.version, id: event.cursorId };
        }

        const visibility = this.getChangeVisibilityForUser(
          event,
          userEmail,
          orgId,
        );
        if (visibility === "visible") {
          events.push(event);
          if (rowCursor) lastCursor = rowCursor;
          continue;
        }
        if (visibility === "pending") {
          return {
            version: Math.max(since, event.version - 1),
            events,
            cursorLimited: true,
            ...(cursor && compareSyncCursors(lastCursor, readCursor) > 0
              ? { cursor: encodeSyncCursor(lastCursor) }
              : {}),
          };
        }
        if (rowCursor) lastCursor = rowCursor;
      }

      if (rows.length >= DURABLE_READ_LIMIT) {
        if (cursor) {
          return {
            version: Math.max(since, lastDurableVersion),
            events,
            cursor: encodeSyncCursor(lastCursor),
            cursorLimited: result.rows.length > DURABLE_READ_LIMIT,
          };
        }
        if (overflowVersion === lastDurableVersion) {
          const boundaryVersion = lastDurableVersion;
          return {
            version: Math.max(since, boundaryVersion - 1),
            events: events.filter((event) => event.version < boundaryVersion),
            cursorLimited: true,
          };
        }
        return {
          version: Math.max(since, lastDurableVersion),
          events,
          cursorLimited: true,
        };
      }

      return {
        version,
        events,
        ...(cursor && compareSyncCursors(lastCursor, readCursor) > 0
          ? { cursor: encodeSyncCursor(lastCursor) }
          : {}),
      };
    } catch {
      return {
        version: this.version,
        events: [],
        ...(cursor ? { cursor: encodeSyncCursor(cursor) } : {}),
      };
    }
  }

  async getCombinedChangesSinceForUser(
    since: number,
    userEmail: string,
    orgId: string | undefined,
    useDurableEvents: boolean,
    cursor?: SyncCursor,
  ): Promise<ChangeReadResult> {
    const memory = this.getChangesSinceForUser(since, userEmail, orgId, cursor);
    if (!useDurableEvents) return memory;

    const durable = await this.getDurableChangesSinceForUser(
      since,
      userEmail,
      orgId,
      cursor,
    );
    const byIdentity = new Map<string, ChangeEvent>();
    for (const event of [...durable.events, ...memory.events]) {
      byIdentity.set(
        JSON.stringify([
          event.cursorId,
          event.version,
          event.source,
          event.type,
          event.key,
          event.owner,
          event.orgId,
          event.resourceType,
          event.resourceId,
        ]),
        event,
      );
    }
    const events = Array.from(byIdentity.values()).sort((a, b) =>
      compareSyncCursors(cursorForEvent(a), cursorForEvent(b)),
    );
    if (cursor) {
      const limitedCursors = [memory, durable]
        .filter((result) => result.cursorLimited)
        .map((result) => decodeSyncCursor(result.cursor))
        .filter((value): value is SyncCursor => !!value);
      if (limitedCursors.length > 0) {
        const boundary = limitedCursors.reduce((minimum, value) =>
          compareSyncCursors(value, minimum) < 0 ? value : minimum,
        );
        return {
          version: boundary.version,
          cursor: encodeSyncCursor(boundary),
          cursorLimited: true,
          events: events.filter(
            (event) => compareSyncCursors(cursorForEvent(event), boundary) <= 0,
          ),
        };
      }
      const responseCursor = [
        cursor,
        decodeSyncCursor(memory.cursor),
        decodeSyncCursor(durable.cursor),
        ...events.map(cursorForEvent),
      ]
        .filter((value): value is SyncCursor => !!value)
        .reduce(
          (maximum, value) =>
            compareSyncCursors(value, maximum) > 0 ? value : maximum,
          cursor,
        );
      return {
        version: Math.max(memory.version, durable.version, since),
        events,
        ...(compareSyncCursors(responseCursor, cursor) > 0
          ? { cursor: encodeSyncCursor(responseCursor) }
          : {}),
      };
    }
    const limitedVersions = [memory, durable]
      .filter((result) => result.cursorLimited)
      .map((result) => result.version);
    return {
      version:
        limitedVersions.length > 0
          ? Math.min(...limitedVersions)
          : Math.max(memory.version, durable.version, since),
      events:
        limitedVersions.length > 0
          ? events.filter(
              (event) => event.version <= Math.min(...limitedVersions),
            )
          : events,
    };
  }

  async seedVersionFromDb(): Promise<void> {
    if (this.versionSeeded) return;
    this.versionSeeded = true;

    try {
      const db = this.getDb();

      const [
        syncEventsTs,
        appTs,
        settingsTs,
        extensionsMaxUpdatedAt,
        extensionMarkerTs,
        actionMarkerTs,
        refreshResult,
      ] = await Promise.all([
        this.readMaxSyncEventVersion(),
        readMaxUpdatedAt(db, "application_state"),
        readSettingsMaxUpdatedAt(db),
        readMaxUpdatedAtRaw(db, "tools"),
        readExtensionMarkerMaxUpdatedAt(db),
        readActionMarkerMaxUpdatedAt(db),
        db
          .execute({
            sql: "SELECT session_id, updated_at FROM application_state WHERE key = ? ORDER BY updated_at DESC, session_id DESC LIMIT 1",
            args: [SCREEN_REFRESH_KEY],
          })
          .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      ]);

      const extensionsTs = timestampValue(extensionsMaxUpdatedAt);
      let refreshTs = 0;
      for (const row of refreshResult.rows) {
        refreshTs = Math.max(refreshTs, timestampValue(row.updated_at));
      }

      const seedMax = Math.max(
        syncEventsTs,
        appTs,
        settingsTs,
        extensionsTs,
        extensionMarkerTs,
        actionMarkerTs,
      );
      if (this.dbAssignedVersions && !syncEventsDisabled()) {
        await this.alignVersionAllocator(seedMax);
      }
      this.version = Math.max(this.version, seedMax);

      this.lastAppStateTs = appTs;
      this.lastSettingsTs = settingsTs;
      this.lastExtensionsTs = extensionsTs;
      this.lastExtensionsUpdatedAt = sqlWatermarkValue(extensionsMaxUpdatedAt);
      this.lastExtensionMarkerTs = extensionMarkerTs;
      this.lastActionMarkerTs = Math.max(
        0,
        actionMarkerTs - ACTION_MARKER_REPLAY_WINDOW_MS,
      );
      this.replayActionMarkerOnce = actionMarkerTs > 0;
      this.lastScreenRefreshTs = refreshTs;
      this.lastScreenRefreshSessionId =
        typeof refreshResult.rows[0]?.session_id === "string"
          ? refreshResult.rows[0].session_id
          : "";
      this.screenRefreshHasMore = false;
      this.screenRefreshInitialized = true;
      this.lastDbCheck = actionMarkerTs > 0 ? 0 : Date.now();
    } catch {
      // Tables may not exist yet — ignore
    }
  }

  async checkExternalDbChanges(options: {
    durableEvents: boolean;
  }): Promise<void> {
    const now = Date.now();
    const interval = options.durableEvents
      ? DURABLE_LEGACY_DB_CHECK_INTERVAL_MS
      : LEGACY_DB_CHECK_INTERVAL_MS;
    if (now - this.lastDbCheck < interval) return;
    if (this.checkPromise) return this.checkPromise;
    this.lastDbCheck = now;
    this.checkPromise = this.doCheckExternalDbChanges()
      .then(() => {
        if (this.dbAssignedVersions && !syncEventsDisabled()) {
          return this.recordChain;
        }
      })
      .finally(() => {
        this.checkPromise = null;
      });
    return this.checkPromise;
  }

  private async doCheckExternalDbChanges(): Promise<void> {
    try {
      const db = this.getDb();

      const [
        appStateMaxTs,
        actionMarkerTs,
        settingsTs,
        extensionsMaxUpdatedAt,
      ] = await Promise.all([
        readMaxUpdatedAt(db, "application_state"),
        readActionMarkerMaxUpdatedAt(db),
        readSettingsMaxUpdatedAt(db),
        readMaxUpdatedAtRaw(db, "tools"),
      ]);

      const replayActionMarker = this.replayActionMarkerOnce;
      this.replayActionMarkerOnce = false;
      const appStateChanged =
        appStateMaxTs > this.lastAppStateTs || replayActionMarker;
      const screenRefreshNeedsCheck =
        appStateChanged || this.screenRefreshHasMore;

      const [appResult, refreshResult, extensionMarkerTs] =
        screenRefreshNeedsCheck
          ? await Promise.all([
              appStateChanged
                ? db.execute({
                    sql: "SELECT session_id, key, updated_at FROM application_state WHERE updated_at > ? ORDER BY updated_at ASC",
                    args: [this.lastAppStateTs],
                  })
                : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
              db.execute({
                sql: `SELECT session_id, updated_at, value FROM application_state
                    WHERE key = ?
                      AND (updated_at > ? OR (updated_at = ? AND session_id > ?))
                    ORDER BY updated_at ASC, session_id ASC
                    LIMIT ?`,
                args: [
                  SCREEN_REFRESH_KEY,
                  this.lastScreenRefreshTs,
                  this.lastScreenRefreshTs,
                  this.lastScreenRefreshSessionId,
                  SCREEN_REFRESH_QUERY_LIMIT,
                ],
              }),
              readExtensionMarkerMaxUpdatedAt(db),
            ])
          : ([
              { rows: [] as Record<string, unknown>[] },
              null,
              this.lastExtensionMarkerTs,
            ] as const);

      if (appResult.rows.length > 0) {
        const appTs = appResult.rows.reduce(
          (max, row) => Math.max(max, timestampValue(row.updated_at)),
          this.lastAppStateTs,
        );
        if (this.lastAppStateTs > 0) {
          for (const row of appResult.rows) {
            const key = typeof row.key === "string" ? row.key : "*";
            if (
              key === EXTENSION_CHANGE_MARKER_KEY ||
              key === ACTION_CHANGE_MARKER_KEY
            ) {
              continue;
            }
            const owner =
              typeof row.session_id === "string" ? row.session_id : undefined;
            this.recordChange(
              {
                source: "app-state",
                type: "change",
                key,
                ...(owner ? { owner } : {}),
              },
              { dedupeKey: `app-state|${timestampValue(row.updated_at)}` },
            );
          }
        }
        this.lastAppStateTs = appTs;
      }

      if (actionMarkerTs > this.lastActionMarkerTs) {
        const actionMarkerResult = await db.execute({
          sql: "SELECT session_id, value, updated_at FROM application_state WHERE key = ? AND updated_at > ? ORDER BY updated_at ASC",
          args: [ACTION_CHANGE_MARKER_KEY, this.lastActionMarkerTs],
        });
        const changedActionMarkers = actionMarkerResult.rows.filter(
          (row) => timestampValue(row.updated_at) > this.lastActionMarkerTs,
        );
        for (const row of changedActionMarkers) {
          const target = parseActionChangeMarker(row.session_id, row.value);
          if (!target) continue;
          this.recordActionChanges(
            [target],
            target.nonce
              ? `action|${target.nonce}`
              : `action|${timestampValue(row.updated_at)}`,
          );
        }
        this.lastActionMarkerTs = actionMarkerTs;
      }

      if (refreshResult) {
        if (!this.screenRefreshInitialized) {
          const lastRow = refreshResult.rows.at(-1);
          this.lastScreenRefreshTs = timestampValue(lastRow?.updated_at);
          this.lastScreenRefreshSessionId =
            typeof lastRow?.session_id === "string" ? lastRow.session_id : "";
          this.screenRefreshHasMore =
            refreshResult.rows.length >= SCREEN_REFRESH_QUERY_LIMIT;
          this.screenRefreshInitialized = true;
        } else {
          for (const row of refreshResult.rows) {
            const owner =
              typeof row.session_id === "string" ? row.session_id : undefined;
            if (!owner) continue;
            const rowTs = timestampValue(row.updated_at);
            let scope: string | undefined;
            try {
              const raw = row.value;
              if (typeof raw === "string") {
                const parsed = JSON.parse(raw);
                if (typeof parsed?.scope === "string") scope = parsed.scope;
              }
            } catch {}
            this.recordChange(
              {
                source: "screen-refresh",
                type: "change",
                key: SCREEN_REFRESH_KEY,
                owner,
                ...(scope ? { scope } : {}),
              },
              { dedupeKey: `screen-refresh|${rowTs}|${owner}` },
            );
            this.lastScreenRefreshTs = rowTs;
            this.lastScreenRefreshSessionId = owner;
          }
          this.screenRefreshHasMore =
            refreshResult.rows.length >= SCREEN_REFRESH_QUERY_LIMIT;
        }
      }

      if (extensionMarkerTs > this.lastExtensionMarkerTs) {
        const extensionMarkerResult = await db.execute({
          sql: "SELECT session_id, value, updated_at FROM application_state WHERE key = ? AND updated_at > ? ORDER BY updated_at ASC",
          args: [EXTENSION_CHANGE_MARKER_KEY, this.lastExtensionMarkerTs],
        });
        const changedExtensionMarkers = extensionMarkerResult.rows;
        if (this.lastExtensionMarkerTs > 0) {
          this.recordExtensionChanges(
            changedExtensionMarkers
              .map((row) =>
                parseExtensionChangeMarker(row.session_id, row.value),
              )
              .filter((target): target is ExtensionChangeTarget => !!target),
            `ext-marker|${extensionMarkerTs}`,
          );
        }
        this.lastExtensionMarkerTs = extensionMarkerTs;
      }

      if (settingsTs > this.lastSettingsTs) {
        if (this.lastSettingsTs > 0) {
          this.recordChange(
            { source: "settings", type: "change", key: "*" },
            { dedupeKey: `settings|${settingsTs}` },
          );
        }
        this.lastSettingsTs = settingsTs;
      }

      const extensionsTs = timestampValue(extensionsMaxUpdatedAt);
      if (extensionsTs > this.lastExtensionsTs) {
        const since = this.lastExtensionsUpdatedAt;
        const extensionResult =
          since === undefined
            ? await db.execute({
                sql: "SELECT id, owner_email, org_id, visibility, updated_at FROM tools ORDER BY updated_at ASC",
                args: [],
              })
            : await db.execute({
                sql: "SELECT id, owner_email, org_id, visibility, updated_at FROM tools WHERE updated_at > ? ORDER BY updated_at ASC",
                args: [since],
              });
        const changedExtensionRows = extensionResult.rows.filter(
          (row) => timestampValue(row.updated_at) > this.lastExtensionsTs,
        );
        if (this.lastExtensionsTs > 0) {
          const targetsByRow = await readExtensionTargetsForRows(
            db,
            changedExtensionRows,
          );
          targetsByRow.forEach((targets, i) => {
            this.recordExtensionChanges(
              targets,
              `ext-tools|${timestampValue(changedExtensionRows[i]?.updated_at)}`,
            );
          });
        }
        this.lastExtensionsTs = extensionsTs;
        this.lastExtensionsUpdatedAt = sqlWatermarkValue(
          extensionsMaxUpdatedAt,
        );
      }
    } catch {
      // Tables may not exist yet — ignore
    }
  }
}

let _defaultState: AppSyncState | undefined;

function hostedRealtimeTransportEnabled(): boolean {
  // config-ok: one of three copies that must agree byte-for-byte; the other
  return process.env.AGENT_NATIVE_REALTIME_TRANSPORT?.trim() === "hosted";
}

export const __hostedRealtimeTransportEnabledForTests =
  hostedRealtimeTransportEnabled;

export function getDefaultAppSyncState(): AppSyncState {
  if (!_defaultState) {
    _defaultState = new AppSyncState({
      dbAssignedVersions: hostedRealtimeTransportEnabled(),
      deterministicEventIds: true,
    });
  }
  return _defaultState;
}

export function getVersion(): number {
  return getDefaultAppSyncState().getVersion();
}

export function getPollEmitter(): EventEmitter {
  return getDefaultAppSyncState().getPollEmitter();
}

export function invalidateCollabAccessCache(
  resourceType: string,
  resourceId: string,
): void {
  getDefaultAppSyncState().invalidateCollabAccessCache(
    resourceType,
    resourceId,
  );
}

export function __resetCollabAccessCacheForTests(): void {
  getDefaultAppSyncState().__resetAccessCacheForTests();
}

export function canSeeChangeForUser(
  event: Pick<
    ChangeEvent,
    "owner" | "orgId" | "resourceType" | "resourceId" | "visibility"
  >,
  userEmail: string,
  orgId: string | undefined,
): boolean {
  return getDefaultAppSyncState().canSeeChangeForUser(event, userEmail, orgId);
}

export function recordChange(event: {
  source: string;
  type: string;
  key?: string;
  [k: string]: unknown;
}): void {
  getDefaultAppSyncState().recordChange(event);
}

export function prepareTransactionalChange(event: {
  source: string;
  type: string;
  key?: string;
  [k: string]: unknown;
}): Promise<TransactionalChange> {
  return getDefaultAppSyncState().prepareTransactionalChange(event);
}

setActionChangeFastPath((target) => {
  getDefaultAppSyncState().recordChange(
    {
      source: "action",
      type: "change",
      key: target.actionName,
      ...(target.owner ? { owner: target.owner } : {}),
      ...(target.orgId ? { orgId: target.orgId } : {}),
      ...(target.requestSource ? { requestSource: target.requestSource } : {}),
    },
    target.nonce
      ? { dedupeKey: actionChangeDedupeKey(target, `action|${target.nonce}`) }
      : undefined,
  );
});

export function getChangesSince(since: number): {
  version: number;
  events: ChangeEvent[];
} {
  return getDefaultAppSyncState().getChangesSince(since);
}

export function getChangesSinceForUser(
  since: number,
  userEmail: string,
  orgId: string | undefined,
): ChangeReadResult {
  return getDefaultAppSyncState().getChangesSinceForUser(
    since,
    userEmail,
    orgId,
  );
}

export function createPollHandler(
  state: AppSyncState = getDefaultAppSyncState(),
) {
  if (state === getDefaultAppSyncState()) state.wireLocalEmitters();
  return defineEventHandler(async (event) => {
    // coercion-ok: polling must fail closed when session resolution is unavailable.
    const session = await import("./auth.js")
      .then(({ getSession }) => getSession(event))
      .catch(() => null); // coercion-ok: polling must fail closed when session resolution is unavailable.
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Unauthenticated" };
    }
    await state.seedVersionFromDb();
    const durableEvents = await state.ensureSyncEventsTable();
    await state.checkExternalDbChanges({ durableEvents });

    const query = getQuery(event);
    const cursor = decodeSyncCursor(query.cursor);
    const since =
      cursor?.version ?? (parseInt(String(query.since ?? "0"), 10) || 0);
    return state.getCombinedChangesSinceForUser(
      since,
      session.email,
      session.orgId,
      durableEvents,
      cursor,
    );
  });
}

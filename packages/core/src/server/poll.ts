/**
 * Polling-based change notification.
 *
 * Replaces SSE with a simple version counter. Each DB mutation (app-state,
 * settings, resources) increments the version. Clients poll `/_agent-native/poll?since=N`
 * and receive any events that occurred after version N.
 *
 * Works in all deployment environments (serverless, edge, long-lived).
 *
 * Also detects cross-process DB writes by periodically checking the
 * application_state and settings tables' updated_at timestamps. This ensures
 * that changes made by external processes (e.g., CLI actions, cron jobs)
 * are picked up even though they don't call recordChange() in this process.
 *
 * All change-tracking state lives on an {@link AppSyncState} instance rather
 * than in module-level singletons, so a single process can hold one isolated
 * instance per app (the hosted Realtime Gateway serves many apps at once). The
 * module-level exports below delegate to a lazily-created default instance
 * bound to the process-global DB, so self-hosted apps run exactly one code
 * path with no behavioral change.
 */

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import {
  ACTION_CHANGE_MARKER_KEY,
  parseActionChangeMarker,
  type ActionChangeTarget,
} from "../action-change-marker.js";
import { getAppStateEmitter } from "../application-state/emitter.js";
import { type DbExec, getDbExec, isPostgres } from "../db/client.js";
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
import { getSettingsEmitter } from "../settings/store.js";
import { getSession } from "./auth.js";

export interface ChangeEvent {
  version: number;
  /** Stable durable-row tie-breaker for events sharing a millisecond version. */
  cursorId?: string;
  source: string;
  type: string;
  key?: string;
  /**
   * Owner email for tenant-scoped events. When absent, the event is treated
   * as deployment-global (e.g. table-level "something changed" pings) and
   * delivered to every authenticated poller. Specific events that should
   * only fan out to one user MUST set this — otherwise polling clients
   * across tenants see each other's signals.
   */
  owner?: string;
  /** Optional org ID for org-scoped events. */
  orgId?: string;
  /**
   * Shareable resource type this event belongs to (e.g. "document"). When
   * present together with `resourceId`, the per-user delivery filter
   * (`canSeeChangeForUser`) can run an access-aware check so non-owner sharees
   * with explicit viewer+ access receive the push instead of only the poll
   * fallback. See the SYNC-CACHE note above `canSeeChangeForUser`.
   */
  resourceType?: string;
  /**
   * Shareable resource id this event belongs to. Paired with `resourceType`
   * to drive the access-aware delivery check in `canSeeChangeForUser`.
   */
  resourceId?: string;
  [k: string]: unknown;
}

// In-memory ring buffer of recent changes. Kept small since clients
// poll frequently (every 2-3s) and only need events since their last poll.
const MAX_BUFFER = 200;
const DURABLE_READ_LIMIT = 1000;
const DURABLE_RETENTION_MS = 24 * 60 * 60 * 1000;
/**
 * Rows per prune statement, and the ceiling on statements per prune call.
 * The product (400k) leaves headroom over one app's documented production of
 * ~1k events/sec over the five-minute throttle, so a healthy app catches up;
 * the cap still bounds how long a single call can run.
 */
const DURABLE_PRUNE_BATCH = 10_000;
const DURABLE_PRUNE_MAX_BATCHES = 40;
/**
 * Postgres advisory-lock key for the per-database retention worker. The lock
 * is transaction-scoped so a serverless worker that is killed cannot leave a
 * lease behind for another worker to clear.
 */
const DURABLE_PRUNE_LOCK_KEY = "agent-native:sync-events-prune";
/**
 * How far back a cold-started process replays durable action markers.
 * Covers the gap between a separate action process writing its marker and this
 * process's first poll — seconds in practice. Anything older is history, and
 * replaying history is what produced 1,169 sync events/sec on one app.
 */
const ACTION_MARKER_REPLAY_WINDOW_MS = 60_000;
const LEGACY_DB_CHECK_INTERVAL_MS = 1000;
export const DURABLE_LEGACY_DB_CHECK_INTERVAL_MS = 30_000;
export const POLL_CHANGE_EVENT = "poll-change";

/** TTL for an allowed (true) cache entry. */
const ACCESS_CACHE_TTL_MS = 30_000;
/**
 * Shorter TTL for a denied (false) entry so a transient DB error (which we
 * fail-closed on) doesn't lock a legitimate user out of the push path for the
 * full 30s — they recover on their next event after this window.
 */
const ACCESS_CACHE_DENY_TTL_MS = 5_000;
/** Max cache entries before FIFO eviction kicks in. */
const ACCESS_CACHE_MAX = 500;
const SCREEN_REFRESH_KEY = "__screen_refresh__";
const SCREEN_REFRESH_QUERY_LIMIT = 256;

/**
 * DB-assigned version allocation (see `AppSyncStateOptions.dbAssignedVersions`).
 * The allocator is a one-row table advanced with `GREATEST(v + 1, epoch_ms)` —
 * the SQL analog of the in-memory `Math.max(version + 1, Date.now())` — inside
 * the same autocommit statement as the event insert. The row lock is held to
 * the statement's implicit commit, so version order equals commit order across
 * every writer, closing the cross-writer clock-skew hole no sequence closes
 * (sequences serialize allocation, not commit visibility). Single-statement is
 * required: the gateway reaches the app DB through a pooled (transactionless)
 * connection. `ON CONFLICT DO UPDATE` (not DO NOTHING) so a deterministic-id
 * dedupe loser still gets the winner's version back and never emits a phantom
 * version to its own clients. The stored JSON is restamped with the allocated
 * version; the read path's column-wins override makes that belt-and-suspenders.
 */
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
): Promise<unknown> {
  try {
    const result = await db.execute(
      `SELECT MAX(updated_at) as max_ts FROM ${table}`,
    );
    return result.rows[0]?.max_ts;
  } catch {
    // Optional framework tables may not exist in every app yet.
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
): Promise<number> {
  return timestampValue(await readMaxUpdatedAtRaw(db, table));
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
  // orgId is part of the key: org visibility and org shares are org-scoped, so a
  // user in multiple orgs must not reuse an org-A decision under an org-B
  // session. The trailing `|resourceType|resourceId` still lets
  // invalidateCollabAccessCache match by suffix.
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
  /** Composite `(version,id)` cursor for durable rows sharing a version. */
  cursor?: string;
  /**
   * True when the returned version is an intentional cursor stop, not the
   * source high-water mark. This happens when access is still pending or when a
   * durable page hit the read limit and more rows may remain unread.
   */
  cursorLimited?: boolean;
};

/**
 * Resolve whether `userEmail`/`orgId` may access a shareable resource. Injected
 * so the hosted gateway can bind the check to a specific app's resource
 * registry + DB; the default resolves the framework's process-global registry
 * lazily to avoid a load-order/circular-import hazard (poll.ts is imported very
 * widely and the sharing module pulls in the resource registry).
 */
export type AccessResolver = (
  resourceType: string,
  resourceId: string,
  ctx: { userEmail: string; orgId: string | undefined },
) => Promise<unknown | null>;

const defaultResolveAccess: AccessResolver = async (
  resourceType,
  resourceId,
  ctx,
) => {
  const { resolveAccess } = await import("../sharing/access.js");
  return resolveAccess(resourceType, resourceId, ctx);
};

export interface AppSyncStateOptions {
  /**
   * Per-app DB accessor. Called per query (not memoized here) so a mocked or
   * hot-swapped exec is always honored. Defaults to the process-global
   * `getDbExec`.
   */
  getDb?: () => DbExec;
  /** Whether this app's DB is Postgres. Defaults to the process-global check. */
  isPostgres?: () => boolean;
  /** Access-aware delivery resolver. Defaults to the framework registry. */
  resolveAccess?: AccessResolver;
  /**
   * Derive durable-event ids deterministically from the event's logical
   * identity plus a caller-supplied dedupe signal (the source row's
   * `updated_at`), instead of the default `version-<random>` id.
   *
   * Off by default: a single-process app has one writer, so random ids are
   * fine and `ON CONFLICT (id) DO NOTHING` never needs to fire. The hosted
   * gateway sets this so two instances that independently detect the same
   * out-of-band write persist the SAME id and dedupe to one row. The signal
   * intentionally excludes `version` (which is per-instance) so it collides
   * across instances.
   */
  deterministicEventIds?: boolean;
  /**
   * Allocate durable-event versions from the app's Postgres DB (a one-row
   * allocator advanced with `GREATEST(v + 1, epoch_ms_now)` inside the insert
   * statement) instead of the per-writer in-memory clock counter.
   *
   * Off by default: a single-writer app's clock counter is already monotonic.
   * Hosted realtime has MULTIPLE writers per app DB (the app's serverless
   * instances plus gateway instances), where clock skew can assign a LOWER
   * version to a LATER event — a client whose cursor passed the higher value
   * then filters the later event out forever. DB allocation serializes on the
   * allocator row's lock, so version order equals commit order across all
   * writers. Versions stay on the epoch-ms scale (existing cursors, the
   * detector's timestamp-mixed seed, and lag metrics all assume it).
   * Postgres only; ignored on SQLite.
   */
  dbAssignedVersions?: boolean;
  /**
   * TTL for a cached ALLOW decision. Defaults to 30s.
   *
   * `invalidateCollabAccessCache` only reaches the in-process default instance,
   * so a gateway holding per-app instances cannot be told a share was revoked
   * and serves its cached ALLOW until this lapses. Shorten it to bound that
   * window, at the cost of more `can-see` round-trips per shared resource.
   */
  accessAllowTtlMs?: number;
}

/**
 * Per-app change-tracking state and read path. One instance per deployed app.
 * The framework runs a single default instance ({@link getDefaultAppSyncState})
 * bound to the process DB; the hosted Realtime Gateway constructs one instance
 * per app with that app's pooled Neon connection injected.
 */
export class AppSyncState {
  private readonly getDb: () => DbExec;
  private readonly isPg: () => boolean;
  private readonly resolveAccessFn: AccessResolver;
  private readonly deterministicEventIds: boolean;
  private readonly dbAssignedVersions: boolean;
  /** Serializes gated recordChange calls so buffer/emit order matches
   * allocation order (interleaved allocations could buffer out of order). */
  private recordChain: Promise<void> = Promise.resolve();
  /** Count of DB-allocation failures that fell back to clock versions. */
  private dbVersionFallbacks = 0;
  private warnedListenerThrow = false;

  // Timestamp-aligned versions so all serverless instances produce values in
  // the same range (seeded from DB, then incremented via Date.now). Plain
  // ++counter diverges across cold starts.
  private version = 0;
  private latestCursor: SyncCursor = { version: 0, id: "" };
  private readonly buffer: ChangeEvent[] = [];
  private readonly pollEmitter = new EventEmitter();
  private syncEventsInitPromise: Promise<boolean> | undefined;
  // Cold starts should not immediately run a potentially large anti-join. A
  // long-lived process will still prune on its first scheduled interval.
  private lastDurablePrune = Date.now();
  private durablePruneFailures = 0;
  private durableWriteFailures = 0;

  /**
   * Whether we've seeded `version` from the DB. In serverless (Netlify,
   * Vercel, etc.) each invocation starts fresh — without seeding, `version`
   * resets to 0 and polling clients see the version jump backwards, causing
   * duplicate events and stuck UI.
   */
  private versionSeeded = false;

  private lastDbCheck = 0;
  // Coalesces concurrent checkExternalDbChanges runs. The throttle alone does
  // not prevent overlap when a single check takes longer than the interval —
  // two overlapping runs would each read+advance the watermarks and double-emit.
  private checkPromise: Promise<void> | null = null;
  private lastAppStateTs = 0;
  private lastSettingsTs = 0;
  private lastExtensionsTs = 0;
  private lastExtensionsUpdatedAt: string | number | undefined;
  private lastExtensionMarkerTs = 0;
  private lastActionMarkerTs = 0;
  /**
   * Set by the seed when a durable action marker predates this process, so the
   * first `doCheckExternalDbChanges` reads the marker rows even though the
   * MAX(updated_at) probe cannot distinguish that row from the seeded max.
   */
  private replayActionMarkerOnce = false;

  /**
   * Tracks the latest updated_at seen on the `__screen_refresh__` key.
   * `screenRefreshInitialized` guards against spurious emits on the first poll
   * after a restart (where an existing row would look like a fresh bump).
   */
  private lastScreenRefreshTs = 0;
  private lastScreenRefreshSessionId = "";
  private screenRefreshInitialized = false;
  private screenRefreshHasMore = false;
  private localEmittersWired = false;

  /**
   * TTL'd access cache for the access-aware branch of `canSeeChangeForUser`,
   * keyed `${userEmail}|${resourceType}|${resourceId}`. Insertion order doubles
   * as FIFO for eviction (JS Maps preserve insertion order). Held per-instance
   * so one gateway process serving many apps never leaks one app's cached
   * access decision into another app's delivery filter.
   */
  private readonly accessCache = new Map<
    string,
    { allowed: boolean; checkedAt: number }
  >();
  /** In-flight background access checks, keyed identically, to dedupe bursts. */
  private readonly accessInFlight = new Set<string>();
  /** Per-resource generation bumped when shares/visibility change. */
  private readonly accessInvalidationEpoch = new Map<string, number>();
  private readonly accessAllowTtlMs: number;

  constructor(options: AppSyncStateOptions = {}) {
    this.getDb = options.getDb ?? getDbExec;
    this.isPg = options.isPostgres ?? isPostgres;
    this.resolveAccessFn = options.resolveAccess ?? defaultResolveAccess;
    this.deterministicEventIds = options.deterministicEventIds ?? false;
    this.dbAssignedVersions = options.dbAssignedVersions ?? false;
    this.accessAllowTtlMs = options.accessAllowTtlMs ?? ACCESS_CACHE_TTL_MS;
    this.pollEmitter.setMaxListeners(0);
  }

  private accessCacheTtl(allowed: boolean): number {
    return allowed ? this.accessAllowTtlMs : ACCESS_CACHE_DENY_TTL_MS;
  }

  /**
   * Durable-event id. Deterministic (hash of logical identity + `dedupeKey`,
   * excluding the per-instance `version`) when the instance opts in AND a
   * dedupe signal is supplied — that combination lets `ON CONFLICT (id) DO
   * NOTHING` collapse the same out-of-band write detected by multiple gateway
   * instances into one row. Otherwise the historical `version-<random>` id,
   * which is unique-per-write for a single-writer app.
   */
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

  /** Get the current version counter. */
  getVersion(): number {
    return this.version;
  }

  getPollEmitter(): EventEmitter {
    return this.pollEmitter;
  }

  /**
   * Wire the in-process app-state/settings emitters into `recordChange` so
   * same-process writes surface on the poll/SSE fast path. Idempotent. Only the
   * default (in-process) instance calls this — the gateway learns of changes by
   * tailing the DB, not from these process-global emitters.
   */
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

        if (this.isPg()) {
          // Run DDL against THIS app's DB, not the process-global one — the
          // gateway injects a per-app getDb, and ddl-guard otherwise probes/
          // creates via the global exec. The dialect override matters for the
          // same reason: ddl-guard's own isPostgres() reads the process-global
          // DB config, which in a gateway process is not this app's dialect.
          const guardOptions = {
            injectedClient: client,
            dialectIsPostgres: true,
          };
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
            // Seed at/above both the existing durable max and wall clock, so
            // allocated versions never land below live client cursors.
            await client.execute(SEED_SYNC_VERSION_SQL);
          }
          return true;
        }

        await client.execute(createSql);
        for (const ddl of [
          "CREATE INDEX IF NOT EXISTS sync_events_version_idx ON sync_events (version)",
          "CREATE INDEX IF NOT EXISTS sync_events_owner_version_idx ON sync_events (owner, version)",
          "CREATE INDEX IF NOT EXISTS sync_events_org_version_idx ON sync_events (org_id, version)",
          "CREATE INDEX IF NOT EXISTS sync_events_created_at_id_idx ON sync_events (created_at, id)",
        ]) {
          try {
            await client.execute(ddl);
          } catch {
            // Index already exists or the dialect rejected a duplicate.
          }
        }
        return true;
      })().catch(() => {
        this.syncEventsInitPromise = undefined;
        return false;
      });
    }
    return this.syncEventsInitPromise;
  }

  /**
   * Drop events past the retention window, in bounded batches.
   *
   * Three things here are load-bearing, all of them learned from a 47 GB
   * `sync_events` table on a live app:
   *
   *   - Prune by `created_at`, the actual retention timestamp, with the
   *     additive `(created_at, id)` index created above. A version can move
   *     ahead of the clock under bursty writes, so it is not a retention
   *     timestamp and cannot define a 24-hour boundary safely.
   *   - Batch it. One statement deleting an unbounded slice is a long
   *     transaction, and a long transaction killed mid-flight by a serverless
   *     worker shutdown is what leaves connections `idle in transaction`
   *     holding locks — the shape of the 2026-08-06 outage.
   *   - `ORDER BY created_at, id` inside the subquery. Without it the planner
   *     prefers a sequential scan even with a LIMIT; with it, the existing
   *     `sync_events_created_at_id_idx` drives the batch and the delete is a
   *     bounded index range scan.
   *
   * The `lastDurablePrune` throttle below is per-process and starts at process
   * initialization, so a cold serverless worker does not run a potentially
   * large delete during its first request. Postgres workers also take a
   * transaction-scoped advisory lease for each batch. The lease and delete
   * are one bounded statement, so a serverless worker killed after the
   * statement starts cannot leave an open transaction.
   */
  private async pruneDurableEvents(client: DbExec): Promise<void> {
    const now = Date.now();
    if (now - this.lastDurablePrune < 5 * 60 * 1000) return;
    this.lastDurablePrune = now;
    const cutoff = now - DURABLE_RETENTION_MS;
    let deleted = 0;
    try {
      for (let batch = 0; batch < DURABLE_PRUNE_MAX_BATCHES; batch++) {
        const runBatch = async (tx: DbExec): Promise<number> => {
          // `id IN (...)` rather than ctid/rowid: both are dialect-specific,
          // and the primary key is indexed on every dialect we ship.
          const result = await tx.execute({
            sql: `DELETE FROM sync_events WHERE id IN (
                    SELECT id FROM sync_events WHERE created_at < ?
                    ORDER BY created_at, id LIMIT ?
                  )`,
            args: [cutoff, DURABLE_PRUNE_BATCH],
          });
          return result.rowsAffected;
        };

        const rowsAffected = this.isPg()
          ? (
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
            ).rowsAffected
          : await runBatch(client);
        deleted += rowsAffected;
        if (rowsAffected < DURABLE_PRUNE_BATCH) break;
      }
      this.durablePruneFailures = 0;
    } catch (err) {
      // This used to be `.catch(() => {})`. A prune that silently never
      // succeeded is indistinguishable from one that had nothing to do, which
      // is how the table reached 47 GB without anyone finding out. Warn once
      // per failure streak so a persistently broken prune is visible without
      // repeating every five minutes.
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

  async persistSyncEvent(
    event: ChangeEvent,
    dedupeKey?: string,
    presetId?: string,
  ): Promise<void> {
    if (!(await this.ensureSyncEventsTable())) return;
    const client = this.getDb();
    await client.execute({
      sql: this.isPg()
        ? `INSERT INTO sync_events (id, version, event_json, source, type, event_key, owner, org_id, resource_type, resource_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`
        : `INSERT OR IGNORE INTO sync_events (id, version, event_json, source, type, event_key, owner, org_id, resource_type, resource_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        // presetId lets a gated fallback reuse the allocating attempt's id,
        // so a commit-then-timeout can't produce the same event twice.
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

  /**
   * Persist with a DB-allocated version (see ALLOCATING_INSERT_SQL). Returns
   * the allocated version — for a deterministic-id dedupe loser, the winner's
   * existing version — or null when persistence is unavailable (caller falls
   * back to clock allocation). Unlike `persistSyncEvent`, errors PROPAGATE to
   * the caller: silence here would silently drop the event entirely, since the
   * buffer/emit are deferred behind this call.
   */
  private async persistWithDbAssignedVersion(
    event: { source: string; type: string; key?: string; [k: string]: unknown },
    id: string,
  ): Promise<number | null> {
    if (!(await this.ensureSyncEventsTable())) return null;
    const client = this.getDb();
    const args = [
      // Local monotonicity floor: after a clock fallback, the next allocation
      // must not land at/below versions this writer already emitted.
      this.version + 1,
      id,
      // jsonb (unlike the legacy TEXT write) rejects \\u0000 escapes; strip
      // them rather than diverting those events to the clock fallback.
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
      // Allocator row missing (e.g. wiped after ensure): reseed, retry once.
      await client.execute(SEED_SYNC_VERSION_SQL).catch(() => {});
      result = await client.execute({ sql: ALLOCATING_INSERT_SQL, args });
    }
    const version = timestampValue(result.rows[0]?.version);
    await this.pruneDurableEvents(client);
    return version > 0 ? version : null;
  }

  /** Read back the version of an already-committed row (a failed allocating
   * call whose statement actually committed). Null when absent/unreachable. */
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

  /**
   * Lift the allocator to at least `floor`. Client cursors are max-only, so
   * any value that can become a cursor (notably the seed's app-clock
   * `updated_at` domain) must never exceed the allocator — a cursor above it
   * would filter later, lower-allocated events out permanently. Failure is
   * swallowed: alignment degrades to the same soft guarantee as the clock
   * fallback.
   */
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

  /**
   * Oldest retained durable version. Used to detect a reconnect cursor that
   * predates the 24h retention window so the gateway can signal a full
   * resync instead of silently dropping events. One indexed aggregate over
   * `sync_events_version_idx`; no schema change.
   */
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
    // Re-insert so the key moves to the end (most-recent) for FIFO ordering.
    this.accessCache.delete(key);
    this.accessCache.set(key, { allowed, checkedAt: now });
    if (this.accessCache.size > ACCESS_CACHE_MAX) {
      // Evict the oldest entries (front of insertion order) back under the cap.
      const overflow = this.accessCache.size - ACCESS_CACHE_MAX;
      let removed = 0;
      for (const oldestKey of this.accessCache.keys()) {
        this.accessCache.delete(oldestKey);
        if (++removed >= overflow) break;
      }
    }
  }

  /**
   * Fire a background access check for a cache-miss key. Never awaited by the
   * caller — the current event is NOT delivered (we returned false), but the
   * result is cached so the user's NEXT event within the TTL is pushed. Dedupes
   * concurrent checks for the same key via `accessInFlight`.
   */
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
        // Fail closed on any error (DB not ready, missing registration, etc.),
        // but with the short deny TTL so a transient failure self-heals quickly.
        if ((this.accessInvalidationEpoch.get(resourceKey) ?? 0) !== epoch) {
          return;
        }
        this.setAccessCache(key, false, Date.now());
      } finally {
        this.accessInFlight.delete(key);
      }
    })();
  }

  /**
   * Test-only: clear the access cache and in-flight set so cases don't bleed
   * into each other. Intentionally NOT part of the public API.
   */
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
    event: Pick<ChangeEvent, "owner" | "orgId" | "resourceType" | "resourceId">,
    userEmail: string,
    orgId: string | undefined,
  ): boolean {
    return (
      this.getChangeVisibilityForUser(event, userEmail, orgId) === "visible"
    );
  }

  private getChangeVisibilityForUser(
    event: Pick<ChangeEvent, "owner" | "orgId" | "resourceType" | "resourceId">,
    userEmail: string,
    orgId: string | undefined,
  ): ChangeVisibility {
    // Global / unowned events: every authenticated user gets them. Events that
    // predate resource tagging (owner/org only, no resourceType) keep the exact
    // conservative contract they had before.
    if (!event.owner && !event.orgId && !event.resourceType) return "visible";
    if (event.owner && event.owner === userEmail) return "visible";
    if (event.orgId && orgId && event.orgId === orgId) return "visible";

    // Access-aware branch: only when the event carries BOTH resourceType and
    // resourceId and the owner/org fast paths above did not already grant.
    if (event.resourceType && event.resourceId) {
      const key = accessCacheKey(
        userEmail,
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
        // Fresh, non-expired cache hit → trust the cached decision.
        return cached.allowed ? "visible" : "hidden";
      }
      // Miss or expired: do NOT deliver this event, but schedule the async check
      // so the user's next event (or poll cycle) resolves correctly.
      this.scheduleAccessCheck(
        key,
        event.resourceType,
        event.resourceId,
        userEmail,
        orgId,
      );
      return "pending";
    }

    return "hidden";
  }

  /**
   * Record a change event. Called by emitter listeners and the tail detector.
   * `dedupeKey` is a stable cross-instance signal (a source row's `updated_at`)
   * used only when the instance derives deterministic ids; it is a persistence
   * concern and never stored on the event object.
   */
  recordChange(
    event: {
      source: string;
      type: string;
      key?: string;
      [k: string]: unknown;
    },
    opts?: { dedupeKey?: string },
  ): void {
    if (this.dbAssignedVersions && this.isPg() && !syncEventsDisabled()) {
      // No provisional version may reach clients: cursors are max-only, so an
      // emitted clock version above a later DB allocation would recreate the
      // skew bug. Buffer/emit happen only after the DB returns the version,
      // serialized so entries land in allocation order. The catch is a
      // backstop: one rejected link must never poison the chain and silently
      // drop every later event.
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

  /** Buffer + emit. Shared by both version-allocation modes. */
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
    // One id for both the allocating attempt AND any fallback persist: if the
    // allocating INSERT commits server-side but the call fails (e.g. a query
    // timeout after commit), the fallback's ON CONFLICT dedupes against the
    // committed row instead of writing the same event twice under two ids.
    // Deterministic ids exclude version by design; the random fallback id gets
    // a wall-clock prefix instead of its usual version prefix (the prefix is
    // debuggability, not semantics — nothing parses row ids).
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
      // The statement may have COMMITTED even though the call failed (e.g. a
      // timeout after commit). Recover the durable row's version by the shared
      // id so clients see the allocator-assigned value, never a divergent
      // clock one.
      version = await this.recoverCommittedVersion(id);
    }
    if (version == null) {
      // Availability fallback: a DB blip must not stall the in-process fast
      // path. Clock-allocate and emit — but first make a best effort to lift
      // the allocator to the fallback value, so other writers' next
      // allocations land above the cursors this emit will advance (max-only
      // cursors above the allocator would filter those events permanently).
      // If the DB is down the lift fails too; the ordering guarantee is soft
      // exactly while the DB is unhealthy.
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
    // A deterministic-id dedupe loser adopts the winner's (possibly older)
    // version here — buffer filtering is a full scan, so a non-tail version is
    // delivered correctly and the version-keyed combined-read dedupe collapses
    // it against the durable row.
    this.version = Math.max(this.version, version);
    this.commitEntryForChain({ ...event, version, cursorId: id });
  }

  /**
   * `commitEntry` for the deferred (chained) path: the buffer push must land
   * and a throwing pollEmitter listener must not reject the chain — the
   * synchronous path propagates such throws to the recordChange caller, but
   * here there is no caller to propagate to, only the chain to poison.
   */
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
              dedupeKey: `${dedupeKey}|${target.actionName ?? ""}|${target.owner ?? ""}|${target.orgId ?? ""}`,
            }
          : undefined,
      );
    }
  }

  /** Get all changes after a given version. */
  getChangesSince(since: number): { version: number; events: ChangeEvent[] } {
    if (since >= this.version) {
      return { version: this.version, events: [] };
    }
    const events = this.buffer.filter((e) => e.version > since);
    return { version: this.version, events };
  }

  /**
   * Get changes after a given version, filtered to events the caller is
   * allowed to see.
   */
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
      // Scope the fetch to rows that could ever be visible to this caller
      // before paying to JSON.parse and visibility-check every deployment-wide
      // event: deployment-global rows (no owner, no org), the caller's own
      // rows, the caller's org's rows, and resource-scoped rows (access is
      // decided below by the access-aware branch, which can grant a non-owner
      // sharee, so resource-scoped rows must still flow through that check
      // regardless of who owns them). A caller with no org passes a null
      // `orgId` bind param, which makes `org_id = ?` match no row in both
      // dialects — mirroring the `event.orgId && orgId` truthy check.
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
          // Malformed durable rows are skipped from delivery, but their
          // composite cursor still needs to advance. Otherwise every poll
          // rereads the same bad row forever and can never reach later rows.
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

  /**
   * Seed `version` from DB timestamps on the first call so serverless cold
   * starts don't return version 0 and confuse polling clients.
   */
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
        readMaxUpdatedAt(db, "settings"),
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
      // The seed mixes app-clock `updated_at` values that can sit AHEAD of the
      // allocator (a skew-fast writer's rows). Lift the allocator to the seed
      // BEFORE the seed can reach this.version — and through it, client
      // cursors — so no later allocation lands below a seeded cursor.
      if (this.dbAssignedVersions && this.isPg() && !syncEventsDisabled()) {
        await this.alignVersionAllocator(seedMax);
      }
      // Seed version — never decrease an already-set value
      this.version = Math.max(this.version, seedMax);

      // Set baselines so checkExternalDbChanges detects future writes
      this.lastAppStateTs = appTs;
      this.lastSettingsTs = settingsTs;
      this.lastExtensionsTs = extensionsTs;
      this.lastExtensionsUpdatedAt = sqlWatermarkValue(extensionsMaxUpdatedAt);
      this.lastExtensionMarkerTs = extensionMarkerTs;
      // Action markers are durable specifically so a web server can observe work
      // performed by a separate action process. Do not baseline past an existing
      // marker on cold start, or the first poll after the action will miss it.
      //
      // Bounded to a replay window rather than rewound to 0. At 0 the filter
      // below (`updated_at > lastActionMarkerTs`) passes EVERY row, and the
      // marker table is one never-pruned row per identity that has ever run a
      // mutating action — so every cold start re-emitted the entire history.
      // On one production app that was 2,188 rows replayed ~32 times a minute:
      // 1,169 sync events/sec, none of it real traffic, against ~1.7/sec that
      // was. A `> 0` first-run guard like the sibling detectors use would be
      // wrong here — it would discard the cross-process wakeup this rewind
      // exists for. Bounding the window keeps that and drops the history.
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
      // Skip the redundant cold-start recheck unless there is an existing durable
      // action marker that the first poll still needs to emit.
      this.lastDbCheck = actionMarkerTs > 0 ? 0 : Date.now();
    } catch {
      // Tables may not exist yet — ignore
    }
  }

  /**
   * Check for cross-process DB writes by comparing updated_at timestamps.
   * Throttled per instance.
   */
  async checkExternalDbChanges(options: {
    durableEvents: boolean;
  }): Promise<void> {
    const now = Date.now();
    const interval = options.durableEvents
      ? DURABLE_LEGACY_DB_CHECK_INTERVAL_MS
      : LEGACY_DB_CHECK_INTERVAL_MS;
    if (now - this.lastDbCheck < interval) return;
    // Coalesce: if a check is already running, await it instead of starting a
    // second overlapping run that would double-advance the watermarks.
    if (this.checkPromise) return this.checkPromise;
    this.lastDbCheck = now;
    this.checkPromise = this.doCheckExternalDbChanges()
      .then(() => {
        // Gated: the detector's recordChange calls only SCHEDULED allocations.
        // The poll handler awaits this check so detected cross-process writes
        // land in the same response — drain the chain here to keep that
        // contract (and so a serverless instance frozen after responding
        // can't strand them). The chain never rejects (backstopped).
        if (this.dbAssignedVersions && this.isPg() && !syncEventsDisabled()) {
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

      // These reads are independent — each compares the DB against instance
      // high-water marks rather than another query's result. Run them
      // concurrently to shave stacked latency; results are still processed in
      // the original sequential order, and conditional follow-up queries stay
      // sequential within their branch.
      //
      // `lastAppStateTs` is maintained as MAX(updated_at) over the whole
      // `application_state` table (seeded in `seedVersionFromDb`, advanced by
      // the scan below over every key, not just the ones that emit events).
      // The application-state row scan and screen/extension marker reads only
      // report rows strictly newer than a watermark that is itself <=
      // `lastAppStateTs`, so an unadvanced MAX proves those reads are no-ops.
      // The action marker keeps its own max probe because its watermark must
      // remain independent under cross-process clock skew.
      const [
        appStateMaxTs,
        actionMarkerTs,
        settingsTs,
        extensionsMaxUpdatedAt,
      ] = await Promise.all([
        readMaxUpdatedAt(db, "application_state"),
        readActionMarkerMaxUpdatedAt(db),
        readMaxUpdatedAt(db, "settings"),
        readMaxUpdatedAtRaw(db, "tools"),
      ]);

      // The seed deliberately rewinds `lastActionMarkerTs` to 0 so a marker
      // written before this process booted still reaches the first poll. That
      // replay is invisible to the MAX probe (the row is already counted in the
      // seeded max), so it gets one forced full read.
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

      // Check application_state for external writes. Preserve the changed key so
      // clients can invalidate one-shot command queries (`navigate`, `__set_url__`)
      // only when those command rows actually change; noisy keys such as
      // `slide-fit-check` should not wake navigation readers.
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

      // Mutating actions write a durable marker in addition to the in-process
      // event. This lets dev-mode `pnpm action ...` child processes and
      // serverless action invocations wake the web server's SSE/poll loop as a
      // first-class source:"action" event rather than a generic app-state bump.
      if (actionMarkerTs > this.lastActionMarkerTs) {
        // Bounded by the same watermark the filter below applies, so a cold
        // start reads its replay window instead of every marker ever written.
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
          // Keyed on the ROW's own timestamp, not the table-wide max: every
          // process replaying the same marker must produce the same id so
          // `ON CONFLICT (id) DO NOTHING` collapses them. Keyed on the max,
          // two processes booting a moment apart hash the same row
          // differently and each writes its own copy. Matches the extension
          // marker path.
          this.recordActionChanges(
            [target],
            `action|${timestampValue(row.updated_at)}`,
          );
        }
        this.lastActionMarkerTs = actionMarkerTs;
      }

      // Check for screen-refresh requests from the agent. The `refresh-screen`
      // tool writes to application_state under a well-known key; when its
      // updated_at bumps, emit a distinct event so the client invalidates
      // all queries (not just the ones matching its default queryKey prefix).
      // `refreshResult` is null exactly when the MAX probe proved no
      // application_state row moved, which is also exactly when this block
      // could not emit anything.
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
          // Emit a per-user event only for the session(s) whose row actually
          // advanced, scoped with `owner` so canSeeChangeForUser delivers it only
          // to that user — not every authenticated poller.
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

      // Extension mutations write a durable marker row so delete and hide/unhide
      // operations are visible across serverless invocations. Translate those
      // marker rows back into extension-source events for targeted client
      // invalidation while preserving user/org scope.
      if (extensionMarkerTs > this.lastExtensionMarkerTs) {
        // Bound the scan by the watermark instead of reading every marker row
        // ever written and filtering in memory: this table keeps one row per
        // session that has ever mutated an extension, so the unbounded read
        // grows with lifetime users rather than with pending work.
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

      // Check settings for external writes.
      if (settingsTs > this.lastSettingsTs) {
        if (this.lastSettingsTs > 0) {
          this.recordChange(
            { source: "settings", type: "change", key: "*" },
            { dedupeKey: `settings|${settingsTs}` },
          );
        }
        this.lastSettingsTs = settingsTs;
      }

      // Extension rows live in the legacy physical `tools` table. Keep this as a
      // compatibility fallback for direct table writes, but scope events to the
      // resource owner/share targets instead of broadcasting deployment-wide.
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

/**
 * Hosted-realtime gate for the default instance, env-only. Mirrors the
 * fail-closed transport-AND-url pair in `sentry-config.ts`'s
 * `resolveRealtimeClientConfig` (not imported — poll.ts is import-cycle
 * sensitive). Hosted apps are multi-writer (their own serverless instances
 * plus gateway instances share one DB), so THEY must DB-allocate versions too
 * — gating only the gateway would leave the app's user-event writes
 * clock-versioned and the cross-writer skew hole open.
 */
function hostedRealtimeTransportEnabled(): boolean {
  return (
    process.env.AGENT_NATIVE_REALTIME_TRANSPORT?.trim() === "hosted" &&
    !!process.env.AGENT_NATIVE_REALTIME_GATEWAY_URL?.trim()
  );
}

/**
 * The process-wide default instance, bound to the global DB. All module-level
 * exports delegate here so self-hosted apps run exactly one code path.
 */
export function getDefaultAppSyncState(): AppSyncState {
  if (!_defaultState) {
    _defaultState = new AppSyncState({
      dbAssignedVersions: hostedRealtimeTransportEnabled(),
      // Only the out-of-band detectors (action markers, extensions, app-state)
      // pass a dedupeKey, so this changes nothing for ordinary writes — they
      // keep unique ids. It exists so N processes detecting the SAME external
      // write collapse to one row via `ON CONFLICT (id) DO NOTHING`. Left off,
      // it never once executed in production: every dedupeKey threaded through
      // this file was inert, and each cold start wrote its own duplicate set.
      deterministicEventIds: true,
    });
  }
  return _defaultState;
}

/** Get the current global version counter. */
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

/**
 * Test-only: clear the default instance's access cache. Underscore-prefixed and
 * intentionally NOT part of the public API — do not rely on it outside tests.
 */
export function __resetCollabAccessCacheForTests(): void {
  getDefaultAppSyncState().__resetAccessCacheForTests();
}

export function canSeeChangeForUser(
  event: Pick<ChangeEvent, "owner" | "orgId" | "resourceType" | "resourceId">,
  userEmail: string,
  orgId: string | undefined,
): boolean {
  return getDefaultAppSyncState().canSeeChangeForUser(event, userEmail, orgId);
}

/** Record a change event. Called by emitter listeners. */
export function recordChange(event: {
  source: string;
  type: string;
  key?: string;
  [k: string]: unknown;
}): void {
  getDefaultAppSyncState().recordChange(event);
}

/** Get all changes after a given version. */
export function getChangesSince(since: number): {
  version: number;
  events: ChangeEvent[];
} {
  return getDefaultAppSyncState().getChangesSince(since);
}

/**
 * Get changes after a given version, filtered to events the caller is
 * allowed to see.
 */
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

/**
 * Create an H3 handler for the poll endpoint.
 *
 * GET /_agent-native/poll?since=N[&cursor=N.id] → { version, events[] }
 *
 * Requires an authenticated session. Events are filtered to the caller's
 * tenant — global events (owner-less, table-level pings) reach every
 * authenticated caller; owned events reach only the matching user/org.
 * Without auth + filtering, an anonymous attacker could poll the deployment
 * and infer cross-tenant activity from the global event stream.
 */
export function createPollHandler(
  state: AppSyncState = getDefaultAppSyncState(),
) {
  // Only the default (in-process) instance wires the local emitters; a gateway
  // per-app instance learns of changes by tailing its own DB.
  if (state === getDefaultAppSyncState()) state.wireLocalEmitters();
  return defineEventHandler(async (event) => {
    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Unauthenticated" };
    }
    // On cold start, seed version from DB so we don't return version: 0
    await state.seedVersionFromDb();
    const durableEvents = await state.ensureSyncEventsTable();
    // Durable sync_events rows are the cheap cross-process path. Keep the
    // legacy watermark scan as a slower safety net for direct SQL writes and
    // older processes that have not started writing durable events yet.
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

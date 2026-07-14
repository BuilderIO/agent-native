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
 */

import { EventEmitter } from "node:events";

import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import {
  ACTION_CHANGE_MARKER_KEY,
  parseActionChangeMarker,
  type ActionChangeTarget,
} from "../action-change-marker.js";
import { getAppStateEmitter } from "../application-state/emitter.js";
import { getDbExec, isPostgres } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import {
  EXTENSION_CHANGE_MARKER_KEY,
  parseExtensionChangeMarker,
  type ExtensionChangeTarget,
} from "../extensions/change-marker.js";
import { getSettingsEmitter } from "../settings/store.js";
import { getSession } from "./auth.js";

export interface ChangeEvent {
  version: number;
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
const LEGACY_DB_CHECK_INTERVAL_MS = 1000;
const DURABLE_LEGACY_DB_CHECK_INTERVAL_MS = 30_000;
let _version = 0;
const _buffer: ChangeEvent[] = [];
export const POLL_CHANGE_EVENT = "poll-change";
const _pollEmitter = new EventEmitter();
_pollEmitter.setMaxListeners(0);
let _syncEventsInitPromise: Promise<boolean> | undefined;
let _lastDurablePrune = 0;

/**
 * Whether we've seeded _version from the DB. In serverless (Netlify,
 * Vercel, etc.) each invocation starts fresh — without seeding, _version
 * resets to 0 and polling clients see the version jump backwards, causing
 * duplicate events and stuck UI.
 */
let _versionSeeded = false;

/** Tracks the latest updated_at we've seen from the DB, per table. */
let _lastDbCheck = 0;
// Coalesces concurrent checkExternalDbChanges runs. The 1s throttle alone does
// not prevent overlap when a single check takes longer than 1s — two overlapping
// runs would each read+advance the shared watermarks and double-emit events.
let _checkPromise: Promise<void> | null = null;
let _lastAppStateTs = 0;
let _lastSettingsTs = 0;
let _lastExtensionsTs = 0;
let _lastExtensionsUpdatedAt: string | number | undefined;
let _lastExtensionMarkerTs = 0;
let _lastActionMarkerTs = 0;

/**
 * Tracks the latest updated_at seen on the `__screen_refresh__` key in
 * application_state. Bumped when the agent calls the `refresh-screen` tool,
 * and surfaced as a distinct `screen-refresh` event so clients can remount
 * the main content subtree via React key.
 *
 * `_screenRefreshInitialized` guards against spurious emits on the first
 * poll after a restart (where an existing row would look like a fresh bump).
 * Once we've taken a baseline reading, any subsequent increase emits.
 */
let _lastScreenRefreshTs = 0;
let _screenRefreshInitialized = false;
// Per-session high-water marks for `__screen_refresh__`. Each user's row is
// tracked independently so a refresh triggered by one user only remounts that
// user's screen (owner-scoped), never every authenticated poller.
const _lastScreenRefreshTsBySession = new Map<string, number>();
const SCREEN_REFRESH_KEY = "__screen_refresh__";
let _localEmittersWired = false;

function wireLocalEmitters(): void {
  if (_localEmittersWired) return;
  _localEmittersWired = true;
  getAppStateEmitter().on("app-state", (event) => {
    if (
      event.key === EXTENSION_CHANGE_MARKER_KEY ||
      event.key === ACTION_CHANGE_MARKER_KEY
    ) {
      return;
    }
    recordChange(event);
  });
  getSettingsEmitter().on("settings", (event) => {
    recordChange(event);
  });
}

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

function syncEventsDisabled(): boolean {
  return (
    process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE === "1" ||
    (process.env.VITEST === "true" &&
      process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS !== "1")
  );
}

async function ensureSyncEventsTable(): Promise<boolean> {
  if (syncEventsDisabled()) return false;
  if (!_syncEventsInitPromise) {
    _syncEventsInitPromise = (async () => {
      const client = getDbExec();
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

      if (isPostgres()) {
        await ensureTableExists("sync_events", createSql);
        await ensureIndexExists(
          "sync_events_version_idx",
          "CREATE INDEX IF NOT EXISTS sync_events_version_idx ON sync_events (version)",
        );
        await ensureIndexExists(
          "sync_events_owner_version_idx",
          "CREATE INDEX IF NOT EXISTS sync_events_owner_version_idx ON sync_events (owner, version)",
        );
        await ensureIndexExists(
          "sync_events_org_version_idx",
          "CREATE INDEX IF NOT EXISTS sync_events_org_version_idx ON sync_events (org_id, version)",
        );
        return true;
      }

      await client.execute(createSql);
      for (const ddl of [
        "CREATE INDEX IF NOT EXISTS sync_events_version_idx ON sync_events (version)",
        "CREATE INDEX IF NOT EXISTS sync_events_owner_version_idx ON sync_events (owner, version)",
        "CREATE INDEX IF NOT EXISTS sync_events_org_version_idx ON sync_events (org_id, version)",
      ]) {
        try {
          await client.execute(ddl);
        } catch {
          // Index already exists or the dialect rejected a duplicate.
        }
      }
      return true;
    })().catch(() => {
      _syncEventsInitPromise = undefined;
      return false;
    });
  }
  return _syncEventsInitPromise;
}

function durableEventId(version: number): string {
  return `${version}-${Math.random().toString(36).slice(2, 10)}`;
}

async function pruneDurableEvents(client: ReturnType<typeof getDbExec>) {
  const now = Date.now();
  if (now - _lastDurablePrune < 5 * 60 * 1000) return;
  _lastDurablePrune = now;
  await client
    .execute({
      sql: "DELETE FROM sync_events WHERE created_at < ?",
      args: [now - DURABLE_RETENTION_MS],
    })
    .catch(() => {});
}

async function persistSyncEvent(event: ChangeEvent): Promise<void> {
  if (!(await ensureSyncEventsTable())) return;
  const client = getDbExec();
  await client
    .execute({
      sql: isPostgres()
        ? `INSERT INTO sync_events (id, version, event_json, source, type, event_key, owner, org_id, resource_type, resource_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`
        : `INSERT OR IGNORE INTO sync_events (id, version, event_json, source, type, event_key, owner, org_id, resource_type, resource_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        durableEventId(event.version),
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
    })
    .catch(() => {});
  await pruneDurableEvents(client);
}

async function readMaxSyncEventVersion(): Promise<number> {
  if (!(await ensureSyncEventsTable())) return 0;
  try {
    const result = await getDbExec().execute(
      "SELECT MAX(version) as max_version FROM sync_events",
    );
    return timestampValue(result.rows[0]?.max_version);
  } catch {
    return 0;
  }
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

/** Get the current global version counter. */
export function getVersion(): number {
  return _version;
}

export function getPollEmitter(): EventEmitter {
  return _pollEmitter;
}

/**
 * In-memory, TTL'd access cache for the access-aware branch of
 * `canSeeChangeForUser`. Keyed by `${userEmail}|${resourceType}|${resourceId}`.
 *
 * Insertion order doubles as FIFO for eviction (JS Maps preserve insertion
 * order), so we can evict the oldest entries when we exceed the cap.
 */
const _accessCache = new Map<string, { allowed: boolean; checkedAt: number }>();
/** In-flight background access checks, keyed identically, to dedupe bursts. */
const _accessInFlight = new Set<string>();
/** Per-resource generation bumped when shares/visibility change. */
const _accessInvalidationEpoch = new Map<string, number>();
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

function accessCacheKey(
  userEmail: string,
  resourceType: string,
  resourceId: string,
): string {
  return `${userEmail}|${resourceType}|${resourceId}`;
}

function accessResourceKey(resourceType: string, resourceId: string): string {
  return `${resourceType}|${resourceId}`;
}

function accessCacheTtl(allowed: boolean): number {
  return allowed ? ACCESS_CACHE_TTL_MS : ACCESS_CACHE_DENY_TTL_MS;
}

export function invalidateCollabAccessCache(
  resourceType: string,
  resourceId: string,
): void {
  const resourceKey = accessResourceKey(resourceType, resourceId);
  _accessInvalidationEpoch.set(
    resourceKey,
    (_accessInvalidationEpoch.get(resourceKey) ?? 0) + 1,
  );
  const suffix = `|${resourceKey}`;
  for (const key of Array.from(_accessCache.keys())) {
    if (key.endsWith(suffix)) _accessCache.delete(key);
  }
  for (const key of Array.from(_accessInFlight)) {
    if (key.endsWith(suffix)) _accessInFlight.delete(key);
  }
}

function setAccessCache(key: string, allowed: boolean, now: number): void {
  // Re-insert so the key moves to the end (most-recent) for FIFO ordering.
  _accessCache.delete(key);
  _accessCache.set(key, { allowed, checkedAt: now });
  if (_accessCache.size > ACCESS_CACHE_MAX) {
    // Evict the oldest entries (front of insertion order) back under the cap.
    const overflow = _accessCache.size - ACCESS_CACHE_MAX;
    let removed = 0;
    for (const oldestKey of _accessCache.keys()) {
      _accessCache.delete(oldestKey);
      if (++removed >= overflow) break;
    }
  }
}

/**
 * Fire a background access check for a cache-miss key. Never awaited by the
 * caller — the current event is NOT delivered (we returned false), but the
 * result is cached so the user's NEXT event within the TTL is pushed. Dedupes
 * concurrent checks for the same key via `_accessInFlight`.
 */
function scheduleAccessCheck(
  key: string,
  resourceType: string,
  resourceId: string,
  userEmail: string,
  orgId: string | undefined,
): void {
  if (_accessInFlight.has(key)) return;
  _accessInFlight.add(key);
  const resourceKey = accessResourceKey(resourceType, resourceId);
  const epoch = _accessInvalidationEpoch.get(resourceKey) ?? 0;
  void (async () => {
    try {
      // Dynamic import to avoid a load-order/circular-import hazard: poll.ts is
      // imported very widely, and the sharing/access module pulls in the
      // resource registry. Importing it lazily inside this background function
      // keeps the module graph acyclic at load time.
      const { resolveAccess } = await import("../sharing/access.js");
      const access = await resolveAccess(resourceType, resourceId, {
        userEmail,
        orgId,
      });
      if ((_accessInvalidationEpoch.get(resourceKey) ?? 0) !== epoch) return;
      setAccessCache(key, access != null, Date.now());
    } catch {
      // Fail closed on any error (DB not ready, missing registration, etc.),
      // but with the short deny TTL so a transient failure self-heals quickly.
      if ((_accessInvalidationEpoch.get(resourceKey) ?? 0) !== epoch) return;
      setAccessCache(key, false, Date.now());
    } finally {
      _accessInFlight.delete(key);
    }
  })();
}

/**
 * Test-only: clear the access cache and in-flight set so cases don't bleed
 * into each other. Underscore-prefixed and intentionally NOT part of the
 * public API — do not rely on it outside tests.
 */
export function __resetCollabAccessCacheForTests(): void {
  _accessCache.clear();
  _accessInFlight.clear();
  _accessInvalidationEpoch.clear();
}

type ChangeVisibility = "visible" | "hidden" | "pending";
type ChangeReadResult = {
  version: number;
  events: ChangeEvent[];
  /**
   * True when the returned version is an intentional cursor stop, not the
   * source high-water mark. This happens when access is still pending or when a
   * durable page hit the read limit and more rows may remain unread.
   */
  cursorLimited?: boolean;
};

/**
 * Decide whether a poll/SSE change event should be delivered to a user.
 *
 * SYNC-CACHE VARIANT — WHY THIS IS SYNCHRONOUS:
 * This function is called on hot, synchronous paths: the SSE emitter callback
 * `push(change)` in poll-events.ts (fires per event) and the
 * `getChangesSinceForUser` loop in this file. Making it async would be
 * invasive (it would ripple through both call sites and their emitters).
 * Instead, for the access-aware branch we consult an in-memory cache and, on a
 * miss, fire a NON-BLOCKING background access check and return `false` for the
 * current event. Because the poll fallback (`getChangesSinceForUser` on the
 * next `/poll` cycle) re-evaluates with the now-populated cache, delivery is
 * eventually guaranteed — the only cost is that the very first event for a
 * fresh (user, resource) pair goes over poll instead of push, and every
 * subsequent event within the TTL is pushed.
 *
 * Security: a cache MISS returns `false`, so we NEVER deliver to a user before
 * their access has been affirmatively confirmed by `resolveAccess` — the same
 * authority that gates the HTTP routes. Errors fail closed (cached deny). The
 * owner/org fast paths below are unchanged and evaluated first.
 */
export function canSeeChangeForUser(
  event: Pick<ChangeEvent, "owner" | "orgId" | "resourceType" | "resourceId">,
  userEmail: string,
  orgId: string | undefined,
): boolean {
  return getChangeVisibilityForUser(event, userEmail, orgId) === "visible";
}

function getChangeVisibilityForUser(
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
    const key = accessCacheKey(userEmail, event.resourceType, event.resourceId);
    const cached = _accessCache.get(key);
    const now = Date.now();
    if (cached && now - cached.checkedAt < accessCacheTtl(cached.allowed)) {
      // Fresh, non-expired cache hit → trust the cached decision.
      return cached.allowed ? "visible" : "hidden";
    }
    // Miss or expired: do NOT deliver this event, but schedule the async check
    // so the user's next event (or poll cycle) resolves correctly.
    scheduleAccessCheck(
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

/** Record a change event. Called by emitter listeners. */
export function recordChange(event: {
  source: string;
  type: string;
  key?: string;
  [k: string]: unknown;
}): void {
  // Use timestamp-aligned versions so all serverless instances produce
  // values in the same range (seeded from DB, then incremented via
  // Date.now). Plain ++counter diverges across cold starts.
  _version = Math.max(_version + 1, Date.now());
  const entry: ChangeEvent = { ...event, version: _version };
  _buffer.push(entry);
  if (_buffer.length > MAX_BUFFER) {
    _buffer.splice(0, _buffer.length - MAX_BUFFER);
  }
  _pollEmitter.emit(POLL_CHANGE_EVENT, entry);
  void persistSyncEvent(entry);
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

function recordExtensionChanges(targets: ExtensionChangeTarget[]): void {
  const uniqueTargets = new Map<string, ExtensionChangeTarget>();
  for (const target of targets) addExtensionTarget(uniqueTargets, target);
  for (const target of uniqueTargets.values()) {
    recordChange({
      source: "extensions",
      type: "change",
      key: "*",
      ...(target.owner ? { owner: target.owner } : {}),
      ...(target.orgId ? { orgId: target.orgId } : {}),
    });
  }
}

function recordActionChanges(targets: ActionChangeTarget[]): void {
  for (const target of targets) {
    recordChange({
      source: "action",
      type: "change",
      key: target.actionName ?? "*",
      ...(target.owner ? { owner: target.owner } : {}),
      ...(target.orgId ? { orgId: target.orgId } : {}),
      ...(target.requestSource ? { requestSource: target.requestSource } : {}),
    });
  }
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

/** Get all changes after a given version. */
export function getChangesSince(since: number): {
  version: number;
  events: ChangeEvent[];
} {
  if (since >= _version) {
    return { version: _version, events: [] };
  }
  const events = _buffer.filter((e) => e.version > since);
  return { version: _version, events };
}

/**
 * Get changes after a given version, filtered to events the caller is
 * allowed to see.
 *
 * Filtering rules:
 *   - Events without an `owner`/`orgId`/`resourceType` are deployment-global
 *     (table-level pings, screen-refresh, etc.) and visible to every
 *     authenticated user.
 *   - Events with `owner === userEmail` go to that user.
 *   - Events with `orgId === orgId` go to anyone in that org.
 *   - Events carrying `resourceType` + `resourceId` additionally reach explicit
 *     viewer+ sharees via the access-aware cache in `canSeeChangeForUser`.
 *   - All other owned events are filtered out.
 */
export function getChangesSinceForUser(
  since: number,
  userEmail: string,
  orgId: string | undefined,
): ChangeReadResult {
  if (since >= _version) {
    return { version: _version, events: [] };
  }
  const events: ChangeEvent[] = [];
  let version = _version;
  for (const event of _buffer) {
    if (event.version <= since) continue;
    const visibility = getChangeVisibilityForUser(event, userEmail, orgId);
    if (visibility === "visible") {
      events.push(event);
      continue;
    }
    if (visibility === "pending") {
      version = Math.max(since, event.version - 1);
      return { version, events, cursorLimited: true };
    }
  }
  return { version, events };
}

async function getDurableChangesSinceForUser(
  since: number,
  userEmail: string,
  orgId: string | undefined,
): Promise<ChangeReadResult> {
  if (since <= 0 || !(await ensureSyncEventsTable())) {
    return { version: _version, events: [] };
  }

  try {
    // Scope the fetch to rows that could ever be visible to this caller
    // before paying to JSON.parse and visibility-check every deployment-wide
    // event: deployment-global rows (no owner, no org), the caller's own
    // rows, the caller's org's rows, and resource-scoped rows (owner/org
    // don't gate those — access is decided below by
    // `getChangeVisibilityForUser`'s access-aware branch, which can grant a
    // non-owner sharee, so resource-scoped rows must still flow through that
    // check regardless of who owns them). This lets Postgres/SQLite use the
    // `sync_events_owner_version_idx` / `sync_events_org_version_idx` indexes
    // instead of scanning every tenant's activity on every poll. The OR group
    // is parenthesized so `version > ?` ANDs against the whole group, not
    // just the first term. A caller with no org passes a null `orgId` bind
    // param, which makes `org_id = ?` evaluate to no match for every row
    // (including null-org rows) in both dialects — mirroring the
    // `event.orgId && orgId` truthy check in `getChangeVisibilityForUser`.
    const result = await getDbExec().execute({
      sql: `SELECT version, event_json FROM sync_events WHERE version > ?
              AND (
                (owner IS NULL AND org_id IS NULL)
                OR owner = ?
                OR org_id = ?
                OR resource_type IS NOT NULL
              )
            ORDER BY version ASC LIMIT ?`,
      args: [since, userEmail, orgId ?? null, DURABLE_READ_LIMIT + 1],
    });
    const events: ChangeEvent[] = [];
    let version = Math.max(_version, since);
    let lastDurableVersion = since;
    const rows = result.rows.slice(0, DURABLE_READ_LIMIT);
    const overflowVersion = timestampValue(
      result.rows[DURABLE_READ_LIMIT]?.version,
    );

    for (const row of rows) {
      const rawVersion = timestampValue(row.version);
      if (rawVersion > lastDurableVersion) lastDurableVersion = rawVersion;
      if (rawVersion > version) version = rawVersion;
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
          };
        }
      } catch {
        event = null;
      }
      if (!event) continue;

      const visibility = getChangeVisibilityForUser(event, userEmail, orgId);
      if (visibility === "visible") {
        events.push(event);
        continue;
      }
      if (visibility === "pending") {
        return {
          version: Math.max(since, event.version - 1),
          events,
          cursorLimited: true,
        };
      }
    }

    if (rows.length >= DURABLE_READ_LIMIT) {
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

    return { version, events };
  } catch {
    return { version: _version, events: [] };
  }
}

async function getCombinedChangesSinceForUser(
  since: number,
  userEmail: string,
  orgId: string | undefined,
  useDurableEvents: boolean,
): Promise<{ version: number; events: ChangeEvent[] }> {
  const memory = getChangesSinceForUser(since, userEmail, orgId);
  if (!useDurableEvents) return memory;

  const durable = await getDurableChangesSinceForUser(since, userEmail, orgId);
  const byIdentity = new Map<string, ChangeEvent>();
  for (const event of [...durable.events, ...memory.events]) {
    byIdentity.set(
      JSON.stringify([
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
  const events = Array.from(byIdentity.values()).sort(
    (a, b) => a.version - b.version,
  );
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
 * Seed _version from DB timestamps on the first call so serverless
 * cold starts don't return version 0 and confuse polling clients.
 */
async function seedVersionFromDb(): Promise<void> {
  if (_versionSeeded) return;
  _versionSeeded = true;

  try {
    const db = getDbExec();

    const [
      syncEventsTs,
      appTs,
      settingsTs,
      extensionsMaxUpdatedAt,
      extensionMarkerTs,
      actionMarkerTs,
      refreshResult,
    ] = await Promise.all([
      readMaxSyncEventVersion(),
      readMaxUpdatedAt(db, "application_state"),
      readMaxUpdatedAt(db, "settings"),
      readMaxUpdatedAtRaw(db, "tools"),
      readExtensionMarkerMaxUpdatedAt(db),
      readActionMarkerMaxUpdatedAt(db),
      db
        .execute({
          sql: "SELECT session_id, updated_at FROM application_state WHERE key = ?",
          args: [SCREEN_REFRESH_KEY],
        })
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);

    const extensionsTs = timestampValue(extensionsMaxUpdatedAt);
    let refreshTs = 0;
    for (const row of refreshResult.rows) {
      refreshTs = Math.max(refreshTs, timestampValue(row.updated_at));
    }

    // Seed version — never decrease an already-set value
    _version = Math.max(
      _version,
      syncEventsTs,
      appTs,
      settingsTs,
      extensionsTs,
      extensionMarkerTs,
      actionMarkerTs,
    );

    // Set baselines so checkExternalDbChanges detects future writes
    _lastAppStateTs = appTs;
    _lastSettingsTs = settingsTs;
    _lastExtensionsTs = extensionsTs;
    _lastExtensionsUpdatedAt = sqlWatermarkValue(extensionsMaxUpdatedAt);
    _lastExtensionMarkerTs = extensionMarkerTs;
    // Action markers are durable specifically so a web server can observe work
    // performed by a separate action process. Do not baseline past an existing
    // marker on cold start, or the first poll after the action will miss it.
    _lastActionMarkerTs = 0;
    _lastScreenRefreshTs = refreshTs;
    _lastScreenRefreshTsBySession.clear();
    for (const row of refreshResult.rows) {
      if (typeof row.session_id === "string") {
        _lastScreenRefreshTsBySession.set(
          row.session_id,
          timestampValue(row.updated_at),
        );
      }
    }
    _screenRefreshInitialized = true;
    // Skip the redundant cold-start recheck unless there is an existing durable
    // action marker that the first poll still needs to emit.
    _lastDbCheck = actionMarkerTs > 0 ? 0 : Date.now();
  } catch {
    // Tables may not exist yet — ignore
  }
}

/**
 * Check for cross-process DB writes by comparing updated_at timestamps.
 * Runs at most once per second to avoid excessive queries.
 */
async function checkExternalDbChanges(options: {
  durableEvents: boolean;
}): Promise<void> {
  const now = Date.now();
  const interval = options.durableEvents
    ? DURABLE_LEGACY_DB_CHECK_INTERVAL_MS
    : LEGACY_DB_CHECK_INTERVAL_MS;
  if (now - _lastDbCheck < interval) return;
  // Coalesce: if a check is already running, await it instead of starting a
  // second overlapping run that would double-advance the shared watermarks
  // (and double-emit change events).
  if (_checkPromise) return _checkPromise;
  _lastDbCheck = now;
  _checkPromise = doCheckExternalDbChanges().finally(() => {
    _checkPromise = null;
  });
  return _checkPromise;
}

async function doCheckExternalDbChanges(): Promise<void> {
  try {
    const db = getDbExec();

    // These reads are independent — each compares the DB against module-level
    // high-water marks (`_lastAppStateTs`, etc.) rather than another query's
    // result, and none of them mutate state before processing below. On a
    // serverless SQL backend every `await` is a network round-trip, so running
    // them concurrently shaves stacked latency off every poll cycle. Results
    // are still processed in the original sequential order, and conditional
    // follow-up queries (action/extension marker detail rows, tool-shares) stay
    // sequential within their branch where they depend on these results.
    const [
      appResult,
      actionMarkerTs,
      refreshResult,
      extensionMarkerTs,
      settingsTs,
      extensionsMaxUpdatedAt,
    ] = await Promise.all([
      db.execute({
        sql: "SELECT session_id, key, updated_at FROM application_state WHERE updated_at > ? ORDER BY updated_at ASC",
        args: [_lastAppStateTs],
      }),
      readActionMarkerMaxUpdatedAt(db),
      db.execute({
        sql: "SELECT session_id, updated_at, value FROM application_state WHERE key = ?",
        args: [SCREEN_REFRESH_KEY],
      }),
      readExtensionMarkerMaxUpdatedAt(db),
      readMaxUpdatedAt(db, "settings"),
      readMaxUpdatedAtRaw(db, "tools"),
    ]);

    // Check application_state for external writes. Preserve the changed key so
    // clients can invalidate one-shot command queries (`navigate`, `__set_url__`)
    // only when those command rows actually change; noisy keys such as
    // `slide-fit-check` should not wake navigation readers.
    if (appResult.rows.length > 0) {
      const appTs = appResult.rows.reduce(
        (max, row) => Math.max(max, timestampValue(row.updated_at)),
        _lastAppStateTs,
      );
      if (_lastAppStateTs > 0) {
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
          recordChange({
            source: "app-state",
            type: "change",
            key,
            ...(owner ? { owner } : {}),
          });
        }
      }
      _lastAppStateTs = appTs;
    }

    // Mutating actions write a durable marker in addition to the in-process
    // event. This lets dev-mode `pnpm action ...` child processes and
    // serverless action invocations wake the web server's SSE/poll loop as a
    // first-class source:"action" event rather than a generic app-state bump.
    // `actionMarkerTs` was read above; the detail-row query below is conditional
    // on it and depends on its result, so it stays sequential.
    if (actionMarkerTs > _lastActionMarkerTs) {
      const actionMarkerResult = await db.execute({
        sql: "SELECT session_id, value, updated_at FROM application_state WHERE key = ? ORDER BY updated_at ASC",
        args: [ACTION_CHANGE_MARKER_KEY],
      });
      const changedActionMarkers = actionMarkerResult.rows.filter(
        (row) => timestampValue(row.updated_at) > _lastActionMarkerTs,
      );
      recordActionChanges(
        changedActionMarkers
          .map((row) => parseActionChangeMarker(row.session_id, row.value))
          .filter((target): target is ActionChangeTarget => !!target),
      );
      _lastActionMarkerTs = actionMarkerTs;
    }

    // Check for screen-refresh requests from the agent. The `refresh-screen`
    // tool writes to application_state under a well-known key; when its
    // updated_at bumps, emit a distinct event so the client invalidates
    // all queries (not just the ones matching its default queryKey prefix).
    // `refreshResult` was read above.
    const refreshTs = refreshResult.rows.reduce(
      (max, row) => Math.max(max, timestampValue(row.updated_at)),
      0,
    );
    if (!_screenRefreshInitialized) {
      _lastScreenRefreshTs = refreshTs;
      for (const row of refreshResult.rows) {
        if (typeof row.session_id === "string") {
          _lastScreenRefreshTsBySession.set(
            row.session_id,
            timestampValue(row.updated_at),
          );
        }
      }
      _screenRefreshInitialized = true;
    } else if (refreshTs > _lastScreenRefreshTs) {
      // Emit a per-user event only for the session(s) whose row actually
      // advanced, scoped with `owner` so canSeeChangeForUser delivers it only
      // to that user — not every authenticated poller.
      for (const row of refreshResult.rows) {
        const owner =
          typeof row.session_id === "string" ? row.session_id : undefined;
        if (!owner) continue;
        const rowTs = timestampValue(row.updated_at);
        if (rowTs <= (_lastScreenRefreshTsBySession.get(owner) ?? 0)) continue;
        let scope: string | undefined;
        try {
          const raw = row.value;
          if (typeof raw === "string") {
            const parsed = JSON.parse(raw);
            if (typeof parsed?.scope === "string") scope = parsed.scope;
          }
        } catch {}
        recordChange({
          source: "screen-refresh",
          type: "change",
          key: SCREEN_REFRESH_KEY,
          owner,
          ...(scope ? { scope } : {}),
        });
        _lastScreenRefreshTsBySession.set(owner, rowTs);
      }
      _lastScreenRefreshTs = refreshTs;
    }

    // Extension mutations write a durable marker row so delete and hide/unhide
    // operations are visible across serverless invocations. Translate those
    // marker rows back into extension-source events for targeted client
    // invalidation while preserving user/org scope. `extensionMarkerTs` was read
    // above; the detail-row query below depends on it and stays sequential.
    if (extensionMarkerTs > _lastExtensionMarkerTs) {
      const extensionMarkerResult = await db.execute({
        sql: "SELECT session_id, value, updated_at FROM application_state WHERE key = ? ORDER BY updated_at ASC",
        args: [EXTENSION_CHANGE_MARKER_KEY],
      });
      const changedExtensionMarkers = extensionMarkerResult.rows.filter(
        (row) => timestampValue(row.updated_at) > _lastExtensionMarkerTs,
      );
      if (_lastExtensionMarkerTs > 0) {
        recordExtensionChanges(
          changedExtensionMarkers
            .map((row) => parseExtensionChangeMarker(row.session_id, row.value))
            .filter((target): target is ExtensionChangeTarget => !!target),
        );
      }
      _lastExtensionMarkerTs = extensionMarkerTs;
    }

    // Check settings for external writes. `settingsTs` was read above.
    if (settingsTs > _lastSettingsTs) {
      if (_lastSettingsTs > 0) {
        recordChange({ source: "settings", type: "change", key: "*" });
      }
      _lastSettingsTs = settingsTs;
    }

    // Extension rows live in the legacy physical `tools` table. Keep this as a
    // compatibility fallback for direct table writes, but scope events to the
    // resource owner/share targets instead of broadcasting deployment-wide.
    // `extensionsMaxUpdatedAt` was read above; the per-row query below is
    // conditional on `extensionsTs` and stays sequential.
    const extensionsTs = timestampValue(extensionsMaxUpdatedAt);
    if (extensionsTs > _lastExtensionsTs) {
      const since = _lastExtensionsUpdatedAt;
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
        (row) => timestampValue(row.updated_at) > _lastExtensionsTs,
      );
      if (_lastExtensionsTs > 0) {
        const targetsByRow = await readExtensionTargetsForRows(
          db,
          changedExtensionRows,
        );
        for (const targets of targetsByRow) recordExtensionChanges(targets);
      }
      _lastExtensionsTs = extensionsTs;
      _lastExtensionsUpdatedAt = sqlWatermarkValue(extensionsMaxUpdatedAt);
    }
  } catch {
    // Tables may not exist yet — ignore
  }
}

/**
 * Create an H3 handler for the poll endpoint.
 *
 * GET /_agent-native/poll?since=N → { version, events[] }
 *
 * Requires an authenticated session. Events are filtered to the caller's
 * tenant — global events (owner-less, table-level pings) reach every
 * authenticated caller; owned events reach only the matching user/org.
 * Without auth + filtering, an anonymous attacker could poll the deployment
 * and infer cross-tenant activity from the global event stream.
 */
export function createPollHandler() {
  wireLocalEmitters();
  return defineEventHandler(async (event) => {
    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Unauthenticated" };
    }
    // On cold start, seed _version from DB so we don't return version: 0
    await seedVersionFromDb();
    const durableEvents = await ensureSyncEventsTable();
    // Durable sync_events rows are the cheap cross-process path. Keep the
    // legacy watermark scan as a slower safety net for direct SQL writes and
    // older processes that have not started writing durable events yet.
    await checkExternalDbChanges({ durableEvents });

    const query = getQuery(event);
    const since = parseInt(String(query.since ?? "0"), 10) || 0;
    return getCombinedChangesSinceForUser(
      since,
      session.email,
      session.orgId,
      durableEvents,
    );
  });
}

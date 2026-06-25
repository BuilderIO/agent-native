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
import { getDbExec } from "../db/client.js";
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
  [k: string]: unknown;
}

// In-memory ring buffer of recent changes. Kept small since clients
// poll frequently (every 2-3s) and only need events since their last poll.
const MAX_BUFFER = 200;
let _version = 0;
const _buffer: ChangeEvent[] = [];
export const POLL_CHANGE_EVENT = "poll-change";
const _pollEmitter = new EventEmitter();
_pollEmitter.setMaxListeners(0);

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

export function canSeeChangeForUser(
  event: ChangeEvent,
  userEmail: string,
  orgId: string | undefined,
): boolean {
  // Global / unowned events: every authenticated user gets them.
  if (!event.owner && !event.orgId) return true;
  if (event.owner && event.owner === userEmail) return true;
  if (event.orgId && orgId && event.orgId === orgId) return true;
  return false;
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
 *   - Events without an `owner` are deployment-global (table-level pings,
 *     screen-refresh, etc.) and visible to every authenticated user.
 *   - Events with `owner === userEmail` go to that user.
 *   - Events with `orgId === orgId` go to anyone in that org.
 *   - All other owned events are filtered out.
 */
export function getChangesSinceForUser(
  since: number,
  userEmail: string,
  orgId: string | undefined,
): { version: number; events: ChangeEvent[] } {
  if (since >= _version) {
    return { version: _version, events: [] };
  }
  const events = _buffer.filter(
    (e) => e.version > since && canSeeChangeForUser(e, userEmail, orgId),
  );
  return { version: _version, events };
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
      appTs,
      settingsTs,
      extensionsMaxUpdatedAt,
      extensionMarkerTs,
      actionMarkerTs,
      refreshResult,
    ] = await Promise.all([
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
async function checkExternalDbChanges(): Promise<void> {
  const now = Date.now();
  if (now - _lastDbCheck < 1000) return;
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
    // Check for cross-process writes before responding
    await checkExternalDbChanges();

    const query = getQuery(event);
    const since = parseInt(String(query.since ?? "0"), 10) || 0;
    return getChangesSinceForUser(since, session.email, session.orgId);
  });
}

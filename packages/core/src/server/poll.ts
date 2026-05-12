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
import { getAppStateEmitter } from "../application-state/emitter.js";
import { getDbExec } from "../db/client.js";
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
let _lastAppStateTs = 0;
let _lastSettingsTs = 0;

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
const SCREEN_REFRESH_KEY = "__screen_refresh__";
let _localEmittersWired = false;

function wireLocalEmitters(): void {
  if (_localEmittersWired) return;
  _localEmittersWired = true;
  getAppStateEmitter().on("app-state", (event) => {
    recordChange(event);
  });
  getSettingsEmitter().on("settings", (event) => {
    recordChange(event);
  });
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

    const [appResult, settingsResult, refreshResult] = await Promise.all([
      db.execute("SELECT MAX(updated_at) as max_ts FROM application_state"),
      db.execute("SELECT MAX(updated_at) as max_ts FROM settings"),
      db.execute({
        sql: "SELECT updated_at FROM application_state WHERE key = ?",
        args: [SCREEN_REFRESH_KEY],
      }),
    ]);

    const appTs = Number(appResult.rows[0]?.max_ts) || 0;
    const settingsTs = Number(settingsResult.rows[0]?.max_ts) || 0;
    const refreshTs = Number(refreshResult.rows[0]?.updated_at) || 0;

    // Seed version — never decrease an already-set value
    _version = Math.max(_version, appTs, settingsTs);

    // Set baselines so checkExternalDbChanges detects future writes
    _lastAppStateTs = appTs;
    _lastSettingsTs = settingsTs;
    _lastScreenRefreshTs = refreshTs;
    _screenRefreshInitialized = true;
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
  _lastDbCheck = now;

  try {
    const db = getDbExec();

    // Check application_state for external writes. Preserve the changed key so
    // clients can invalidate one-shot command queries (`navigate`, `__set_url__`)
    // only when those command rows actually change; noisy keys such as
    // `slide-fit-check` should not wake navigation readers.
    const appResult = await db.execute({
      sql: "SELECT session_id, key, updated_at FROM application_state WHERE updated_at > ? ORDER BY updated_at ASC",
      args: [_lastAppStateTs],
    });
    if (appResult.rows.length > 0) {
      const appTs = appResult.rows.reduce(
        (max, row) => Math.max(max, Number(row.updated_at) || 0),
        _lastAppStateTs,
      );
      if (_lastAppStateTs > 0) {
        for (const row of appResult.rows) {
          const key = typeof row.key === "string" ? row.key : "*";
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

    // Check for screen-refresh requests from the agent. The `refresh-screen`
    // tool writes to application_state under a well-known key; when its
    // updated_at bumps, emit a distinct event so the client invalidates
    // all queries (not just the ones matching its default queryKey prefix).
    const refreshResult = await db.execute({
      sql: "SELECT updated_at, value FROM application_state WHERE key = ?",
      args: [SCREEN_REFRESH_KEY],
    });
    const refreshTs = Number(refreshResult.rows[0]?.updated_at) || 0;
    if (!_screenRefreshInitialized) {
      _lastScreenRefreshTs = refreshTs;
      _screenRefreshInitialized = true;
    } else if (refreshTs > _lastScreenRefreshTs) {
      let scope: string | undefined;
      try {
        const raw = refreshResult.rows[0]?.value;
        if (typeof raw === "string") {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.scope === "string") scope = parsed.scope;
        }
      } catch {}
      recordChange({
        source: "screen-refresh",
        type: "change",
        key: SCREEN_REFRESH_KEY,
        ...(scope ? { scope } : {}),
      });
      _lastScreenRefreshTs = refreshTs;
    }

    // Check settings for external writes
    const settingsResult = await db.execute(
      "SELECT MAX(updated_at) as max_ts FROM settings",
    );
    const settingsTs = Number(settingsResult.rows[0]?.max_ts) || 0;
    if (settingsTs > _lastSettingsTs) {
      if (_lastSettingsTs > 0) {
        recordChange({ source: "settings", type: "change", key: "*" });
      }
      _lastSettingsTs = settingsTs;
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

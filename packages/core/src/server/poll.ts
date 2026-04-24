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

import { defineEventHandler, getQuery } from "h3";
import { getDbExec } from "../db/client.js";

export interface ChangeEvent {
  version: number;
  source: string;
  type: string;
  key?: string;
  [k: string]: unknown;
}

// In-memory ring buffer of recent changes. Kept small since clients
// poll frequently (every 2-3s) and only need events since their last poll.
const MAX_BUFFER = 200;
let _version = 0;
const _buffer: ChangeEvent[] = [];

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

/** Get the current global version counter. */
export function getVersion(): number {
  return _version;
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

    // Check application_state for external writes
    const appResult = await db.execute(
      "SELECT MAX(updated_at) as max_ts FROM application_state",
    );
    const appTs = Number(appResult.rows[0]?.max_ts) || 0;
    if (appTs > _lastAppStateTs) {
      if (_lastAppStateTs > 0) {
        recordChange({ source: "app-state", type: "change", key: "*" });
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
 */
export function createPollHandler() {
  return defineEventHandler(async (event) => {
    // On cold start, seed _version from DB so we don't return version: 0
    await seedVersionFromDb();
    // Check for cross-process writes before responding
    await checkExternalDbChanges();

    const query = getQuery(event);
    const since = parseInt(String(query.since ?? "0"), 10) || 0;
    return getChangesSince(since);
  });
}

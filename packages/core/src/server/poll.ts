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

/** Tracks the latest updated_at we've seen from the DB, per table. */
let _lastDbCheck = 0;
let _lastAppStateTs = 0;
let _lastSettingsTs = 0;

/**
 * Tracks the latest updated_at seen on the `__screen_refresh__` key in
 * application_state. Bumped when the agent calls the `refresh-screen` tool,
 * and surfaced as a distinct `screen-refresh` event so clients can invalidate
 * ALL react-query caches (not just the ones matching their queryKey prefix).
 */
let _lastScreenRefreshTs = 0;
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
  _version++;
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
        // There was an external write — emit a generic app-state change event
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
    if (refreshTs > _lastScreenRefreshTs) {
      if (_lastScreenRefreshTs > 0) {
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
      }
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
    // Check for cross-process writes before responding
    await checkExternalDbChanges();

    const query = getQuery(event);
    const since = parseInt(String(query.since ?? "0"), 10) || 0;
    return getChangesSince(since);
  });
}

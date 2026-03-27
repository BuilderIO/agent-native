/**
 * Polling-based change notification.
 *
 * Replaces SSE with a simple version counter. Each DB mutation (app-state,
 * settings, resources) increments the version. Clients poll `/api/poll?since=N`
 * and receive any events that occurred after version N.
 *
 * Works in all deployment environments (serverless, edge, long-lived).
 */

import { defineEventHandler, getQuery } from "h3";

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
 * Create an H3 handler for the poll endpoint.
 *
 * GET /api/poll?since=N → { version, events[] }
 */
export function createPollHandler() {
  return defineEventHandler((event) => {
    const query = getQuery(event);
    const since = parseInt(String(query.since ?? "0"), 10) || 0;
    return getChangesSince(since);
  });
}

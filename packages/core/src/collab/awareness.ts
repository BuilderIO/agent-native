/**
 * Server-side awareness state management for collaborative editing.
 *
 * Stores per-client awareness state (cursor positions, user info) in memory.
 * Clients POST their state and receive other clients' states via polling.
 * States expire after 30 seconds of no updates.
 *
 * Fast-path: when a client POSTs new awareness state, the server emits an
 * event on the awareness emitter so SSE-connected peers receive cursor moves
 * push-style instead of waiting for the next poll cycle.
 */

import { EventEmitter } from "node:events";

import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import type { H3Event } from "h3";

import { readBody } from "../server/h3-helpers.js";

const AWARENESS_TIMEOUT = 30_000; // 30 seconds

export interface AwarenessEntry {
  clientId: number;
  state: string; // JSON-encoded awareness state object
  lastSeen: number;
}

// ---------------------------------------------------------------------------
// Awareness event emitter — fast-path for push delivery to SSE-connected peers.
// The SSE handler (poll-events) subscribes and forwards events to its stream.
// ---------------------------------------------------------------------------

export const AWARENESS_CHANGE_EVENT = "awareness-change" as const;

export interface AwarenessChangeEvent {
  source: "awareness";
  type: "awareness-change";
  docId: string;
  /** Array of updated states for this document (all non-expired clients). */
  states: Array<{ clientId: number; state: string }>;
  /** Owner email for access-scoped delivery (taken from session if available). */
  owner?: string;
  /** Org ID for org-scoped delivery. */
  orgId?: string;
}

const _awarenessEmitter = new EventEmitter();
_awarenessEmitter.setMaxListeners(0);

export function getAwarenessEmitter(): EventEmitter {
  return _awarenessEmitter;
}

export function emitAwarenessChange(
  docId: string,
  states: Array<{ clientId: number; state: string }>,
  owner?: string,
  orgId?: string,
): void {
  const event: AwarenessChangeEvent = {
    source: "awareness",
    type: "awareness-change",
    docId,
    states,
    ...(owner && { owner }),
    ...(orgId && { orgId }),
  };
  _awarenessEmitter.emit(AWARENESS_CHANGE_EVENT, event);
}

// docId → Map<clientId, AwarenessEntry>
const _awarenessMap = new Map<string, Map<number, AwarenessEntry>>();

export function getDocAwareness(docId: string): Map<number, AwarenessEntry> {
  let map = _awarenessMap.get(docId);
  if (!map) {
    map = new Map();
    _awarenessMap.set(docId, map);
  }
  return map;
}

export function cleanExpired(map: Map<number, AwarenessEntry>): void {
  const now = Date.now();
  for (const [clientId, entry] of map) {
    if (now - entry.lastSeen > AWARENESS_TIMEOUT) {
      map.delete(clientId);
    }
  }
}

// Drop the per-document map from the registry once it has no entries left,
// so the outer map does not grow unbounded with every docId ever touched.
function pruneIfEmpty(docId: string, map: Map<number, AwarenessEntry>): void {
  if (map.size === 0) {
    _awarenessMap.delete(docId);
  }
}

/**
 * POST /_agent-native/collab/:docId/awareness
 *
 * Client sends its awareness state and receives other clients' states.
 *
 * Body: { clientId: number, state: string (base64) }
 * Response: { states: Array<{ clientId: number, state: string }> }
 */
export const postAwareness = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const body = await readBody(event);
  const { clientId, state } = body as {
    clientId?: number;
    state?: string;
  };

  if (clientId == null || !state) {
    // `!clientId` would wrongly reject clientId === 0, which is a valid
    // (if rare) Yjs client id. Only reject missing/null ids here.
    setResponseStatus(event, 400);
    return { error: "clientId and state required" };
  }

  const map = getDocAwareness(docId);

  // Store this client's state
  map.set(clientId, { clientId, state, lastSeen: Date.now() });

  // Clean expired entries, then prune the outer-map entry if it becomes empty.
  // Without pruning, a deployment with many transient docIds (e.g. one per
  // session) would grow _awarenessMap without bound.
  cleanExpired(map);
  // map has at least the sender's entry so size >= 1 here; pruneIfEmpty is a
  // no-op in the normal path but guards against edge cases (e.g. clientId 0
  // that was immediately evicted by a concurrent cleanExpired run).
  pruneIfEmpty(docId, map);

  // Build the full list of current states (all clients including sender).
  const allStates: Array<{ clientId: number; state: string }> = [];
  const otherStates: Array<{ clientId: number; state: string }> = [];
  for (const [id, entry] of map) {
    allStates.push({ clientId: id, state: entry.state });
    if (id !== clientId) {
      otherStates.push({ clientId: id, state: entry.state });
    }
  }

  // Fast-path: push the updated state set to SSE-connected peers so they
  // don't have to wait for the next poll cycle for cursor/selection updates.
  emitAwarenessChange(docId, allStates);

  return { states: otherStates };
});

/**
 * GET /_agent-native/collab/:docId/users
 *
 * Returns the list of active users for a document (for presence bar).
 */
export const getActiveUsers = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }

  const map = getDocAwareness(docId);
  cleanExpired(map);
  pruneIfEmpty(docId, map);

  const users: Array<{ clientId: number; lastSeen: number }> = [];
  for (const [, entry] of map) {
    users.push({ clientId: entry.clientId, lastSeen: entry.lastSeen });
  }

  return { users };
});

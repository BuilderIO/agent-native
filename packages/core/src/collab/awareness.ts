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

import { getSession } from "../server/auth.js";
import { readBody } from "../server/h3-helpers.js";
import {
  deleteAwarenessRow,
  loadAwarenessRows,
  upsertAwarenessRow,
} from "./awareness-store.js";

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
  /** Shareable resource type this awareness event belongs to, when known. */
  resourceType?: string;
  /** Shareable resource id this awareness event belongs to, when known. */
  resourceId?: string;
}

export interface AwarenessScope {
  owner?: string;
  orgId?: string;
  resourceType?: string;
  resourceId?: string;
}

const _awarenessEmitter = new EventEmitter();
_awarenessEmitter.setMaxListeners(0);

const _awarenessScopes = new Map<string, AwarenessScope>();

export function getAwarenessEmitter(): EventEmitter {
  return _awarenessEmitter;
}

export function rememberAwarenessScope(
  docId: string,
  scope: AwarenessScope | undefined,
): void {
  if (!scope) return;
  const next = { ...(_awarenessScopes.get(docId) ?? {}), ...scope };
  if (!next.owner && !next.orgId && !next.resourceType && !next.resourceId) {
    return;
  }
  _awarenessScopes.set(docId, next);
}

export function emitAwarenessChange(
  docId: string,
  states: Array<{ clientId: number; state: string }>,
  scope?: AwarenessScope,
): void {
  rememberAwarenessScope(docId, scope);
  const resolvedScope = _awarenessScopes.get(docId) ?? {};
  const event: AwarenessChangeEvent = {
    source: "awareness",
    type: "awareness-change",
    docId,
    states,
    ...(resolvedScope.owner && { owner: resolvedScope.owner }),
    ...(resolvedScope.orgId && { orgId: resolvedScope.orgId }),
    ...(resolvedScope.resourceType && {
      resourceType: resolvedScope.resourceType,
    }),
    ...(resolvedScope.resourceId && { resourceId: resolvedScope.resourceId }),
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
 * Merge SQL-mirrored awareness rows (written by other server instances —
 * or by an agent action running in its own serverless invocation) into the
 * in-memory map, newest lastSeen wins. Degrades to memory-only when the DB
 * is unavailable.
 */
async function mergeStoredAwareness(
  docId: string,
  map: Map<number, AwarenessEntry>,
): Promise<void> {
  const rows = await loadAwarenessRows(docId);
  for (const row of rows) {
    const existing = map.get(row.clientId);
    if (!existing || row.lastSeen > existing.lastSeen) {
      map.set(row.clientId, row);
    }
  }
}

/**
 * POST /_agent-native/collab/:docId/awareness
 *
 * Client sends its awareness state and receives other clients' states.
 *
 * Body: { clientId: number, state: string | null (JSON-encoded awareness state, or null to clear) }
 * Response: { states: Array<{ clientId: number, state: string }> }
 */
export const postAwareness = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }
  const session = await getSession(event).catch(() => null);
  const contextScope = (
    event.context as { _collabAwarenessScope?: AwarenessScope } | undefined
  )?._collabAwarenessScope;

  const body = await readBody(event);
  const { clientId, state } = body as {
    clientId?: number;
    state?: string | null;
  };

  if (clientId == null || state === undefined) {
    // `!clientId` would wrongly reject clientId === 0, which is a valid
    // (if rare) Yjs client id. A null state is valid: it clears this client.
    setResponseStatus(event, 400);
    return { error: "clientId and state required" };
  }

  const map = getDocAwareness(docId);

  if (state === null) {
    map.delete(clientId);
    // Best-effort cross-instance removal (never blocks the response).
    void deleteAwarenessRow(docId, clientId);
  } else {
    // Store this client's state
    const entry = { clientId, state, lastSeen: Date.now() };
    map.set(clientId, entry);
    // Mirror to SQL so other instances (and serverless action invocations)
    // see this participant. Throttled internally; never throws.
    void upsertAwarenessRow(docId, clientId, state, entry.lastSeen);
  }

  // Pull in participants known to other instances (multi-instance serverless)
  // before building the response, so every poller sees the full set.
  await mergeStoredAwareness(docId, map);

  // Clean expired entries, then prune the outer-map entry if it becomes empty.
  // Without pruning, a deployment with many transient docIds (e.g. one per
  // session) would grow _awarenessMap without bound.
  cleanExpired(map);
  // Null-state clears and expiry can empty the map; prune the outer entry so
  // transient document ids do not accumulate.
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
  emitAwarenessChange(
    docId,
    allStates,
    contextScope ?? {
      ...(session?.email ? { owner: session.email } : {}),
      ...(session?.orgId ? { orgId: session.orgId } : {}),
    },
  );

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
  await mergeStoredAwareness(docId, map);
  cleanExpired(map);
  pruneIfEmpty(docId, map);

  const users: Array<{ clientId: number; lastSeen: number }> = [];
  for (const [, entry] of map) {
    users.push({ clientId: entry.clientId, lastSeen: entry.lastSeen });
  }

  return { users };
});

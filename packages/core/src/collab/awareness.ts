/**
 * Server-side awareness state management for collaborative editing.
 *
 * Stores per-client awareness state (cursor positions, user info) in memory.
 * Clients POST their state and receive other clients' states via polling.
 * States expire after 30 seconds of no updates.
 */

import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import type { H3Event } from "h3";
import { readBody } from "../server/h3-helpers.js";

const AWARENESS_TIMEOUT = 30_000; // 30 seconds

interface AwarenessEntry {
  clientId: number;
  state: string; // base64-encoded awareness update
  lastSeen: number;
}

// docId → Map<clientId, AwarenessEntry>
const _awarenessMap = new Map<string, Map<number, AwarenessEntry>>();

function getDocAwareness(docId: string): Map<number, AwarenessEntry> {
  let map = _awarenessMap.get(docId);
  if (!map) {
    map = new Map();
    _awarenessMap.set(docId, map);
  }
  return map;
}

function cleanExpired(map: Map<number, AwarenessEntry>): void {
  const now = Date.now();
  for (const [clientId, entry] of map) {
    if (now - entry.lastSeen > AWARENESS_TIMEOUT) {
      map.delete(clientId);
    }
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

  if (!clientId || !state) {
    setResponseStatus(event, 400);
    return { error: "clientId and state required" };
  }

  const map = getDocAwareness(docId);

  // Store this client's state
  map.set(clientId, { clientId, state, lastSeen: Date.now() });

  // Clean expired entries
  cleanExpired(map);

  // Return other clients' states (exclude the sender)
  const states: Array<{ clientId: number; state: string }> = [];
  for (const [id, entry] of map) {
    if (id !== clientId) {
      states.push({ clientId: id, state: entry.state });
    }
  }

  return { states };
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

  const users: Array<{ clientId: number; lastSeen: number }> = [];
  for (const [, entry] of map) {
    users.push({ clientId: entry.clientId, lastSeen: entry.lastSeen });
  }

  return { users };
});

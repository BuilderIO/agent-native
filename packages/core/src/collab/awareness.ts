import { EventEmitter } from "node:events";

import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import type { H3Event } from "h3";

import { getSession } from "../server/auth.js";
import { readBody } from "../server/h3-helpers.js";
import {
  deleteAwarenessRow,
  loadAwarenessRows,
  loadAwarenessRowsStrict,
  upsertAwarenessRow,
} from "./awareness-store.js";

const AWARENESS_TIMEOUT = 30_000;
const CLEAR_TOMBSTONE_TTL = AWARENESS_TIMEOUT + 5_000;
const AWARENESS_SCOPE_TIMEOUT = AWARENESS_TIMEOUT + 5_000;
const MAX_AWARENESS_SCOPES = 10_000;

export interface AwarenessEntry {
  clientId: number;
  state: string;
  lastSeen: number;
}

export const AWARENESS_CHANGE_EVENT = "awareness-change" as const;

export interface AwarenessChangeEvent {
  source: "awareness";
  type: "awareness-change";
  docId: string;
  states: Array<{ clientId: number; state: string }>;
  owner?: string;
  orgId?: string;
  resourceType?: string;
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

interface AwarenessScopeEntry {
  scope: AwarenessScope;
  lastSeen: number;
}

const _awarenessScopes = new Map<string, AwarenessScopeEntry>();

function pruneAwarenessScopes(now: number): void {
  for (const [docId, entry] of _awarenessScopes) {
    if (now - entry.lastSeen > AWARENESS_SCOPE_TIMEOUT) {
      _awarenessScopes.delete(docId);
    }
  }

  while (_awarenessScopes.size > MAX_AWARENESS_SCOPES) {
    const oldest = _awarenessScopes.keys().next().value as string | undefined;
    if (!oldest) break;
    _awarenessScopes.delete(oldest);
  }
}

export function getAwarenessEmitter(): EventEmitter {
  return _awarenessEmitter;
}

export function rememberAwarenessScope(
  docId: string,
  scope: AwarenessScope | undefined,
): void {
  const now = Date.now();
  pruneAwarenessScopes(now);
  const existing = _awarenessScopes.get(docId);
  if (!scope) {
    // Agent-presence heartbeats emit scope-less awareness changes. They still
    // prove the document is active and must keep the access scope alive.
    if (existing) {
      _awarenessScopes.delete(docId);
      _awarenessScopes.set(docId, { ...existing, lastSeen: now });
    }
    return;
  }
  const next = {
    ...(existing?.scope ?? {}),
    ...scope,
  };
  if (!next.owner && !next.orgId && !next.resourceType && !next.resourceId) {
    return;
  }
  _awarenessScopes.delete(docId);
  _awarenessScopes.set(docId, { scope: next, lastSeen: now });
  pruneAwarenessScopes(now);
}

export function emitAwarenessChange(
  docId: string,
  states: Array<{ clientId: number; state: string }>,
  scope?: AwarenessScope,
): void {
  rememberAwarenessScope(docId, scope);
  pruneAwarenessScopes(Date.now());
  const resolvedScope = _awarenessScopes.get(docId)?.scope ?? {};
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

const _awarenessMap = new Map<string, Map<number, AwarenessEntry>>();
const _awarenessClearTombstones = new Map<string, number>();

function awarenessKey(docId: string, clientId: number): string {
  return `${docId}\0${clientId}`;
}

function pruneAwarenessClearTombstones(now: number): void {
  for (const [key, clearedAt] of _awarenessClearTombstones) {
    if (now - clearedAt > CLEAR_TOMBSTONE_TTL) {
      _awarenessClearTombstones.delete(key);
    }
  }
}

export function rememberAwarenessClear(
  docId: string,
  clientId: number,
  clearedAt: number = Date.now(),
): void {
  pruneAwarenessClearTombstones(clearedAt);
  const key = awarenessKey(docId, clientId);
  const prev = _awarenessClearTombstones.get(key);
  if (prev == null || clearedAt > prev) {
    _awarenessClearTombstones.set(key, clearedAt);
  }
}

export function forgetAwarenessClear(docId: string, clientId: number): void {
  _awarenessClearTombstones.delete(awarenessKey(docId, clientId));
}

function isBlockedByAwarenessClear(
  docId: string,
  clientId: number,
  lastSeen: number,
  now: number,
): boolean {
  pruneAwarenessClearTombstones(now);
  const key = awarenessKey(docId, clientId);
  const clearedAt = _awarenessClearTombstones.get(key);
  if (clearedAt == null) return false;
  if (lastSeen <= clearedAt) return true;
  _awarenessClearTombstones.delete(key);
  return false;
}

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

function pruneIfEmpty(docId: string, map: Map<number, AwarenessEntry>): void {
  if (map.size === 0) {
    _awarenessMap.delete(docId);
  }
}

async function mergeStoredAwareness(
  docId: string,
  map: Map<number, AwarenessEntry>,
): Promise<void> {
  const now = Date.now();
  mergeAwarenessRows(docId, map, await loadAwarenessRows(docId, now), now);
}

function mergeAwarenessRows(
  docId: string,
  map: Map<number, AwarenessEntry>,
  rows: AwarenessEntry[],
  now: number,
): void {
  for (const row of rows) {
    if (isBlockedByAwarenessClear(docId, row.clientId, row.lastSeen, now)) {
      void deleteAwarenessRow(docId, row.clientId, row.lastSeen);
      continue;
    }
    const existing = map.get(row.clientId);
    if (!existing || row.lastSeen > existing.lastSeen) {
      map.set(row.clientId, row);
    }
  }
}

/**
 * A presence state marked as one that cannot flush the doc, which clients
 * read as neither holding a stored revision nor able to lead; null when the
 * state is not a JSON object.
 */
function cannotFlushState(state: unknown): string | null {
  if (typeof state !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(state);
    // coercion-ok: null is the unreadable case, which postAwareness refuses with 400.
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return JSON.stringify({ ...parsed, canFlushDocument: false });
}

/** Whether a reader may replace or clear `entry`: its own, or nobody's. */
function readerMayReplace(entry: AwarenessEntry | undefined): boolean {
  if (!entry || Date.now() - entry.lastSeen > AWARENESS_TIMEOUT) return true;
  try {
    const parsed = JSON.parse(entry.state) as { canFlushDocument?: unknown };
    return parsed?.canFlushDocument === false;
    // coercion-ok: an unreadable entry is not a reader's, so it is refused.
  } catch {
    return false;
  }
}

export const postAwareness = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }
  const session = await getSession(event).catch(() => null);
  const context = event.context as
    | {
        _collabAwarenessScope?: AwarenessScope;
        _collabAwarenessReadOnly?: boolean;
      }
    | undefined;
  const contextScope = context?._collabAwarenessScope;

  const body = await readBody(event);
  const { clientId, state } = body as {
    clientId?: number;
    state?: string | null;
  };

  if (clientId == null || state === undefined) {
    setResponseStatus(event, 400);
    return { error: "clientId and state required" };
  }

  let storedState = state;
  if (state !== null && context?._collabAwarenessReadOnly) {
    const marked = cannotFlushState(state);
    if (marked === null) {
      setResponseStatus(event, 400);
      return { error: "state must be a JSON object" };
    }
    storedState = marked;
  }

  const map = getDocAwareness(docId);

  // A reader's state never holds a revision, so replacing or clearing a
  // writer's entry would hide the revision that writer holds from a tab
  // deciding whether to apply the stored body.
  const readOnly = context?._collabAwarenessReadOnly === true;
  if (readOnly) {
    let rows: AwarenessEntry[];
    try {
      rows = await loadAwarenessRowsStrict(docId);
    } catch {
      setResponseStatus(event, 503);
      return { error: "Presence could not be read" };
    }
    mergeAwarenessRows(docId, map, rows, Date.now());
    if (!readerMayReplace(map.get(clientId))) {
      setResponseStatus(event, 403);
      return { error: "clientId belongs to another collaborator" };
    }
  }

  if (storedState === null) {
    const clearedAt = Date.now();
    map.delete(clientId);
    rememberAwarenessClear(docId, clientId, clearedAt);
    void deleteAwarenessRow(docId, clientId, clearedAt);
  } else {
    forgetAwarenessClear(docId, clientId);
    const entry = { clientId, state: storedState, lastSeen: Date.now() };
    map.set(clientId, entry);
    void upsertAwarenessRow(docId, clientId, storedState, entry.lastSeen);
  }

  // A reader's rows were merged above.
  if (!readOnly) await mergeStoredAwareness(docId, map);

  cleanExpired(map);
  pruneIfEmpty(docId, map);

  const allStates: Array<{ clientId: number; state: string }> = [];
  const otherStates: Array<{ clientId: number; state: string }> = [];
  for (const [id, entry] of map) {
    allStates.push({ clientId: id, state: entry.state });
    if (id !== clientId) {
      otherStates.push({ clientId: id, state: entry.state });
    }
  }

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

import { EventEmitter } from "node:events";

import { defineEventHandler, setResponseStatus, getRouterParam } from "h3";
import type { H3Event } from "h3";

import { getSession } from "../server/auth.js";
import { readBody } from "../server/h3-helpers.js";
import {
  deleteAwarenessRow,
  loadAwarenessRows,
  loadAwarenessRowsStrict,
  replaceReaderAwarenessRow,
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

/** Returns the ids whose stored rows a clear on this server outdates. */
function mergeAwarenessRows(
  docId: string,
  map: Map<number, AwarenessEntry>,
  rows: AwarenessEntry[],
  now: number,
): Set<number> {
  const cleared = new Set<number>();
  for (const row of rows) {
    if (isBlockedByAwarenessClear(docId, row.clientId, row.lastSeen, now)) {
      cleared.add(row.clientId);
      void deleteAwarenessRow(docId, row.clientId, row.lastSeen);
      continue;
    }
    if (storedRowWins(row, map.get(row.clientId), now)) {
      map.set(row.clientId, row);
    }
  }
  return cleared;
}

// A writer's entry may hold the revision a joining tab waits for, so a
// reader's under the same id never hides it, whichever server's clock
// stamped it later.
function storedRowWins(
  row: AwarenessEntry,
  existing: AwarenessEntry | undefined,
  now: number,
): boolean {
  if (!existing || now - existing.lastSeen > AWARENESS_TIMEOUT) return true;
  const rowReads = isReaderEntry(row);
  if (rowReads !== isReaderEntry(existing)) return !rowReads;
  return row.lastSeen > existing.lastSeen;
}

/**
 * A presence state as a JSON object, or null when it is not one: a client
 * refuses a whole presence list with a state it cannot read, so one such
 * state would hide every collaborator listed beside it.
 */
function readPresenceState(state: unknown): Record<string, unknown> | null {
  if (typeof state !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(state);
    // coercion-ok: null is the unreadable case, which postAwareness refuses with 400.
  } catch {
    return null;
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function isReaderEntry(entry: AwarenessEntry): boolean {
  try {
    const parsed = JSON.parse(entry.state) as { canFlushDocument?: unknown };
    return parsed?.canFlushDocument === false;
    // coercion-ok: an unreadable entry is not a reader's, so it is refused.
  } catch {
    return false;
  }
}

/** Whether a reader may replace or clear `entry`: its own, or nobody's. */
function readerMayReplace(entry: AwarenessEntry | null | undefined): boolean {
  return (
    !entry ||
    Date.now() - entry.lastSeen > AWARENESS_TIMEOUT ||
    isReaderEntry(entry)
  );
}

type PresenceRefusal = { status: 403 | 503; error: string };

const BELONGS_TO_ANOTHER: PresenceRefusal = {
  status: 403,
  error: "clientId belongs to another collaborator",
};

/**
 * Writes a reader's presence, or clears it when `state` is null. A reader's
 * state never holds a revision, so replacing or clearing a writer's entry
 * would hide the revision that writer holds from a tab deciding whether to
 * apply the stored body.
 */
async function writeReaderPresence(
  docId: string,
  map: Map<number, AwarenessEntry>,
  clientId: number,
  state: string | null,
): Promise<PresenceRefusal | null> {
  // The write applies only to the row the read judged, since a writer on
  // another server can store one under this id after the read. A row that
  // changed or went since, such as one a clear outdates being deleted beside
  // the write, is read and judged again once. A writer known only to another
  // server's memory is not covered until its next presence post stores it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const readAt = Date.now();
    let rows: AwarenessEntry[];
    try {
      rows = await loadAwarenessRowsStrict(docId, readAt);
    } catch {
      return { status: 503, error: "Presence could not be read" };
    }
    const cleared = mergeAwarenessRows(docId, map, rows, Date.now());
    const row = rows.find((stored) => stored.clientId === clientId) ?? null;
    if (
      !readerMayReplace(map.get(clientId)) ||
      (!cleared.has(clientId) && !readerMayReplace(row))
    ) {
      return BELONGS_TO_ANOTHER;
    }
    const lastSeen = Date.now();
    let replaced: boolean;
    try {
      replaced = await replaceReaderAwarenessRow(
        docId,
        clientId,
        state === null ? null : { state, lastSeen },
        { row, readAt },
      );
    } catch {
      return { status: 503, error: "Presence could not be saved" };
    }
    if (!replaced) continue;
    // No clear is remembered: it would hide, and delete, an entry a writer
    // on another server stores under this id stamped before it.
    if (state === null) {
      map.delete(clientId);
    } else {
      forgetAwarenessClear(docId, clientId);
      map.set(clientId, { clientId, state, lastSeen });
    }
    return null;
  }
  return BELONGS_TO_ANOTHER;
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

  const readOnly = context?._collabAwarenessReadOnly === true;
  let storedState = state;
  if (state !== null) {
    const parsed = readPresenceState(state);
    if (!parsed) {
      setResponseStatus(event, 400);
      return { error: "state must be a JSON object" };
    }
    // A reader's state, which clients read as neither holding a stored
    // revision nor able to lead.
    if (readOnly) {
      storedState = JSON.stringify({ ...parsed, canFlushDocument: false });
    }
  }

  const map = getDocAwareness(docId);

  if (readOnly) {
    const refused = await writeReaderPresence(
      docId,
      map,
      clientId,
      storedState,
    );
    if (refused) {
      setResponseStatus(event, refused.status);
      return { error: refused.error };
    }
  } else if (storedState === null) {
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

  // A reader's rows were merged above. An answer without the stored rows
  // would omit collaborators only the store knows, so it is refused; this
  // caller's own entry stands.
  if (!readOnly) {
    let rows: AwarenessEntry[];
    try {
      rows = await loadAwarenessRowsStrict(docId, Date.now());
    } catch {
      setResponseStatus(event, 503);
      return { error: "Presence could not be read" };
    }
    mergeAwarenessRows(docId, map, rows, Date.now());
  }

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

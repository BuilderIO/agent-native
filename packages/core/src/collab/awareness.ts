import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  defineEventHandler,
  setResponseHeader,
  setResponseStatus,
  getRouterParam,
} from "h3";
import type { H3Event } from "h3";

import { getSession } from "../server/auth.js";
import { AGENT_CLIENT_ID } from "./agent-identity.js";
import {
  MAX_AWARENESS_CLIENT_SEQUENCE,
  MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE,
  MAX_LEGACY_AWARENESS_CLOCK_SKEW_MS,
} from "./awareness-sequence.js";
import {
  loadAwarenessClientSequence,
  loadAwarenessRows,
  writeAwarenessRow,
} from "./awareness-store.js";
import { readCollabBody } from "./payload.js";
import { emailToColor, emailToName } from "./types.js";

const AWARENESS_TIMEOUT = 30_000;
const CLEAR_TOMBSTONE_TTL = AWARENESS_TIMEOUT + 5_000;
const AWARENESS_SCOPE_TIMEOUT = AWARENESS_TIMEOUT + 5_000;
const MAX_AWARENESS_SCOPES = 10_000;

type BoundAwarenessState =
  | { ok: true; serialized: string }
  | { ok: false; reason: "invalid-json" | "not-object" };

function bindAwarenessIdentity(
  state: string,
  session: { email: string; name?: string; image?: string },
  actorEmail: string,
): BoundAwarenessState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(state);
  } catch (error) {
    return { ok: false, reason: "invalid-json" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "not-object" };
  }

  const image = session.image?.trim();
  return {
    ok: true,
    serialized: JSON.stringify({
      ...(parsed as Record<string, unknown>),
      user: {
        name: session.name?.trim() || emailToName(actorEmail),
        email: actorEmail,
        color: emailToColor(actorEmail),
        ...(image ? { avatarUrl: image } : {}),
      },
    }),
  };
}

export interface AwarenessEntry {
  clientId: number;
  state: string;
  lastSeen: number;
  clientSequence?: number;
  clientSequenceRaw?: number;
  actorEmail?: string | null;
  clearTokenHash?: string | null;
}

export interface AwarenessRow extends AwarenessEntry {
  clientSequence: number;
  clientSequenceRaw: number;
  cleared: boolean;
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
const _awarenessClearTombstones = new Map<
  string,
  { clearedAt: number; clientSequence?: number; actorEmail?: string | null }
>();
const _unsyncedAwarenessWrites = new Map<string, number>();
let _awarenessWriteAttemptOrder = 0;

function awarenessKey(docId: string, clientId: number): string {
  return `${docId}\0${clientId}`;
}

function pruneAwarenessClearTombstones(now: number): void {
  for (const [key, clear] of _awarenessClearTombstones) {
    if (now - clear.clearedAt > CLEAR_TOMBSTONE_TTL) {
      _awarenessClearTombstones.delete(key);
      _unsyncedAwarenessWrites.delete(key);
    }
  }
}

export function rememberAwarenessClear(
  docId: string,
  clientId: number,
  clearedAt: number = Date.now(),
  clientSequence?: number,
  actorEmail?: string | null,
): void {
  pruneAwarenessClearTombstones(clearedAt);
  const key = awarenessKey(docId, clientId);
  const prev = _awarenessClearTombstones.get(key);
  if (
    prev == null ||
    (clientSequence != null &&
      (prev.clientSequence == null ||
        clientSequence > prev.clientSequence ||
        (clientSequence === prev.clientSequence &&
          clearedAt > prev.clearedAt))) ||
    (clientSequence == null &&
      prev.clientSequence == null &&
      clearedAt > prev.clearedAt)
  ) {
    _awarenessClearTombstones.set(key, {
      clearedAt,
      clientSequence,
      actorEmail: actorEmail?.trim().toLowerCase() ?? null,
    });
  }
}

export function forgetAwarenessClear(docId: string, clientId: number): void {
  _awarenessClearTombstones.delete(awarenessKey(docId, clientId));
}

function isBlockedByAwarenessClear(
  docId: string,
  clientId: number,
  lastSeen: number,
  clientSequence: number,
  now: number,
): boolean {
  pruneAwarenessClearTombstones(now);
  const key = awarenessKey(docId, clientId);
  const clear = _awarenessClearTombstones.get(key);
  if (clear == null) return false;
  if (clear.clientSequence != null) {
    if (clientSequence <= clear.clientSequence) return true;
  } else if (lastSeen <= clear.clearedAt) {
    return true;
  }
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

export function cleanExpired(
  map: Map<number, AwarenessEntry>,
  docId?: string,
): void {
  const now = Date.now();
  pruneAwarenessClearTombstones(now);
  for (const [clientId, entry] of map) {
    if (now - entry.lastSeen > AWARENESS_TIMEOUT) {
      map.delete(clientId);
      if (docId) {
        _unsyncedAwarenessWrites.delete(awarenessKey(docId, clientId));
      }
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
  authoritativeClientId?: number,
): Promise<void> {
  const now = Date.now();
  const rows = await loadAwarenessRows(docId, now);
  for (const row of rows) {
    const authoritative = row.clientId === authoritativeClientId;
    const clear = _awarenessClearTombstones.get(
      awarenessKey(docId, row.clientId),
    );
    const rowSequence = row.clientSequence ?? 0;
    if (row.actorEmail && clear && row.actorEmail !== clear.actorEmail) {
      forgetAwarenessClear(docId, row.clientId);
    }
    if (authoritative) {
      if (
        isBlockedByAwarenessClear(
          docId,
          row.clientId,
          row.lastSeen,
          rowSequence,
          now,
        )
      ) {
        map.delete(row.clientId);
        continue;
      }
      forgetAwarenessClear(docId, row.clientId);
    }
    if (row.cleared) {
      rememberAwarenessClear(
        docId,
        row.clientId,
        row.lastSeen,
        row.clientSequence > 0 ? row.clientSequence : undefined,
        row.actorEmail,
      );
      const existing = map.get(row.clientId);
      if (
        authoritative ||
        (existing &&
          ((existing.clientSequence ?? 0) > MAX_AWARENESS_CLIENT_SEQUENCE ||
            row.clientSequence >= (existing.clientSequence ?? 0)))
      ) {
        map.delete(row.clientId);
      }
      continue;
    }
    if (authoritative) {
      map.set(row.clientId, { ...row, clientSequence: rowSequence });
      continue;
    }
    if (
      isBlockedByAwarenessClear(
        docId,
        row.clientId,
        row.lastSeen,
        rowSequence,
        now,
      )
    ) {
      continue;
    }
    const existing = map.get(row.clientId);
    const existingSequence = existing?.clientSequence ?? 0;
    if (
      !existing ||
      existingSequence > MAX_AWARENESS_CLIENT_SEQUENCE ||
      rowSequence > (existing.clientSequence ?? 0) ||
      (rowSequence === (existing.clientSequence ?? 0) &&
        row.lastSeen > existing.lastSeen)
    ) {
      map.set(row.clientId, { ...row, clientSequence: rowSequence });
    }
  }
}

function localSequenceForWrite(
  existing: AwarenessEntry | undefined,
  clientSequence: number,
): number {
  if (clientSequence <= MAX_AWARENESS_CLIENT_SEQUENCE) return clientSequence;
  const currentSequence = existing?.clientSequence ?? 0;
  return currentSequence >= MAX_AWARENESS_CLIENT_SEQUENCE
    ? 1
    : currentSequence + 1;
}

function applyLocalAwarenessWrite(
  docId: string,
  map: Map<number, AwarenessEntry>,
  clientId: number,
  state: string,
  lastSeen: number,
  clientSequence: number,
  cleared: boolean,
  actorEmail: string,
  clearTokenHash: string | null,
  existingOverride?: AwarenessEntry,
): void {
  const existing = map.get(clientId) ?? existingOverride;
  const sequence = localSequenceForWrite(existing, clientSequence);
  if (cleared) {
    rememberAwarenessClear(
      docId,
      clientId,
      lastSeen,
      sequence || undefined,
      existing?.actorEmail ?? actorEmail,
    );
    map.delete(clientId);
    return;
  }
  map.set(clientId, {
    clientId,
    state,
    lastSeen,
    clientSequence: sequence,
    clientSequenceRaw:
      clientSequence > MAX_AWARENESS_CLIENT_SEQUENCE ? clientSequence : 0,
    actorEmail,
    clearTokenHash,
  });
}

function canApplyLocalAwarenessWrite(
  docId: string,
  existing: AwarenessEntry | undefined,
  clientId: number,
  clientSequence: number,
  lastSeen: number,
  actorEmail: string,
  cleared: boolean,
  clearTokenHash: string | null,
  existingOverride?: AwarenessEntry,
): boolean {
  const current = existing ?? existingOverride;
  const localSequence = localSequenceForWrite(current, clientSequence);
  if (!current) {
    pruneAwarenessClearTombstones(Date.now());
    const clear = _awarenessClearTombstones.get(awarenessKey(docId, clientId));
    if (clear && clear.actorEmail !== actorEmail) return false;
    return (
      !cleared &&
      (clientSequence > MAX_AWARENESS_CLIENT_SEQUENCE ||
        clientSequence <= MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE) &&
      !isBlockedByAwarenessClear(
        docId,
        clientId,
        lastSeen,
        localSequence,
        lastSeen,
      )
    );
  }
  const sameActor = current.actorEmail?.trim().toLowerCase() === actorEmail;
  const ownsClearToken =
    cleared &&
    current.clearTokenHash != null &&
    current.clearTokenHash === clearTokenHash &&
    lastSeen - current.lastSeen <= AWARENESS_SCOPE_TIMEOUT;
  if (!sameActor && !ownsClearToken) return false;
  if (!sameActor) return true;

  let sequenceAllowed = true;
  const currentSequence = current.clientSequence ?? 0;
  const currentRawSequence = current.clientSequenceRaw ?? 0;
  if (clientSequence > MAX_AWARENESS_CLIENT_SEQUENCE) {
    sequenceAllowed =
      currentRawSequence > 0
        ? clientSequence > currentRawSequence
        : currentSequence === 0;
  } else if (clientSequence > 0) {
    sequenceAllowed =
      currentRawSequence > 0 || currentSequence > MAX_AWARENESS_CLIENT_SEQUENCE
        ? clientSequence <= MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE
        : clientSequence > currentSequence &&
          clientSequence <=
            currentSequence + MAX_AWARENESS_CLIENT_SEQUENCE_ADVANCE;
  } else {
    sequenceAllowed = currentRawSequence === 0 && currentSequence === 0;
  }
  if (!sequenceAllowed) return false;

  return !isBlockedByAwarenessClear(
    docId,
    clientId,
    lastSeen,
    localSequence,
    Date.now(),
  );
}

function awarenessSnapshots(
  map: Map<number, AwarenessEntry>,
  clientId: number,
): {
  allStates: Array<{ clientId: number; state: string }>;
  otherStates: Array<{ clientId: number; state: string }>;
} {
  const allStates: Array<{ clientId: number; state: string }> = [];
  const otherStates: Array<{ clientId: number; state: string }> = [];
  for (const [id, entry] of map) {
    allStates.push({ clientId: id, state: entry.state });
    if (id !== clientId) otherStates.push({ clientId: id, state: entry.state });
  }
  return { allStates, otherStates };
}

export const postAwareness = defineEventHandler(async (event: H3Event) => {
  const docId = getRouterParam(event, "docId");
  if (!docId) {
    setResponseStatus(event, 400);
    return { error: "docId required" };
  }
  const session = await getSession(event).catch(() => null);
  if (!session?.email?.trim()) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }
  const actorEmail = session.email.trim().toLowerCase();
  const contextScope = (
    event.context as { _collabAwarenessScope?: AwarenessScope } | undefined
  )?._collabAwarenessScope;

  const body = await readCollabBody(event);
  const { clientId, clientSequence, state, clearToken } = body as {
    clientId?: number;
    clientSequence?: number;
    state?: string | null;
    clearToken?: unknown;
  };

  if (clientId == null || state === undefined) {
    setResponseStatus(event, 400);
    return { error: "clientId and state required" };
  }
  if (
    !Number.isSafeInteger(clientId) ||
    clientId < 0 ||
    clientId === AGENT_CLIENT_ID
  ) {
    setResponseStatus(event, 400);
    return { error: "invalid clientId" };
  }
  if (
    (state !== null && typeof state !== "string") ||
    (clearToken !== undefined &&
      (typeof clearToken !== "string" || clearToken.length > 128)) ||
    (clientSequence !== undefined &&
      (!Number.isSafeInteger(clientSequence) ||
        clientSequence < 0 ||
        (clientSequence > MAX_AWARENESS_CLIENT_SEQUENCE &&
          clientSequence >
            (Date.now() + MAX_LEGACY_AWARENESS_CLOCK_SKEW_MS) * 1_000)))
  ) {
    setResponseStatus(event, 400);
    return { error: "invalid awareness state or clientSequence" };
  }
  const clearTokenHash =
    typeof clearToken === "string" && clearToken.length > 0
      ? createHash("sha256").update(clearToken).digest("hex")
      : null;

  const boundState =
    state === null
      ? undefined
      : bindAwarenessIdentity(state, session, actorEmail);
  if (boundState && !boundState.ok) {
    setResponseStatus(event, 400);
    return { error: "invalid awareness state or clientSequence" };
  }
  const serializedState = boundState?.serialized ?? "";

  const sequence = clientSequence ?? 0;
  const lastSeen = Date.now();
  const attemptOrder = ++_awarenessWriteAttemptOrder;
  let writeOutcome:
    | { kind: "completed"; applied: boolean }
    | { kind: "unavailable"; errorType: string };
  try {
    writeOutcome = {
      kind: "completed",
      applied: await writeAwarenessRow(
        docId,
        clientId,
        serializedState,
        lastSeen,
        sequence,
        state === null,
        actorEmail,
        clearTokenHash,
      ),
    };
  } catch (error) {
    writeOutcome = {
      kind: "unavailable",
      errorType: error instanceof Error ? error.name : typeof error,
    };
  }
  if (writeOutcome.kind === "unavailable") {
    const map = getDocAwareness(docId);
    cleanExpired(map, docId);
    let ownershipVerified = false;
    let stored:
      | Awaited<ReturnType<typeof loadAwarenessClientSequence>>
      | undefined;
    const clear = _awarenessClearTombstones.get(awarenessKey(docId, clientId));
    if (clear) {
      ownershipVerified = clear.actorEmail === actorEmail;
    } else {
      try {
        stored = await loadAwarenessClientSequence(docId, clientId);
        ownershipVerified =
          stored === undefined || stored.actorEmail === actorEmail;
      } catch {
        ownershipVerified = false;
      }
    }
    cleanExpired(map, docId);
    const existing = map.get(clientId);
    const storedEntry: AwarenessEntry | undefined = stored
      ? {
          clientId,
          state: "",
          lastSeen: stored.lastSeen,
          clientSequence: stored.clientSequence,
          clientSequenceRaw: stored.clientSequenceRaw,
          actorEmail: stored.actorEmail,
          clearTokenHash: stored.clearTokenHash,
        }
      : undefined;
    if (stored?.cleared && !clear) {
      rememberAwarenessClear(
        docId,
        clientId,
        stored.lastSeen,
        stored.clientSequence,
        stored.actorEmail,
      );
    }
    const cleared = state === null;
    const canAdvanceStored =
      existing === undefined ||
      storedEntry === undefined ||
      canApplyLocalAwarenessWrite(
        docId,
        storedEntry,
        clientId,
        sequence,
        lastSeen,
        actorEmail,
        cleared,
        clearTokenHash,
      );
    if (
      cleared &&
      existing === undefined &&
      storedEntry === undefined &&
      ownershipVerified &&
      canAdvanceStored
    ) {
      rememberAwarenessClear(
        docId,
        clientId,
        lastSeen,
        sequence || undefined,
        actorEmail,
      );
      _unsyncedAwarenessWrites.set(awarenessKey(docId, clientId), attemptOrder);
    }
    if (
      (existing !== undefined || ownershipVerified) &&
      canAdvanceStored &&
      canApplyLocalAwarenessWrite(
        docId,
        existing,
        clientId,
        sequence,
        lastSeen,
        actorEmail,
        state === null,
        clearTokenHash,
        storedEntry,
      )
    ) {
      applyLocalAwarenessWrite(
        docId,
        map,
        clientId,
        serializedState,
        lastSeen,
        sequence,
        cleared,
        actorEmail,
        clearTokenHash,
        storedEntry,
      );
      _unsyncedAwarenessWrites.set(awarenessKey(docId, clientId), attemptOrder);
    }
    cleanExpired(map, docId);
    pruneIfEmpty(docId, map);
    const { allStates } = awarenessSnapshots(map, clientId);
    emitAwarenessChange(
      docId,
      allStates,
      contextScope ?? {
        ...(session?.email ? { owner: session.email } : {}),
        ...(session?.orgId ? { orgId: session.orgId } : {}),
      },
    );
    setResponseStatus(event, 503);
    return {
      error: "Awareness persistence unavailable",
      failureType: writeOutcome.errorType,
    };
  }
  const applied = writeOutcome.applied;
  let current: Awaited<ReturnType<typeof loadAwarenessClientSequence>>;
  if (applied) {
    current = undefined;
  } else {
    try {
      current = await loadAwarenessClientSequence(docId, clientId);
    } catch (error) {
      setResponseStatus(event, 503);
      return {
        error: "Awareness ownership lookup unavailable",
        failureType: error instanceof Error ? error.name : typeof error,
      };
    }
  }
  if (current && current.actorEmail !== actorEmail) {
    setResponseStatus(event, 403);
    return { error: "Awareness client id belongs to another collaborator" };
  }
  if (!applied) {
    setResponseStatus(event, 409);
    setResponseHeader(
      event,
      "x-awareness-client-sequence",
      String(current?.clientSequence ?? 0),
    );
  }

  const map = getDocAwareness(docId);
  cleanExpired(map, docId);
  const localEntry = map.get(clientId);
  const localKey = awarenessKey(docId, clientId);
  const unsyncedAttemptOrder = _unsyncedAwarenessWrites.get(localKey);
  const reconcilesUnsyncedLocalWrite =
    unsyncedAttemptOrder !== undefined && attemptOrder > unsyncedAttemptOrder;
  const useAuthoritativeStoredRow =
    applied &&
    (unsyncedAttemptOrder === undefined || reconcilesUnsyncedLocalWrite);
  const hasLocalOrderingState =
    localEntry !== undefined || _awarenessClearTombstones.has(localKey);
  if (
    applied &&
    (reconcilesUnsyncedLocalWrite ||
      !hasLocalOrderingState ||
      canApplyLocalAwarenessWrite(
        docId,
        localEntry,
        clientId,
        sequence,
        lastSeen,
        actorEmail,
        state === null,
        clearTokenHash,
      ))
  ) {
    if (reconcilesUnsyncedLocalWrite) {
      map.delete(clientId);
      forgetAwarenessClear(docId, clientId);
      _unsyncedAwarenessWrites.delete(localKey);
    }
    applyLocalAwarenessWrite(
      docId,
      map,
      clientId,
      serializedState,
      lastSeen,
      sequence,
      state === null,
      actorEmail,
      clearTokenHash,
    );
  }
  try {
    await mergeStoredAwareness(
      docId,
      map,
      useAuthoritativeStoredRow ? clientId : undefined,
    );
  } catch (error) {
    if (applied) {
      cleanExpired(map, docId);
      pruneIfEmpty(docId, map);
      const { allStates } = awarenessSnapshots(map, clientId);
      emitAwarenessChange(
        docId,
        allStates,
        contextScope ?? {
          ...(session?.email ? { owner: session.email } : {}),
          ...(session?.orgId ? { orgId: session.orgId } : {}),
        },
      );
    }
    setResponseStatus(event, 503);
    return {
      error: "Awareness read unavailable",
      failureType: error instanceof Error ? error.name : typeof error,
    };
  }

  cleanExpired(map, docId);
  pruneIfEmpty(docId, map);

  const { allStates, otherStates } = awarenessSnapshots(map, clientId);

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
  try {
    await mergeStoredAwareness(docId, map);
  } catch (error) {
    setResponseStatus(event, 503);
    return {
      error: "Awareness read unavailable",
      failureType: error instanceof Error ? error.name : typeof error,
    };
  }
  cleanExpired(map, docId);
  pruneIfEmpty(docId, map);

  const users: Array<{ clientId: number; lastSeen: number }> = [];
  for (const [, entry] of map) {
    users.push({ clientId: entry.clientId, lastSeen: entry.lastSeen });
  }

  return { users };
});


import { AGENT_CLIENT_ID, DEFAULT_AGENT_IDENTITY } from "./agent-identity.js";
import { deleteAwarenessRow, upsertAwarenessRow } from "./awareness-store.js";
import {
  emitAwarenessChange,
  forgetAwarenessClear,
  getDocAwareness,
  rememberAwarenessClear,
  type AwarenessEntry,
} from "./awareness.js";
import { appendRecentEdit, type RecentEdit } from "./recent-edits.js";
import { searchAndReplace } from "./ydoc-manager.js";

const HEARTBEAT_INTERVAL = 10_000;

export const AGENT_PRESENCE_LINGER_MS = 6_000;

const _heartbeats = new Map<string, NodeJS.Timeout>();
const _refCounts = new Map<string, number>();
const _lingerTimers = new Map<string, NodeJS.Timeout>();

function cancelLinger(docId: string): void {
  const timer = _lingerTimers.get(docId);
  if (timer) {
    clearTimeout(timer);
    _lingerTimers.delete(docId);
  }
}

function removeAgentPresence(docId: string): void {
  cancelLinger(docId);
  const clearedAt = Date.now();
  rememberAwarenessClear(docId, AGENT_CLIENT_ID, clearedAt);
  const map = getDocAwareness(docId);
  map.delete(AGENT_CLIENT_ID);
  emitAwarenessChange(docId, currentAwarenessStates(map));
  void deleteAwarenessRow(docId, AGENT_CLIENT_ID, clearedAt);

  const interval = _heartbeats.get(docId);
  if (interval) {
    clearInterval(interval);
    _heartbeats.delete(docId);
  }
}

function scheduleLingerRemoval(docId: string, lingerMs: number): void {
  cancelLinger(docId);
  if (lingerMs <= 0) {
    removeAgentPresence(docId);
    return;
  }
  const timer = setTimeout(() => {
    _lingerTimers.delete(docId);
    if ((_refCounts.get(docId) ?? 0) > 0) return;
    removeAgentPresence(docId);
  }, lingerMs);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
  _lingerTimers.set(docId, timer);
}

function ensureHeartbeat(docId: string): void {
  if (_heartbeats.has(docId)) return;

  const interval = setInterval(() => {
    const m = getDocAwareness(docId);
    const existing = m.get(AGENT_CLIENT_ID);
    if (existing) {
      existing.lastSeen = Date.now();
      void upsertAwarenessRow(
        docId,
        AGENT_CLIENT_ID,
        existing.state,
        existing.lastSeen,
      );
    }
  }, HEARTBEAT_INTERVAL);

  if (typeof interval === "object" && "unref" in interval) {
    interval.unref();
  }

  _heartbeats.set(docId, interval);
}

function currentAwarenessStates(map: Map<number, AwarenessEntry>) {
  return Array.from(map, ([clientId, entry]) => ({
    clientId,
    state: entry.state,
  }));
}

function readAgentState(docId: string): Record<string, unknown> {
  const existing = getDocAwareness(docId).get(AGENT_CLIENT_ID);
  if (existing) {
    try {
      return JSON.parse(existing.state) as Record<string, unknown>;
    } catch {
      // Invalid state — fall through to defaults
    }
  }
  return {
    user: {
      name: DEFAULT_AGENT_IDENTITY.name,
      email: DEFAULT_AGENT_IDENTITY.email,
      color: DEFAULT_AGENT_IDENTITY.color,
    },
  };
}

function writeAgentState(docId: string, state: Record<string, unknown>): void {
  forgetAwarenessClear(docId, AGENT_CLIENT_ID);
  const entry: AwarenessEntry = {
    clientId: AGENT_CLIENT_ID,
    state: JSON.stringify(state),
    lastSeen: Date.now(),
  };
  const map = getDocAwareness(docId);
  map.set(AGENT_CLIENT_ID, entry);
  emitAwarenessChange(docId, currentAwarenessStates(map));
  void upsertAwarenessRow(docId, AGENT_CLIENT_ID, entry.state, entry.lastSeen);
}

export function agentEnterDocument(
  docId: string,
  metadata?: Record<string, unknown>,
): void {
  cancelLinger(docId);

  const state = { ...readAgentState(docId), ...metadata };
  writeAgentState(docId, state);

  _refCounts.set(docId, (_refCounts.get(docId) ?? 0) + 1);

  ensureHeartbeat(docId);
}

export interface AgentLeaveOptions {
  lingerMs?: number;
}

export function agentLeaveDocument(
  docId: string,
  options?: AgentLeaveOptions,
): void {
  const count = (_refCounts.get(docId) ?? 1) - 1;
  if (count > 0) {
    _refCounts.set(docId, count);
    return;
  }
  _refCounts.delete(docId);

  scheduleLingerRemoval(docId, options?.lingerMs ?? AGENT_PRESENCE_LINGER_MS);
}

export function agentUpdateSelection(
  docId: string,
  selection: Record<string, unknown>,
): void {
  const state = { ...readAgentState(docId), ...selection };
  writeAgentState(docId, state);
}

export interface AgentTouchOptions {
  edit?: Omit<RecentEdit, "at"> & { at?: number };
  metadata?: Record<string, unknown>;
  lingerMs?: number;
}

export function agentTouchDocument(
  docId: string,
  options?: AgentTouchOptions,
): void {
  cancelLinger(docId);

  const state = { ...readAgentState(docId), ...(options?.metadata ?? {}) };
  const now = Date.now();
  if (options?.edit) {
    const { at, ...rest } = options.edit;
    state.recentEdits = appendRecentEdit(
      state.recentEdits as RecentEdit[] | undefined,
      { ...rest, at: at ?? now },
    );
  }
  state.lastEditAt = now;
  writeAgentState(docId, state);

  ensureHeartbeat(docId);

  if ((_refCounts.get(docId) ?? 0) === 0) {
    scheduleLingerRemoval(docId, options?.lingerMs ?? AGENT_PRESENCE_LINGER_MS);
  }
}

export async function agentApplyEditsIncrementally(
  docId: string,
  edits: Array<{ find: string; replace: string }>,
  options?: { delayMs?: number },
): Promise<void> {
  const delayMs = options?.delayMs ?? 150;
  agentEnterDocument(docId);

  try {
    for (const edit of edits) {
      await searchAndReplace(docId, edit.find, edit.replace, "agent");
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  } finally {
    agentLeaveDocument(docId);
  }
}

export async function agentApplyPatchesIncrementally(
  docId: string,
  fieldName: string,
  patches: Array<{
    op: string;
    path: string;
    value?: unknown;
    index?: number;
    from?: number;
    to?: number;
  }>,
  options?: { delayMs?: number },
): Promise<void> {
  const delayMs = options?.delayMs ?? 150;
  agentEnterDocument(docId);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let applyPatchOps: any;
    try {
      const mod = await import("./ydoc-manager.js");
      applyPatchOps = (mod as Record<string, unknown>).applyPatchOps;
    } catch {
      throw new Error(
        "applyPatchOps is not available yet — Phase 1 must complete first",
      );
    }

    if (typeof applyPatchOps !== "function") {
      throw new Error(
        "applyPatchOps is not available yet — Phase 1 must complete first",
      );
    }

    for (const patch of patches) {
      await applyPatchOps(docId, [patch], fieldName, "agent");
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  } finally {
    agentLeaveDocument(docId);
  }
}

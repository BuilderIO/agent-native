/**
 * Server-side agent presence lifecycle for collaborative editing.
 *
 * Provides enter/leave semantics so the agent behaves like a real
 * collaborator — it "enters" a document, its edits are visible with
 * durable presence, and it "leaves" when done. Actions call these
 * instead of hand-rolling HTTP awareness calls.
 *
 * Presence lingers after the agent finishes editing (default 6s) so viewers
 * get a moment to see who just changed what — the same way a human
 * collaborator's cursor doesn't vanish the instant they stop typing. Recent
 * edits are attributed in the awareness state (`recentEdits`, `lastEditAt`)
 * so clients can render fading highlights over the edited regions.
 *
 * On serverless hosts the linger timer may never fire after the response is
 * sent; the 30s awareness expiry then removes the entry, so presence degrades
 * to "up to 30s" instead of leaking.
 */

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

const HEARTBEAT_INTERVAL = 10_000; // 10 seconds

/** How long agent presence lingers after leave/last edit before clearing. */
export const AGENT_PRESENCE_LINGER_MS = 6_000;

// docId → heartbeat interval handle
const _heartbeats = new Map<string, NodeJS.Timeout>();
// docId → reference count (how many concurrent operations are using this doc)
const _refCounts = new Map<string, number>();
// docId → pending linger-removal timer
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
  // Cross-instance removal (serverless) — best-effort, never blocks.
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
    // A new operation may have re-entered while we waited.
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
      // Keep the SQL mirror fresh too, or remote-instance pollers would see
      // the agent expire mid-operation (store throttles unchanged writes).
      void upsertAwarenessRow(
        docId,
        AGENT_CLIENT_ID,
        existing.state,
        existing.lastSeen,
      );
    }
  }, HEARTBEAT_INTERVAL);

  // Don't block Node from exiting if this is the only timer left
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
  // Mirror to SQL so pollers on other instances see the agent — an action
  // often runs in a different serverless invocation than the poll route.
  void upsertAwarenessRow(docId, AGENT_CLIENT_ID, entry.state, entry.lastSeen);
}

/**
 * Mark the agent as present on a document.
 *
 * Sets an awareness entry for the agent and starts a heartbeat that
 * keeps it alive. If the agent is already present on this doc (including
 * lingering after a previous edit), refreshes state without creating a
 * second interval.
 */
export function agentEnterDocument(
  docId: string,
  metadata?: Record<string, unknown>,
): void {
  cancelLinger(docId);

  const state = { ...readAgentState(docId), ...metadata };
  writeAgentState(docId, state);

  // Increment reference count
  _refCounts.set(docId, (_refCounts.get(docId) ?? 0) + 1);

  ensureHeartbeat(docId);
}

export interface AgentLeaveOptions {
  /**
   * How long presence lingers before the awareness entry clears.
   * Defaults to {@link AGENT_PRESENCE_LINGER_MS}. Pass 0 to clear
   * immediately (e.g. when an operation failed before editing anything).
   */
  lingerMs?: number;
}

/**
 * Release the agent's presence on a document.
 *
 * Decrements the reference count; when it reaches zero the awareness entry
 * lingers for `lingerMs` (default 6s) and is then removed. Viewers see the
 * agent avatar/highlights for a beat after the edit completes instead of an
 * instant disappearance.
 */
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

/**
 * Update the agent's awareness state to include selection info
 * (e.g., which track, panel, or element the agent is working on).
 */
export function agentUpdateSelection(
  docId: string,
  selection: Record<string, unknown>,
): void {
  const state = { ...readAgentState(docId), ...selection };
  writeAgentState(docId, state);
}

export interface AgentTouchOptions {
  /** Region descriptor + label recorded in the agent's recentEdits ring. */
  edit?: Omit<RecentEdit, "at"> & { at?: number };
  /** Extra awareness fields to merge (e.g. `selection`). */
  metadata?: Record<string, unknown>;
  /** Linger before auto-clearing when no enter/leave pair is active. */
  lingerMs?: number;
}

/**
 * Record an agent edit on a document without requiring an explicit
 * enter/leave pair. Used by the collab write paths so ANY agent edit
 * produces visible presence + lingering attribution automatically.
 *
 * - Upserts the agent awareness entry (identity preserved/merged).
 * - Appends to the `recentEdits` ring and bumps `lastEditAt`.
 * - When no explicit operation is in flight (refcount 0), (re)schedules a
 *   linger removal so presence fades out on its own.
 */
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

/**
 * Apply search-and-replace edits incrementally so each one appears
 * as a separate poll event to connected clients.
 *
 * Enters the document before editing and leaves in a finally block.
 */
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

/**
 * Apply structured data patches incrementally so each one appears
 * as a separate poll event to connected clients.
 *
 * Enters the document before patching and leaves in a finally block.
 */
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
    // Resolve applyPatchOps dynamically so a build that strips it (or a partial
    // upgrade) fails loudly here rather than at module load time.
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

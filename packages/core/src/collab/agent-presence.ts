/**
 * Server-side agent presence lifecycle for collaborative editing.
 *
 * Provides enter/leave semantics so the agent behaves like a real
 * collaborator — it "enters" a document, its edits are visible with
 * durable presence, and it "leaves" when done. Actions call these
 * instead of hand-rolling HTTP awareness calls.
 */

import { getDocAwareness, type AwarenessEntry } from "./awareness.js";
import {
  AGENT_CLIENT_ID,
  DEFAULT_AGENT_IDENTITY,
  type AgentIdentity,
} from "./agent-identity.js";
import { searchAndReplace } from "./ydoc-manager.js";

const HEARTBEAT_INTERVAL = 10_000; // 10 seconds

// docId → heartbeat interval handle
const _heartbeats = new Map<string, NodeJS.Timeout>();
// docId → reference count (how many concurrent operations are using this doc)
const _refCounts = new Map<string, number>();

/**
 * Mark the agent as present on a document.
 *
 * Sets an awareness entry for the agent and starts a heartbeat that
 * keeps it alive. If the agent is already present on this doc, just
 * refreshes `lastSeen` without creating a second interval.
 */
export function agentEnterDocument(
  docId: string,
  metadata?: Record<string, unknown>,
): void {
  const map = getDocAwareness(docId);

  const state = JSON.stringify({
    user: {
      name: DEFAULT_AGENT_IDENTITY.name,
      email: DEFAULT_AGENT_IDENTITY.email,
      color: DEFAULT_AGENT_IDENTITY.color,
    },
    ...metadata,
  });

  const entry: AwarenessEntry = {
    clientId: AGENT_CLIENT_ID,
    state,
    lastSeen: Date.now(),
  };
  map.set(AGENT_CLIENT_ID, entry);

  // Increment reference count
  _refCounts.set(docId, (_refCounts.get(docId) ?? 0) + 1);

  // Don't create another interval if one already exists
  if (_heartbeats.has(docId)) return;

  const interval = setInterval(() => {
    const m = getDocAwareness(docId);
    const existing = m.get(AGENT_CLIENT_ID);
    if (existing) {
      existing.lastSeen = Date.now();
    }
  }, HEARTBEAT_INTERVAL);

  // Don't block Node from exiting if this is the only timer left
  if (typeof interval === "object" && "unref" in interval) {
    interval.unref();
  }

  _heartbeats.set(docId, interval);
}

/**
 * Remove the agent's presence from a document.
 *
 * Clears the awareness entry and stops the heartbeat.
 */
export function agentLeaveDocument(docId: string): void {
  const count = (_refCounts.get(docId) ?? 1) - 1;
  if (count > 0) {
    _refCounts.set(docId, count);
    return;
  }
  _refCounts.delete(docId);

  const map = getDocAwareness(docId);
  map.delete(AGENT_CLIENT_ID);

  const interval = _heartbeats.get(docId);
  if (interval) {
    clearInterval(interval);
    _heartbeats.delete(docId);
  }
}

/**
 * Update the agent's awareness state to include selection info
 * (e.g., which track, panel, or element the agent is working on).
 */
export function agentUpdateSelection(
  docId: string,
  selection: Record<string, unknown>,
): void {
  const map = getDocAwareness(docId);
  const existing = map.get(AGENT_CLIENT_ID);

  let parsed: Record<string, unknown> = {
    user: {
      name: DEFAULT_AGENT_IDENTITY.name,
      email: DEFAULT_AGENT_IDENTITY.email,
      color: DEFAULT_AGENT_IDENTITY.color,
    },
  };

  if (existing) {
    try {
      parsed = JSON.parse(existing.state) as Record<string, unknown>;
    } catch {
      // Invalid state — use defaults
    }
  }

  const state = JSON.stringify({ ...parsed, ...selection });
  map.set(AGENT_CLIENT_ID, {
    clientId: AGENT_CLIENT_ID,
    state,
    lastSeen: Date.now(),
  });
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
 *
 * NOTE: `applyPatchOps` may not exist yet (Phase 1 creates it).
 * This will compile once Phase 1 finishes.
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
    // Dynamic import — applyPatchOps is being added by Phase 1.
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

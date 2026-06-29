/**
 * Presence kit — Liveblocks/collaboration-grade presence primitives.
 *
 * usePresence(awareness) returns:
 *   - others: reactive array of remote participants (human + agent)
 *   - setPresence(partial): merge fields into local awareness state
 *
 * The hook re-renders on every awareness change event and always includes
 * the agent participant (AGENT_CLIENT_ID) as isAgent: true.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { Awareness } from "y-protocols/awareness";

import { AGENT_CLIENT_ID } from "./agent-identity.js";
import type { CollabUser } from "./client.js";

/** Arbitrary JSON presence payload published by a participant. */
export type PresencePayload = Record<string, unknown>;

/** A remote participant's full presence snapshot. */
export interface OtherPresence {
  /** Yjs client ID. */
  clientId: number;
  /** User identity (from awareness `user` field). */
  user: CollabUser;
  /** Arbitrary presence fields set via setPresence() / agentUpdateSelection(). */
  presence: PresencePayload;
  /** True when this participant is the AI agent. */
  isAgent: boolean;
}

export interface UsePresenceResult {
  /** All remote participants (excludes local client). */
  others: OtherPresence[];
  /**
   * Merge fields into the local awareness state. These are broadcast to
   * peers by the fast-awareness path in useCollaborativeDoc.
   * Call this to publish cursor position, viewport, or selection.
   */
  setPresence: (partial: PresencePayload) => void;
}

/**
 * Derive OtherPresence entries from an Awareness instance.
 *
 * @param awareness Awareness instance from useCollaborativeDoc.
 * @param localClientId The local Yjs client ID (to exclude self).
 */
export function usePresence(
  awareness: Awareness | null | undefined,
  localClientId: number | null | undefined,
): UsePresenceResult {
  const [others, setOthers] = useState<OtherPresence[]>([]);

  // Keep the latest awareness ref so setPresence closure doesn't go stale.
  const awarenessRef = useRef(awareness);
  awarenessRef.current = awareness;

  useEffect(() => {
    if (!awareness) {
      setOthers([]);
      return;
    }

    function derive(): OtherPresence[] {
      const result: OtherPresence[] = [];
      awareness!.getStates().forEach((state, clientId) => {
        if (clientId === localClientId) return; // skip self
        const s = state as Record<string, unknown>;
        const isAgent = clientId === AGENT_CLIENT_ID;

        // User identity — fall back to agent defaults or anonymous.
        let user: CollabUser;
        if (isAgent) {
          user = {
            name: (s.user as CollabUser)?.name ?? "AI Assistant",
            email: (s.user as CollabUser)?.email ?? "agent@system",
            color: (s.user as CollabUser)?.color ?? "#00B5FF",
          };
        } else {
          const u = s.user as CollabUser | undefined;
          user = {
            name: u?.name ?? "Unknown",
            email: u?.email ?? `client-${clientId}`,
            color: u?.color ?? "#94a3b8",
          };
        }

        // Everything that isn't `user` or `visible` is presence payload.
        const presence: PresencePayload = {};
        for (const [k, v] of Object.entries(s)) {
          if (k !== "user" && k !== "visible") {
            presence[k] = v;
          }
        }

        result.push({ clientId, user, presence, isAgent });
      });
      return result;
    }

    function onAwarenessChange() {
      setOthers(derive());
    }

    // Derive immediately.
    setOthers(derive());
    awareness.on("change", onAwarenessChange);
    return () => {
      awareness.off("change", onAwarenessChange);
    };
  }, [awareness, localClientId]);

  const setPresence = useCallback((partial: PresencePayload) => {
    const aw = awarenessRef.current;
    if (!aw) return;
    for (const [k, v] of Object.entries(partial)) {
      aw.setLocalStateField(k, v);
    }
  }, []);

  return { others, setPresence };
}

// ---------------------------------------------------------------------------
// Normalized cursor coordinate helpers
// ---------------------------------------------------------------------------

export interface NormalizedPoint {
  /** 0–1 fraction of container width. */
  x: number;
  /** 0–1 fraction of container height. */
  y: number;
}

/** Convert a pointer event offset to a normalized point. */
export function toNormalized(
  clientX: number,
  clientY: number,
  container: DOMRect,
): NormalizedPoint {
  return {
    x: Math.max(0, Math.min(1, (clientX - container.left) / container.width)),
    y: Math.max(0, Math.min(1, (clientY - container.top) / container.height)),
  };
}

/** Convert a normalized point back to absolute offset within a container. */
export function fromNormalized(
  point: NormalizedPoint,
  container: DOMRect,
): { x: number; y: number } {
  return {
    x: point.x * container.width,
    y: point.y * container.height,
  };
}

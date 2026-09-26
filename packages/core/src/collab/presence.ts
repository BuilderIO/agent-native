
import type {
  CollabUser,
  NormalizedPoint,
  OtherPresence,
  PresencePayload,
} from "@agent-native/toolkit/collab-ui";
import { useState, useEffect, useCallback, useRef } from "react";
import type { Awareness } from "y-protocols/awareness";

import { AGENT_CLIENT_ID } from "./agent-identity.js";

export type {
  NormalizedPoint,
  OtherPresence,
  PresencePayload,
} from "@agent-native/toolkit/collab-ui";

export function deriveCollabUser(
  state: Record<string, unknown>,
  clientId: number,
): CollabUser {
  const isAgent = clientId === AGENT_CLIENT_ID;
  const userState = state.user as Partial<CollabUser> | undefined;
  const avatarUrl =
    typeof userState?.avatarUrl === "string" && userState.avatarUrl.trim()
      ? userState.avatarUrl
      : undefined;

  return {
    name: userState?.name ?? (isAgent ? "AI Assistant" : "Unknown"),
    email:
      userState?.email ?? (isAgent ? "agent@system" : `client-${clientId}`),
    // guard:allow-raw-color — collaboration protocol default, not theme UI
    color: userState?.color ?? (isAgent ? "#00B5FF" : "#94a3b8"),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export function shallowEqualOthers(
  a: readonly OtherPresence[],
  b: readonly OtherPresence[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (left === right) continue;
    if (
      left.clientId !== right.clientId ||
      left.isAgent !== right.isAgent ||
      left.user.name !== right.user.name ||
      left.user.email !== right.user.email ||
      left.user.color !== right.user.color ||
      left.user.avatarUrl !== right.user.avatarUrl
    ) {
      return false;
    }
    if (JSON.stringify(left.presence) !== JSON.stringify(right.presence)) {
      return false;
    }
  }
  return true;
}

export interface UsePresenceResult {
  others: OtherPresence[];
  setPresence: (partial: PresencePayload) => void;
}

export function usePresence(
  awareness: Awareness | null | undefined,
  localClientId: number | null | undefined,
): UsePresenceResult {
  const [others, setOthers] = useState<OtherPresence[]>([]);

  const awarenessRef = useRef(awareness);
  awarenessRef.current = awareness;

  useEffect(() => {
    if (!awareness) {
      setOthers([]);
      return;
    }

    let lastOthers: OtherPresence[] = [];

    function derive(): OtherPresence[] {
      const result: OtherPresence[] = [];
      awareness!.getStates().forEach((state, clientId) => {
        if (clientId === localClientId) return;
        const s = state as Record<string, unknown>;

        const user = deriveCollabUser(s, clientId);

        const presence: PresencePayload = {};
        for (const [k, v] of Object.entries(s)) {
          if (k !== "user" && k !== "visible") {
            presence[k] = v;
          }
        }

        result.push({
          clientId,
          user,
          presence,
          isAgent: clientId === AGENT_CLIENT_ID,
        });
      });
      return result;
    }

    function onAwarenessChange(changes?: {
      added: number[];
      updated: number[];
      removed: number[];
    }) {
      if (changes) {
        const changedIds = [
          ...changes.added,
          ...changes.updated,
          ...changes.removed,
        ];
        if (
          changedIds.length > 0 &&
          changedIds.every((id) => id === localClientId)
        ) {
          return;
        }
      }
      const next = derive();
      if (shallowEqualOthers(lastOthers, next)) return;
      lastOthers = next;
      setOthers(next);
    }

    lastOthers = derive();
    setOthers(lastOthers);
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

export function fromNormalized(
  point: NormalizedPoint,
  container: DOMRect,
): { x: number; y: number } {
  return {
    x: point.x * container.width,
    y: point.y * container.height,
  };
}

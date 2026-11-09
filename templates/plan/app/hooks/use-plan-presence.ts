import { generateTabId } from "@agent-native/core/client/agent-chat";
import {
  useCollaborativeDoc,
  usePresence,
  useRecentEdits,
  type AttributedRecentEdit,
  type CollabUser,
  type UseCollaborativeDocResult,
} from "@agent-native/core/client/collab";
import { useEffect, useRef } from "react";
import type { Transaction } from "yjs";

const TAB_ID = generateTabId();
// Long enough to cover a collaborator's autosave and its retries, so a save of
// theirs can still be racing this tab's for about this long.
const COLLABORATOR_TYPING_WINDOW_MS = 30_000;

export interface UsePlanPresenceResult {
  activeUsers: CollabUser[];
  agentPresent: boolean;
  agentActive: boolean;
  /** Someone else, not the agent, has this plan's live document open. */
  anotherEditorIsLive: boolean;
  /** Whether typing from someone with this plan open just reached this document. */
  collaboratorJustTyped: () => boolean;
  recentEdits: AttributedRecentEdit[];
  collabDoc: Pick<
    UseCollaborativeDocResult,
    | "ydoc"
    | "awareness"
    | "isSynced"
    | "initialization"
    | "flushUpdates"
    | "requestSync"
  >;
}

export function usePlanPresence(options: {
  planId: string | null | undefined;
  enabled?: boolean;
  user?: CollabUser | undefined;
}): UsePlanPresenceResult {
  const { planId, enabled = true, user } = options;
  const docId = enabled && planId ? `plan:${planId}` : null;

  const {
    ydoc,
    awareness,
    isSynced,
    initialization,
    flushUpdates,
    requestSync,
    activeUsers,
    agentPresent,
    agentActive,
  } = useCollaborativeDoc({
    docId,
    activityResource: planId
      ? { resourceType: "plan", resourceId: planId }
      : undefined,
    user,
    requestSource: TAB_ID,
    pollInterval: 3000,
  });

  const localClientId = ydoc?.clientID ?? null;
  const { others } = usePresence(awareness, localClientId);
  const recentEdits = useRecentEdits(others);

  const isSyncedRef = useRef(isSynced);
  isSyncedRef.current = isSynced;
  const collaboratorTypedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!ydoc || !awareness) return;
    const noteTyping = ({ beforeState, afterState }: Transaction) => {
      // The first sync brings in old typing, which isn't anyone typing now.
      if (!isSyncedRef.current) return;
      const present = awareness.getStates();
      for (const [clientId, clock] of afterState) {
        if (
          clientId !== ydoc.clientID &&
          present.has(clientId) &&
          clock > (beforeState.get(clientId) ?? 0)
        ) {
          collaboratorTypedAtRef.current = Date.now();
          return;
        }
      }
    };
    ydoc.on("afterTransaction", noteTyping);
    return () => ydoc.off("afterTransaction", noteTyping);
  }, [ydoc, awareness]);
  const collaboratorJustTyped = () =>
    collaboratorTypedAtRef.current !== null &&
    Date.now() - collaboratorTypedAtRef.current < COLLABORATOR_TYPING_WINDOW_MS;

  return {
    activeUsers,
    agentPresent,
    agentActive,
    anotherEditorIsLive: others.some((other) => !other.isAgent),
    collaboratorJustTyped,
    recentEdits,
    collabDoc: {
      ydoc,
      awareness,
      isSynced,
      initialization,
      flushUpdates,
      requestSync,
    },
  };
}

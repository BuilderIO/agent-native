import { generateTabId } from "@agent-native/core/client/agent-chat";
import {
  useCollaborativeDoc,
  usePresence,
  useRecentEdits,
  type AttributedRecentEdit,
  type CollabUser,
  type UseCollaborativeDocResult,
} from "@agent-native/core/client/collab";

const TAB_ID = generateTabId();

export interface UsePlanPresenceResult {
  activeUsers: CollabUser[];
  agentPresent: boolean;
  agentActive: boolean;
  /** Someone else, not the agent, has this plan's live document open. */
  anotherEditorIsLive: boolean;
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
  user?: CollabUser;
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

  return {
    activeUsers,
    agentPresent,
    agentActive,
    anotherEditorIsLive: others.some((other) => !other.isAgent),
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

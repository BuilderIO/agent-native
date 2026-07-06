import {
  useCollaborativeDoc,
  usePresence,
  useRecentEdits,
  generateTabId,
  type AttributedRecentEdit,
  type CollabUser,
} from "@agent-native/core/client";

/** One tab id per browser tab, shared by every plan presence hook instance. */
const TAB_ID = generateTabId();

export interface UsePlanPresenceResult {
  /** Remote human collaborators (excludes self and the agent slot). */
  activeUsers: CollabUser[];
  /** True while the AI agent holds a durable presence entry on this plan. */
  agentPresent: boolean;
  /** True briefly right after the agent edits (for the "AI editing" pulse). */
  agentActive: boolean;
  /** Non-expired recent edits from remote participants (human + agent). */
  recentEdits: AttributedRecentEdit[];
}

/**
 * Plan-level presence + recent-edit attribution over a lightweight, content-free
 * collab doc `plan:<planId>` — the single-doc content collab is intentionally
 * OFF (see PlanDocumentEditor), so this doc carries ONLY awareness (who is here,
 * where the agent is working) and never any Y.XmlFragment content.
 *
 * Mirrors templates/slides `use-deck-presence`: open the doc for awareness, and
 * publish the local user identity so peers see the current user's avatar. The
 * agent's presence + `{ kind: "paths", paths }` recent-edit descriptors arrive
 * on the same doc from `agentTouchDocument("plan:<planId>", …)` in the patch
 * actions, so no client publish is needed for the agent.
 */
export function usePlanPresence(options: {
  planId: string | null | undefined;
  enabled?: boolean;
  user?: CollabUser;
}): UsePlanPresenceResult {
  const { planId, enabled = true, user } = options;
  const docId = enabled && planId ? `plan:${planId}` : null;

  const { ydoc, awareness, activeUsers, agentPresent, agentActive } =
    useCollaborativeDoc({
      docId,
      user,
      requestSource: TAB_ID,
      // Presence is low-stakes; a relaxed poll keeps it cheap.
      pollInterval: 3000,
    });

  const localClientId = ydoc?.clientID ?? null;
  const { others } = usePresence(awareness, localClientId);
  const recentEdits = useRecentEdits(others);

  return {
    // `activeUsers` from useCollaborativeDoc already excludes the agent slot and
    // dedupes by email; PresenceBar filters out the current user via its
    // `currentUserEmail` prop.
    activeUsers,
    agentPresent,
    agentActive,
    recentEdits,
  };
}

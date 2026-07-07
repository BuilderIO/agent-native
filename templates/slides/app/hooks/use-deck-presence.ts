import {
  useCollaborativeDoc,
  usePresence,
  useRecentEdits,
  type AttributedRecentEdit,
  type CollabUser,
} from "@agent-native/core/client";
import { useEffect, useMemo } from "react";
import type { Awareness } from "y-protocols/awareness";

const TAB_ID = `slides-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** How long the agent counts as "active" after its last recorded edit. */
const AGENT_ACTIVE_MS = 6000;

export interface DeckPresenceResult {
  /** Map<slideId, CollabUser[]> for sidebar / same-slide avatars. Includes the
   *  agent (styled) on whichever slide it is editing. */
  slidePresence: Map<string, CollabUser[]>;
  /** True while the agent has a durable presence entry on the deck. */
  agentPresent: boolean;
  /** True briefly after the agent records an edit (drives the pulsing chip). */
  agentActive: boolean;
  /** The slide the agent is currently editing, if any. */
  agentSlideId: string | null;
  /** Non-expired recent edits from remote participants (incl. the agent), for
   *  lingering highlights. */
  recentEdits: AttributedRecentEdit[];
  /** Deck presence-doc awareness (for resolving highlight rects). */
  awareness: Awareness | null;
  /** Local Yjs client id (to exclude self). */
  localClientId: number | null;
}

/**
 * Tracks deck-level presence: which slide each participant (human OR the agent)
 * is currently on. Uses a presence-only Yjs doc (`deck-{deckId}`) with no TipTap
 * content — the SAME doc id the slide-editing actions write agent presence to
 * via `agentTouchDocument`. So once the agent edits a slide, it shows up here as
 * a participant on that slide, with a lingering "AI edited" highlight.
 */
export function useDeckPresence(options: {
  deckId: string | null;
  activeSlideId: string | null;
  user?: CollabUser;
}): DeckPresenceResult {
  const { deckId, activeSlideId, user } = options;
  const normalizedSelfEmail = user?.email?.trim().toLowerCase();

  const { ydoc, awareness, agentPresent } = useCollaborativeDoc({
    docId: deckId ? `deck-${deckId}` : null,
    user,
    requestSource: TAB_ID,
    pollInterval: 3000,
  });

  const localClientId = (ydoc?.clientID ?? null) as number | null;
  const { others, setPresence } = usePresence(awareness, localClientId);

  // Publish which slide this user is currently viewing so peers (and the agent)
  // can see it.
  useEffect(() => {
    if (!awareness || !activeSlideId) return;
    setPresence({ slide: activeSlideId });
    return () => setPresence({ slide: null });
  }, [awareness, activeSlideId, setPresence]);

  const recentEdits = useRecentEdits(others);

  // Build Map<slideId, CollabUser[]> from all remote participants, humans and
  // agent alike. The agent's presence carries a `slide` field (from the action's
  // `metadata.slide`), so it lands on the exact slide it edited.
  const slidePresence = useMemo(() => {
    const map = new Map<string, CollabUser[]>();
    for (const other of others) {
      const slide = other.presence["slide"];
      if (typeof slide !== "string" || !slide) continue;
      // Skip our own reflection by email (another tab of the same human still
      // shows — matches the prior email-comparison behavior).
      const email = other.user.email?.trim().toLowerCase();
      if (!other.isAgent && email && email === normalizedSelfEmail) continue;
      if (!map.has(slide)) map.set(slide, []);
      map.get(slide)!.push(other.user);
    }
    return map;
  }, [others, normalizedSelfEmail]);

  // The agent's current slide + freshness (for the pulsing "AI" chip).
  const agentEntry = useMemo(() => others.find((o) => o.isAgent), [others]);
  const agentSlideId =
    typeof agentEntry?.presence["slide"] === "string"
      ? (agentEntry.presence["slide"] as string)
      : null;
  const agentActive = useMemo(() => {
    const lastEditAt = agentEntry?.presence["lastEditAt"];
    if (typeof lastEditAt === "number") {
      return Date.now() - lastEditAt < AGENT_ACTIVE_MS;
    }
    // Fall back to any fresh recent edit attributed to the agent.
    return recentEdits.some((e) => e.isAgent);
  }, [agentEntry, recentEdits]);

  return {
    slidePresence,
    agentPresent,
    agentActive,
    agentSlideId,
    recentEdits,
    awareness: awareness ?? null,
    localClientId,
  };
}

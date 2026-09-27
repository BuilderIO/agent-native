import {
  useCollaborativeDoc,
  usePresence,
  useRecentEdits,
  type AttributedRecentEdit,
  type CollabUser,
} from "@agent-native/core/client/collab";
import { useEffect, useMemo } from "react";
import type { Awareness } from "y-protocols/awareness";

const TAB_ID = `slides-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const AGENT_ACTIVE_MS = 6000;

export interface DeckPresenceResult {
  slidePresence: Map<string, CollabUser[]>;
  agentPresent: boolean;
  agentActive: boolean;
  agentSlideId: string | null;
  recentEdits: AttributedRecentEdit[];
  awareness: Awareness | null;
  localClientId: number | null;
}

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

  useEffect(() => {
    if (!awareness || !activeSlideId) return;
    setPresence({ slide: activeSlideId });
    return () => setPresence({ slide: null });
  }, [awareness, activeSlideId, setPresence]);

  const recentEdits = useRecentEdits(others);

  const slidePresence = useMemo(() => {
    const map = new Map<string, CollabUser[]>();
    for (const other of others) {
      const slide = other.presence["slide"];
      if (typeof slide !== "string" || !slide) continue;
      const email = other.user.email?.trim().toLowerCase();
      if (!other.isAgent && email && email === normalizedSelfEmail) continue;
      if (!map.has(slide)) map.set(slide, []);
      map.get(slide)!.push(other.user);
    }
    return map;
  }, [others, normalizedSelfEmail]);

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

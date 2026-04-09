import { useEffect, useState } from "react";
import {
  useCollaborativeDoc,
  type CollabUser,
} from "@agent-native/core/client";

const TAB_ID = `slides-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Tracks deck-level presence: which slide each user is currently viewing.
 * Uses a presence-only Yjs doc (deck-{deckId}) with no TipTap content.
 * Returns a Map<slideId, CollabUser[]> for rendering avatars in the sidebar.
 */
export function useDeckPresence(options: {
  deckId: string | null;
  activeSlideId: string | null;
  user?: CollabUser;
}) {
  const { deckId, activeSlideId, user } = options;

  const { awareness } = useCollaborativeDoc({
    docId: deckId ? `deck-${deckId}` : null,
    user,
    requestSource: TAB_ID,
    pollInterval: 3000,
  });

  // Publish which slide this user is currently viewing
  useEffect(() => {
    if (!awareness || !activeSlideId) return;
    awareness.setLocalStateField("slide", activeSlideId);
  }, [awareness, activeSlideId]);

  // Build Map<slideId, CollabUser[]> from all remote awareness states
  const [slidePresence, setSlidePresence] = useState<Map<string, CollabUser[]>>(
    new Map(),
  );

  useEffect(() => {
    if (!awareness) return;

    const update = () => {
      const map = new Map<string, CollabUser[]>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const selfId = (awareness as any).doc?.clientID;
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === selfId) return;
        const u = state.user as CollabUser | undefined;
        const slide = state.slide as string | undefined;
        if (u && slide) {
          if (!map.has(slide)) map.set(slide, []);
          map.get(slide)!.push(u);
        }
      });
      setSlidePresence(map);
    };

    awareness.on("change", update);
    update();
    return () => awareness.off("change", update);
  }, [awareness]);

  return { slidePresence };
}

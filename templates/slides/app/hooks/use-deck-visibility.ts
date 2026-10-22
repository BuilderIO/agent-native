import { useActionQuery } from "@agent-native/core/client/hooks";

import type { Deck } from "@/context/DeckContext";

/**
 * The deck's visibility as the Share panel shows it. The panel writes an
 * access change into the `list-resource-shares` record the editor already
 * loads for the viewer's role, while the deck row only catches up on its next
 * refresh. This reads that record without fetching it again.
 */
export function useDeckVisibility(
  deckId: string,
  deckVisibility: Deck["visibility"],
): Deck["visibility"] {
  const query = useActionQuery<{ visibility: Deck["visibility"] | null }>(
    "list-resource-shares",
    { resourceType: "deck", resourceId: deckId } as any,
    { enabled: false } as any,
  );
  return query.data?.visibility ?? deckVisibility;
}

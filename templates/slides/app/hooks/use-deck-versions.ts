import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import type { DeckVersion, DeckVersionListResponse } from "../../shared/api";

export function useDeckVersions(deckId: string | null) {
  return useActionQuery<DeckVersionListResponse>(
    "list-deck-versions",
    deckId ? { deckId } : undefined,
    {
      enabled: !!deckId,
      placeholderData: (prev: any) => prev,
    } as any,
  );
}

export function useDeckVersion(
  deckId: string | null,
  versionId: string | null,
) {
  return useActionQuery<DeckVersion>(
    "get-deck-version",
    deckId && versionId ? { deckId, versionId } : undefined,
    {
      enabled: !!(deckId && versionId),
      placeholderData: (prev: any) => prev,
    } as any,
  );
}

export function useRestoreDeckVersion() {
  return useActionMutation<
    {
      id: string;
      title: string;
      slideCount: number;
      restoredVersionId: string;
      updatedAt: string;
      url: string;
    },
    { deckId: string; versionId: string }
  >("restore-deck-version");
}

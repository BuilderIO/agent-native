export type GenerationDeckRefreshResult<TDeck> =
  | { status: "ready"; deck: TDeck; endedAt: number }
  | { status: "not_ready"; endedAt: number }
  | { status: "failed"; endedAt: number };

export async function refreshDeckForGenerationOutcome<TDeck>(
  refreshOpenDeck: (deckId: string) => Promise<TDeck | null>,
  deckId: string,
  now: () => number = Date.now,
): Promise<GenerationDeckRefreshResult<TDeck>> {
  const endedAt = now();
  try {
    let refreshedDeck = await refreshOpenDeck(deckId);
    if (refreshedDeck === null) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      refreshedDeck = await refreshOpenDeck(deckId);
    }
    return refreshedDeck
      ? { status: "ready", deck: refreshedDeck, endedAt }
      : { status: "not_ready", endedAt };
  } catch {
    return { status: "failed", endedAt };
  }
}

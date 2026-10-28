export type DeckListViewState = "loading" | "error" | "empty" | "decks";

export function deckListViewState({
  loading,
  loadError,
  deckCount,
}: {
  loading: boolean;
  loadError: boolean;
  deckCount: number;
}): DeckListViewState {
  if (loading) return "loading";
  if (deckCount > 0) return "decks";
  if (loadError) return "error";
  return "empty";
}

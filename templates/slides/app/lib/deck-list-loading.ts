export type DeckListViewState = "loading" | "error" | "empty" | "decks";

/**
 * One place that decides what the deck list renders, so "we have not decided
 * yet" can never be spelled the same way as "the server told us there is
 * nothing". Callers must keep `loading` true until the read that answers the
 * question has actually been applied to `deckCount` — a resolver cannot tell a
 * pre-fetch zero from a confirmed zero.
 */
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

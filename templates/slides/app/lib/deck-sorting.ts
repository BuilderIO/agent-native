import type { Deck } from "@/context/DeckContext";

type DeckDates = Pick<Deck, "createdAt" | "updatedAt">;

function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function getDeckRecency(deck: DeckDates): number {
  return parseDate(deck.updatedAt) ?? parseDate(deck.createdAt) ?? 0;
}

export function sortDecksByRecency<T extends DeckDates>(decks: T[]): T[] {
  return [...decks].sort(
    (first, second) => getDeckRecency(second) - getDeckRecency(first),
  );
}

// Thumbnails render from the first slide only; a slide beyond this size is
// reported as too large instead of inflating every gallery page.
export const MAX_PREVIEW_SLIDE_CHARS = 128 * 1024;

/**
 * What a deck list row shows without reading `decks.data`. `slideCount` is
 * never null once these are written, so a null `slide_count` marks a row
 * saved before the columns existed.
 */
export interface DeckListColumns {
  previewSlide: string | null;
  previewTooLarge: boolean;
  aspectRatio: string | null;
  slideCount: number;
}

export function deckListColumns(deck: unknown): DeckListColumns {
  const record =
    deck && typeof deck === "object" && !Array.isArray(deck)
      ? (deck as { slides?: unknown; aspectRatio?: unknown })
      : {};
  const slides = Array.isArray(record.slides) ? record.slides : [];
  const firstSlide = slides.length > 0 ? JSON.stringify(slides[0]) : null;
  const previewTooLarge =
    firstSlide !== null && firstSlide.length > MAX_PREVIEW_SLIDE_CHARS;
  return {
    previewSlide: previewTooLarge ? null : firstSlide,
    previewTooLarge,
    aspectRatio:
      typeof record.aspectRatio === "string" ? record.aspectRatio : null,
    slideCount: slides.length,
  };
}

/**
 * Every write of `decks.data` goes through this so the list columns can never
 * describe a different body than the one stored beside them.
 */
export function deckDataColumns(
  deck: unknown,
): { data: string } & DeckListColumns {
  return { data: JSON.stringify(deck), ...deckListColumns(deck) };
}

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Deck } from "@/context/DeckContext";

// One page is one preview request; matches DECK_PREVIEW_BATCH_SIZE.
export const DECK_GRID_PAGE_SIZE = 24;

/**
 * The home grid shows decks a page at a time and loads the next page as its
 * end scrolls near. Only shown cards ask for previews, one bounded request per
 * page, so a large library never renders or downloads every thumbnail.
 * `resetKey` (the filter and search) starts again from the first page.
 */
export function useDeckGridPaging(
  decks: readonly Deck[],
  resetKey: string,
  loadDeckPreviews: (ids: readonly string[]) => Promise<void>,
) {
  const [pageCount, setPageCount] = useState(1);
  useEffect(() => setPageCount(1), [resetKey]);

  const observable = typeof IntersectionObserver !== "undefined";
  const shownDecks = useMemo(
    () =>
      observable ? decks.slice(0, pageCount * DECK_GRID_PAGE_SIZE) : decks,
    [decks, observable, pageCount],
  );
  const hasMore = shownDecks.length < decks.length;

  // A changed deck's updatedAt changes this key, so its preview reloads.
  // `loadDeckPreviews` skips decks it already holds in full or has answered.
  const previewKey = shownDecks
    .map((deck) => `${deck.id}@${deck.updatedAt}`)
    .join("|");
  useEffect(() => {
    if (!previewKey) return;
    const ids = previewKey
      .split("|")
      .map((entry) => entry.slice(0, entry.lastIndexOf("@")));
    for (let start = 0; start < ids.length; start += DECK_GRID_PAGE_SIZE) {
      void loadDeckPreviews(ids.slice(start, start + DECK_GRID_PAGE_SIZE));
    }
  }, [loadDeckPreviews, previewKey]);

  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    setSentinel(node);
  }, []);
  useEffect(() => {
    if (!sentinel || !hasMore || !observable) return;
    // Re-created per page, so a sentinel still in view after a page lands
    // reports again and loads the next one.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPageCount((count) => count + 1);
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, observable, pageCount, sentinel]);

  return { shownDecks, hasMore, sentinelRef };
}

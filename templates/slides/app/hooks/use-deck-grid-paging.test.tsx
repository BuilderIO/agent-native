// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Deck } from "@/context/DeckContext";

import { DECK_GRID_PAGE_SIZE, useDeckGridPaging } from "./use-deck-grid-paging";

function listRow(index: number): Deck {
  return {
    id: `deck-${index}`,
    title: `Deck ${index}`,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    slides: [],
  };
}

let reportIntersection: (isIntersecting: boolean) => void = () => {};

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        reportIntersection = (isIntersecting) =>
          callback(
            [{ isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDeckGridPaging", () => {
  const decks = Array.from({ length: 30 }, (_, index) => listRow(index));

  it("shows one page, asks for that page's previews, and loads the next page near the end", () => {
    const loadDeckPreviews = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useDeckGridPaging(decks, "all", loadDeckPreviews),
    );

    expect(result.current.shownDecks).toHaveLength(DECK_GRID_PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);
    expect(loadDeckPreviews).toHaveBeenCalledTimes(1);
    expect(loadDeckPreviews).toHaveBeenLastCalledWith(
      decks.slice(0, DECK_GRID_PAGE_SIZE).map((deck) => deck.id),
    );

    act(() => {
      result.current.sentinelRef(document.createElement("div"));
    });
    act(() => reportIntersection(true));

    expect(result.current.shownDecks).toHaveLength(decks.length);
    expect(result.current.hasMore).toBe(false);
    expect(loadDeckPreviews).toHaveBeenLastCalledWith(
      decks.slice(DECK_GRID_PAGE_SIZE).map((deck) => deck.id),
    );
  });

  it("starts over from the first page when the filter or search changes", () => {
    const loadDeckPreviews = vi.fn(async () => {});
    const { result, rerender } = renderHook(
      ({ resetKey }) => useDeckGridPaging(decks, resetKey, loadDeckPreviews),
      { initialProps: { resetKey: "all" } },
    );
    act(() => {
      result.current.sentinelRef(document.createElement("div"));
    });
    act(() => reportIntersection(true));
    expect(result.current.shownDecks).toHaveLength(decks.length);

    rerender({ resetKey: "mine" });

    expect(result.current.shownDecks).toHaveLength(DECK_GRID_PAGE_SIZE);
  });
});

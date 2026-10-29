// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import {
  changedDeckIds,
  deckIdFromPathname,
  fetchDecksForCurrentRoute,
  getDuplicateSourceSlides,
  hasUncommittedDeckChanges,
  includeOpenDeckIfMissing,
  shareUnchangedSlides,
  type Deck,
} from "./DeckContext";

function deck(id: string): Deck {
  return {
    id,
    title: id,
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    slides: [],
  };
}

describe("DeckContext route hydration helpers", () => {
  it("extracts the opened deck id from editor and present routes", () => {
    expect(deckIdFromPathname("/deck/deck-1")).toBe("deck-1");
    expect(deckIdFromPathname("/deck/deck-1/present")).toBe("deck-1");
    expect(deckIdFromPathname("/slides/deck/deck%202")).toBe("deck 2");
    expect(deckIdFromPathname("/")).toBeNull();
  });

  it("fetches the directly opened deck when the initial list is missing it", async () => {
    const fetchById = vi.fn(async (id: string) => deck(id));

    await expect(
      includeOpenDeckIfMissing([deck("deck-owned")], "deck-shared", fetchById),
    ).resolves.toEqual([deck("deck-owned"), deck("deck-shared")]);
    expect(fetchById).toHaveBeenCalledWith("deck-shared");
  });

  it("does not refetch when the opened deck is already in the initial list", async () => {
    const fetchById = vi.fn(async (id: string) => deck(id));

    await expect(
      includeOpenDeckIfMissing([deck("deck-owned")], "deck-owned", fetchById),
    ).resolves.toEqual([deck("deck-owned")]);
    expect(fetchById).not.toHaveBeenCalled();
  });

  it("reports only decks whose snapshot changed", () => {
    const before = [deck("a"), deck("b")];
    const after = [deck("a"), { ...deck("b"), title: "Updated" }, deck("c")];

    expect(changedDeckIds(before, after)).toEqual(["b", "c"]);
  });

  it("uses a preview slide while hydrating a listing deck for duplication", () => {
    const preview = {
      id: "preview-slide",
      content: "<h1>Preview</h1>",
      notes: "",
      layout: "title" as const,
    };

    expect(
      getDuplicateSourceSlides({
        ...deck("preview-only"),
        previewSlide: preview,
      }),
    ).toEqual([preview]);
  });

  it("treats dirty decks as uncommitted before the debounced save is registered", () => {
    expect(hasUncommittedDeckChanges("dirty", new Set(["dirty"]))).toBe(true);
    expect(hasUncommittedDeckChanges("clean", new Set(["dirty"]))).toBe(false);
  });
});

describe("remote deck updates", () => {
  const withSlides = (contents: string[]): Deck => ({
    ...deck("deck-1"),
    slides: contents.map((content, index) => ({
      id: `slide-${index + 1}`,
      content,
      notes: "",
      layout: "content",
    })),
  });

  it("keeps the client's slide objects for every slide the server did not change", () => {
    const client = withSlides(["<p>A</p>", "<p>B</p>", "<p>C</p>"]);
    const server = withSlides(["<p>A</p>", "<p>B, edited</p>", "<p>C</p>"]);

    const shared = shareUnchangedSlides(client, server);

    expect(shared.slides[0]).toBe(client.slides[0]);
    expect(shared.slides[1]).toBe(server.slides[1]);
    expect(shared.slides[2]).toBe(client.slides[2]);
  });

  it("keeps the client's slide array when nothing changed, so nothing re-renders", () => {
    const client = withSlides(["<p>A</p>", "<p>B</p>"]);
    const server = {
      ...withSlides(["<p>A</p>", "<p>B</p>"]),
      updatedAt: "2026-05-13T00:00:00.000Z",
    };

    const shared = shareUnchangedSlides(client, server);

    expect(shared.slides).toBe(client.slides);
    expect(shared.updatedAt).toBe(server.updatedAt);
  });

  it("takes the server order when slides moved", () => {
    const client = withSlides(["<p>A</p>", "<p>B</p>"]);
    const server = { ...client, slides: [...client.slides].reverse() };

    const shared = shareUnchangedSlides(client, server);

    expect(shared.slides).not.toBe(client.slides);
    expect(shared.slides.map((slide) => slide.id)).toEqual([
      "slide-2",
      "slide-1",
    ]);
  });
});

describe("route baseline", () => {
  it("renders the open deck from its own read without waiting on the list", async () => {
    window.history.pushState({}, "", "/deck/deck-open");
    const readList = vi.fn(async () => ({
      status: "ok" as const,
      decks: [deck("deck-other")],
    }));

    await expect(
      fetchDecksForCurrentRoute(
        undefined,
        async (id) => ({ status: "ok", deck: deck(id) }),
        readList,
      ),
    ).resolves.toEqual({ decks: [deck("deck-open")], listPending: true });
    expect(readList).not.toHaveBeenCalled();
  });

  it("falls back to the list when the open deck cannot be read", async () => {
    window.history.pushState({}, "", "/deck/deck-gone");

    await expect(
      fetchDecksForCurrentRoute(
        undefined,
        async () => ({ status: "not-found", error: new Error("gone") }),
        async () => ({ status: "ok", decks: [deck("deck-other")] }),
      ),
    ).resolves.toEqual({ decks: [deck("deck-other")], listPending: false });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  deckIdFromPathname,
  includeOpenDeckIfMissing,
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
});

import { describe, expect, it } from "vitest";

import { getDeckRecency, sortDecksByRecency } from "./deck-sorting";

describe("sortDecksByRecency", () => {
  it("orders decks by updated time without mutating the input", () => {
    const decks = [
      {
        id: "older",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
      },
      {
        id: "newer",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
      },
    ];

    expect(sortDecksByRecency(decks).map((deck) => deck.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(decks.map((deck) => deck.id)).toEqual(["older", "newer"]);
  });

  it("falls back to created time when updated time is unavailable", () => {
    expect(
      getDeckRecency({
        createdAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "",
      }),
    ).toBe(Date.parse("2026-08-04T00:00:00.000Z"));
  });
});

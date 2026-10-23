import { describe, expect, it } from "vitest";

import { readRouteSlideSelection } from "./chat-route-selection";

describe("readRouteSlideSelection", () => {
  it("represents a deck-only chat link without a slide target", () => {
    expect(readRouteSlideSelection("", "deck-1")).toEqual({
      deckId: "deck-1",
      items: [],
    });
  });

  it("restores the slide target supplied by a result-card link", () => {
    expect(
      readRouteSlideSelection("?slideId=slide-2&slideNumber=2", "deck-1"),
    ).toEqual({
      deckId: "deck-1",
      slideId: "slide-2",
      slideNumber: 2,
      items: [],
    });
  });

  it("keeps malformed slide targets scoped to the deck", () => {
    expect(
      readRouteSlideSelection("?slideId=%20&slideNumber=0", "deck-1"),
    ).toEqual({ deckId: "deck-1", items: [] });
    expect(
      readRouteSlideSelection(`?slideId=${"x".repeat(201)}`, "deck-1"),
    ).toEqual({ deckId: "deck-1", items: [] });
  });

  it("does not invent a deck scope when the route has no deck id", () => {
    expect(readRouteSlideSelection("?slideId=slide-2", null)).toBeNull();
  });
});

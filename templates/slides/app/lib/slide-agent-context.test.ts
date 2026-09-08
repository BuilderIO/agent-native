import { describe, expect, it } from "vitest";

import { hasCurrentSlideSelection } from "./slide-agent-context";

describe("hasCurrentSlideSelection", () => {
  it("only treats non-empty selection state from the active deck as current", () => {
    expect(
      hasCurrentSlideSelection(
        { deckId: "deck-1", slideId: "slide-1", items: [{}] },
        "deck-1",
      ),
    ).toBe(true);
    expect(
      hasCurrentSlideSelection(
        { deckId: "deck-2", slideId: "slide-1", items: [{}] },
        "deck-1",
      ),
    ).toBe(false);
    expect(
      hasCurrentSlideSelection(
        { deckId: "deck-1", slideId: "slide-1", items: [] },
        "deck-1",
      ),
    ).toBe(false);
  });
});

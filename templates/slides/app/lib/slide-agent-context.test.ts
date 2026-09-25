import { describe, expect, it } from "vitest";

import {
  getSlidesAgentScopeLabel,
  hasCurrentSlideSelection,
} from "./slide-agent-context";

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

describe("getSlidesAgentScopeLabel", () => {
  it("labels the current slide by number and keeps selected targets distinct", () => {
    expect(
      getSlidesAgentScopeLabel(
        { deckId: "deck-1", slideId: "slide-5", slideNumber: 5, items: [] },
        "deck-1",
      ),
    ).toEqual({ key: "agent.slideNumber", number: 5 });
    expect(
      getSlidesAgentScopeLabel(
        {
          deckId: "deck-1",
          slideId: "slide-5",
          slideNumber: 5,
          items: [{}],
        },
        "deck-1",
      ),
    ).toEqual({ key: "agent.currentSelection" });
  });

  it("does not use a slide number from another deck or invalid state", () => {
    expect(
      getSlidesAgentScopeLabel(
        { deckId: "deck-2", slideId: "slide-5", slideNumber: 5 },
        "deck-1",
      ),
    ).toEqual({ key: "agent.thisSlide" });
    expect(
      getSlidesAgentScopeLabel({ deckId: "deck-1", slideNumber: 0 }, "deck-1"),
    ).toEqual({ key: "agent.thisSlide" });
  });
});

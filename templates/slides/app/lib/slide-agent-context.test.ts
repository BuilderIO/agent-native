import { describe, expect, it } from "vitest";

import {
  buildSlidesAgentContext,
  getSlidesAgentScopeLabel,
  haveSameSlidesAgentScope,
  hasCurrentSlideSelection,
  type SlidesAgentSelection,
} from "./slide-agent-context";

describe("haveSameSlidesAgentScope", () => {
  const initialSelection: SlidesAgentSelection = {
    deckId: "deck-1",
    slideId: "slide-1",
    slideNumber: 1,
    slideIndex: 0,
    selectionRevision: 1,
    items: [{ objectId: "text-1", textPreview: "first", color: "red" }],
  };

  it("ignores caret, text preview, style, and publication revision changes", () => {
    const nextSelection: SlidesAgentSelection = {
      ...initialSelection,
      slideIndex: 1,
      selectionRevision: 2,
      items: [{ objectId: "text-1", textPreview: "second", color: "blue" }],
    };

    expect(haveSameSlidesAgentScope(initialSelection, nextSelection)).toBe(
      true,
    );
    expect(
      buildSlidesAgentContext(initialSelection, "deck-1").contextVersion,
    ).toBe(buildSlidesAgentContext(nextSelection, "deck-1").contextVersion);
  });

  it("keeps selected target boundaries when ids contain separators", () => {
    const multipleTargets = {
      ...initialSelection,
      items: [{ objectId: "a" }, { objectId: "b" }],
    };
    const singleTarget = {
      ...initialSelection,
      items: [{ objectId: "a|b" }],
    };

    expect(haveSameSlidesAgentScope(multipleTargets, singleTarget)).toBe(false);
    expect(
      buildSlidesAgentContext(multipleTargets, "deck-1").contextVersion,
    ).not.toBe(buildSlidesAgentContext(singleTarget, "deck-1").contextVersion);
  });

  it.each([
    ["deck", { ...initialSelection, deckId: "deck-2" }],
    ["slide", { ...initialSelection, slideId: "slide-2" }],
    ["slide number", { ...initialSelection, slideNumber: 2 }],
    [
      "selected target",
      { ...initialSelection, items: [{ objectId: "text-2" }] },
    ],
    [
      "target order",
      {
        ...initialSelection,
        items: [{ objectId: "text-2" }, { objectId: "text-1" }],
      },
    ],
    ["selection removal", { ...initialSelection, items: [] }],
  ] satisfies Array<[string, SlidesAgentSelection]>)(
    "detects a semantic %s change",
    (_name, nextSelection) => {
      expect(haveSameSlidesAgentScope(initialSelection, nextSelection)).toBe(
        false,
      );
    },
  );
});

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
  it("labels selected targets with the current slide number", () => {
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
    ).toEqual({ key: "agent.slideNumber", number: 5 });
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

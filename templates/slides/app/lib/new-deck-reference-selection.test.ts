import { describe, expect, it } from "vitest";

import {
  findPromptReferenceDeckId,
  resolveNewDeckReferenceSelection,
  resolveRetryReferenceDeckSelection,
} from "./new-deck-reference-selection";

describe("findPromptReferenceDeckId", () => {
  it("matches a same-origin accessible deck and ignores its slide query", () => {
    expect(
      findPromptReferenceDeckId(
        "Use this style: (https://slides.example/deck/deck-picked?slide=7)",
        "https://slides.example",
        [{ id: "deck-picked" }],
      ),
    ).toBe("deck-picked");
  });

  it("ignores external and unknown deck URLs", () => {
    expect(
      findPromptReferenceDeckId(
        "https://other.example/deck/deck-picked https://slides.example/deck/not-loaded",
        "https://slides.example",
        [{ id: "deck-picked" }],
      ),
    ).toBeNull();
  });

  it("does not guess when the prompt links multiple accessible decks", () => {
    expect(
      findPromptReferenceDeckId(
        "https://slides.example/deck/first and https://slides.example/deck/second",
        "https://slides.example",
        [{ id: "first" }, { id: "second" }],
      ),
    ).toBeNull();
  });
});

describe("resolveNewDeckReferenceSelection", () => {
  it("uses defaults while the picker is still auto-managed", () => {
    expect(
      resolveNewDeckReferenceSelection({
        designSystemAuto: true,
        selectedDesignSystemId: null,
        defaultDesignSystemId: "ds-default",
        referenceDeckAuto: true,
        selectedReferenceDeckId: null,
        defaultReferenceDeckId: "deck-default",
      }),
    ).toEqual({
      designSystemId: "ds-default",
      referenceDeckId: "deck-default",
    });
  });

  it("lets explicit removals override the defaults", () => {
    expect(
      resolveNewDeckReferenceSelection({
        designSystemAuto: false,
        selectedDesignSystemId: null,
        defaultDesignSystemId: "ds-default",
        referenceDeckAuto: false,
        selectedReferenceDeckId: null,
        defaultReferenceDeckId: "deck-default",
      }),
    ).toEqual({
      designSystemId: null,
      referenceDeckId: null,
    });
  });

  it("keeps explicit picks even when defaults are present", () => {
    expect(
      resolveNewDeckReferenceSelection({
        designSystemAuto: false,
        selectedDesignSystemId: "ds-picked",
        defaultDesignSystemId: "ds-default",
        referenceDeckAuto: false,
        selectedReferenceDeckId: "deck-picked",
        defaultReferenceDeckId: "deck-default",
      }),
    ).toEqual({
      designSystemId: "ds-picked",
      referenceDeckId: "deck-picked",
    });
  });
});

describe("resolveRetryReferenceDeckSelection", () => {
  it("clears an automatic deck when an edited retry has no composer context or link", () => {
    expect(
      resolveRetryReferenceDeckSelection({
        carriedDeckMissing: false,
        hasComposerContext: false,
        hasExplicitComposerDeckReference: false,
        promptReferenceDeckId: null,
        reusingRetryInputs: false,
        retryReferenceDeckId: "previous-automatic-deck",
        retryReferenceDeckIdSource: "automatic",
      }),
    ).toEqual({
      referenceDeckId: null,
      referenceDeckIdSource: "automatic",
    });
  });

  it("marks a deck linked in an edited automatic retry as prompt-derived", () => {
    expect(
      resolveRetryReferenceDeckSelection({
        carriedDeckMissing: false,
        hasComposerContext: false,
        hasExplicitComposerDeckReference: false,
        promptReferenceDeckId: "prompt-deck",
        reusingRetryInputs: false,
        retryReferenceDeckId: "previous-automatic-deck",
        retryReferenceDeckIdSource: "automatic",
      }),
    ).toEqual({
      referenceDeckId: "prompt-deck",
      referenceDeckIdSource: "prompt",
    });
  });

  it("preserves an explicit deck selection when the prompt links another deck", () => {
    expect(
      resolveRetryReferenceDeckSelection({
        carriedDeckMissing: false,
        hasComposerContext: false,
        hasExplicitComposerDeckReference: false,
        promptReferenceDeckId: "prompt-deck",
        reusingRetryInputs: false,
        retryReferenceDeckId: "selected-deck",
        retryReferenceDeckIdSource: "selection",
      }),
    ).toEqual({
      referenceDeckId: "selected-deck",
      referenceDeckIdSource: "selection",
    });
  });
});

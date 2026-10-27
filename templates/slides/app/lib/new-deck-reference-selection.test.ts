import { describe, expect, it } from "vitest";

import {
  findPromptReferenceDeckId,
  getAutomaticReferenceDeckIdToRemove,
  resolveRetryReferenceDeckSelection,
  withoutAutomaticReferenceDeck,
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

describe("withoutAutomaticReferenceDeck", () => {
  it("removes legacy automatic deck state but keeps explicit references", () => {
    const selection = {
      referenceDeckId: "recent-deck",
      referenceDeckIdSource: "automatic" as const,
      composerContext: {
        designSystemId: null,
        references: [
          { source: "slides" as const, id: "recent-deck", title: "Recent" },
          { source: "slides" as const, id: "chosen-deck", title: "Chosen" },
          {
            source: "website" as const,
            id: "https://example.com",
            title: "Example",
            url: "https://example.com",
          },
        ],
      },
      contextItems: [
        {
          key: "slides:recent-deck:",
          title: "Recent",
          context: "",
          status: "ready" as const,
        },
        {
          key: "slides:chosen-deck:",
          title: "Chosen",
          context: "",
          status: "ready" as const,
        },
      ],
    };

    expect(withoutAutomaticReferenceDeck(selection)).toEqual({
      composerContext: {
        designSystemId: null,
        references: [
          { source: "slides", id: "chosen-deck", title: "Chosen" },
          {
            source: "website",
            id: "https://example.com",
            title: "Example",
            url: "https://example.com",
          },
        ],
      },
      contextItems: [
        {
          key: "slides:chosen-deck:",
          title: "Chosen",
          context: "",
          status: "ready",
        },
      ],
    });
  });

  it("clears empty automatic provenance without changing explicit state", () => {
    expect(
      withoutAutomaticReferenceDeck({
        referenceDeckId: null,
        referenceDeckIdSource: "automatic",
        designSystemId: "system-1",
      }),
    ).toEqual({ designSystemId: "system-1" });
  });

  it("keeps a selected deck when a stale automatic marker has the same id", () => {
    const composerContext = {
      designSystemId: null,
      references: [
        { source: "slides" as const, id: "selected", title: "Selected" },
      ],
    };
    const contextItems = [
      {
        key: "slides:selected:",
        title: "Selected",
        context: "Explicitly selected deck",
        status: "ready" as const,
      },
    ];

    expect(
      withoutAutomaticReferenceDeck({
        automaticReferenceDeckId: "selected",
        referenceDeckId: "selected",
        referenceDeckIdSource: "selection",
        composerContext,
        contextItems,
      }),
    ).toEqual({
      referenceDeckId: "selected",
      referenceDeckIdSource: "selection",
      composerContext,
      contextItems,
    });
  });

  it("uses selection provenance when the automatic id comes from the composer", () => {
    expect(
      getAutomaticReferenceDeckIdToRemove(
        {
          referenceDeckId: "selected",
          referenceDeckIdSource: "selection",
        },
        "selected",
      ),
    ).toBeNull();

    expect(
      getAutomaticReferenceDeckIdToRemove(
        { referenceDeckId: "selected" },
        "selected",
      ),
    ).toBeNull();
  });
});

describe("resolveRetryReferenceDeckSelection", () => {
  it("clears an automatic deck when an edited retry has no composer context or link", () => {
    expect(
      resolveRetryReferenceDeckSelection({
        automaticReferenceDeckRemovedFromComposer: false,
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
        automaticReferenceDeckRemovedFromComposer: false,
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
        automaticReferenceDeckRemovedFromComposer: false,
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

  it("clears an automatic deck removed from an unchanged retry composer", () => {
    expect(
      resolveRetryReferenceDeckSelection({
        automaticReferenceDeckRemovedFromComposer: true,
        carriedDeckMissing: false,
        hasComposerContext: true,
        hasExplicitComposerDeckReference: false,
        promptReferenceDeckId: null,
        reusingRetryInputs: true,
        retryReferenceDeckId: "previous-automatic-deck",
        retryReferenceDeckIdSource: "automatic",
      }),
    ).toEqual({
      referenceDeckId: null,
      referenceDeckIdSource: "automatic",
    });
  });

  it("keeps an automatic deck when its composer selection is unchanged", () => {
    expect(
      resolveRetryReferenceDeckSelection({
        automaticReferenceDeckRemovedFromComposer: false,
        carriedDeckMissing: false,
        hasComposerContext: true,
        hasExplicitComposerDeckReference: false,
        promptReferenceDeckId: null,
        reusingRetryInputs: true,
        retryReferenceDeckId: "previous-automatic-deck",
        retryReferenceDeckIdSource: "automatic",
      }),
    ).toEqual({
      referenceDeckId: "previous-automatic-deck",
      referenceDeckIdSource: "automatic",
    });
  });
});

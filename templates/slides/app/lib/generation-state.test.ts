import { describe, expect, it } from "vitest";

import {
  shouldClearNewDeckGeneratingState,
  shouldShowNewDeckGeneratingOverlay,
  shouldShowNewDeckGeneratingProgress,
  slideBeingFilledInPlace,
} from "./generation-state";

describe("new deck generation state", () => {
  it("shows the blocking overlay before and during the first slide", () => {
    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: true,
        isNewDeckCreation: true,
        slideCount: 0,
        generationStarted: true,
      }),
    ).toBe(true);

    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: true,
        isNewDeckCreation: true,
        slideCount: 1,
        generationStarted: true,
      }),
    ).toBe(false);

    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: false,
        isNewDeckCreation: true,
        slideCount: 0,
        generationStarted: true,
      }),
    ).toBe(false);

    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: false,
        isNewDeckCreation: true,
        slideCount: 0,
        generationStarted: false,
      }),
    ).toBe(true);
  });

  it("keeps creation intent until generation starts", () => {
    expect(
      shouldClearNewDeckGeneratingState({
        generating: false,
        generationStarted: false,
      }),
    ).toBe(false);
  });

  it("keeps progress visible after the first slide lands", () => {
    expect(
      shouldShowNewDeckGeneratingProgress({
        generating: true,
        isNewDeckCreation: true,
      }),
    ).toBe(true);

    expect(
      shouldClearNewDeckGeneratingState({
        generating: true,
        generationStarted: true,
      }),
    ).toBe(false);
  });

  it("names the placeholder the agent fills instead of adding a generating row", () => {
    const BLANK = "<blank>";
    const slides = [
      { id: "slide-1", content: "real content" },
      { id: "slide-2", content: BLANK },
      { id: "slide-3", content: "real content" },
    ];

    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: "slide-2",
        slides,
        blankContent: BLANK,
      }),
    ).toBe("slide-2");

    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: false,
        addSlideTargetId: "slide-2",
        slides,
        blankContent: BLANK,
      }),
    ).toBeNull();

    // Agent appends a net-new slide: no placeholder to light up.
    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: null,
        slides,
        blankContent: BLANK,
      }),
    ).toBeNull();

    // Placeholder deleted mid-run.
    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: "slide-2",
        slides: [
          { id: "slide-1", content: "real content" },
          { id: "slide-3", content: "real content" },
        ],
        blankContent: BLANK,
      }),
    ).toBeNull();

    // The agent has already written real content: the fill is done, so a
    // follow-up `add-slide` for the rest of a multi-slide request gets the
    // trailing generating row again instead of staying suppressed.
    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: "slide-1",
        slides,
        blankContent: BLANK,
      }),
    ).toBeNull();
  });

  it("clears new-deck generating state only when observed work finishes", () => {
    expect(
      shouldClearNewDeckGeneratingState({
        generating: false,
        generationStarted: true,
      }),
    ).toBe(true);

    expect(
      shouldClearNewDeckGeneratingState({
        generating: false,
        generationStarted: false,
      }),
    ).toBe(false);
  });
});

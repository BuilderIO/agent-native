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
    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: "slide-2",
        slideIds: ["slide-1", "slide-2", "slide-3"],
      }),
    ).toBe("slide-2");

    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: false,
        addSlideTargetId: "slide-2",
        slideIds: ["slide-1", "slide-2"],
      }),
    ).toBeNull();

    // Agent appends a net-new slide: no placeholder to light up.
    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: null,
        slideIds: ["slide-1"],
      }),
    ).toBeNull();

    // Placeholder deleted mid-run.
    expect(
      slideBeingFilledInPlace({
        addSlideGenerating: true,
        addSlideTargetId: "slide-2",
        slideIds: ["slide-1", "slide-3"],
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

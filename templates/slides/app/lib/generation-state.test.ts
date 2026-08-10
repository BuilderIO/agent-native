import { describe, expect, it } from "vitest";

import {
  shouldClearNewDeckGeneratingState,
  shouldShowNewDeckGeneratingOverlay,
  shouldShowNewDeckGeneratingProgress,
} from "./generation-state";

describe("new deck generation state", () => {
  it("shows the blocking overlay only while a fresh deck has no slides", () => {
    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: true,
        isNewDeckCreation: true,
        slideCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: true,
        isNewDeckCreation: true,
        slideCount: 1,
      }),
    ).toBe(false);

    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: false,
        isNewDeckCreation: true,
        slideCount: 0,
      }),
    ).toBe(false);
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

import { describe, expect, it } from "vitest";

import {
  shouldClearNewDeckGeneratingState,
  shouldShowNewDeckGeneratingOverlay,
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

  it("clears new-deck generating state when work finishes or a slide lands", () => {
    expect(
      shouldClearNewDeckGeneratingState({
        generating: true,
        slideCount: 0,
      }),
    ).toBe(false);

    expect(
      shouldClearNewDeckGeneratingState({
        generating: true,
        slideCount: 1,
      }),
    ).toBe(true);

    expect(
      shouldClearNewDeckGeneratingState({
        generating: false,
        slideCount: 0,
      }),
    ).toBe(true);
  });
});

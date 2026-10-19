import { describe, expect, it } from "vitest";

import {
  clampPresenterIndex,
  isOpenSlidePresenterMessage,
} from "./presenter-channel";

describe("OpenSlide presenter channel messages", () => {
  it("accepts valid projection state and navigation messages", () => {
    expect(
      isOpenSlidePresenterMessage({
        type: "state",
        state: {
          index: 2,
          total: 5,
          blackout: null,
          startedAt: 1_700_000_000_000,
        },
      }),
    ).toBe(true);
    expect(isOpenSlidePresenterMessage({ type: "request-state" })).toBe(true);
    expect(isOpenSlidePresenterMessage({ type: "goto", index: 3 })).toBe(true);
    expect(
      isOpenSlidePresenterMessage({ type: "switch-deck", deckId: "other" }),
    ).toBe(true);
    expect(isOpenSlidePresenterMessage({ type: "next" })).toBe(true);
    expect(isOpenSlidePresenterMessage({ type: "prev" })).toBe(true);
    expect(
      isOpenSlidePresenterMessage({ type: "toggle-blackout", mode: "white" }),
    ).toBe(true);
  });

  it("accepts step-aware state while remaining compatible with older state", () => {
    expect(
      isOpenSlidePresenterMessage({
        type: "state",
        state: {
          index: 2,
          total: 5,
          blackout: null,
          startedAt: 1_700_000_000_000,
          stepIndex: 1,
          stepCount: 3,
        },
      }),
    ).toBe(true);
    expect(
      isOpenSlidePresenterMessage({
        type: "state",
        state: {
          index: 2,
          total: 5,
          blackout: null,
          startedAt: 1_700_000_000_000,
          stepIndex: 0,
          stepCount: null,
        },
      }),
    ).toBe(true);
  });

  it("rejects malformed messages before they change presentation state", () => {
    expect(isOpenSlidePresenterMessage({ type: "goto", index: "3" })).toBe(
      false,
    );
    expect(
      isOpenSlidePresenterMessage({
        type: "state",
        state: { index: 1, total: 4, blackout: "purple", startedAt: 10 },
      }),
    ).toBe(false);
    expect(
      isOpenSlidePresenterMessage({
        type: "state",
        state: {
          index: 1,
          total: 4,
          blackout: null,
          startedAt: 10,
          stepIndex: 2,
          stepCount: 1,
        },
      }),
    ).toBe(false);
    expect(
      isOpenSlidePresenterMessage({
        type: "state",
        state: {
          index: 1,
          total: 4,
          blackout: null,
          startedAt: 10,
          stepIndex: 0,
        },
      }),
    ).toBe(false);
    expect(
      isOpenSlidePresenterMessage({
        type: "state",
        state: {
          index: 1,
          total: 4,
          blackout: null,
          startedAt: 10,
          stepIndex: 501,
          stepCount: null,
        },
      }),
    ).toBe(false);
    expect(
      isOpenSlidePresenterMessage({ type: "switch-deck", deckId: "  " }),
    ).toBe(false);
    expect(
      isOpenSlidePresenterMessage({
        type: "switch-deck",
        deckId: "x".repeat(513),
      }),
    ).toBe(false);
  });
});

describe("presenter slide index", () => {
  it("clamps navigation to the available slides", () => {
    expect(clampPresenterIndex(2, 5)).toBe(2);
    expect(clampPresenterIndex(9, 5)).toBe(4);
    expect(clampPresenterIndex(-1, 5)).toBe(0);
    expect(clampPresenterIndex(Number.NaN, 5)).toBe(0);
    expect(clampPresenterIndex(3, 0)).toBe(0);
  });
});

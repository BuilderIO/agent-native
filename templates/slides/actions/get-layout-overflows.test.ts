import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();
const mockReadAppStateForCurrentTab = vi.fn();
const mockWriteAppStateForCurrentTab = vi.fn();

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("./_tab-state.js", () => ({
  readAppStateForCurrentTab: (...args: unknown[]) =>
    mockReadAppStateForCurrentTab(...args),
  writeAppStateForCurrentTab: (...args: unknown[]) =>
    mockWriteAppStateForCurrentTab(...args),
}));

import { hashSlideContent } from "../shared/slide-fit";
import action from "./get-layout-overflows";

const slideAContent = "<p>A</p>";
const slideBContent = "<p>B</p>";

function measurement(content: string, verticalOverflow = 0) {
  return {
    contentHash: hashSlideContent(content),
    contentHeight: verticalOverflow > 0 ? 645 : 380,
    contentWidth: 740,
    viewportHeight: 420,
    viewportWidth: 740,
    verticalOverflow,
    horizontalOverflow: 0,
    measuredAt: 2000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAccess.mockResolvedValue({
    resource: {
      data: JSON.stringify({
        aspectRatio: "16:9",
        slides: [
          { id: "slide-a", content: slideAContent },
          { id: "slide-b", content: slideBContent },
        ],
      }),
    },
  });
});

describe("get-layout-overflows", () => {
  it("uses the current slide measurement when the deck aggregate says all slides fit", async () => {
    const deckFitState = {
      deckId: "deck-1",
      aspectRatio: "16:9",
      slides: {
        "slide-a": measurement(slideAContent),
        "slide-b": measurement(slideBContent),
      },
    };
    const currentSlideState = {
      ...measurement(slideAContent, 225),
      slideId: "slide-a",
      deckId: "deck-1",
    };
    mockReadAppStateForCurrentTab.mockImplementation(async (key: string) => {
      if (key === "deck-fit-checks") return deckFitState;
      if (key === "slide-fit-check") return currentSlideState;
      return null;
    });

    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({
      status: "measured",
      measuredSlideCount: 2,
      slideCount: 2,
      unknownSlideIds: [],
      canClaimDeckFits: false,
    });
    expect(result.overflows).toEqual([
      expect.objectContaining({
        slideId: "slide-a",
        slideNumber: 1,
        verticalOverflow: 225,
        horizontalOverflow: 0,
      }),
    ]);
    expect(mockReadAppStateForCurrentTab).toHaveBeenCalledWith(
      "deck-fit-checks",
      { fallbackToGlobal: false },
    );
    expect(mockReadAppStateForCurrentTab).toHaveBeenCalledWith(
      "slide-fit-check",
      { fallbackToGlobal: false },
    );
  });

  it("tells the agent to stop re-checking after repeated unresolved overflow", async () => {
    let history: { deckId: string; count: number; lastCheckAt: number } | null =
      null;
    const deckFitState = {
      deckId: "deck-1",
      aspectRatio: "16:9",
      slides: {
        "slide-a": measurement(slideAContent, 225),
        "slide-b": measurement(slideBContent),
      },
    };
    mockReadAppStateForCurrentTab.mockImplementation(async (key: string) => {
      if (key === "layout-overflow-check-history") return history;
      if (key === "deck-fit-checks") return deckFitState;
      return null;
    });
    mockWriteAppStateForCurrentTab.mockImplementation(
      async (_key: string, value: typeof history) => {
        history = value;
      },
    );

    let result;
    for (let i = 0; i < 3; i += 1) {
      result = await action.run({ deckId: "deck-1" });
    }

    expect(result).toMatchObject({
      status: "measured",
      canClaimDeckFits: false,
      guidance: expect.stringContaining("checked 3 times"),
    });
  });

  it("resets the repeat count once the deck fits", async () => {
    mockReadAppStateForCurrentTab.mockImplementation(async (key: string) => {
      if (key === "layout-overflow-check-history") {
        return { deckId: "deck-1", count: 5, lastCheckAt: Date.now() };
      }
      if (key === "deck-fit-checks") {
        return {
          deckId: "deck-1",
          aspectRatio: "16:9",
          slides: {
            "slide-a": measurement(slideAContent),
            "slide-b": measurement(slideBContent),
          },
        };
      }
      return null;
    });

    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({ canClaimDeckFits: true });
    expect(result.guidance).toBeUndefined();
    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith(
      "layout-overflow-check-history",
      { deckId: "deck-1", count: 0, lastCheckAt: expect.any(Number) },
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveAccess = vi.fn();
const mockReadAppStateForCurrentTab = vi.fn();

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mockResolveAccess(...args),
}));

vi.mock("./_tab-state.js", () => ({
  readAppStateForCurrentTab: (...args: unknown[]) =>
    mockReadAppStateForCurrentTab(...args),
}));

import { hashSlideContent } from "../shared/slide-fit";
import action from "./get-layout-overflows";

const slideAContent = "<p>A</p>";
const slideBContent = "<p>B</p>";

function measurement(
  content: string,
  verticalOverflow = 0,
  layoutFitRevision?: string,
) {
  return {
    contentHash: hashSlideContent(content),
    ...(layoutFitRevision ? { layoutFitRevision } : {}),
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
  it("is a read-only snapshot of current editor measurements", () => {
    expect(action.readOnly).toBe(true);
  });

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

  it("keeps stale measurements unknown while an async write is settling", async () => {
    mockReadAppStateForCurrentTab.mockImplementation(async (key: string) => {
      if (key === "deck-fit-checks") {
        return {
          deckId: "deck-1",
          aspectRatio: "16:9",
          slides: {
            "slide-a": measurement("<p>Old A</p>", 225),
            "slide-b": measurement(slideBContent),
          },
        };
      }
      return null;
    });

    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({
      status: "unknown",
      measuredSlideCount: 1,
      unknownSlideIds: ["slide-a"],
      unknownSlides: [{ slideId: "slide-a", slideNumber: 1 }],
      overflows: [],
      canClaimDeckFits: false,
      guidance: expect.stringContaining(
        "Rechecking in this turn will not change this result",
      ),
    });
  });

  it("keeps legacy FNV measurements unknown until the browser remeasures", async () => {
    mockReadAppStateForCurrentTab.mockImplementation(async (key: string) => {
      if (key === "deck-fit-checks") {
        return {
          deckId: "deck-1",
          aspectRatio: "16:9",
          slides: {
            "slide-a": {
              ...measurement(slideAContent),
              contentHash: "1ca88cd3",
            },
            "slide-b": measurement(slideBContent),
          },
        };
      }
      return null;
    });

    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({
      status: "unknown",
      measuredSlideCount: 1,
      slideCount: 2,
      unknownSlideIds: ["slide-a"],
      unknownSlides: [{ slideId: "slide-a", slideNumber: 1 }],
      overflows: [],
      canClaimDeckFits: false,
    });
  });

  it("rejects a matching hash from an older persisted write", async () => {
    const currentRevision = "write-2";
    mockResolveAccess.mockResolvedValue({
      resource: {
        data: JSON.stringify({
          aspectRatio: "16:9",
          slides: [
            {
              id: "slide-a",
              content: slideAContent,
              layoutFitRevision: currentRevision,
            },
            { id: "slide-b", content: slideBContent },
          ],
        }),
      },
    });
    mockReadAppStateForCurrentTab.mockImplementation(async (key: string) => {
      if (key === "deck-fit-checks") {
        return {
          deckId: "deck-1",
          aspectRatio: "16:9",
          slides: {
            "slide-a": measurement(slideAContent, 225, "write-1"),
            "slide-b": measurement(slideBContent),
          },
        };
      }
      return null;
    });

    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({
      status: "unknown",
      measuredSlideCount: 1,
      unknownSlideIds: ["slide-a"],
      unknownSlides: [{ slideId: "slide-a", slideNumber: 1 }],
      overflows: [],
      canClaimDeckFits: false,
    });
  });

  it("names unmeasured slide numbers and IDs without persisting poll counts", async () => {
    mockReadAppStateForCurrentTab.mockImplementation(async (key: string) => {
      return null;
    });
    const result = await action.run({ deckId: "deck-1" });

    expect(result).toMatchObject({
      status: "unknown",
      canClaimDeckFits: false,
      unknownSlides: [
        { slideId: "slide-a", slideNumber: 1 },
        { slideId: "slide-b", slideNumber: 2 },
      ],
      guidance: expect.stringContaining("Slides 1 (slide-a), 2 (slide-b)"),
    });
    expect(mockReadAppStateForCurrentTab).toHaveBeenCalledTimes(2);
  });

  it("gives a dimension-specific repair hint for every measured overflow", async () => {
    const currentSlideState = {
      ...measurement(slideAContent, 40),
      contentWidth: 752,
      horizontalOverflow: 12,
      slideId: "slide-a",
      deckId: "deck-1",
    };
    mockReadAppStateForCurrentTab.mockImplementation(async (key: string) => {
      if (key === "slide-fit-check") return currentSlideState;
      if (key === "deck-fit-checks") {
        return {
          deckId: "deck-1",
          aspectRatio: "16:9",
          slides: { "slide-b": measurement(slideBContent) },
        };
      }
      return null;
    });

    const result = await action.run({ deckId: "deck-1" });

    expect(result.overflows).toEqual([
      expect.objectContaining({
        slideId: "slide-a",
        slideNumber: 1,
        verticalOverflow: 40,
        horizontalOverflow: 12,
        hint: expect.stringContaining(
          "Reduce vertical content by at least 40 px",
        ),
      }),
    ]);
    expect(result.overflows[0].hint).toContain(
      "Reduce horizontal content by at least 12 px",
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAppState = vi.fn();

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
}));

import { awaitLayoutFitCheck, formatOverflowForTool } from "./_await-fit-check";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("awaitLayoutFitCheck", () => {
  it("returns { status: 'overflows' } when the editor reports vertical overflow for the slide", async () => {
    const since = 1000;
    mockReadAppState.mockResolvedValueOnce({
      slideId: "slide-A",
      contentHeight: 645,
      viewportHeight: 420,
      verticalOverflow: 225,
      measuredAt: 1500,
    });

    const result = await awaitLayoutFitCheck("slide-A", since, 2000);

    expect(result.status).toBe("overflows");
    if (result.status === "overflows") {
      expect(result.measurement.verticalOverflow).toBe(225);
      expect(result.measurement.slideId).toBe("slide-A");
    }
  });

  it("returns { status: 'fits' } when the editor reports zero overflow", async () => {
    mockReadAppState.mockResolvedValueOnce({
      slideId: "slide-A",
      contentHeight: 380,
      viewportHeight: 420,
      verticalOverflow: 0,
      measuredAt: 1500,
    });

    const result = await awaitLayoutFitCheck("slide-A", 1000, 2000);

    expect(result.status).toBe("fits");
    if (result.status === "fits") {
      expect(result.measurement.verticalOverflow).toBe(0);
    }
  });

  it("ignores measurements from a different slide and times out cleanly", async () => {
    mockReadAppState.mockResolvedValue({
      slideId: "DIFFERENT-slide",
      contentHeight: 500,
      viewportHeight: 420,
      verticalOverflow: 80,
      measuredAt: 1500,
    });

    const result = await awaitLayoutFitCheck("slide-A", 1000, 500);

    expect(result.status).toBe("timeout");
  });

  it("ignores stale measurements (measuredAt < since) and times out cleanly", async () => {
    mockReadAppState.mockResolvedValue({
      slideId: "slide-A",
      contentHeight: 645,
      viewportHeight: 420,
      verticalOverflow: 225,
      measuredAt: 500, // before `since`
    });

    const result = await awaitLayoutFitCheck("slide-A", 1000, 500);

    expect(result.status).toBe("timeout");
  });

  it("returns timeout (not error) when readAppState throws (no auth context)", async () => {
    mockReadAppState.mockRejectedValue(
      new Error(
        "Application state access requires an authenticated request context",
      ),
    );

    const result = await awaitLayoutFitCheck("slide-A", 1000, 500);

    expect(result.status).toBe("timeout");
  });

  it("returns timeout cleanly when readAppState always returns null (no editor open)", async () => {
    mockReadAppState.mockResolvedValue(null);

    const result = await awaitLayoutFitCheck("slide-A", 1000, 500);

    expect(result.status).toBe("timeout");
  });

  it("waits for the right measurement to arrive across multiple polls", async () => {
    // First poll: stale measurement for a different slide
    // Second poll: the measurement we want
    mockReadAppState
      .mockResolvedValueOnce({
        slideId: "other-slide",
        contentHeight: 500,
        viewportHeight: 420,
        verticalOverflow: 80,
        measuredAt: 1500,
      })
      .mockResolvedValueOnce({
        slideId: "slide-A",
        contentHeight: 645,
        viewportHeight: 420,
        verticalOverflow: 225,
        measuredAt: 1600,
      });

    const result = await awaitLayoutFitCheck("slide-A", 1000, 2000);

    expect(result.status).toBe("overflows");
    expect(mockReadAppState).toHaveBeenCalledTimes(2);
  });
});

describe("formatOverflowForTool", () => {
  it("produces a message with the slide id, overflow numbers, and the prioritized fix list", () => {
    const msg = formatOverflowForTool("deck-X", {
      slideId: "slide-Y",
      contentHeight: 645,
      viewportHeight: 420,
      verticalOverflow: 225,
      measuredAt: Date.now(),
    });

    expect(msg).toMatch(/Layout overflows/);
    expect(msg).toContain("225");
    expect(msg).toContain("645");
    expect(msg).toContain("420");
    expect(msg).toContain("slide-Y");
    expect(msg).toContain("deck-X");
    expect(msg).toMatch(/update-slide --deckId/);
    expect(msg).toMatch(/Tighten copy/);
    expect(msg).toMatch(/Reduce vertical density/);
    expect(msg).toMatch(/transform: scale/);
  });
});

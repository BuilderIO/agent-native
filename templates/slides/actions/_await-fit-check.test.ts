import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAppState = vi.fn();
let mockRunContext: { browserTabId?: string } | undefined;

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mockReadAppState(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: () => mockRunContext,
}));

import { awaitLayoutFitCheck, formatOverflowForTool } from "./_await-fit-check";

beforeEach(() => {
  vi.clearAllMocks();
  mockRunContext = undefined;
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

  it("returns { status: 'overflows' } when only horizontal overflow is reported", async () => {
    mockReadAppState.mockResolvedValueOnce({
      slideId: "slide-A",
      contentHeight: 420,
      contentWidth: 1200,
      viewportHeight: 420,
      viewportWidth: 740,
      verticalOverflow: 0,
      horizontalOverflow: 460,
      measuredAt: 1500,
    });

    const result = await awaitLayoutFitCheck("slide-A", 1000, 2000);

    expect(result.status).toBe("overflows");
    if (result.status === "overflows") {
      expect(result.measurement.horizontalOverflow).toBe(460);
    }
  });

  it("reads the tab-scoped measurement when the action came from a browser tab", async () => {
    mockRunContext = { browserTabId: "slides-tab-a" };
    mockReadAppState.mockImplementation(async (key) => {
      if (key === "slide-fit-check:slides-tab-a") {
        return {
          slideId: "slide-A",
          contentHeight: 380,
          viewportHeight: 420,
          verticalOverflow: 0,
          measuredAt: 1500,
        };
      }
      return null;
    });

    const result = await awaitLayoutFitCheck("slide-A", 1000, 2000);

    expect(result.status).toBe("fits");
    expect(mockReadAppState).toHaveBeenCalledWith(
      "slide-fit-check:slides-tab-a",
    );
    expect(mockReadAppState).not.toHaveBeenCalledWith("slide-fit-check");
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

  it("returns overflow for a wide main content box", async () => {
    mockReadAppState.mockResolvedValueOnce({
      slideId: "slide-A",
      contentHash: "new-html",
      contentWidth: 820,
      contentHeight: 380,
      viewportWidth: 740,
      viewportHeight: 420,
      horizontalOverflow: 80,
      verticalOverflow: 0,
      measuredAt: 1500,
    });

    const result = await awaitLayoutFitCheck("slide-A", 1000, 2000, "new-html");

    expect(result.status).toBe("overflows");
    if (result.status === "overflows") {
      expect(result.measurement.horizontalOverflow).toBe(80);
    }
  });

  it("ignores a fresh measurement for different HTML", async () => {
    mockReadAppState.mockResolvedValue({
      slideId: "slide-A",
      contentHash: "old-html",
      contentHeight: 380,
      viewportHeight: 420,
      verticalOverflow: 0,
      measuredAt: 1500,
    });

    const result = await awaitLayoutFitCheck("slide-A", 1000, 500, "new-html");

    expect(result.status).toBe("timeout");
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

  it("ignores non-finite measurements instead of treating them as fit results", async () => {
    mockReadAppState.mockResolvedValue({
      slideId: "slide-A",
      verticalOverflow: Number.NaN,
      contentHeight: 500,
      viewportHeight: 380,
      measuredAt: Number.NaN,
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

  it("describes horizontal overflow in the agent repair message", () => {
    const msg = formatOverflowForTool("deck-X", {
      slideId: "slide-Y",
      contentHeight: 420,
      contentWidth: 1200,
      viewportHeight: 420,
      viewportWidth: 740,
      verticalOverflow: 0,
      horizontalOverflow: 460,
      measuredAt: Date.now(),
    });

    expect(msg).toContain("horizontally by 460px");
    expect(msg).toContain("1200x420");
    expect(msg).toContain("740x420");
  });
});

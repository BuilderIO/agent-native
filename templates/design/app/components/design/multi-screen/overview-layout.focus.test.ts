import { describe, expect, it } from "vitest";

import {
  getFocusedLineupFillHeight,
  getFocusedLineupScale,
  resolveFocusedLineupScreenId,
} from "./overview-layout";

describe("resolveFocusedLineupScreenId", () => {
  const screenIds = ["a", "b", "c"];

  it("prefers the selected screen, then the requested one, then the active one", () => {
    expect(
      resolveFocusedLineupScreenId({
        screenIds,
        selectedScreenIds: ["c"],
        requestedScreenId: "b",
        activeScreenId: "a",
      }),
    ).toBe("c");
    expect(
      resolveFocusedLineupScreenId({
        screenIds,
        selectedScreenIds: [],
        requestedScreenId: "b",
        activeScreenId: "a",
      }),
    ).toBe("b");
    expect(
      resolveFocusedLineupScreenId({
        screenIds,
        selectedScreenIds: [],
        requestedScreenId: null,
        activeScreenId: "c",
      }),
    ).toBe("c");
  });

  it("falls back to the first screen when nothing named exists", () => {
    expect(
      resolveFocusedLineupScreenId({
        screenIds,
        selectedScreenIds: ["gone"],
        requestedScreenId: "also-gone",
        activeScreenId: undefined,
      }),
    ).toBe("a");
  });

  it("returns null with no screens", () => {
    expect(
      resolveFocusedLineupScreenId({
        screenIds: [],
        selectedScreenIds: ["a"],
        requestedScreenId: "a",
      }),
    ).toBeNull();
  });
});

describe("getFocusedLineupScale", () => {
  const minScale = 0.1;

  it.each([620, 1100])(
    "fits a 1440px desktop frame edge to edge in a %ipx pane",
    (paneWidth) => {
      expect(
        getFocusedLineupScale({
          frameWidth: 1440,
          availableWidth: paneWidth,
          minScale,
          maxScale: 1,
        }),
      ).toBeCloseTo(paneWidth / 1440, 6);
    },
  );

  it("never zooms past 100% display zoom, however wide the pane is", () => {
    expect(
      getFocusedLineupScale({
        frameWidth: 1440,
        availableWidth: 2200,
        minScale,
        maxScale: 1,
      }),
    ).toBe(1);
  });

  it("zooms a narrow frame in to fill the pane, but never past maxScale", () => {
    expect(
      getFocusedLineupScale({
        frameWidth: 320,
        availableWidth: 620,
        minScale,
        maxScale: 2,
      }),
    ).toBeCloseTo(620 / 320, 6);
    expect(
      getFocusedLineupScale({
        frameWidth: 320,
        availableWidth: 620,
        minScale,
        maxScale: 1,
      }),
    ).toBe(1);
  });

  it("does not collapse below minScale in a pane narrower than the frame can fit", () => {
    expect(
      getFocusedLineupScale({
        frameWidth: 1280,
        availableWidth: 10,
        minScale,
        maxScale: 1,
      }),
    ).toBe(minScale);
  });
});

describe("getFocusedLineupFillHeight", () => {
  const base = {
    frameWidth: 1440,
    availableWidth: 620,
    minScale: 0.1,
    maxScale: 1,
  };

  it("grows a short frame to the pane's viewport height at the fitted scale", () => {
    const height = getFocusedLineupFillHeight({
      ...base,
      frameHeight: 900,
      viewportHeight: 860,
    });
    // 860 / (620 / 1440) = 1997.4 canvas px, so the pane is filled to its edge.
    expect(height).toBe(1998);
    expect(height * (620 / 1440)).toBeGreaterThanOrEqual(860);
  });

  it("never shrinks a frame already taller than the pane", () => {
    expect(
      getFocusedLineupFillHeight({
        ...base,
        frameHeight: 4000,
        viewportHeight: 860,
      }),
    ).toBe(4000);
  });

  it("needs only the viewport height when the frame is shown at 100%", () => {
    expect(
      getFocusedLineupFillHeight({
        frameWidth: 390,
        frameHeight: 600,
        availableWidth: 390,
        viewportHeight: 860,
        minScale: 0.1,
        maxScale: 1,
      }),
    ).toBe(860);
  });
});

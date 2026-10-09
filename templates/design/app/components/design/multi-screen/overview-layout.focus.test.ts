import { describe, expect, it } from "vitest";

import {
  getFocusedLineupFitScale,
  getFocusedLineupFillHeight,
  getFocusedLineupScale,
  getWidgetFitPaddingPx,
  resolveFocusedLineupScreenId,
} from "./overview-layout";

describe("resolveFocusedLineupScreenId", () => {
  const screenIds = ["a", "b", "c"];

  it("prefers the requested screen, then selection, then active screen", () => {
    expect(
      resolveFocusedLineupScreenId({
        screenIds,
        selectedScreenIds: ["c"],
        requestedScreenId: "b",
        activeScreenId: "a",
      }),
    ).toBe("b");
    expect(
      resolveFocusedLineupScreenId({
        screenIds,
        selectedScreenIds: ["c"],
        requestedScreenId: null,
        activeScreenId: "a",
      }),
    ).toBe("c");
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

describe("getFocusedLineupFitScale", () => {
  it.each([
    [620, 860],
    [1100, 900],
  ])("fits a tall screen inside a %ipx by %ipx pane", (width, height) => {
    const scale = getFocusedLineupFitScale({
      frameWidth: 1440,
      frameHeight: 2560,
      availableWidth: width,
      availableHeight: height,
      minScale: 0.1,
      maxScale: 1,
    });

    expect(scale).toBeCloseTo(Math.min(width / 1440, height / 2560), 6);
    expect(1440 * scale).toBeLessThanOrEqual(width);
    expect(2560 * scale).toBeLessThanOrEqual(height);
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

describe("getWidgetFitPaddingPx", () => {
  it("caps the margin in a very large pane", () => {
    expect(getWidgetFitPaddingPx(2400, 2000)).toBe(96);
  });

  it("scales the margin down so a narrow pane keeps room for the artboard", () => {
    expect(getWidgetFitPaddingPx(1040, 800)).toBe(40);
    expect(getWidgetFitPaddingPx(360, 700)).toBe(18);
  });

  it("gives a larger pane at least as much room to fit into", () => {
    const room = (width: number, height: number) =>
      height - 2 * getWidgetFitPaddingPx(width, height);
    expect(room(1100, 900)).toBeGreaterThan(room(620, 860));
  });

  it("never drops below a visible margin", () => {
    expect(getWidgetFitPaddingPx(120, 90)).toBe(16);
  });
});

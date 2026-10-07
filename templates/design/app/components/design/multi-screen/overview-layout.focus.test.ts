import { describe, expect, it } from "vitest";

import {
  getFocusedLineupScale,
  getFocusedLineupTop,
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

  it("fits the frame to the pane width minus the side padding", () => {
    // A 1280px-wide frame in the 620px widget pane: (620 - 32) / 1280.
    expect(
      getFocusedLineupScale({
        frameWidth: 1280,
        availableWidth: 620,
        minScale,
        maxScale: 1,
      }),
    ).toBeCloseTo(588 / 1280, 6);
  });

  it("zooms a narrow frame in to fill the pane, but never past maxScale", () => {
    expect(
      getFocusedLineupScale({
        frameWidth: 320,
        availableWidth: 620,
        minScale,
        maxScale: 2,
      }),
    ).toBeCloseTo(588 / 320, 6);
    expect(
      getFocusedLineupScale({
        frameWidth: 320,
        availableWidth: 620,
        minScale,
        maxScale: 1,
      }),
    ).toBe(1);
  });

  it("does not collapse below minScale in a pane narrower than its padding", () => {
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

describe("getFocusedLineupTop", () => {
  it("centers a frame that fits the pane", () => {
    expect(
      getFocusedLineupTop({
        frameHeight: 400,
        scale: 1,
        viewportHeight: 860,
      }),
    ).toBe(230);
  });

  it("top-aligns below the floating controls when the frame is taller than the pane", () => {
    expect(
      getFocusedLineupTop({
        frameHeight: 2560,
        scale: 0.46,
        viewportHeight: 860,
      }),
    ).toBe(56);
  });
});

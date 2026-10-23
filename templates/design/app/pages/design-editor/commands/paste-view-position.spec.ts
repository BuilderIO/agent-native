import { describe, expect, it } from "vitest";

import {
  resolveScreenViewPastePositions,
  resolveViewPastePosition,
} from "./paste-view-position";

describe("resolveViewPastePosition", () => {
  it("lands a view-centered paste on whole pixels", () => {
    expect(
      resolveViewPastePosition({
        visibleRect: { x: 3000.25, y: 3000.5, width: 1000.5, height: 600 },
        frames: [
          { id: "home", geometry: { x: 0, y: 0, width: 390, height: 844 } },
        ],
        boardFileId: "board",
        sourceFileIds: ["home"],
        selectedFrameIds: ["home"],
        cascadeOffset: 0,
      }),
    ).toEqual({ fileId: "board", x: 3501, y: 3301 });
  });
});

describe("resolveScreenViewPastePositions", () => {
  it("centers copied screens on whole pixels", () => {
    expect(
      resolveScreenViewPastePositions({
        visibleRect: { x: 0.5, y: 0, width: 1001, height: 600 },
        sourceFrames: [{ x: 5000, y: 0, width: 390, height: 845 }],
        cascadeOffset: 0,
      }),
    ).toEqual([{ x: 306, y: -122 }]);
  });
});

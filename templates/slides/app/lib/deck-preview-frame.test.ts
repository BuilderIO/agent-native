import { describe, expect, it } from "vitest";

import { getDeckListingPreviewFrameStyle } from "./deck-preview-frame";

describe("deck listing preview frame", () => {
  it("fills the stable 16:9 listing frame for every supported deck ratio", () => {
    expect(getDeckListingPreviewFrameStyle("16:9")).toEqual({
      aspectRatio: "960 / 540",
      height: "100%",
      width: "100%",
    });

    for (const ratio of ["1:1", "9:16", "4:5"] as const) {
      expect(getDeckListingPreviewFrameStyle(ratio)).toMatchObject({
        height: "100%",
        width: "auto",
      });
    }
  });
});

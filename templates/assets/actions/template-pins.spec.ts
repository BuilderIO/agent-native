import { describe, expect, it } from "vitest";

import { templateHasPins } from "./_template-input.js";

describe("template pin detection", () => {
  it("does not treat portable canonical-logo composition as a pin", () => {
    expect(templateHasPins({ includeLogo: true })).toEqual([]);
  });

  it("identifies fixed reference images and skeleton specifications", () => {
    expect(
      templateHasPins({
        presetReferences: [{ id: "product", assetIds: ["asset-1", "asset-2"] }],
        skeletonSpec: { background: { type: "asset", assetId: "plate-1" } },
      }),
    ).toEqual(['reference "product"', "skeletonSpec"]);
  });

  it("allows variable entries with no asset ids to remain global", () => {
    expect(
      templateHasPins({
        presetReferences: [
          { id: "subject", variable: true, required: true, assetIds: [] },
        ],
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  getReviewPinPosition,
  getReviewPopoverBox,
  getReviewPopoverPlacement,
  isReviewPointVisible,
  placeReviewDraftPin,
  reviewRegionClipPath,
  type ReviewDraftPin,
  type ReviewVisibleRegion,
} from "./review-canvas-state";

const firstLocation = {
  id: "draft-1",
  anchor: { point: { xPct: 20, yPct: 30 } },
  metadata: { layerName: "Hero" },
};

describe("review canvas draft state", () => {
  it("creates one human-targeted draft at the clicked location", () => {
    expect(placeReviewDraftPin(null, firstLocation)).toEqual({
      ...firstLocation,
      draft: "",
      resolutionTarget: "human",
    });
  });

  it("moves an empty draft instead of accumulating empty pins", () => {
    const current = placeReviewDraftPin(null, firstLocation);
    const moved = placeReviewDraftPin(current, {
      id: "ignored-new-id",
      anchor: { point: { xPct: 70, yPct: 80 } },
      metadata: { layerName: "Footer" },
    });

    expect(moved.id).toBe(current.id);
    expect(moved.anchor).toEqual({ point: { xPct: 70, yPct: 80 } });
    expect(moved.metadata).toEqual({ layerName: "Footer" });
  });

  it("does not move or replace a draft after the reviewer starts typing", () => {
    const current: ReviewDraftPin = {
      ...placeReviewDraftPin(null, firstLocation),
      draft: "Keep this feedback",
      resolutionTarget: "agent",
    };

    expect(
      placeReviewDraftPin(current, {
        id: "draft-2",
        anchor: { point: { xPct: 80, yPct: 90 } },
        metadata: {},
      }),
    ).toBe(current);
  });

  it("opens popovers inward near the right and bottom canvas edges", () => {
    expect(getReviewPopoverPlacement({ xPct: 95, yPct: 90 })).toEqual({
      horizontal: "end",
      vertical: "above",
    });
    expect(getReviewPopoverPlacement({ xPct: 20, yPct: 30 })).toEqual({
      horizontal: "start",
      vertical: "below",
    });
  });

  it("uses the viewport position when the canvas point is transformed", () => {
    expect(
      getReviewPopoverPlacement(
        { xPct: 20, yPct: 30 },
        { x: 100, y: 851 },
        { width: 1440, height: 1000 },
      ),
    ).toEqual({
      horizontal: "start",
      vertical: "above",
    });
  });

  it("keeps the clicked position after associating a layer", () => {
    expect(
      getReviewPinPosition({
        nodeId: "hero-title",
        selector: "body > main > h1",
        point: { xPct: 18, yPct: 72 },
      }),
    ).toEqual({
      point: { xPct: 18, yPct: 72 },
      source: "node",
    });

    expect(
      getReviewPinPosition({
        selector: "body > main > section:nth-of-type(2)",
        point: { xPct: 81, yPct: 24 },
      }),
    ).toEqual({
      point: { xPct: 81, yPct: 24 },
      source: "selector",
    });
  });

  it("uses the source-relative point only for the matching screen", () => {
    const anchor = {
      point: { xPct: 18, yPct: 72 },
      screenId: "screen-1",
      screenPoint: { xPct: 61, yPct: 39 },
    };
    expect(getReviewPinPosition(anchor, "screen-1")?.point).toEqual(
      anchor.screenPoint,
    );
    expect(getReviewPinPosition(anchor, "screen-2")?.point).toEqual(
      anchor.point,
    );
    expect(getReviewPinPosition(anchor)?.point).toEqual(anchor.point);
  });
});

describe("review visible region", () => {
  const region: ReviewVisibleRegion = {
    left: 300,
    top: 48,
    width: 700,
    height: 600,
    bottomNotch: { left: 500, right: 800, top: 580 },
  };

  it("accepts points inside the region and rejects the chrome around it", () => {
    expect(isReviewPointVisible(region, { x: 600, y: 300 })).toBe(true);
    expect(isReviewPointVisible(region, { x: 120, y: 300 })).toBe(false);
    expect(isReviewPointVisible(region, { x: 600, y: 20 })).toBe(false);
    expect(isReviewPointVisible(region, { x: 1100, y: 300 })).toBe(false);
    expect(isReviewPointVisible(region, { x: 600, y: 700 })).toBe(false);
  });

  it("rejects points under the floating bottom toolbar only", () => {
    expect(isReviewPointVisible(region, { x: 650, y: 600 })).toBe(false);
    expect(isReviewPointVisible(region, { x: 400, y: 600 })).toBe(true);
    expect(isReviewPointVisible(region, { x: 650, y: 560 })).toBe(true);
  });

  it("clips to the region with the toolbar cut out of the bottom edge", () => {
    expect(reviewRegionClipPath({ ...region, bottomNotch: null })).toBe(
      "polygon(300px 48px, 1000px 48px, 1000px 648px, 300px 648px)",
    );
    expect(reviewRegionClipPath(region)).toBe(
      "polygon(300px 48px, 1000px 48px, 1000px 648px, 800px 648px, 800px 580px, 500px 580px, 500px 648px, 300px 648px)",
    );
  });

  it("keeps a popover inside the region whichever side it opens toward", () => {
    // Opening right of a pin near the right edge shifts it back inside.
    expect(getReviewPopoverBox(900, region, "start")).toEqual({
      left: 1000 - 8 - 320 - 900,
      width: 320,
    });
    // Opening left of a pin near the left edge shifts it back inside.
    expect(getReviewPopoverBox(320, region, "end")).toEqual({
      left: 300 + 8 - 320,
      width: 320,
    });
    expect(getReviewPopoverBox(500, region, "start")).toEqual({
      left: 12,
      width: 320,
    });
    expect(getReviewPopoverBox(800, region, "end")).toEqual({
      left: -12 - 320,
      width: 320,
    });
  });

  it("narrows a popover that cannot fit the region", () => {
    const narrow = { ...region, width: 200 };
    const box = getReviewPopoverBox(400, narrow, "start");
    expect(box.width).toBe(184);
    expect(400 + box.left).toBeGreaterThanOrEqual(narrow.left + 8);
    expect(400 + box.left + box.width).toBeLessThanOrEqual(
      narrow.left + narrow.width - 8,
    );
  });
});

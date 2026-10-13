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

  const below = { horizontal: "start", vertical: "below" } as const;
  const above = { horizontal: "start", vertical: "above" } as const;

  // Absolute rectangle the popover occupies once it is rendered at `height`.
  const occupied = (
    anchor: { x: number; y: number },
    box: ReturnType<typeof getReviewPopoverBox>,
    height: number,
  ) => {
    const top = anchor.y + box.top;
    return {
      left: anchor.x + box.left,
      right: anchor.x + box.left + box.width,
      top,
      bottom: top + Math.min(height, box.maxHeight),
    };
  };
  const overlapsNotch = (rect: ReturnType<typeof occupied>) => {
    const notch = region.bottomNotch!;
    return (
      rect.right > notch.left &&
      rect.left < notch.right &&
      rect.bottom > notch.top
    );
  };
  const insideRegion = (rect: ReturnType<typeof occupied>) =>
    rect.left >= region.left &&
    rect.right <= region.left + region.width &&
    rect.top >= region.top &&
    rect.bottom <= region.top + region.height;

  it("keeps a popover inside the region whichever side it opens toward", () => {
    // Opening right of a pin near the right edge shifts it back inside.
    expect(
      getReviewPopoverBox({ x: 900, y: 200 }, region, below, 100),
    ).toMatchObject({ left: 1000 - 8 - 320 - 900, width: 320 });
    // Opening left of a pin near the left edge shifts it back inside.
    expect(
      getReviewPopoverBox(
        { x: 320, y: 200 },
        region,
        { horizontal: "end", vertical: "below" },
        100,
      ),
    ).toMatchObject({ left: 300 + 8 - 320, width: 320 });
    expect(
      getReviewPopoverBox({ x: 400, y: 200 }, region, below, 100),
    ).toMatchObject({ left: 12, width: 320 });
    expect(
      getReviewPopoverBox(
        { x: 700, y: 200 },
        region,
        { horizontal: "end", vertical: "below" },
        100,
      ),
    ).toMatchObject({ left: -12 - 320, width: 320 });
  });

  it("narrows a popover that cannot fit the region", () => {
    const narrow = { ...region, width: 200 };
    const box = getReviewPopoverBox({ x: 400, y: 200 }, narrow, below, 100);
    expect(box.width).toBe(184);
    expect(400 + box.left).toBeGreaterThanOrEqual(narrow.left + 8);
    expect(400 + box.left + box.width).toBeLessThanOrEqual(
      narrow.left + narrow.width - 8,
    );
  });

  it("opens where it was asked to when the popover fits clear of the toolbar", () => {
    // 300px from y=204 ends at 504, above the toolbar's 580 minus its margin.
    expect(
      getReviewPopoverBox({ x: 400, y: 200 }, region, below, 300),
    ).toMatchObject({ ...below, left: 12, top: 4, width: 320 });

    // Far to the left of the toolbar, only the region limits the height.
    const wide = {
      ...region,
      left: 100,
      width: 900,
      bottomNotch: { left: 600, right: 800, top: 580 },
    };
    const anchor = { x: 200, y: 200 };
    expect(getReviewPopoverBox(anchor, wide, below, 300)).toEqual({
      ...below,
      left: 12,
      top: 4,
      width: 320,
      maxHeight: 640 - 204,
    });
    expect(getReviewPopoverBox(anchor, wide, above, 120)).toEqual({
      ...above,
      left: 12,
      top: 12 - 120,
      width: 320,
      maxHeight: 212 - 56,
    });
  });

  it("flips a below popover above when it would run into the toolbar cut-out", () => {
    // Below would span y 434..634: inside the region, but 54px into the
    // toolbar that starts at 580.
    const anchor = { x: 650, y: 430 };
    const box = getReviewPopoverBox(anchor, region, below, 200);

    expect(box.vertical).toBe("above");
    const rect = occupied(anchor, box, 200);
    expect(overlapsNotch(rect)).toBe(false);
    expect(insideRegion(rect)).toBe(true);
    expect(rect.bottom).toBe(442);
  });

  it("keeps an above popover for a pin just over the toolbar clear of it", () => {
    const anchor = { x: 650, y: 575 };
    const box = getReviewPopoverBox(anchor, region, above, 300);

    expect(box.vertical).toBe("above");
    const rect = occupied(anchor, box, 300);
    expect(overlapsNotch(rect)).toBe(false);
    expect(rect.bottom).toBe(580 - 8);
  });

  it("opens a popover beside the toolbar when only that side keeps it clear", () => {
    const wide = {
      ...region,
      left: 100,
      width: 900,
      bottomNotch: { left: 600, right: 800, top: 580 },
    };
    // Opening right runs over the toolbar and above has too little room, so
    // only opening below on the left keeps all 330px clear.
    const anchor = { x: 590, y: 300 };
    const box = getReviewPopoverBox(anchor, wide, below, 330);

    expect(box).toMatchObject({ horizontal: "end", vertical: "below" });
    const rect = occupied(anchor, box, 330);
    expect(rect.right).toBeLessThanOrEqual(wide.bottomNotch.left);
    expect(rect.bottom).toBe(634);
  });

  it("caps the height and scrolls when no side has room for the whole popover", () => {
    const short = {
      ...region,
      height: 300,
      bottomNotch: { left: 500, right: 800, top: 280 },
    };
    const anchor = { x: 650, y: 200 };
    const box = getReviewPopoverBox(anchor, short, below, 600);

    expect(box).toMatchObject({ vertical: "above", maxHeight: 156 });
    const rect = occupied(anchor, box, 600);
    expect(rect.top).toBe(56);
    expect(rect.bottom).toBe(212);
    expect(overlapsNotch({ ...rect })).toBe(false);
  });

  it("never places any part of a popover in the cut-out or outside the region", () => {
    const placements = [below, above];
    for (let x = 320; x <= 980; x += 60) {
      for (let y = 60; y <= 640; y += 40) {
        const anchor = { x, y };
        if (!isReviewPointVisible(region, anchor)) continue;
        for (const placement of placements) {
          for (const height of [80, 240, 420]) {
            const box = getReviewPopoverBox(anchor, region, placement, height);
            const rect = occupied(anchor, box, height);
            expect({
              anchor,
              placement,
              height,
              hit: overlapsNotch(rect),
            }).toEqual({
              anchor,
              placement,
              height,
              hit: false,
            });
            expect(insideRegion(rect)).toBe(true);
          }
        }
      }
    }
  });
});

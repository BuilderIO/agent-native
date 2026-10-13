import { describe, expect, it } from "vitest";

import {
  getReviewPinPosition,
  getReviewPopoverPlacement,
  placeReviewDraftPin,
  type ReviewDraftPin,
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

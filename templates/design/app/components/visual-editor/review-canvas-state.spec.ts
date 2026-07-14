import { describe, expect, it } from "vitest";

import {
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
});

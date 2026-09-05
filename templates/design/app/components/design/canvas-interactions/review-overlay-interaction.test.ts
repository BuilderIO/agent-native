// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { isCanvasOverlayInteractionTarget } from "./review-overlay-interaction";

describe("review overlay canvas interaction guard", () => {
  it("recognizes review chrome and its descendants", () => {
    const popover = document.createElement("div");
    popover.dataset.reviewPopover = "";
    const control = document.createElement("button");
    popover.append(control);

    const clickPlane = document.createElement("div");
    clickPlane.dataset.reviewClickPlane = "";

    expect(isCanvasOverlayInteractionTarget(control)).toBe(true);
    expect(isCanvasOverlayInteractionTarget(clickPlane)).toBe(true);
  });

  it("leaves ordinary canvas targets available to gestures", () => {
    expect(
      isCanvasOverlayInteractionTarget(document.createElement("div")),
    ).toBe(false);
    expect(isCanvasOverlayInteractionTarget(null)).toBe(false);
  });
});

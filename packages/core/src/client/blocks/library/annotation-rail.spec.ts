import { describe, expect, it } from "vitest";
import {
  resolveAnnotationInlineOverlayPosition,
  resolveAnnotationHoverCardPosition,
  type AnnotationAnchor,
} from "./annotation-rail.js";

const anchor: AnnotationAnchor = {
  codeLeft: 360,
  codeRight: 860,
  lineCenter: 200,
  lineBottom: 211,
};

describe("annotation hover card placement", () => {
  it("uses the right gutter when there is room", () => {
    expect(
      resolveAnnotationHoverCardPosition(
        anchor,
        { width: 280, height: 120 },
        { width: 1200, height: 600 },
      ),
    ).toEqual({ left: 872, top: 140 });
  });

  it("uses the left gutter when the right side overflows and the left fits", () => {
    expect(
      resolveAnnotationHoverCardPosition(
        anchor,
        { width: 280, height: 120 },
        { width: 900, height: 600 },
      ),
    ).toEqual({ left: 68, top: 140 });
  });

  it("falls below the line when neither side has a clean gutter", () => {
    expect(
      resolveAnnotationHoverCardPosition(
        { ...anchor, codeLeft: 100 },
        { width: 280, height: 120 },
        { width: 900, height: 600 },
      ),
    ).toEqual({ left: 100, top: 223 });
  });
});

describe("annotation inline overlay placement", () => {
  it("anchors to the row while staying inside the viewport", () => {
    expect(
      resolveAnnotationInlineOverlayPosition(
        { right: 860, top: 120, height: 22 },
        { width: 320, height: 120 },
        { width: 950, height: 700 },
      ),
    ).toEqual({ right: 90, top: 71 });
  });

  it("clamps horizontally when the row anchor is too far left", () => {
    expect(
      resolveAnnotationInlineOverlayPosition(
        { right: 100, top: 120, height: 22 },
        { width: 320, height: 120 },
        { width: 950, height: 700 },
      ),
    ).toEqual({ right: 622, top: 71 });
  });

  it("clamps vertically when the row anchor is near the viewport edge", () => {
    expect(
      resolveAnnotationInlineOverlayPosition(
        { right: 860, top: 5, height: 22 },
        { width: 320, height: 120 },
        { width: 950, height: 700 },
      ),
    ).toEqual({ right: 90, top: 8 });
  });
});

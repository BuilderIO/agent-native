import { describe, expect, it } from "vitest";
import {
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

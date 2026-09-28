import { describe, expect, it } from "vitest";

import {
  slideCommentAnchorAtPoint,
  slideCommentAnchorFromRange,
  slideCommentAnchorPosition,
} from "./slide-comment-anchor";

const slideRect = { left: 100, top: 50, width: 400, height: 200 };

describe("slide comment anchor geometry", () => {
  it("stores slide and object-relative percentages for a component point", () => {
    expect(
      slideCommentAnchorAtPoint({
        clientX: 250,
        clientY: 140,
        slideRect,
        objectId: "object-1",
        objectRect: { left: 200, top: 100, width: 100, height: 80 },
      }),
    ).toEqual({
      x: 37.5,
      y: 45,
      objectId: "object-1",
      objectX: 50,
      objectY: 50,
    });
  });

  it("keeps legacy slide coordinates when the anchored object is unavailable", () => {
    expect(
      slideCommentAnchorPosition({ x: 12, y: 18 }, slideRect, {
        left: 200,
        top: 100,
        width: 100,
        height: 80,
      }),
    ).toEqual({ x: 12, y: 18 });
    expect(
      slideCommentAnchorPosition(
        {
          x: 12,
          y: 18,
          objectId: "missing",
          objectX: 50,
          objectY: 50,
        },
        slideRect,
      ),
    ).toEqual({ x: 12, y: 18 });
  });

  it("converts a text-selection range center before persisting", () => {
    const range = {
      getBoundingClientRect: () => ({
        left: 200,
        top: 100,
        width: 100,
        height: 40,
      }),
    } as Pick<Range, "getBoundingClientRect">;

    expect(
      slideCommentAnchorFromRange({
        range,
        slideRect,
        objectId: "object-1",
        objectRect: { left: 200, top: 100, width: 100, height: 80 },
        targetText: "Revenue",
      }),
    ).toEqual({
      x: 37.5,
      y: 35,
      objectId: "object-1",
      objectX: 50,
      objectY: 25,
      targetText: "Revenue",
    });
  });

  it("recomputes an object marker from current rendered geometry", () => {
    expect(
      slideCommentAnchorPosition(
        {
          x: 10,
          y: 20,
          objectId: "object-1",
          objectX: 50,
          objectY: 50,
        },
        slideRect,
        { left: 300, top: 150, width: 120, height: 60 },
      ),
    ).toEqual({ x: 65, y: 65 });
  });
});

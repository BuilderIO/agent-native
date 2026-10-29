import { describe, expect, it } from "vitest";

import { parseSlideReviewAnchor, slideReviewAnchor } from "./slide-review.js";

describe("slide review anchors", () => {
  it("round-trips a slide, quoted text and an object-relative point", () => {
    const anchor = slideReviewAnchor({
      slideId: "slide-1",
      quotedText: "  Revenue  ",
      point: { x: 10, y: 20, objectId: "chart", objectX: 5, objectY: 6 },
    });

    expect(anchor).toEqual({
      kind: "slide",
      slideId: "slide-1",
      quotedText: "Revenue",
      point: { x: 10, y: 20, objectId: "chart", objectX: 5, objectY: 6 },
    });
    expect(parseSlideReviewAnchor(JSON.parse(JSON.stringify(anchor)))).toEqual(
      anchor,
    );
  });

  it("omits blank quoted text and a missing point", () => {
    expect(
      slideReviewAnchor({ slideId: "slide-1", quotedText: "  ", point: null }),
    ).toEqual({ kind: "slide", slideId: "slide-1" });
  });

  it.each([
    ["a board-level anchor", { kind: "board" }],
    ["an anchor without a slide", { kind: "slide", slideId: " " }],
    ["unknown fields", { kind: "slide", slideId: "s", extra: true }],
    ["a bad point", { kind: "slide", slideId: "s", point: { x: 140, y: 0 } }],
    ["no anchor", null],
  ])("reads %s as not a Slides anchor", (_label, value) => {
    expect(parseSlideReviewAnchor(value)).toBeNull();
  });
});

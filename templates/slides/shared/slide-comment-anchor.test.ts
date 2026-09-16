import { describe, expect, it } from "vitest";

import {
  parseSlideCommentAnchor,
  serializeSlideCommentAnchor,
  slideCommentAnchorSchema,
} from "./slide-comment-anchor.js";

describe("slide comment anchors", () => {
  it("preserves legacy slide-relative anchors", () => {
    const anchor = { x: 25, y: 60, targetText: "Title" };

    expect(parseSlideCommentAnchor(JSON.stringify(anchor))).toEqual(anchor);
  });

  it("preserves object identity and both coordinate spaces", () => {
    const anchor = {
      x: 42,
      y: 33,
      objectId: "shape-7",
      objectX: 50,
      objectY: 100,
      targetText: "Revenue",
    };

    expect(
      parseSlideCommentAnchor(serializeSlideCommentAnchor(anchor)),
    ).toEqual(anchor);
  });

  it("rejects partial or out-of-range object-relative anchors", () => {
    expect(() =>
      slideCommentAnchorSchema.parse({ x: 10, y: 10, objectId: "shape-7" }),
    ).toThrow();
    expect(() =>
      slideCommentAnchorSchema.parse({
        x: 10,
        y: 10,
        objectId: "shape-7",
        objectX: 101,
        objectY: 50,
      }),
    ).toThrow();
    expect(() =>
      slideCommentAnchorSchema.parse({
        x: 10,
        y: 10,
        objectX: 50,
        objectY: 50,
      }),
    ).toThrow();
  });

  it("rejects malformed persisted values instead of hiding them", () => {
    expect(() => parseSlideCommentAnchor("not-json")).toThrow();
    expect(parseSlideCommentAnchor(null)).toBeNull();
  });
});

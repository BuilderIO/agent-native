// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  slideCommentAnchorAtPoint,
  slideCommentAnchorFromRange,
  slideCommentAnchorPosition,
  slideCommentTextRange,
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

  it("persists text offsets so repeated phrases highlight the selected copy", () => {
    const object = document.createElement("div");
    object.innerHTML = "<span>Repeat</span> <strong>Repeat</strong>";
    const textNodes = document.createTreeWalker(object, NodeFilter.SHOW_TEXT);
    textNodes.nextNode();
    textNodes.nextNode();
    const selectedText = textNodes.nextNode() as Text;
    const selectedRange = document.createRange();
    selectedRange.setStart(selectedText, 0);
    selectedRange.setEnd(selectedText, selectedText.length);
    const range = {
      getBoundingClientRect: () => ({
        left: 200,
        top: 100,
        width: 60,
        height: 20,
      }),
      get startContainer() {
        return selectedRange.startContainer;
      },
      get startOffset() {
        return selectedRange.startOffset;
      },
      get endContainer() {
        return selectedRange.endContainer;
      },
      get endOffset() {
        return selectedRange.endOffset;
      },
      toString: () => selectedRange.toString(),
    } as Pick<
      Range,
      | "getBoundingClientRect"
      | "startContainer"
      | "startOffset"
      | "endContainer"
      | "endOffset"
      | "toString"
    >;
    const anchor = slideCommentAnchorFromRange({
      range,
      slideRect,
      objectId: "object-1",
      objectRect: { left: 200, top: 100, width: 100, height: 80 },
      objectElement: object,
      targetText: "Repeat",
    });

    expect(anchor).toMatchObject({ textStartOffset: 7, textEndOffset: 13 });
    const restored = slideCommentTextRange(object, anchor, "Repeat");
    expect(restored?.toString()).toBe("Repeat");
    expect(restored?.startContainer).toBe(selectedText);
  });

  it("does not guess which duplicate phrase an older anchor refers to", () => {
    const object = document.createElement("div");
    object.innerHTML = "<span>Repeat</span> <strong>Repeat</strong>";

    expect(
      slideCommentTextRange(
        object,
        {
          x: 50,
          y: 50,
          objectId: "object-1",
          objectX: 50,
          objectY: 50,
        },
        "Repeat",
      ),
    ).toBeNull();
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

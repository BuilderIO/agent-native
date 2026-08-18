import { describe, expect, it } from "vitest";

import { toSharedDeckSlide } from "./api";

describe("toSharedDeckSlide speaker notes", () => {
  it("preserves persisted speaker notes in the shared read model", () => {
    expect(
      toSharedDeckSlide(
        {
          id: "slide-1",
          content: '<div class="fmd-slide"><h1>Title</h1></div>',
          notes: "Explain the decision before advancing.",
        },
        0,
      ),
    ).toMatchObject({
      id: "slide-1",
      notes: "Explain the decision before advancing.",
    });
  });
});

describe("toSharedDeckSlide animation normalization", () => {
  it("does not turn an unsupported animation into a different motion", () => {
    const slide = toSharedDeckSlide(
      {
        id: "slide-1",
        content: '<div class="fmd-slide"><h1>Title</h1></div>',
        animations: [
          {
            id: "title-reveal",
            elementIndex: 0,
            elementPath: [0],
            type: "bounce",
          },
        ],
      },
      0,
    );

    expect(slide.animations).toBeUndefined();
    expect(slide.animationIssues).toEqual([
      { index: 0, id: "title-reveal", code: "unsupported-type" },
    ]);
  });

  it("preserves valid animations while reporting malformed siblings", () => {
    const slide = toSharedDeckSlide(
      {
        id: "slide-1",
        content: '<div class="fmd-slide"><h1>Title</h1></div>',
        animations: [
          {
            id: "title-reveal",
            elementIndex: 0,
            elementPath: [0],
            type: "fade",
          },
          {
            id: "broken-reveal",
            elementIndex: 0,
            elementPath: [],
            type: "fade",
          },
        ],
      },
      0,
    );

    expect(slide.animations).toHaveLength(1);
    expect(slide.animations?.[0]?.id).toBe("title-reveal");
    expect(slide.animationIssues).toEqual([
      { index: 1, id: "broken-reveal", code: "invalid-element-path" },
    ]);
  });
});

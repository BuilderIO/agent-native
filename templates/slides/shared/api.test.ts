import { describe, expect, it } from "vitest";

import { toSharedDeckSlide } from "./api";

describe("toSharedDeckSlide speaker notes", () => {
  it("redacts presenter notes by default", () => {
    expect(
      toSharedDeckSlide(
        {
          id: "slide-1",
          content: '<div class="fmd-slide"><h1>Title</h1></div>',
          notes: "Private presenter context.",
        },
        0,
      ).notes,
    ).toBe("");
  });

  it("preserves persisted speaker notes for an internal read", () => {
    expect(
      toSharedDeckSlide(
        {
          id: "slide-1",
          content: '<div class="fmd-slide"><h1>Title</h1></div>',
          notes: "Explain the decision before advancing.",
        },
        0,
        { includeNotes: true },
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

describe("toSharedDeckSlide transitions", () => {
  it.each([
    ["instant", "none"],
    ["slide", "slide-from-right"],
    ["zoom", "dissolve"],
    ["flip", "flip"],
  ])("exports %s as the canonical %s", (stored, canonical) => {
    expect(
      toSharedDeckSlide({ id: "slide-1", content: "", transition: stored }, 0)
        .transition,
    ).toBe(canonical);
  });

  it.each(["toString", "constructor", "bogus", 7, null])(
    "drops the non-transition value %j",
    (stored) => {
      expect(
        toSharedDeckSlide({ id: "slide-1", content: "", transition: stored }, 0)
          .transition,
      ).toBeUndefined();
    },
  );

  it("exports a valid integer transitionSpeed", () => {
    expect(
      toSharedDeckSlide(
        { id: "slide-1", content: "", transition: "fade", transitionSpeed: 30 },
        0,
      ).transitionSpeed,
    ).toBe(30);
  });

  it.each([50, -1, 2.5, "30", null])(
    "drops the invalid transitionSpeed %j",
    (transitionSpeed) => {
      expect(
        toSharedDeckSlide({ id: "slide-1", content: "", transitionSpeed }, 0)
          .transitionSpeed,
      ).toBeUndefined();
    },
  );
});

describe("toSharedDeckSlide reveal issues", () => {
  const titled = `<div class="fmd-slide"><h1>Title</h1><div class="text-box"><p>One</p><p>Two</p></div></div>`;

  it("does not resolve reveals itself, so an unresolved path adds no issue without revealIssues", () => {
    const slide = toSharedDeckSlide(
      {
        id: "slide-1",
        content: titled,
        animations: [
          { id: "gone", elementIndex: 0, elementPath: [5], type: "fade" },
        ],
      },
      0,
    );

    expect(slide.animations).toHaveLength(1);
    expect(slide.animationIssues).toBeUndefined();
  });

  it("merges revealIssues with structural issues in stored order", () => {
    const slide = toSharedDeckSlide(
      {
        id: "slide-1",
        content: titled,
        animations: [
          { id: "ok", elementIndex: 0, elementPath: [0], type: "fade" },
          { id: "gone", elementIndex: 0, elementPath: [9], type: "fade" },
          { id: "bad-type", elementIndex: 0, elementPath: [0], type: "bounce" },
        ],
      },
      0,
      { revealIssues: [{ index: 1, id: "gone", code: "stale-path" }] },
    );

    expect(slide.animations?.map((animation) => animation.id)).toEqual([
      "ok",
      "gone",
    ]);
    expect(slide.animationIssues).toEqual([
      { index: 1, id: "gone", code: "stale-path" },
      { index: 2, id: "bad-type", code: "unsupported-type" },
    ]);
  });
});

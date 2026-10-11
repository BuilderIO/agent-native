import { toSharedDeckSlide } from "@shared/api";
import { describe, expect, it } from "vitest";

import { slideRevealIssues } from "./slide-reveal-issues";

const titled = `<div class="fmd-slide"><h1>Title</h1><div class="text-box"><p>One</p><p>Two</p></div></div>`;

describe("slideRevealIssues", () => {
  it("records a reveal whose stored path no longer exists as stale-path", () => {
    expect(
      slideRevealIssues({
        id: "slide-1",
        content: titled,
        animations: [
          { id: "gone", elementIndex: 0, elementPath: [5], type: "fade" },
        ],
      }),
    ).toEqual([{ index: 0, id: "gone", code: "stale-path" }]);
  });

  it("records a legacy elementIndex reveal on a slide with no .fmd-slide as missing-element", () => {
    expect(
      slideRevealIssues({
        id: "slide-1",
        content: "<p>Loose text, no slide root</p>",
        animations: [{ id: "legacy", elementIndex: 0, type: "fade" }],
      }),
    ).toEqual([{ index: 0, id: "legacy", code: "missing-element" }]);
  });

  it("does not flag a by-paragraph reveal whose step is another reveal's element, since that reveal plays the step", () => {
    expect(
      slideRevealIssues({
        id: "slide-1",
        content: titled,
        animations: [
          { id: "one", elementIndex: 0, elementPath: [1, 0], type: "fade" },
          {
            id: "all",
            elementIndex: 0,
            elementPath: [1],
            byParagraph: true,
            type: "fade",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("names the stored entry, not its position among the kept reveals", () => {
    const slide = {
      id: "slide-1",
      content: titled,
      animations: [
        { id: "ok", elementIndex: 0, elementPath: [0], type: "fade" },
        { id: "bad-type", elementIndex: 0, elementPath: [0], type: "bounce" },
        { id: "gone", elementIndex: 0, elementPath: [9], type: "fade" },
      ],
    };

    // Structural rejects are the mapping's job; this helper reports only what
    // the resolver finds among the reveals that pass them.
    expect(slideRevealIssues(slide)).toEqual([
      { index: 2, id: "gone", code: "stale-path" },
    ]);
    expect(
      toSharedDeckSlide(slide, 0, { revealIssues: slideRevealIssues(slide) })
        .animationIssues,
    ).toEqual([
      { index: 1, id: "bad-type", code: "unsupported-type" },
      { index: 2, id: "gone", code: "stale-path" },
    ]);
  });

  it("returns no issues when every reveal resolves", () => {
    const slide = {
      id: "slide-1",
      content: titled,
      animations: [
        { id: "title", elementIndex: 0, elementPath: [0], type: "fade" },
        {
          id: "body",
          elementIndex: 0,
          elementPath: [1],
          byParagraph: true,
          type: "fade",
        },
      ],
    };

    expect(slideRevealIssues(slide)).toEqual([]);
    expect(
      toSharedDeckSlide(slide, 0, { revealIssues: slideRevealIssues(slide) })
        .animationIssues,
    ).toBeUndefined();
  });
});

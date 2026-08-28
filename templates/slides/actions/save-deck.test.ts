import { describe, expect, it } from "vitest";

import { stampChangedSlideRevisions } from "./save-deck";

describe("stampChangedSlideRevisions", () => {
  it("preserves fit identity for non-render changes and invalidates render changes", () => {
    const previous = {
      slides: [
        {
          id: "same",
          content: "<p>Same</p>",
          layout: "content",
          excalidrawData: "",
          notes: "old",
          layoutFitRevision: "keep-me",
        },
        {
          id: "layout",
          content: "<p>Same</p>",
          layout: "content",
          layoutFitRevision: "old-layout",
        },
        {
          id: "drawing",
          content: "<p>Same</p>",
          layout: "content",
          excalidrawData: "old-drawing",
          layoutFitRevision: "old-drawing-revision",
        },
      ],
    };
    const next = {
      slides: [
        {
          ...previous.slides[0],
          notes: "new",
        },
        {
          ...previous.slides[1],
          layout: "statement",
        },
        {
          ...previous.slides[2],
          excalidrawData: "new-drawing",
        },
      ],
    };

    stampChangedSlideRevisions(JSON.stringify(previous), next);

    expect(next.slides[0].layoutFitRevision).toBe("keep-me");
    expect(next.slides[1].layoutFitRevision).toEqual(expect.any(String));
    expect(next.slides[1].layoutFitRevision).not.toBe("old-layout");
    expect(next.slides[2].layoutFitRevision).toEqual(expect.any(String));
    expect(next.slides[2].layoutFitRevision).not.toBe("old-drawing-revision");
  });
});

import { describe, expect, it } from "vitest";

import { assertNoDeckRenderArtifacts } from "./_render-artifacts";
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

  it("invalidates every slide when deck geometry or typography changes", () => {
    const previous = {
      aspectRatio: "16:9",
      designSystemId: null,
      slides: [
        {
          id: "one",
          content: "<p>One</p>",
          layoutFitRevision: "old-one",
        },
        {
          id: "two",
          content: "<p>Two</p>",
          layoutFitRevision: "old-two",
        },
      ],
    };
    const next = {
      ...previous,
      aspectRatio: "4:3",
      designSystemId: "ds-1",
      slides: previous.slides.map((slide) => ({ ...slide })),
    };

    stampChangedSlideRevisions(JSON.stringify(previous), next);

    expect(next.slides[0].layoutFitRevision).toEqual(expect.any(String));
    expect(next.slides[0].layoutFitRevision).not.toBe("old-one");
    expect(next.slides[1].layoutFitRevision).toEqual(expect.any(String));
    expect(next.slides[1].layoutFitRevision).not.toBe("old-two");
  });
});

describe("assertNoDeckRenderArtifacts", () => {
  const stored = JSON.stringify({
    slides: [
      { id: "a", content: '<div class="fmd-slide"><p>A</p></div>' },
      {
        id: "legacy",
        content: '<div class="fmd-slide"><p data-builder-id="b-1">L</p></div>',
      },
    ],
  });

  it("refuses a full-deck save that adds rendered editor markup to a slide", () => {
    expect(() =>
      assertNoDeckRenderArtifacts(stored, {
        slides: [
          {
            id: "a",
            content:
              '<div class="fmd-slide"><style>[data-slide-content-scope="slide-r1"] p{color:red}</style><p>A</p></div>',
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        errorCode: "render_artifact_in_slide_content",
      }),
    );
  });

  it("saves a stored slide that keeps its markup and a new copy of older scoped styles", () => {
    expect(() =>
      assertNoDeckRenderArtifacts(stored, {
        slides: [
          {
            id: "legacy",
            content:
              '<div class="fmd-slide"><p data-builder-id="b-1">L2</p></div>',
          },
          {
            id: "restored",
            content:
              '<div class="fmd-slide"><style>[data-slide-content-scope="slide-r1"] p{color:red}</style><p>R</p></div>',
          },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts an exact copy of a stored slide, markers and all", () => {
    expect(() =>
      assertNoDeckRenderArtifacts(stored, {
        slides: [
          {
            id: "copy",
            content:
              '<div class="fmd-slide"><p data-builder-id="b-1">L</p></div>',
          },
        ],
      }),
    ).not.toThrow();
  });

  it("refuses a new slide carrying editor markup even when another slide stores it", () => {
    expect(() =>
      assertNoDeckRenderArtifacts(stored, {
        slides: [
          {
            id: "copy",
            content:
              '<div class="fmd-slide"><p data-builder-id="b-1">Changed</p></div>',
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        errorCode: "render_artifact_in_slide_content",
      }),
    );
  });
});

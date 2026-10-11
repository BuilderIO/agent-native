import { isActionContractError } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

import {
  assertSlideAnimationsResolve,
  summarizeSlideAnimationTargets,
} from "./validate-slide-animations";

const content = `<div class="fmd-slide"><h1>Title</h1><div class="text-box"><p>One</p><p>Two</p></div></div>`;

function refusalOf(run: () => void) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the reveal list to be refused");
}

describe("save-time reveal validation", () => {
  it("accepts a by-paragraph reveal whose expansion overlaps nothing", () => {
    expect(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content,
        animations: [
          { id: "title", elementIndex: 0, elementPath: [0] },
          {
            id: "body",
            elementIndex: 0,
            elementPath: [1],
            byParagraph: true,
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects a by-paragraph reveal that expands onto a box another reveal already hides", () => {
    expect(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content,
        animations: [
          { id: "box", elementIndex: 1, elementPath: [1] },
          {
            id: "body",
            elementIndex: 1,
            elementPath: [1],
            byParagraph: true,
          },
        ],
      }),
    ).toThrow(/body.*duplicates target path 1/);
  });

  it("reports the typed reason for a stale path in the summary", () => {
    const [summary] = summarizeSlideAnimationTargets(content, [
      { id: "gone", elementIndex: 0, elementPath: [9] },
    ]);
    expect(summary).toMatchObject({
      targetValid: false,
      targetIssue: "target-not-found",
    });
  });

  it("refuses a stale path as a 400 typed error carrying the reason", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content,
        animations: [{ id: "gone", elementIndex: 0, elementPath: [9] }],
      }),
    );
    expect(isActionContractError(error)).toBe(true);
    expect(error).toMatchObject({
      errorCode: "slide_animation_stale_path",
      statusCode: 400,
      details: { reason: "stale-path", slideId: "s1", animationId: "gone" },
    });
  });

  it("refuses a repeated reveal id as duplicate-id before resolving anything", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content,
        animations: [
          { id: "same", elementIndex: 0, elementPath: [0] },
          { id: "same", elementIndex: 1, elementPath: [9] },
        ],
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_duplicate_id",
      statusCode: 400,
      details: {
        reason: "duplicate-id",
        animationIndex: 1,
        animationId: "same",
      },
    });
  });

  it("refuses a by-paragraph collision as duplicate-after-expansion", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content,
        animations: [
          { id: "box", elementIndex: 1, elementPath: [1] },
          { id: "body", elementIndex: 1, elementPath: [1], byParagraph: true },
        ],
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_duplicate_after_expansion",
      statusCode: 400,
      details: { reason: "duplicate-after-expansion", animationId: "body" },
    });
  });
});

describe("save-time reveal validation against the stored list", () => {
  const stale = (id: string, elementPath: number[]) => ({
    id,
    elementIndex: 0,
    elementPath,
  });
  const stored = {
    content,
    animations: [stale("gone-a", [9]), stale("gone-b", [8])],
  };

  it("accepts a partial repair: removing one stored unresolved reveal while another stays", () => {
    expect(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content,
        animations: [stale("gone-b", [8])],
        baseline: stored,
      }),
    ).not.toThrow();
  });

  it("refuses a new unresolved reveal even while stored unresolved reveals remain", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content,
        animations: [
          stale("gone-a", [9]),
          stale("gone-b", [8]),
          stale("new", [7]),
        ],
        baseline: stored,
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_stale_path",
      statusCode: 400,
      details: { reason: "stale-path", animationIndex: 2, animationId: "new" },
    });
  });

  it("refuses a stored unresolved reveal moved onto another unresolved target", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content,
        animations: [stale("gone-a", [7]), stale("gone-b", [8])],
        baseline: stored,
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_stale_path",
      details: { animationId: "gone-a" },
    });
  });

  it("refuses a reveal that a content change strands, even when the stored list resolved it", () => {
    const withBody = `<div class="fmd-slide"><h1>Title</h1><div class="text-box"><p>One</p><p>Two</p></div></div>`;
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: `<div class="fmd-slide"><h1>Title</h1></div>`,
        animations: [{ id: "body", elementIndex: 1, elementPath: [1] }],
        baseline: {
          content: withBody,
          animations: [{ id: "body", elementIndex: 1, elementPath: [1] }],
        },
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_stale_path",
      details: { animationId: "body" },
    });
  });

  it("does not block a content change while the reveal stays unresolved", () => {
    expect(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: `<div class="fmd-slide"><h1>Retitled</h1></div>`,
        animations: [{ id: "body", elementIndex: 1, elementPath: [1] }],
        baseline: {
          content: `<div class="fmd-slide"><h1>Title</h1></div>`,
          animations: [{ id: "body", elementIndex: 1, elementPath: [1] }],
        },
      }),
    ).not.toThrow();
  });
});

describe("save-time reveal validation of sanitizer-dropped targets", () => {
  it("refuses a reveal on an svg, which the runtime removes with its subtree", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: `<div class="fmd-slide"><p>Keep</p><svg><circle r="4"></circle></svg></div>`,
        animations: [{ id: "dot", elementIndex: 1, elementPath: [1] }],
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_missing_element",
      statusCode: 400,
      details: { reason: "missing-element", animationId: "dot" },
    });
  });

  it("refuses a reveal inside a button, which the runtime removes with its subtree", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: `<div class="fmd-slide"><button><p>Go</p></button></div>`,
        animations: [{ id: "go", elementIndex: 0, elementPath: [0, 0] }],
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_missing_element",
      details: { animationId: "go" },
    });
  });

  it("refuses a reveal on a tag the runtime unwraps, since its data-pstep never renders", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: `<div class="fmd-slide"><nav><p>Menu</p></nav></div>`,
        animations: [{ id: "menu", elementIndex: 0, elementPath: [0] }],
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_missing_element",
      details: { animationId: "menu" },
    });
  });

  it("refuses a reveal on a mermaid block, which the renderer replaces with a placeholder", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: `<div class="fmd-slide"><div class="mermaid">graph TD; A-->B</div></div>`,
        animations: [{ id: "diagram", elementIndex: 0, elementPath: [0] }],
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_missing_element",
      details: { animationId: "diagram" },
    });
  });
});

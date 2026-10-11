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

  const grown = `<div class="fmd-slide"><h1>Title</h1><div class="text-box"><p>One</p><p>Two</p><p>Three</p></div></div>`;

  it("refuses a stale reveal that an insert brings onto a new element, even with the same path", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: grown,
        animations: [{ id: "late", elementIndex: 2, elementPath: [1, 2] }],
        baseline: {
          content,
          animations: [{ id: "late", elementIndex: 2, elementPath: [1, 2] }],
        },
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      statusCode: 400,
      details: { reason: "retargeted", animationId: "late" },
    });
  });

  it("accepts a stale reveal that an insert reaches when the save repairs its path", () => {
    expect(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: grown,
        animations: [{ id: "late", elementIndex: 2, elementPath: [1, 2] }],
        baseline: {
          content,
          animations: [{ id: "late", elementIndex: 2, elementPath: [1, 5] }],
        },
      }),
    ).not.toThrow();
  });
});

describe("save-time reveal identity across a content edit", () => {
  const before = `<div class="fmd-slide"><h1>Title</h1><div class="text-box"><p>One</p><p>Two</p></div></div>`;
  const reveal = { id: "two", elementIndex: 1, elementPath: [1, 1] };
  const saveWith = (
    content: string,
    animations: Parameters<
      typeof assertSlideAnimationsResolve
    >[0]["animations"] = [reveal],
  ) =>
    assertSlideAnimationsResolve({
      slideId: "s1",
      content,
      animations,
      baseline: { content: before, animations: [reveal] },
    });
  const box = (inner: string) =>
    `<div class="fmd-slide"><h1>Title</h1><div class="text-box">${inner}</div></div>`;

  it("refuses a sibling inserted before the target, even though its path still resolves", () => {
    const error = refusalOf(() =>
      saveWith(box("<p>New</p><p>One</p><p>Two</p>")),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      statusCode: 400,
      details: {
        reason: "retargeted",
        slideId: "s1",
        animationIndex: 0,
        animationId: "two",
      },
    });
  });

  it("refuses a reorder that moves another sibling onto the target's path", () => {
    const error = refusalOf(() => saveWith(box("<p>Two</p><p>One</p>")));
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      details: { animationId: "two" },
    });
  });

  it("refuses an edit to one of two identical paragraphs, since duplicate text cannot prove which one the reveal targets", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: box("<p>Three</p><p>Two</p>"),
        animations: [{ id: "two", elementIndex: 1, elementPath: [1, 0] }],
        baseline: {
          content: box("<p>Two</p><p>Two</p>"),
          animations: [{ id: "two", elementIndex: 1, elementPath: [1, 0] }],
        },
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      details: { animationId: "two" },
    });
  });

  it("refuses a reveal that resolves once a rootless baseline gains a slide root", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: box("<p>One</p><p>Two</p>"),
        animations: [reveal],
        baseline: {
          content: "<h1>Title</h1><p>One</p><p>Two</p>",
          animations: [reveal],
        },
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      details: { animationId: "two" },
    });
  });

  it("accepts a text edit to the target, which keeps its identity", () => {
    expect(() => saveWith(box("<p>One</p><p>Two, revised</p>"))).not.toThrow();
  });

  it("refuses a target whose tag changes in place, since the structure changed", () => {
    const error = refusalOf(() => saveWith(box("<p>One</p><h2>Two</h2>")));
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      details: { animationId: "two" },
    });
  });

  it("refuses a sibling appended after the target, since the slide structure changed", () => {
    const error = refusalOf(() =>
      saveWith(box("<p>One</p><p>Two</p><p>Three</p>")),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      details: { animationId: "two" },
    });
  });

  it("refuses a text edit to the target that also appends a sibling after it, since text cannot prove the pairing", () => {
    const error = refusalOf(() =>
      saveWith(box("<p>One</p><p>Two, revised</p><p>Three</p>")),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      details: { animationId: "two" },
    });
  });

  it("refuses an inserted copy of the target's text, since identical siblings cannot be told apart", () => {
    const error = refusalOf(() =>
      saveWith(box("<p>One</p><p>Two</p><p>Two</p><p>Three</p>")),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      details: { animationId: "two" },
    });
  });

  it("refuses a reveal whose target was deleted when its surviving same-tag sibling is edited", () => {
    const error = refusalOf(() =>
      assertSlideAnimationsResolve({
        slideId: "s1",
        content: box("<p>Two, revised</p>"),
        animations: [{ id: "one", elementIndex: 0, elementPath: [1, 0] }],
        baseline: {
          content: before,
          animations: [{ id: "one", elementIndex: 0, elementPath: [1, 0] }],
        },
      }),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      details: { animationId: "one" },
    });
  });

  it("refuses a text edit to the target that also inserts a sibling before it", () => {
    const error = refusalOf(() =>
      saveWith(box("<p>One</p><p>Something new</p><p>Two, revised</p>")),
    );
    expect(error).toMatchObject({
      errorCode: "slide_animation_retargeted",
      details: { animationId: "two" },
    });
  });

  it("accepts an insertion before the target when the reveal is re-pointed to its new path", () => {
    expect(() =>
      saveWith(box("<p>New</p><p>One</p><p>Two</p>"), [
        { id: "two", elementIndex: 2, elementPath: [1, 2] },
      ]),
    ).not.toThrow();
  });

  it("accepts a save that leaves the content unchanged", () => {
    expect(() => saveWith(before)).not.toThrow();
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

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

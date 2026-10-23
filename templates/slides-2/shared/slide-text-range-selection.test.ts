import { describe, expect, it } from "vitest";

import {
  currentSlideTextRangeSelection,
  MAX_SLIDE_TEXT_RANGE_EXPECTED_TEXT_LENGTH,
  slideTextRangeSelectionSchema,
} from "./slide-text-range-selection";

const selection = {
  slideId: "slide-1",
  sourceLine: 3,
  sourceColumn: 12,
  sourceRevision: 2,
  sourceHash: "a".repeat(64),
  start: 1,
  end: 4,
  expectedText: "Hello",
};

describe("slide text range selection", () => {
  it("accepts a bounded range tied to a source locator", () => {
    expect(slideTextRangeSelectionSchema.parse(selection)).toEqual(selection);
  });

  it.each([
    ["empty ranges", { ...selection, start: 2, end: 2 }],
    ["ranges beyond expected text", { ...selection, end: 6 }],
    ["negative offsets", { ...selection, start: -1 }],
    [
      "expected text over the bound",
      {
        ...selection,
        start: 0,
        end: MAX_SLIDE_TEXT_RANGE_EXPECTED_TEXT_LENGTH + 1,
        expectedText: "x".repeat(MAX_SLIDE_TEXT_RANGE_EXPECTED_TEXT_LENGTH + 1),
      },
    ],
    ["invalid hashes", { ...selection, sourceHash: "not-a-hash" }],
  ])("rejects %s", (_description, value) => {
    expect(slideTextRangeSelectionSchema.safeParse(value).success).toBe(false);
  });

  it("returns a selection only for its current source and locator", () => {
    expect(
      currentSlideTextRangeSelection(
        selection,
        {
          slideId: selection.slideId,
          revision: selection.sourceRevision,
          sourceHash: selection.sourceHash,
        },
        { line: selection.sourceLine, column: selection.sourceColumn },
      ),
    ).toEqual(selection);

    expect(
      currentSlideTextRangeSelection(
        selection,
        {
          slideId: selection.slideId,
          revision: selection.sourceRevision + 1,
          sourceHash: selection.sourceHash,
        },
        { line: selection.sourceLine, column: selection.sourceColumn },
      ),
    ).toBeNull();
    expect(
      currentSlideTextRangeSelection(
        selection,
        {
          slideId: selection.slideId,
          revision: selection.sourceRevision,
          sourceHash: "b".repeat(64),
        },
        { line: selection.sourceLine, column: selection.sourceColumn },
      ),
    ).toBeNull();
    expect(
      currentSlideTextRangeSelection(
        selection,
        {
          slideId: selection.slideId,
          revision: selection.sourceRevision,
          sourceHash: selection.sourceHash,
        },
        { line: selection.sourceLine, column: selection.sourceColumn + 1 },
      ),
    ).toBeNull();
  });
});

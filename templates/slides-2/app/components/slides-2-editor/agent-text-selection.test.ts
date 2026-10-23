import { describe, expect, it } from "vitest";

import { currentAgentTextRangeSelection } from "./agent-text-selection";

const sourceIdentity = {
  slideId: "slide-1",
  revision: 3,
  sourceHash: "a".repeat(64),
};
const locator = { line: 8, column: 2 };
const selection = {
  slideId: sourceIdentity.slideId,
  sourceLine: locator.line,
  sourceColumn: locator.column,
  sourceRevision: sourceIdentity.revision,
  sourceHash: sourceIdentity.sourceHash,
  start: 0,
  end: 5,
  expectedText: "Title",
};

describe("currentAgentTextRangeSelection", () => {
  it("keeps a matching range while the saved source is current", () => {
    expect(
      currentAgentTextRangeSelection(selection, sourceIdentity, locator, false),
    ).toEqual(selection);
  });

  it("hides draft text ranges while edits are unsaved", () => {
    expect(
      currentAgentTextRangeSelection(selection, sourceIdentity, locator, true),
    ).toBeNull();
  });

  it("rejects ranges from a different saved source", () => {
    expect(
      currentAgentTextRangeSelection(
        selection,
        { ...sourceIdentity, revision: 4 },
        locator,
        false,
      ),
    ).toBeNull();
  });
});

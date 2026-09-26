import { describe, expect, it } from "vitest";

import {
  markdownSuggestionOperationsForFindReplace,
  markdownSuggestionOperationsForReplacements,
} from "./suggestion-diff.js";

function proposedFrom(
  before: string,
  operations: ReturnType<typeof markdownSuggestionOperationsForFindReplace>,
) {
  return [...operations]
    .reverse()
    .reduce(
      (text, operation) =>
        text.slice(0, operation.anchor.from) +
        operation.after.changedText +
        text.slice(operation.anchor.to),
      before,
    );
}

describe("suggestion decomposition", () => {
  it("keeps punctuation and a separate word independently reviewable", () => {
    const before = "We shipped quickly, and the results were good.";
    const after = "We shipped quickly and the results were excellent.";
    const operations = markdownSuggestionOperationsForFindReplace({
      before,
      find: before,
      replace: after,
      start: 0,
    });

    expect(operations).toHaveLength(2);
    expect(
      operations.map((item) => [
        item.before.changedText,
        item.after.changedText,
      ]),
    ).toEqual([
      [",", ""],
      ["good", "excellent"],
    ]);
    expect(proposedFrom(before, operations)).toBe(after);
    expect(proposedFrom(before, [operations[1]!])).toBe(
      "We shipped quickly, and the results were excellent.",
    );
  });

  it("keeps selected sentence replacements granular", () => {
    const before = "We shipped quickly, and the results were good.";
    const after = "We shipped quickly and the results were excellent.";
    const operations = markdownSuggestionOperationsForReplacements({
      before,
      after,
      replacements: [{ from: 0, to: before.length }],
    });

    expect(operations).toHaveLength(2);
    expect(proposedFrom(before, operations)).toBe(after);
  });

  it("keeps a changed lexical word together despite shared letters", () => {
    const before = "A second note is ready.";
    const after = "A second note is approved.";
    const operations = markdownSuggestionOperationsForFindReplace({
      before,
      find: before,
      replace: after,
      start: 0,
    });
    expect(
      operations.map((item) => [
        item.before.changedText,
        item.after.changedText,
      ]),
    ).toEqual([["ready", "approved"]]);
  });

  it("preserves exact whitespace, Unicode, and formatting bytes", () => {
    for (const [before, after] of [
      ["word word", "word, word"],
      ["Line one\nLine two", "Line one\n\nLine two"],
      ["Cafe 🐈 was good.", "Café 🐈 was excellent."],
      ["Read **good** notes.", "Read *excellent* notes."],
      ["one  two", "one two"],
    ]) {
      const operations = markdownSuggestionOperationsForFindReplace({
        before,
        find: before,
        replace: after,
        start: 0,
      });
      expect(operations.length).toBeGreaterThan(0);
      expect(proposedFrom(before, operations)).toBe(after);
      expect(
        operations.every(
          (item) =>
            item.before.markdown === before &&
            item.anchor.from <= item.anchor.to &&
            item.anchor.to <= before.length,
        ),
      ).toBe(true);
    }
  });

  it("returns no edit for an unchanged replacement", () => {
    expect(
      markdownSuggestionOperationsForFindReplace({
        before: "same text",
        find: "same text",
        replace: "same text",
        start: 0,
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  markdownSuggestionOperations,
  markdownSuggestionOperationsForFindReplace,
  markdownSuggestionOperationsForReplacements,
} from "./suggestion-diff.js";
import { resolveMarkdownSuggestionRange } from "./suggestion-rebase.js";

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
  it("keeps a middle edit reviewable after accepting both outer edits", () => {
    const before = "Alpha quick bravo, middle ready, omega slow.";
    const after = "Apex quick bravo, middle set, omega fast.";
    const operations = markdownSuggestionOperations(before, after);
    expect(operations).toHaveLength(3);

    let current = before;
    for (const operation of [
      operations[0]!,
      operations[2]!,
      operations[1]!,
    ].map((value) => JSON.parse(JSON.stringify(value)) as typeof value)) {
      const range = resolveMarkdownSuggestionRange(current, operation);
      expect(
        range,
        `operation ${operation.ordinal} against ${current}`,
      ).not.toBeNull();
      current =
        current.slice(0, range!.from) +
        operation.after.changedText +
        current.slice(range!.to);
    }
    expect(current).toBe(after);
  });

  it("rebases a middle edit despite repeated context elsewhere", () => {
    const before = "Intro cat a a dog. Another a a a dog.";
    const after = "Intro lion b a hound. Another a a a dog.";
    const operations = markdownSuggestionOperations(before, after);
    expect(operations).toHaveLength(3);

    let current = before;
    for (const operation of [
      operations[0]!,
      operations[2]!,
      operations[1]!,
    ].map((value) => JSON.parse(JSON.stringify(value)) as typeof value)) {
      const range = resolveMarkdownSuggestionRange(current, operation);
      expect(
        range,
        `operation ${operation.ordinal} against ${current}`,
      ).not.toBeNull();
      current =
        current.slice(0, range!.from) +
        operation.after.changedText +
        current.slice(range!.to);
    }
    expect(current).toBe(after);
  });

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

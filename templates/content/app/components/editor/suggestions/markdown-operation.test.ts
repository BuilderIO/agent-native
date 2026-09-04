import { describe, expect, it } from "vitest";

import {
  markdownSuggestionOperation,
  markdownSuggestionOperations,
} from "./markdown-operation";

describe("markdownSuggestionOperation", () => {
  it.each([
    ["Hello", "Hello!", "insert_text"],
    ["Hello!", "Hello", "delete_text"],
    ["Hello", "Hi", "replace_text"],
    ["Hello", "Hello\n\nNext", "add_text_block"],
    ["Hello", "**Hello**", "set_inline_mark"],
  ])("classifies %s -> %s as %s", (before, after, kind) => {
    expect(markdownSuggestionOperation(before, after)?.kind).toBe(kind);
  });

  it("splits disjoint edits into independently applicable snapshots", () => {
    const before = "Alpha old. Beta old. Gamma old.";
    const after = "Alpha new. Beta old. Gamma fresh.";
    const operations = markdownSuggestionOperations(before, after);

    expect(operations).toHaveLength(2);
    expect(operations).toMatchObject([
      {
        ordinal: 0,
        kind: "replace_text",
        targetId: "body",
        before: { markdown: before, changedText: "old" },
        after: {
          markdown: "Alpha new. Beta old. Gamma old.",
          changedText: "new",
        },
        schemaVersion: 1,
      },
      {
        ordinal: 1,
        kind: "replace_text",
        targetId: "body",
        before: { markdown: before, changedText: "old" },
        after: {
          markdown: "Alpha old. Beta old. Gamma fresh.",
          changedText: "fresh",
        },
        schemaVersion: 1,
      },
    ]);
  });

  it.each([
    ["Hello", "Hello!", "insert_text"],
    ["Hello!", "Hello", "delete_text"],
    ["Hello", "Hi", "replace_text"],
    ["Hello", "Hello\n\nNext", "add_text_block"],
    ["Hello", "**Hello**", "set_inline_mark"],
  ])("classifies split %s -> %s as %s", (before, after, kind) => {
    expect(markdownSuggestionOperations(before, after)).toMatchObject([
      { ordinal: 0, kind, targetId: "body", schemaVersion: 1 },
    ]);
  });

  it("returns no operations when markdown is identical", () => {
    expect(markdownSuggestionOperations("unchanged", "unchanged")).toEqual([]);
  });

  it("keeps anchors tied to the correct occurrence of repeated text", () => {
    const before = "repeat same; repeat same; repeat same";
    const [operation] = markdownSuggestionOperations(
      before,
      "repeat same; repeat zxy; repeat same",
    );

    expect(operation).toMatchObject({
      before: { markdown: before, changedText: "same" },
      after: {
        markdown: "repeat same; repeat zxy; repeat same",
        changedText: "zxy",
      },
      anchor: {
        from: 20,
        to: 24,
        prefix: "repeat same; repeat ",
        suffix: "; repeat same",
      },
    });
  });

  it("honestly falls back to one whole-document replacement beyond its size guard", () => {
    const before = `${"a".repeat(64_000)}x`;
    const after = `${"a".repeat(64_000)}y`;

    expect(markdownSuggestionOperations(before, after)).toEqual([
      markdownSuggestionOperation(before, after),
    ]);
  });

  it("retains exact canonical snapshots and a narrow anchor", () => {
    const operation = markdownSuggestionOperation(
      "one two three",
      "one 2 three",
    );
    expect(operation).toMatchObject({
      before: { markdown: "one two three", changedText: "two" },
      after: { markdown: "one 2 three", changedText: "2" },
      anchor: { prefix: "one ", suffix: " three" },
    });
  });
});

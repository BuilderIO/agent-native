import { describe, expect, it } from "vitest";

import { markdownSuggestionOperation } from "./markdown-operation";

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

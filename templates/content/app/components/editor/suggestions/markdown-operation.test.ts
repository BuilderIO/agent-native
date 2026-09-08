import { describe, expect, it } from "vitest";

import {
  draftSuggestionAnchors,
  markdownSuggestionOperation,
  markdownSuggestionOperations,
} from "./markdown-operation";

describe("draftSuggestionAnchors", () => {
  it("anchors a deletion against the final draft including neighboring insertions", () => {
    const before = "Alpha Beta Gamma.\nThe team will publish on Friday.";
    const draft = " Beta Gamma. Added words.\nThe team will publish on Friday.";
    const operations = markdownSuggestionOperations(before, draft);
    const anchors = draftSuggestionAnchors(operations, draft);
    expect(anchors[0]).toEqual({
      from: 0,
      to: 0,
      prefix: "",
      suffix: draft.slice(0, 32),
    });
    for (const [index, operation] of operations.entries()) {
      const anchor = anchors[index]!;
      expect(draft.slice(anchor.from, anchor.to)).toBe(
        operation.after.changedText,
      );
      expect(draft.slice(anchor.to, anchor.to + 32)).toBe(anchor.suffix);
    }
  });

  it("accounts for earlier additions and deletions before a replacement", () => {
    const before = "Alpha Beta.\nFriday.\nLast paragraph.";
    const draft = "Beta. More.\nMonday.\nLast paragraph.";
    const operations = markdownSuggestionOperations(before, draft);
    const anchors = draftSuggestionAnchors(operations, draft);
    operations.forEach((operation, index) => {
      const anchor = anchors[index]!;
      expect(draft.slice(anchor.from, anchor.to)).toBe(
        operation.after.changedText,
      );
      expect(draft.slice(Math.max(0, anchor.from - 32), anchor.from)).toBe(
        anchor.prefix,
      );
    });
  });
});

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

  it("keeps a repeated paragraph prefix inside one contiguous insertion", () => {
    const before =
      "The team will publish the draft on Friday.\nReview this paragraph and leave a comment about the timeline.\nKeep this final paragraph unchanged.";
    const after = before.replace(
      "Review this paragraph",
      "Review note. Review this paragraph",
    );
    const operations = markdownSuggestionOperations(before, after);

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      ordinal: 0,
      kind: "insert_text",
      before: { markdown: before, changedText: "" },
      after: { markdown: after, changedText: "Review note. " },
      anchor: {
        from: 43,
        to: 43,
        prefix: "ll publish the draft on Friday.\n",
        suffix: "Review this paragraph and leave ",
      },
    });
    const operation = operations[0]!;
    expect(
      before.slice(0, operation.anchor.from) +
        operation.after.changedText +
        before.slice(operation.anchor.to),
    ).toBe(after);
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

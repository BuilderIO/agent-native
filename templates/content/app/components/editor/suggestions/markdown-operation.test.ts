import { nfmToDoc } from "@shared/nfm";
import { SuggestionFormattingMappingError } from "@shared/suggestion-formatting";
import { describe, expect, it } from "vitest";

import {
  draftSuggestionAnchors,
  markdownSuggestionOperation,
  markdownSuggestionOperations,
  markdownSuggestionOperationsForReplacements,
} from "./markdown-operation";

describe("mixed text and formatting proposals", () => {
  it.each([
    "<span underline=true>Echo</span>",
    "<span underline=true color=red>Echo</span>",
  ])("fails explicitly for an unverified marked source %s", (before) => {
    expect(() =>
      markdownSuggestionOperations(before, before.replace("Echo", "ECHO")),
    ).toThrow(SuggestionFormattingMappingError);
  });
  it.each([
    [
      "Echo other",
      "**Echo** other!",
      [
        ["Echo", "**Echo**"],
        ["", "!"],
      ],
    ],
    ["**Echo** other", "**Other** other", [["**Echo**", "**Other**"]]],
    ["**Echo** other", "Other other", [["**Echo**", "Other"]]],
    ["Echo other", "**Other** other", [["Echo", "**Other**"]]],
    [
      "Echo other",
      "[Echo](https://example.test) other!",
      [
        ["Echo", "[Echo](https://example.test)"],
        ["", "!"],
      ],
    ],
  ])(
    "preserves complete mark envelopes for %s -> %s",
    (before, after, expected) => {
      const operations = markdownSuggestionOperations(before, after);
      expect(
        operations.map((operation) => [
          operation.before.changedText,
          operation.after.changedText,
        ]),
      ).toEqual(expected);
      let reconstructed = before;
      for (const operation of [...operations].reverse()) {
        reconstructed =
          reconstructed.slice(0, operation.anchor.from) +
          operation.after.changedText +
          reconstructed.slice(operation.anchor.to);
      }
      expect(reconstructed).toBe(after);
      for (const operation of operations) {
        expect(operation.after.markdown).toBe(
          before.slice(0, operation.anchor.from) +
            operation.after.changedText +
            before.slice(operation.anchor.to),
        );
      }
    },
  );
  it("keeps the text edit after independently accepting or rejecting the mark edit", () => {
    const before = "Echo other";
    const operations = markdownSuggestionOperations(before, "**Echo** other!");
    expect(operations).toHaveLength(2);
    expect(operations[0]!.after.markdown).toBe("**Echo** other");
    expect(operations[1]!.after.markdown).toBe("Echo other!");
    expect(operations[0]!.kind).toBe("set_inline_mark");
    expect(operations[1]!.kind).toBe("insert_text");
  });
});

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
  it("preserves an exact selected range across sibling marked runs", () => {
    const before = "**Prefix Upper**<br>**Lower suffix.**";
    const from = before.indexOf("Upper");
    const to = before.indexOf("Lower") + "Lower".length;
    const after = `${before.slice(0, from)}Across${before.slice(to)}`;

    expect(
      markdownSuggestionOperationsForReplacements({
        before,
        after,
        replacements: [{ from, to }],
      }),
    ).toMatchObject([
      {
        kind: "replace_text",
        before: { markdown: before, changedText: "Upper**<br>**Lower" },
        after: { markdown: after, changedText: "Across" },
        anchor: { from, to },
      },
    ]);
  });

  it("does not force the exact-range path when bytes outside it changed", () => {
    const before = "**Prefix Upper**<br>**Lower suffix.** Tail";
    const from = before.indexOf("Upper");
    const to = before.indexOf("Lower") + "Lower".length;
    const after = `${before.slice(0, from)}Across${before.slice(to)}!`;
    const operations = markdownSuggestionOperationsForReplacements({
      before,
      after,
      replacements: [{ from, to }],
    });
    expect(operations).toHaveLength(2);
    expect(operations[1]).toMatchObject({
      kind: "insert_text",
      before: { changedText: "" },
      after: { changedText: "!" },
    });
  });

  it("rejects invalid replacement ranges even when content is unchanged", () => {
    expect(() =>
      markdownSuggestionOperationsForReplacements({
        before: "Echo",
        after: "Echo",
        replacements: [{ from: -1, to: 2 }],
      }),
    ).toThrow("Invalid suggestion replacement range");
  });

  it.each([
    "**Echo**",
    "*Echo*",
    "~~Echo~~",
    "`Echo`",
    '<span underline="true">Echo</span>',
    "[Echo](https://example.test)",
  ])("classifies and scopes supported formatting %s", (formatted) => {
    const before = "Echo\nOther paragraph.";
    const after = formatted + before.slice(4);
    expect(markdownSuggestionOperation(before, after)?.kind).toBe(
      "set_inline_mark",
    );
    expect(markdownSuggestionOperations(before, after)).toMatchObject([
      {
        kind: "set_inline_mark",
        before: { changedText: "Echo" },
        after: { changedText: formatted },
        anchor: { from: 0, to: 4 },
      },
    ]);
  });
  it("keeps independent formatting proposals individually applicable", () => {
    const before = "One middle Two\nLast";
    const [first, second] = markdownSuggestionOperations(
      before,
      "**One** middle *Two*\nLast",
    );
    expect(first!.after.markdown).toBe("**One** middle Two\nLast");
    expect(second!.after.markdown).toBe("One middle *Two*\nLast");
  });
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

  it.each([false, true])(
    "keeps a hard-break token atomic beside a separate paragraph change (reverse: %s)",
    (reverse) => {
      const canonical =
        "Alpha \nbeta gamma.\nRepeat repeat repeat.\nBold italic underline strike code link.";
      const proposed =
        "Alpha beta gamma.\nRepeat <br>repeat repeat.\nBold italic underline strike code link.";
      const before = reverse ? proposed : canonical;
      const after = reverse ? canonical : proposed;
      const operations = markdownSuggestionOperations(before, after);
      expect(operations).toHaveLength(2);
      expect(
        operations.map((operation) =>
          reverse ? operation.before.changedText : operation.after.changedText,
        ),
      ).toEqual(["", "<br>"]);
      let reconstructed = before;
      for (const operation of [...operations].reverse()) {
        reconstructed =
          reconstructed.slice(0, operation.anchor.from) +
          operation.after.changedText +
          reconstructed.slice(operation.anchor.to);
      }
      expect(reconstructed).toBe(after);
      const breakOperation = operations[1]!;
      expect(breakOperation.anchor.prefix).toContain("Repeat ");
      expect(breakOperation.after.markdown).toBe(
        reverse
          ? proposed.replace("<br>", "")
          : canonical.replace("Repeat repeat", "Repeat <br>repeat"),
      );
    },
  );

  it.each([
    {
      before: "Lead.\nRepeat \\<br> repeat.",
      after: "Lead!\nRepeat \\<bx> repeat.",
      removed: "<br>",
      inserted: "<bx>",
    },
    {
      before: "Lead.\n`<br>` repeat.",
      after: "Lead!\n`<bx>` repeat.",
      removed: "`<br>`",
      inserted: "`<bx>`",
    },
  ])(
    "preserves literal and code token semantics: $before",
    ({ before, after, removed, inserted }) => {
      const operations = markdownSuggestionOperations(before, after);
      expect(operations).toHaveLength(2);
      expect(operations[1]).toMatchObject({
        before: { changedText: removed },
        after: { changedText: inserted },
      });
      let reconstructed = before;
      for (const operation of [...operations].reverse()) {
        reconstructed =
          reconstructed.slice(0, operation.anchor.from) +
          operation.after.changedText +
          reconstructed.slice(operation.anchor.to);
      }
      expect(reconstructed).toBe(after);
      for (const source of [
        before,
        after,
        ...operations.map((operation) => operation.after.markdown),
      ]) {
        expect(JSON.stringify(nfmToDoc(source))).not.toContain(
          '"type":"hardBreak"',
        );
      }
    },
  );

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

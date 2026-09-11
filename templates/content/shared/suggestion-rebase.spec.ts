import { describe, expect, it } from "vitest";

import { resolveMarkdownSuggestionRange } from "./suggestion-rebase";

function change(before: string, from: number, to: number, inserted: string) {
  return {
    before: { markdown: before, changedText: before.slice(from, to) },
    after: {
      markdown: before.slice(0, from) + inserted + before.slice(to),
      changedText: inserted,
    },
    anchor: {
      from,
      to,
      prefix: before.slice(Math.max(0, from - 32), from),
      suffix: before.slice(to, to + 32),
    },
  };
}

describe("resolveMarkdownSuggestionRange", () => {
  const before =
    "Alpha Beta Gamma. Added words.\nThe team will publish on Monday.";
  const end = before.indexOf("\n");

  it.each([
    [52, 59, "review", 59, 66],
    [44, 44, "Review note.\u00a0", 51, 51],
  ])(
    "retains saved middle-paragraph proposal %s after surrounding acceptance",
    (from, to, inserted, expectedFrom, expectedTo) => {
      const saved =
        "This reads better compared to the original.\nEditors publish carefully.\nFinal sentence.";
      const canonical =
        "This reads more clearly than the original.\u00a0Indeed.\nEditors publish carefully.\nAlso:\u00a0Final sentence.\u00a0Added words\u00a0revised\u00a0finally.";
      expect(
        resolveMarkdownSuggestionRange(
          canonical,
          change(saved, Number(from), Number(to), String(inserted)),
        ),
      ).toEqual({ from: expectedFrom, to: expectedTo });
    },
  );

  it.each([false, true])(
    "composes both exact saved pending decisions sequentially, reverse=%s",
    (reverse) => {
      const saved =
        "This reads better compared to the original.\nEditors publish carefully.\nFinal sentence.";
      let current =
        "This reads more clearly than the original.\u00a0Indeed.\nEditors publish carefully.\nAlso:\u00a0Final sentence.\u00a0Added words\u00a0revised\u00a0finally.";
      const operations = [
        change(saved, 52, 59, "review"),
        change(saved, 44, 44, "Review note.\u00a0"),
      ];
      for (const operation of reverse ? operations.reverse() : operations) {
        const range = resolveMarkdownSuggestionRange(current, operation);
        expect(range).not.toBeNull();
        expect(current.slice(range!.from, range!.to)).toBe(
          operation.before.changedText,
        );
        current =
          current.slice(0, range!.from) +
          operation.after.changedText +
          current.slice(range!.to);
      }
      expect(current).toBe(
        "This reads more clearly than the original.\u00a0Indeed.\nReview note.\u00a0Editors review carefully.\nAlso:\u00a0Final sentence.\u00a0Added words\u00a0revised\u00a0finally.",
      );
    },
  );

  it.each([
    "First\nEditors publish cautiously.\nLast",
    "First\nOther Editors publish carefully.\nLast",
    "First\nEditors publish carefully.\nEditors publish carefully.\nLast",
    "First\n> Editors publish carefully.\nLast",
    "First\n```\nEditors publish carefully.\n```\nLast",
  ])(
    "refuses changed, competing, duplicate, or nested paragraphs: %s",
    (current) => {
      const saved = "Opening\nEditors publish carefully.\nEnding";
      expect(
        resolveMarkdownSuggestionRange(
          current,
          change(saved, 8, 8, "Review note. "),
        ),
      ).toBeNull();
    },
  );

  it("refuses a paragraph duplicated in the source and a cross-block target", () => {
    const saved =
      "Opening\nEditors publish carefully.\nEditors publish carefully.\nEnding";
    expect(
      resolveMarkdownSuggestionRange(
        "First\nEditors publish carefully.\nLast",
        change(saved, 8, 8, "Review note. "),
      ),
    ).toBeNull();
    const single = "Opening\nEditors publish carefully.\nEnding";
    expect(
      resolveMarkdownSuggestionRange(
        "First\nEditors publish carefully.\nLast",
        change(single, 7, 15, "Other"),
      ),
    ).toBeNull();
  });

  it("locates an insertion after a neighboring replacement is accepted", () => {
    expect(
      resolveMarkdownSuggestionRange(
        before.replace("Alpha", "First"),
        change(before, end, end, " Next."),
      ),
    ).toEqual({ from: end, to: end });
  });

  it.each([
    [
      "Start\nEditors publish carefully.\nTail",
      "Changed\nTail\nReview note. Editors publish carefully.",
    ],
    [
      "Start\nEditors publish carefully.\nTail",
      "Changed\nTail\nEditors publish carefully.",
    ],
    [
      "Start\nEditors publish carefully.\nTail",
      "Changed\nReview note. Editors publish carefully.\nAlso Editors publish carefully.",
    ],
    [
      "Start\nEditors publish carefully.\nOther Editors publish carefully.",
      "Changed\nReview note. Editors publish carefully.\nFinish",
    ],
    [
      "Start\nEditors publish carefully.\nTail",
      "Changed\nReview note. Editors publish carefully.\nExtra\nFinish",
    ],
  ])(
    "rejects reordered, competing, or count-changed paragraph correspondence",
    (saved, current) => {
      const from = saved.indexOf("publish");
      expect(
        resolveMarkdownSuggestionRange(
          current,
          change(saved, from, from + 7, "review"),
        ),
      ).toBeNull();
    },
  );

  it.each(["Note. ", "A much longer review note. "])(
    "composes unequal prefix shifts using mutually unique paragraph correspondence: %s",
    (prefix) => {
      const saved = "Start\nEditors publish carefully.\nTail";
      const current = `Changed opening\n${prefix}Editors publish carefully.\nFinish`;
      const from = saved.indexOf("publish");
      expect(
        resolveMarkdownSuggestionRange(
          current,
          change(saved, from, from + 7, "review"),
        ),
      ).toEqual({
        from: current.indexOf("publish"),
        to: current.indexOf("publish") + 7,
      });
    },
  );

  it("does not compose competing paragraph-start insertions or an altered target", () => {
    const saved = "Start\nEditors publish carefully.\nTail";
    expect(
      resolveMarkdownSuggestionRange(
        "Changed\nOther Editors publish carefully.\nFinish",
        change(saved, 6, 6, "Review note. "),
      ),
    ).toBeNull();
    const from = saved.indexOf("publish");
    expect(
      resolveMarkdownSuggestionRange(
        "Changed\nEditors announce carefully.\nFinish",
        change(saved, from, from + 7, "review"),
      ),
    ).toBeNull();
  });

  it("locates a replacement after a neighboring insertion is accepted", () => {
    expect(
      resolveMarkdownSuggestionRange(
        before.replace("words.", "words. Next."),
        change(before, 0, 5, "First"),
      ),
    ).toEqual({ from: 0, to: 5 });
  });

  it("returns canonical offsets after a shorter accepted replacement", () => {
    expect(
      resolveMarkdownSuggestionRange(
        before.replace("Alpha", "A"),
        change(before, end, end, " Next."),
      ),
    ).toEqual({ from: end - 4, to: end - 4 });
  });

  it("uses snapshot offsets for unchanged canonical text", () => {
    expect(
      resolveMarkdownSuggestionRange(before, change(before, 0, 5, "First")),
    ).toEqual({ from: 0, to: 5 });
  });

  it("does not highlight an overlapping canonical replacement", () => {
    expect(
      resolveMarkdownSuggestionRange(
        before.replace("Alpha", "Other"),
        change(before, 0, 5, "First"),
      ),
    ).toBeNull();
  });

  it("refuses repeated contextual matches", () => {
    expect(
      resolveMarkdownSuggestionRange(
        "Alpha old Omega and Alpha old Omega",
        change("Alpha old Omega", 6, 9, "new"),
      ),
    ).toBeNull();
  });

  it("refuses ambiguous sliding deletions", () => {
    for (const from of [1, 3, 5]) {
      expect(
        resolveMarkdownSuggestionRange(
          "xababZ",
          change("xabababZ", from, from + 2, "new"),
        ),
      ).toBeNull();
    }
  });

  it.each([null, {}, { markdown: 12 }, { markdown: "Alpha" }])(
    "returns no range for an invalid payload: %s",
    (payload) => {
      const operation = change(before, 0, 5, "First");
      expect(
        resolveMarkdownSuggestionRange(before, {
          ...operation,
          before: payload,
        }),
      ).toBeNull();
    },
  );

  it("returns no range for an invalid anchor even on an unchanged snapshot", () => {
    const operation = change(before, 0, 5, "First");
    expect(
      resolveMarkdownSuggestionRange(before, { ...operation, anchor: null }),
    ).toBeNull();
    expect(
      resolveMarkdownSuggestionRange(before, {
        ...operation,
        anchor: { ...operation.anchor, from: -1 },
      }),
    ).toBeNull();
  });
});

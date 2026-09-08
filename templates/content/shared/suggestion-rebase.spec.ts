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

  it("locates an insertion after a neighboring replacement is accepted", () => {
    expect(
      resolveMarkdownSuggestionRange(
        before.replace("Alpha", "First"),
        change(before, end, end, " Next."),
      ),
    ).toEqual({ from: end, to: end });
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

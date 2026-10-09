import type { ResourceSuggestion } from "@agent-native/core/review";
import { markdownSuggestionOperation } from "@shared/suggestion-diff";
import { describe, expect, it } from "vitest";

import {
  receiptSuggestionId,
  suggestionLineExcerpt,
  suggestionsByThread,
} from "./thread-suggestions";

const suggestion = (
  id: string,
  metadata: Record<string, unknown> | null,
  createdAt = "2026-10-09T17:00:00.000Z",
) =>
  ({
    id,
    metadata,
    createdAt,
    operations: [],
  }) as unknown as ResourceSuggestion;

describe("suggestionsByThread", () => {
  it("groups suggestions under the comment thread they came from, oldest first", () => {
    const grouped = suggestionsByThread(
      [
        suggestion("later", { sourceThreadId: "t1" }, "2026-10-09T18:00:00Z"),
        suggestion("earlier", { sourceThreadId: "t1" }, "2026-10-09T17:00:00Z"),
        suggestion("margin", null),
        suggestion("elsewhere", { sourceThreadId: "other-page" }),
      ],
      new Set(["t1"]),
    );
    expect([...grouped.keys()]).toEqual(["t1"]);
    expect(grouped.get("t1")!.map((entry) => entry.id)).toEqual([
      "earlier",
      "later",
    ]);
  });
});

describe("receiptSuggestionId", () => {
  it("reads the suggestion an AI receipt reply links to", () => {
    expect(
      receiptSuggestionId(
        "[Name the time](/page/doc-1?suggestion=3f2a-9c_b.1)",
      ),
    ).toBe("3f2a-9c_b.1");
  });

  it("ignores ordinary replies that mention a link mid-sentence", () => {
    expect(
      receiptSuggestionId(
        "See [this](/page/doc-1?suggestion=abc) before we decide",
      ),
    ).toBeNull();
    expect(receiptSuggestionId("actually, make it Thursday")).toBeNull();
  });
});

describe("suggestionLineExcerpt", () => {
  it("shows the whole line around a mid-word edit as reader text", () => {
    const before =
      "# Launch note\n\nThe team ships **every** Friday afternoon, so feedback lands.\n";
    const after = before.replace("afternoon", "at 3:00 PM UTC");
    const operation = markdownSuggestionOperation(before, after)!;
    expect(operation.after.changedText).toBe("t 3:00 PM UTC");

    expect(
      suggestionLineExcerpt([
        operation,
      ] as unknown as ResourceSuggestion["operations"]),
    ).toEqual({
      before: "The team ships every Friday afternoon, so feedback lands.",
      after: "The team ships every Friday at 3:00 PM UTC, so feedback lands.",
    });
  });

  it("declines operations it cannot place, rather than guessing", () => {
    const operation = markdownSuggestionOperation("One two", "One three")!;
    expect(
      suggestionLineExcerpt([
        { ...operation, before: { ...operation.before, changedText: "x" } },
      ] as unknown as ResourceSuggestion["operations"]),
    ).toBeNull();
  });
});

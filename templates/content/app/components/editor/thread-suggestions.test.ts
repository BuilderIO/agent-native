import type { ResourceSuggestion } from "@agent-native/core/review";
import { markdownSuggestionOperation } from "@shared/suggestion-diff";
import { describe, expect, it } from "vitest";

import {
  receiptSuggestion,
  reviewedInThread,
  suggestionLineExcerpt,
  suggestionsByThread,
} from "./thread-suggestions";

const suggestion = (
  id: string,
  metadata: Record<string, unknown> | null,
  createdAt = "2026-10-09T17:00:00.000Z",
  extra: Partial<ResourceSuggestion> = {},
) =>
  ({
    id,
    metadata,
    createdAt,
    status: "pending",
    authorEmail: "ana@example.com",
    operations: [],
    ...extra,
  }) as unknown as ResourceSuggestion;

const fromThread = (threadId: string) => ({
  sourceThreadId: threadId,
  commentAiRequestId: `request-${threadId}`,
});

describe("suggestionsByThread", () => {
  it("groups suggestions under the comment thread they came from, oldest first", () => {
    const grouped = suggestionsByThread(
      [
        suggestion("later", fromThread("t1"), "2026-10-09T18:00:00Z"),
        suggestion("earlier", fromThread("t1"), "2026-10-09T17:00:00Z"),
        suggestion("margin", null),
        suggestion("elsewhere", fromThread("other-page")),
        suggestion("claimed", { sourceThreadId: "t1" }),
      ],
      [{ threadId: "t1", resolved: false }],
    );
    expect([...grouped.keys()]).toEqual(["t1"]);
    expect(grouped.get("t1")!.map((entry) => entry.id)).toEqual([
      "earlier",
      "later",
    ]);
  });
});

describe("reviewedInThread", () => {
  it("sends a pending suggestion back to its card once its thread is resolved", () => {
    const resolved = { threadId: "t1", resolved: true };
    expect(reviewedInThread(suggestion("s", fromThread("t1")), resolved)).toBe(
      false,
    );
    expect(
      reviewedInThread(
        suggestion("s", fromThread("t1"), undefined, { status: "accepted" }),
        resolved,
      ),
    ).toBe(true);
    expect(
      reviewedInThread(suggestion("s", fromThread("t1")), {
        ...resolved,
        resolved: false,
      }),
    ).toBe(true);
  });
});

describe("receiptSuggestion", () => {
  const linked = suggestion("3f2a-9c_b.1", fromThread("t1"));
  const reply = (content: string, author_email = "ana@example.com") => ({
    content,
    author_email,
  });

  it("finds the suggestion an AI receipt reply links to", () => {
    expect(
      receiptSuggestion(
        reply("[Name the time](/page/doc-1?suggestion=3f2a-9c_b.1)"),
        [linked],
      ),
    ).toBe(linked);
  });

  it("leaves ordinary replies and other people's links alone", () => {
    expect(
      receiptSuggestion(
        reply(
          "See [this](/page/doc-1?suggestion=3f2a-9c_b.1) before we decide",
        ),
        [linked],
      ),
    ).toBeNull();
    expect(
      receiptSuggestion(
        reply(
          "[Name the time](/page/doc-1?suggestion=3f2a-9c_b.1)",
          "ben@example.com",
        ),
        [linked],
      ),
    ).toBeNull();
    expect(
      receiptSuggestion(reply("actually, make it Thursday"), [linked]),
    ).toBeNull();
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

  it("shows every line of a replacement that adds lines", () => {
    const before = "Ship on Friday.\n\nReview on Monday.\n";
    const after = before.replace(
      "Friday.",
      "Thursday.\n\nDemo on Friday.\n\nRetro after.",
    );
    const operation = markdownSuggestionOperation(before, after)!;

    expect(
      suggestionLineExcerpt([
        operation,
      ] as unknown as ResourceSuggestion["operations"]),
    ).toEqual({
      before: "Ship on Friday.",
      after: "Ship on Thursday.\nDemo on Friday.\nRetro after.",
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

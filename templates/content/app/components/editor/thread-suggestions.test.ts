import type { ResourceSuggestion } from "@agent-native/core/review";
import { markdownSuggestionOperation } from "@shared/suggestion-diff";
import { describe, expect, it } from "vitest";

import {
  proposalGroups,
  receiptSuggestion,
  reviewedInThread,
  refreshedProposalMembers,
  reviewUnitDiffParts,
  reviewUnitOperations,
  reviewUnits,
  suggestionLineExcerpt,
  suggestionsByThread,
  withWholeReviewUnits,
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

describe("proposalGroups", () => {
  const at = (from: number) => [{ anchor: { from, to: from + 1 } }];
  it("keeps a proposal's edits together in Page order, and other suggestions alone", () => {
    const groups = proposalGroups([
      suggestion("alone", fromThread("t1")),
      suggestion("second", fromThread("t1"), undefined, {
        proposalId: "p1",
        operations: at(40) as ResourceSuggestion["operations"],
      }),
      suggestion("later", fromThread("t1")),
      suggestion("first", fromThread("t1"), undefined, {
        proposalId: "p1",
        operations: at(3) as ResourceSuggestion["operations"],
      }),
    ]);
    expect(groups.map((group) => group.map((entry) => entry.id))).toEqual([
      ["alone"],
      ["first", "second"],
      ["later"],
    ]);
  });
});

describe("reviewUnits", () => {
  const piece = (
    id: string,
    reviewUnit: string | null,
    status: ResourceSuggestion["status"] = "pending",
    proposalId = "p1",
  ) =>
    suggestion(id, reviewUnit ? { reviewUnit } : null, undefined, {
      proposalId,
      status,
    });

  const ids = (suggestions: ResourceSuggestion[]) =>
    reviewUnits(suggestions).map((unit) => [
      unit.leader.id,
      unit.members.map((member) => member.id),
    ]);

  it("groups pieces by label, in the order given", () => {
    expect(
      ids([piece("a", "k:0"), piece("b", "k:1"), piece("c", "k:0")]),
    ).toEqual([
      ["a", ["a", "c"]],
      ["b", ["b"]],
    ]);
  });

  it("keeps a suggestion with no label on its own", () => {
    expect(ids([piece("a", null), piece("b", null)])).toEqual([
      ["a", ["a"]],
      ["b", ["b"]],
    ]);
  });

  it("separates pieces that ended differently", () => {
    expect(
      ids([piece("a", "k:0"), piece("b", "k:0", "stale"), piece("c", "k:0")]),
    ).toEqual([
      ["a", ["a", "c"]],
      ["b", ["b"]],
    ]);
  });

  it("treats anything but a text label as no unit", () => {
    const unlabeled = (id: string, reviewUnit: unknown) =>
      suggestion(id, { reviewUnit }, undefined, { proposalId: "p1" });
    expect(ids([unlabeled("a", ""), unlabeled("b", "")])).toHaveLength(2);
    expect(ids([unlabeled("a", 1), unlabeled("b", 1)])).toHaveLength(2);
  });

  it("doesn't join the same label across proposals", () => {
    expect(
      ids([
        piece("a", "k:0", "pending", "p1"),
        piece("b", "k:0", "pending", "p2"),
      ]),
    ).toEqual([
      ["a", ["a"]],
      ["b", ["b"]],
    ]);
  });

  it("brings the rest of a unit along with a piece a filter kept", () => {
    const all = [
      piece("a", "k:0"),
      piece("b", "k:1"),
      piece("c", "k:0"),
      piece("d", null),
      piece("e", "k:0", "stale"),
    ];
    const [, , kept = null] = all;
    if (!kept) throw new Error("The list has a third piece");
    expect(
      withWholeReviewUnits([kept], all).map((member) => member.id),
    ).toEqual(["a", "c"]);
  });
});

describe("reviewUnitOperations", () => {
  const source = "Teh team will recieve the files.\n\nKeep this line.";
  const unitOf = (...ops: unknown[]) => {
    const members = ops.map((operation, index) =>
      suggestion(`piece-${index}`, null, undefined, {
        operations: [operation],
      } as Partial<ResourceSuggestion>),
    );
    const [leader = null] = members;
    if (!leader) throw new Error("A unit has a piece");
    return { leader, members };
  };
  const joined = (...ops: unknown[]) => {
    const [operation = null] = reviewUnitOperations(unitOf(...ops));
    if (!operation) throw new Error("A unit has an operation");
    return operation;
  };
  const swap = (find: string, inserted: string, markdown = source) => {
    const from = markdown.indexOf(find);
    return {
      id: find,
      kind: "replace_text",
      before: { markdown, changedText: find },
      after: { markdown, changedText: inserted },
      anchor: { from, to: from + find.length },
    };
  };

  it("reads a unit as one change from its first piece to its last", () => {
    const operation = joined(swap("Teh", "The"), swap("recieve", "receive"));
    expect(operation).toMatchObject({
      kind: "replace_text",
      before: { changedText: "Teh team will recieve" },
      after: { changedText: "The team will receive" },
      anchor: { from: 0, to: "Teh team will recieve".length },
    });
    expect((operation.after as { markdown: string }).markdown).toBe(
      "The team will receive the files.\n\nKeep this line.",
    );
    expect(suggestionLineExcerpt([operation])).toEqual({
      before: "Teh team will recieve the files.",
      after: "The team will receive the files.",
    });
  });

  it("reads pieces in Page order whichever order they come in", () => {
    const operation = joined(swap("recieve", "receive"), swap("Teh", "The"));
    expect(operation.after).toMatchObject({
      changedText: "The team will receive",
    });
  });

  it("applies a deletion and an insertion that change the length", () => {
    const from = source.indexOf("team");
    const operation = joined(swap("Teh ", ""), {
      ...swap("team", ""),
      before: { markdown: source, changedText: "" },
      after: { markdown: source, changedText: "whole " },
      anchor: { from, to: from },
    });
    expect(operation.before).toMatchObject({ changedText: "Teh " });
    expect(operation.after).toMatchObject({ changedText: "whole " });
  });

  it("returns a single piece's operations untouched", () => {
    const unit = unitOf(swap("Teh", "The"));
    expect(reviewUnitOperations(unit)).toBe(unit.leader.operations);
  });

  it("lists pieces staged on different text instead of joining them", () => {
    const operations = reviewUnitOperations(
      unitOf(swap("Teh", "The"), swap("Keep", "Hold", "Keep it.")),
    );
    expect(operations).toHaveLength(2);
  });

  it("lists a piece that empties a block instead of writing out its marker", () => {
    const operations = reviewUnitOperations(
      unitOf(swap("Teh", "The"), swap("Keep this line.", "<empty-block/>")),
    );
    expect(operations).toHaveLength(2);
  });
});

describe("refreshedProposalMembers", () => {
  const piece = (id: string, status = "pending", proposalId = "p") =>
    ({ id, status, proposalId }) as unknown as ResourceSuggestion;
  const unit = [piece("a"), piece("b")];

  it("keeps an exact set whose pieces are all still pending", () => {
    const refreshed = [
      piece("a"),
      piece("b"),
      piece("c"),
      piece("x", "pending", "q"),
    ];
    expect(
      refreshedProposalMembers(refreshed, "p", unit, true)?.map(({ id }) => id),
    ).toEqual(["a", "b"]);
  });

  it("refuses an exact set once one of its pieces was decided", () => {
    expect(
      refreshedProposalMembers(
        [piece("a"), piece("b", "accepted")],
        "p",
        unit,
        true,
      ),
    ).toBeNull();
  });

  it("takes whatever is left of a whole proposal", () => {
    expect(
      refreshedProposalMembers(
        [piece("a", "accepted"), piece("b"), piece("c")],
        "p",
        unit,
        false,
      )?.map(({ id }) => id),
    ).toEqual(["b", "c"]);
  });
});

describe("reviewUnitDiffParts", () => {
  it("keeps whole words together", () => {
    expect(reviewUnitDiffParts("the retry hooks", "the retries")).toEqual([
      { type: "equal", text: "the " },
      { type: "delete", text: "retry hooks" },
      { type: "insert", text: "retries" },
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

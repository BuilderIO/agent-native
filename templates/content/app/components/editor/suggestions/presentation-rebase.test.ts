import { canonicalizeNfm } from "@shared/nfm";
import type { MarkdownSuggestionOperation } from "@shared/suggestion-diff";
import { resolveMarkdownSuggestionRange } from "@shared/suggestion-rebase";
import { describe, expect, it } from "vitest";

import {
  createCommittedSuggestionPresentationTransition,
  createObservedSuggestionPresentationTransition,
  hydrateSuggestionPresentationTransitions,
  pruneSuggestionPresentationTransitions,
  retainCommittedSuggestionPresentationTransitions,
  resolveSuggestionPresentationRange,
  suggestionPresentationTransitionKey,
  type SuggestionPresentationTransition,
} from "./presentation-rebase";

function edit(
  before: string,
  from: number,
  to: number,
  inserted: string,
): MarkdownSuggestionOperation {
  return {
    ordinal: 0,
    kind:
      from === to ? "insert_text" : inserted ? "replace_text" : "delete_text",
    targetId: "body",
    schemaVersion: 1,
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

const before = "We shipped quickly, and the results were good.";
const after = "We shipped quickly and the results were excellent.";
const committed = {
  id: "accepted",
  status: "accepted" as const,
  operations: [edit(before, 0, before.length, after)],
};
const pending = {
  id: "pending",
  status: "pending" as const,
  revision: 1,
  operations: [
    edit(
      before,
      before.indexOf("results"),
      before.indexOf("results") + 7,
      "findings",
    ),
  ],
};

describe("committed suggestion presentation proof", () => {
  it("combines separately confirmed disjoint changes only on the same original basis", () => {
    const tail = {
      ...committed,
      id: "tail",
      operations: [edit(before, before.length, before.length, " Tail.")],
    };
    const first = retainCommittedSuggestionPresentationTransitions(
      new Map(),
      [pending],
      [tail],
    );
    const combined = retainCommittedSuggestionPresentationTransitions(
      first,
      [pending],
      [committed],
    );
    const transition = combined.get(
      suggestionPresentationTransitionKey(pending),
    );
    expect(
      resolveSuggestionPresentationRange(
        `${after} Tail.`,
        pending.operations[0]!,
        transition,
      ),
    ).not.toBeNull();
    const key = suggestionPresentationTransitionKey(pending);
    const repeated = retainCommittedSuggestionPresentationTransitions(
      first,
      [pending],
      [tail],
    );
    expect(repeated.get(key)?.after).toBe(`${before} Tail.`);
    expect(repeated.get(key)?.changes).toHaveLength(1);
    const conflicting = {
      ...committed,
      operations: [
        edit(before, before.indexOf(","), before.indexOf(",") + 1, ":"),
      ],
    };
    expect(
      retainCommittedSuggestionPresentationTransitions(
        combined,
        [pending],
        [conflicting],
      ).get(key),
    ).toBe(transition);
    const laterBasis = {
      ...tail,
      operations: [edit(after, after.length, after.length, " Later.")],
    };
    expect(
      retainCommittedSuggestionPresentationTransitions(
        combined,
        [pending],
        [laterBasis],
      ).get(key),
    ).toBe(transition);
    expect(
      resolveSuggestionPresentationRange(
        `Notice. ${after} Tail.`,
        pending.operations[0]!,
        transition,
      ),
    ).toEqual({
      from: "Notice. ".length + after.indexOf("results"),
      to: "Notice. ".length + after.indexOf("results") + 7,
    });
  });

  it("seeds one proven cold committed candidate when cached parent content is still before", () => {
    const cold = hydrateSuggestionPresentationTransitions(
      new Map(),
      [pending],
      [committed],
      before,
    );
    expect(cold.size).toBe(1);
    expect(
      resolveSuggestionPresentationRange(
        after,
        pending.operations[0]!,
        cold.get(suggestionPresentationTransitionKey(pending)),
      ),
    ).not.toBeNull();
    expect(
      resolveSuggestionPresentationRange(
        after.replace("results", "outcomes"),
        pending.operations[0]!,
        cold.get(suggestionPresentationTransitionKey(pending)),
      ),
    ).toBeNull();
    expect(
      hydrateSuggestionPresentationTransitions(
        new Map(),
        [pending],
        [committed, { ...committed, id: "independent" }],
        before,
      ).size,
    ).toBe(0);
  });
  it("retains proof for disjoint precise pending children inside a wide saved envelope", () => {
    const wide = {
      ...pending,
      operations: [
        edit(
          before,
          0,
          before.length,
          before.replace("We", "They").replace("good", "great"),
        ),
      ],
    };
    const middle = {
      ...committed,
      operations: [
        edit(
          before,
          before.indexOf("results"),
          before.indexOf("results") + 7,
          "findings",
        ),
      ],
    };
    expect(
      retainCommittedSuggestionPresentationTransitions(
        new Map(),
        [wide],
        [middle],
      ).size,
    ).toBe(1);
    expect(
      hydrateSuggestionPresentationTransitions(
        new Map(),
        [wide],
        [middle],
        middle.operations[0]!.after.markdown,
      ).size,
    ).toBe(1);
    const overlapping = { ...middle, operations: [edit(before, 0, 2, "They")] };
    expect(
      retainCommittedSuggestionPresentationTransitions(
        new Map(),
        [wide],
        [overlapping],
      ).size,
    ).toBe(0);
  });
  it("uses requested evidence only after the rendered source independently matches its exact after", () => {
    const request = { ...committed, status: "pending" as const };
    const observed = createObservedSuggestionPresentationTransition([request])!;
    expect(
      createCommittedSuggestionPresentationTransition([request]),
    ).toBeNull();
    expect(
      resolveSuggestionPresentationRange(
        before,
        pending.operations[0]!,
        undefined,
        observed,
      ),
    ).toEqual({
      from: pending.operations[0]!.anchor.from,
      to: pending.operations[0]!.anchor.to,
    });
    expect(
      resolveSuggestionPresentationRange(
        after,
        pending.operations[0]!,
        undefined,
        observed,
      ),
    ).not.toBeNull();
    expect(
      resolveSuggestionPresentationRange(
        `${after} Peer.`,
        pending.operations[0]!,
        undefined,
        observed,
      ),
    ).toBeNull();
    expect(
      resolveSuggestionPresentationRange(
        after.replace("results", "outcomes"),
        pending.operations[0]!,
        undefined,
        observed,
      ),
    ).toBeNull();
    expect(
      resolveSuggestionPresentationRange(after, pending.operations[0]!),
    ).toBeNull();
    expect(request.status).toBe("pending");
    expect(
      retainCommittedSuggestionPresentationTransitions(
        new Map(),
        [pending],
        [request],
      ).size,
    ).toBe(0);
  });

  it("hydrates cold committed evidence conservatively and never replaces known evidence", () => {
    const key = suggestionPresentationTransitionKey(pending);
    const cold = hydrateSuggestionPresentationTransitions(
      new Map(),
      [pending],
      [committed],
      after,
    );
    expect(cold.size).toBe(1);
    expect(
      resolveSuggestionPresentationRange(
        after,
        pending.operations[0]!,
        cold.get(key),
      ),
    ).not.toBeNull();
    expect(
      hydrateSuggestionPresentationTransitions(
        new Map(),
        [pending],
        [{ ...committed, status: "rejected" }],
        after,
      ).size,
    ).toBe(0);
    const otherBasis = {
      ...committed,
      operations: [edit(`${before}!`, 0, before.length + 1, `${after}!`)],
    };
    expect(
      hydrateSuggestionPresentationTransitions(
        new Map(),
        [pending],
        [otherBasis],
        after,
      ).size,
    ).toBe(0);
    expect(
      hydrateSuggestionPresentationTransitions(
        new Map(),
        [pending],
        [committed, { ...committed, id: "independent" }],
        after,
      ).size,
    ).toBe(0);
    const later = {
      ...committed,
      operations: [edit(before, before.length, before.length, " Peer.")],
    };
    expect(
      hydrateSuggestionPresentationTransitions(
        cold,
        [pending],
        [later],
        `${after} Peer.`,
      ).get(key),
    ).toBe(cold.get(key));
    expect(
      hydrateSuggestionPresentationTransitions(
        new Map(),
        [pending],
        [committed],
        before,
      ).size,
    ).toBe(1);
    expect(
      hydrateSuggestionPresentationTransitions(
        new Map(),
        [pending],
        [committed],
        after.replace("results", "outcomes"),
      ).size,
    ).toBe(0);
  });
  it("preserves known pending proof through a later disjoint same-basis acceptance", () => {
    const retained = retainCommittedSuggestionPresentationTransitions(
      new Map(),
      [pending],
      [committed],
    );
    const later = {
      ...committed,
      id: "tail",
      operations: [edit(before, before.length, before.length, " Peer.")],
    };
    const next = retainCommittedSuggestionPresentationTransitions(
      retained,
      [pending],
      [later],
    );
    const key = suggestionPresentationTransitionKey(pending);
    expect(next.get(key)?.changes).toEqual(
      expect.arrayContaining(retained.get(key)!.changes),
    );
    expect(next.get(key)?.after).toBe(`${after} Peer.`);
    expect(
      resolveSuggestionPresentationRange(
        `${after} Peer.`,
        pending.operations[0]!,
        next.get(key),
      ),
    ).not.toBeNull();
  });

  it("hydrates a same-proposal committed group as one reload candidate", () => {
    const members = [
      {
        ...committed,
        proposalId: "group",
        operations: [
          edit(before, before.indexOf(","), before.indexOf(",") + 1, ""),
        ],
      },
      {
        ...committed,
        proposalId: "group",
        operations: [
          edit(
            before,
            before.indexOf("good"),
            before.indexOf("good") + 4,
            "excellent",
          ),
        ],
      },
    ];
    const hydrated = hydrateSuggestionPresentationTransitions(
      new Map(),
      [pending],
      members,
      after,
    );
    expect(hydrated.size).toBe(1);
    expect(
      hydrateSuggestionPresentationTransitions(
        new Map(),
        [pending],
        members,
        before,
      ).size,
    ).toBe(1);
    expect(
      hydrated.get(suggestionPresentationTransitionKey(pending))?.after,
    ).toBe(after);
  });
  it("proves an interleaved pending target through exact committed changes", () => {
    const transition = createCommittedSuggestionPresentationTransition([
      committed,
    ])!;
    expect(transition.changes).toHaveLength(2);
    expect(transition.after).toBe(after);
    expect(
      resolveMarkdownSuggestionRange(after, pending.operations[0]),
    ).toBeNull();
    const range = resolveSuggestionPresentationRange(
      after,
      pending.operations[0]!,
      transition,
    );
    expect(range).toEqual({
      from: after.indexOf("results"),
      to: after.indexOf("results") + 7,
    });
    const later = `${after} A peer added a sentence.`;
    expect(
      resolveMarkdownSuggestionRange(later, pending.operations[0]),
    ).toBeNull();
    expect(
      resolveSuggestionPresentationRange(
        later,
        pending.operations[0]!,
        transition,
      ),
    ).toEqual(range);
    expect(
      resolveSuggestionPresentationRange(
        after.replace("results", "outcomes"),
        pending.operations[0]!,
        transition,
      ),
    ).toBeNull();
  });

  it("constructs one proof for disjoint committed group members on the same basis", () => {
    const comma = before.indexOf(",");
    const good = before.indexOf("good");
    const members = [
      {
        ...committed,
        id: "comma",
        operations: [edit(before, comma, comma + 1, "")],
      },
      {
        ...committed,
        id: "good",
        operations: [edit(before, good, good + 4, "excellent")],
      },
    ];
    const transition =
      createCommittedSuggestionPresentationTransition(members)!;
    expect(transition.after).toBe(after);
    expect(
      resolveSuggestionPresentationRange(
        after,
        pending.operations[0]!,
        transition,
      ),
    ).not.toBeNull();
    expect(
      createCommittedSuggestionPresentationTransition([
        members[0]!,
        members[0]!,
      ]),
    ).toBeNull();
    expect(
      createCommittedSuggestionPresentationTransition([
        members[0]!,
        {
          ...members[1]!,
          operations: [edit(after, 0, after.length, `${after}!`)],
        },
      ]),
    ).toBeNull();
  });

  it.each(["pending", "rejected", "stale"] as const)(
    "does not authorize a witness for %s disposition",
    (status) => {
      const uncommitted = { ...committed, status };
      expect(
        createCommittedSuggestionPresentationTransition([uncommitted]),
      ).toBeNull();
      expect(
        retainCommittedSuggestionPresentationTransitions(
          new Map(),
          [pending],
          [uncommitted],
        ).size,
      ).toBe(0);
    },
  );

  it("rejects an invalid saved payload, foreign target, or incomplete change set", () => {
    expect(
      createCommittedSuggestionPresentationTransition([
        {
          ...committed,
          operations: [
            {
              ...committed.operations[0]!,
              after: { markdown: `${after}!`, changedText: after },
            },
          ],
        },
      ]),
    ).toBeNull();
    expect(
      createCommittedSuggestionPresentationTransition([
        {
          ...committed,
          operations: [{ ...committed.operations[0]!, targetId: "title" }],
        },
      ]),
    ).toBeNull();
    const transition = createCommittedSuggestionPresentationTransition([
      committed,
    ])!;
    for (const invalid of [
      { ...transition, after: `${after}!` },
      { ...transition, before: `Other ${before}` },
      { ...transition, changes: transition.changes.slice(0, 1) },
      {
        ...transition,
        changes: [...transition.changes, transition.changes[0]!],
      },
      { ...transition, changes: [{ ...transition.changes[0]!, from: -1 }] },
    ]) {
      expect(
        resolveSuggestionPresentationRange(
          after,
          pending.operations[0]!,
          invalid,
        ),
      ).toBeNull();
    }
  });

  it("does not lend a valid witness to a different pending basis", () => {
    const transition = createCommittedSuggestionPresentationTransition([
      committed,
    ])!;
    const differentBefore = before.replace("We", "They");
    const different = edit(
      differentBefore,
      differentBefore.indexOf("results"),
      differentBefore.indexOf("results") + 7,
      "findings",
    );
    expect(
      resolveSuggestionPresentationRange(after, different, transition),
    ).toBeNull();
    expect(
      retainCommittedSuggestionPresentationTransitions(
        new Map(),
        [{ ...pending, operations: [different] }],
        [committed],
      ).size,
    ).toBe(0);
  });

  it("preserves validated existing sibling ranges without mutating the saved anchor", () => {
    const operation = {
      ...pending.operations[0]!,
      anchor: {
        ...pending.operations[0]!.anchor,
        siblingRanges: [{ from: 0, to: 2 }],
      },
    };
    const transition = createCommittedSuggestionPresentationTransition([
      committed,
    ])!;
    expect(
      resolveSuggestionPresentationRange(after, operation, transition),
    ).toEqual({
      from: after.indexOf("results"),
      to: after.indexOf("results") + 7,
    });
    expect(operation.anchor.siblingRanges).toEqual([{ from: 0, to: 2 }]);
    const overlap = {
      ...operation,
      anchor: {
        ...operation.anchor,
        siblingRanges: [
          { from: operation.anchor.from, to: operation.anchor.to },
        ],
      },
    };
    expect(
      resolveSuggestionPresentationRange(after, overlap, transition),
    ).toBeNull();
  });

  it("rejects ambiguous repeated fixed gaps even when the body reconstruction is exact", () => {
    const repeatedBefore = "LEFT Echo Echo RIGHT";
    const repeatedAfter = "Echo Echo Echo";
    const transition: SuggestionPresentationTransition = {
      before: repeatedBefore,
      after: repeatedAfter,
      changes: [
        { from: 0, to: 5, beforeText: "LEFT ", afterText: "Echo " },
        {
          from: repeatedBefore.indexOf(" RIGHT"),
          to: repeatedBefore.length,
          beforeText: " RIGHT",
          afterText: "",
        },
      ],
    };
    const operation = edit(repeatedBefore, 5, 9, "Wave");
    expect(resolveMarkdownSuggestionRange(repeatedAfter, operation)).toBeNull();
    expect(
      resolveSuggestionPresentationRange(repeatedAfter, operation, transition),
    ).toBeNull();
  });

  it.each([before.indexOf(","), before.indexOf(",") + 1])(
    "does not widen a pending insertion at accepted range edge %s",
    (offset) => {
      const operation = edit(before, offset, offset, "added");
      const transition = createCommittedSuggestionPresentationTransition([
        committed,
      ])!;
      expect(
        resolveSuggestionPresentationRange(after, operation, transition),
      ).toBeNull();
      expect(
        retainCommittedSuggestionPresentationTransitions(
          new Map(),
          [{ ...pending, operations: [operation] }],
          [committed],
        ).size,
      ).toBe(0);
    },
  );

  it("requires existing resolver proof for canonicalized positions", () => {
    const markedBefore = `Intro.\n\n${before.replace("results", "**results**")}\n\nTail.`;
    const markedAfter = markedBefore
      .replace(",", "")
      .replace("good", "excellent");
    const markedCommitted = {
      ...committed,
      operations: [edit(markedBefore, 0, markedBefore.length, markedAfter)],
    };
    const markedPending = edit(
      markedBefore,
      markedBefore.indexOf("results"),
      markedBefore.indexOf("results") + 7,
      "findings",
    );
    expect(
      createCommittedSuggestionPresentationTransition([markedCommitted]),
    ).toBeNull();
    const comma = markedBefore.indexOf(",");
    const good = markedBefore.indexOf("good");
    const transition: SuggestionPresentationTransition = {
      before: markedBefore,
      after: markedAfter,
      changes: [
        { from: comma, to: comma + 1, beforeText: ",", afterText: "" },
        {
          from: good,
          to: good + 4,
          beforeText: "good",
          afterText: "excellent",
        },
      ],
    };
    const canonical = canonicalizeNfm(markedAfter);
    expect(canonical).not.toBe(markedAfter);
    expect(
      resolveSuggestionPresentationRange(canonical, markedPending, transition),
    ).toEqual({
      from: canonical.indexOf("results"),
      to: canonical.indexOf("results") + 7,
    });
    expect(
      resolveSuggestionPresentationRange(
        canonical,
        markedPending,
        undefined,
        transition,
      ),
    ).toEqual({
      from: canonical.indexOf("results"),
      to: canonical.indexOf("results") + 7,
    });
  });

  it("retains evidence for the pending lifetime and prunes amendment or disposition changes", () => {
    const retained = retainCommittedSuggestionPresentationTransitions(
      new Map(),
      [pending],
      [committed],
    );
    expect(retained.size).toBe(1);
    expect(
      retained.get(suggestionPresentationTransitionKey(pending))?.after,
    ).toBe(after);
    expect(pruneSuggestionPresentationTransitions(retained, [pending])).toBe(
      retained,
    );
    expect(
      pruneSuggestionPresentationTransitions(retained, [
        { ...pending, revision: 2 },
      ]).size,
    ).toBe(0);
    expect(
      pruneSuggestionPresentationTransitions(retained, [
        {
          ...pending,
          operations: [
            edit(
              before,
              pending.operations[0]!.anchor.from,
              pending.operations[0]!.anchor.to,
              "outcomes",
            ),
          ],
        },
      ]).size,
    ).toBe(0);
    expect(
      pruneSuggestionPresentationTransitions(retained, [
        { ...pending, status: "rejected" },
      ]).size,
    ).toBe(0);
    expect(pruneSuggestionPresentationTransitions(retained, []).size).toBe(0);
  });
});

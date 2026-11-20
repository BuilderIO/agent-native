import type { ResourceSuggestion } from "@agent-native/core/review";
import { canonicalizeNfm } from "@shared/nfm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSuggestionDraftSession,
  planSuggestionDraftPersistence,
  suggestionDraftOperations,
  suggestionOperationKey,
  type SuggestionPersistenceEntry,
} from "./draft-session";
import {
  SUGGESTION_FOLLOW_QUIET_MS,
  SUGGESTION_FOLLOW_RECHECK_MS,
  carryOwnSuggestions,
  readPageOnLiveCopyChange,
  suggestionPageFollow,
} from "./follow-page";

const hash = (char: string) => `sha256:${char.repeat(64)}`;
const session = {
  baseContent: "First paragraph.\n\nSecond paragraph.\n",
  baseRevision: `body:4:${hash("a")}`,
};
const newerPage = {
  content: "First paragraph.\n\nSecond paragraph, with more.\n",
  revision: `body:5:${hash("b")}`,
  updatedAt: "2026-11-06T23:00:05.000Z",
};
const base = {
  session,
  page: newerPage,
  draftUpdatedAt: "2026-11-06T23:00:00.000Z",
  settled: true,
  draftChangedAt: null,
  now: 1_000_000,
};

describe("suggestionPageFollow", () => {
  it("starts the draft over from a newer Page once nothing is unsaved", () => {
    expect(suggestionPageFollow(base)).toEqual({ kind: "restart" });
  });

  it("stays on the Page the draft started from", () => {
    expect(
      suggestionPageFollow({
        ...base,
        page: {
          content: session.baseContent,
          revision: session.baseRevision,
          updatedAt: base.draftUpdatedAt,
        },
      }),
    ).toEqual({ kind: "stay" });
  });

  it("never moves back to an older Page", () => {
    expect(
      suggestionPageFollow({
        ...base,
        page: { ...newerPage, revision: `body:3:${hash("c")}` },
      }),
    ).toEqual({ kind: "stay" });
  });

  it("only updates the revision when the Page text is the same", () => {
    expect(
      suggestionPageFollow({
        ...base,
        page: { ...newerPage, content: session.baseContent },
        settled: false,
      }),
    ).toEqual({ kind: "rebase", baseRevision: newerPage.revision });
  });

  it("checks again while a save or decision is still running", () => {
    expect(suggestionPageFollow({ ...base, settled: false })).toEqual({
      kind: "wait",
      ms: SUGGESTION_FOLLOW_RECHECK_MS,
    });
  });

  it("waits for the typing to pause", () => {
    expect(
      suggestionPageFollow({ ...base, draftChangedAt: base.now - 500 }),
    ).toEqual({ kind: "wait", ms: SUGGESTION_FOLLOW_QUIET_MS - 500 });
    expect(
      suggestionPageFollow({
        ...base,
        draftChangedAt: base.now - SUGGESTION_FOLLOW_QUIET_MS,
      }),
    ).toEqual({ kind: "restart" });
  });

  it("leaves an amendment to a saved suggestion alone", () => {
    expect(
      suggestionPageFollow({
        ...base,
        session: {
          ...session,
          existingSuggestion: {
            id: "suggestion-1",
            threadId: "thread-1",
            revision: 1,
            baseRevision: session.baseRevision,
          },
        },
      }),
    ).toEqual({ kind: "stay" });
  });

  it("compares save times when the revisions are not body revisions", () => {
    const timestamped = {
      ...base,
      session: { ...session, baseRevision: base.draftUpdatedAt },
    };
    expect(
      suggestionPageFollow({
        ...timestamped,
        page: { ...newerPage, revision: newerPage.updatedAt },
      }),
    ).toEqual({ kind: "restart" });
    expect(
      suggestionPageFollow({
        ...timestamped,
        page: {
          ...newerPage,
          revision: "2026-11-06T22:00:00.000Z",
          updatedAt: "2026-11-06T22:00:00.000Z",
        },
      }),
    ).toEqual({ kind: "stay" });
  });
});

describe("readPageOnLiveCopyChange", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A live copy to change, and reads that finish when the test says. */
  function setUp(alreadyReading = () => false) {
    let changed: (() => void) | null = null;
    const finishes: Array<() => void> = [];
    const read = vi.fn(
      () => new Promise<void>((resolve) => finishes.push(resolve)),
    );
    const stop = readPageOnLiveCopyChange({
      subscribe: (listener) => {
        changed = listener;
        return () => {
          changed = null;
        };
      },
      read,
      alreadyReading,
    });
    return {
      read,
      stop,
      change: () => changed?.(),
      subscribed: () => changed !== null,
      async finishRead() {
        finishes.shift()?.();
        await Promise.resolve();
        await Promise.resolve();
      },
    };
  }

  it("reads once for a burst of changes", () => {
    const live = setUp();
    live.change();
    live.change();
    live.change();
    expect(live.read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SUGGESTION_FOLLOW_RECHECK_MS);
    expect(live.read).toHaveBeenCalledTimes(1);
  });

  it("lets a read finish when changes keep coming, then reads once more", async () => {
    const live = setUp();
    live.change();
    vi.advanceTimersByTime(SUGGESTION_FOLLOW_RECHECK_MS);
    for (let step = 0; step < 5; step++) {
      live.change();
      vi.advanceTimersByTime(SUGGESTION_FOLLOW_RECHECK_MS);
    }
    expect(live.read).toHaveBeenCalledTimes(1);
    await live.finishRead();
    vi.advanceTimersByTime(SUGGESTION_FOLLOW_RECHECK_MS);
    expect(live.read).toHaveBeenCalledTimes(2);
    await live.finishRead();
    vi.advanceTimersByTime(SUGGESTION_FOLLOW_RECHECK_MS * 4);
    expect(live.read).toHaveBeenCalledTimes(2);
  });

  it("reads once more after joining a read that was already on its way", async () => {
    const live = setUp(() => true);
    live.change();
    vi.advanceTimersByTime(SUGGESTION_FOLLOW_RECHECK_MS);
    await live.finishRead();
    vi.advanceTimersByTime(SUGGESTION_FOLLOW_RECHECK_MS);
    expect(live.read).toHaveBeenCalledTimes(2);
  });

  it("stops listening and reading once stopped", async () => {
    const live = setUp();
    live.change();
    vi.advanceTimersByTime(SUGGESTION_FOLLOW_RECHECK_MS);
    live.change();
    live.stop();
    expect(live.subscribed()).toBe(false);
    await live.finishRead();
    vi.advanceTimersByTime(SUGGESTION_FOLLOW_RECHECK_MS * 4);
    expect(live.read).toHaveBeenCalledTimes(1);
  });
});

describe("carryOwnSuggestions", () => {
  const page = (...paragraphs: string[]) =>
    canonicalizeNfm(paragraphs.join("

"));
  const base = page(
    "Opening paragraph of the page.",
    "Middle paragraph of the page.",
    "Closing paragraph of the page.",
  );
  const draft = page(
    "Opening paragraph of the page. First.",
    "Middle paragraph of the page.",
    "Closing paragraph of the page.",
  );
  const newer = page(
    "Opening paragraph of the page.",
    "Middle paragraph of the page.",
    "Closing paragraph of the page. Words from another tab.",
  );
  const session = (content: string, revision: string) =>
    createSuggestionDraftSession({
      id: `session-${revision}`,
      baseContent: content,
      baseRevision: revision,
      startedAt: "2026-11-20T23:00:00.000Z",
      initialContent: content,
    });
  const saved = (status: ResourceSuggestion["status"] = "pending") =>
    ({ id: "first", status }) as ResourceSuggestion;
  // This tab's saved suggestions, as a save records them.
  const entriesFor = (content: string, suggestion = saved()) => {
    const operations = suggestionDraftOperations(
      session(base, "body:4"),
      content,
    );
    return new Map<string, SuggestionPersistenceEntry>(
      operations.map((operation) => [
        suggestionOperationKey(operation),
        { idempotencyKey: "create-first", operation, suggestion },
      ]),
    );
  };
  const carry = (
    overrides: Partial<Parameters<typeof carryOwnSuggestions>[0]> = {},
  ) =>
    carryOwnSuggestions({
      session: session(base, "body:4"),
      draft,
      next: session(newer, "body:5"),
      entries: entriesFor(draft),
      latest: () => saved(),
      ...overrides,
    });

  it("keeps this tab's saved suggestion in the draft for the newer Page", () => {
    const carried = carry();
    expect(carried?.content).toBe(
      page(
        "Opening paragraph of the page. First.",
        "Middle paragraph of the page.",
        "Closing paragraph of the page. Words from another tab.",
      ),
    );
    const next = session(newer, "body:5");
    const plan = planSuggestionDraftPersistence(
      suggestionDraftOperations(next, carried!.content),
      carried!.entries,
    );
    // Nothing is saved again: the suggestion reads as already saved.
    expect(plan.create).toEqual([]);
    expect(plan.amend).toEqual([]);
    expect(plan.withdraw).toEqual([]);
    expect([...plan.unchanged.values()].map(({ id }) => id)).toEqual(["first"]);
  });

  it("reads words typed right after it on from it", () => {
    const carried = carry()!;
    const typed = carried.content.replace("First.", "First. Second.");
    const plan = planSuggestionDraftPersistence(
      suggestionDraftOperations(session(newer, "body:5"), typed),
      carried.entries,
    );
    expect(plan.create).toEqual([]);
    expect(plan.amend).toHaveLength(1);
    expect(plan.amend[0]).toMatchObject({
      suggestion: { id: "first" },
      operation: { after: { changedText: " First. Second." } },
    });
  });

  it("starts over when one of them was decided elsewhere", () => {
    expect(carry({ latest: () => saved("rejected") })).toBeNull();
    expect(carry({ latest: () => undefined })).toBeNull();
  });

  it("starts over when someone else changed the same paragraph", () => {
    const sameParagraph = page(
      "Opening paragraph of the page, changed elsewhere.",
      "Middle paragraph of the page.",
      "Closing paragraph of the page.",
    );
    expect(carry({ next: session(sameParagraph, "body:5") })).toBeNull();
  });

  it("starts over with nothing saved, or with typing not yet saved", () => {
    expect(carry({ entries: new Map() })).toBeNull();
    expect(
      carry({
        draft: page(
          "Opening paragraph of the page. First.",
          "Middle paragraph of the page. Unsaved.",
          "Closing paragraph of the page.",
        ),
      }),
    ).toBeNull();
  });
});

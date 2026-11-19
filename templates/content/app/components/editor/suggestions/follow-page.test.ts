import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SUGGESTION_FOLLOW_QUIET_MS,
  SUGGESTION_FOLLOW_RECHECK_MS,
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

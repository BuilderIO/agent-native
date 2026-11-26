import { describe, expect, it } from "vitest";

import type { ThreadSummary } from "@/lib/threads";

import {
  INITIAL_NEW_MAIL_ABOVE,
  trackNewMailAbove,
} from "./use-new-mail-above";

function thread(
  id: string,
  read = false,
  date = "2026-01-02T00:00:00.000Z",
): ThreadSummary {
  return {
    latestMessage: {
      id,
      threadId: `thread-${id}`,
      isRead: read,
      date,
    } as ThreadSummary["latestMessage"],
    participants: [],
    messageCount: 1,
    hasUnread: !read,
    hasStarred: false,
    labelIds: [],
  };
}

const a = thread("a");
const b = thread("b");
const c = thread("c");

function baseline(threads: ThreadSummary[], firstVisible: number) {
  return trackNewMailAbove(
    INITIAL_NEW_MAIL_ABOVE,
    "inbox",
    threads,
    firstVisible,
  );
}

describe("trackNewMailAbove", () => {
  it("takes the first list with mail as what was already there", () => {
    const empty = baseline([], 0);
    expect(empty.known).toBeNull();

    const state = trackNewMailAbove(empty, "inbox", [a, b, c], 2);
    expect(state.known).toEqual(new Set(["a", "b", "c"]));
    expect(state.arrived.size).toBe(0);
  });

  it("counts unread mail that arrives above the first row in view", () => {
    const state = trackNewMailAbove(
      baseline([a, b, c], 2),
      "inbox",
      [thread("n"), a, b, c],
      2,
    );
    expect([...state.arrived]).toEqual(["n"]);
  });

  it("leaves out mail that arrives in view or already read", () => {
    const inView = trackNewMailAbove(
      baseline([a, b, c], 0),
      "inbox",
      [thread("n"), a, b, c],
      0,
    );
    expect(inView.arrived.size).toBe(0);

    const read = trackNewMailAbove(
      baseline([a, b, c], 2),
      "inbox",
      [thread("n", true), a, b, c],
      2,
    );
    expect(read.arrived.size).toBe(0);
  });

  it("drops an arrival once it is read, scrolled into view or gone", () => {
    const counted = trackNewMailAbove(
      baseline([a, b, c], 2),
      "inbox",
      [thread("n"), a, b, c],
      2,
    );
    const n = thread("n");

    expect(
      trackNewMailAbove(counted, "inbox", [thread("n", true), a, b, c], 2)
        .arrived.size,
    ).toBe(0);
    expect(
      trackNewMailAbove(counted, "inbox", [n, a, b, c], 0).arrived.size,
    ).toBe(0);
    expect(trackNewMailAbove(counted, "inbox", [a, b, c], 2).arrived.size).toBe(
      0,
    );
  });

  it("does not count an arrival seen in view after scrolling away", () => {
    const seen = trackNewMailAbove(
      baseline([a, b, c], 0),
      "inbox",
      [thread("n"), a, b, c],
      0,
    );
    expect(
      trackNewMailAbove(seen, "inbox", [thread("n"), a, b, c], 3).arrived.size,
    ).toBe(0);
  });

  it("starts over when the list changes", () => {
    const counted = trackNewMailAbove(
      baseline([a, b, c], 2),
      "inbox",
      [thread("n"), a, b, c],
      2,
    );
    const other = trackNewMailAbove(
      counted,
      "starred",
      [thread("n"), a, b, c],
      2,
    );
    expect(other.listKey).toBe("starred");
    expect(other.arrived.size).toBe(0);
  });

  it("leaves out mail older than everything the list had", () => {
    const older = thread("old", false, "2025-12-01T00:00:00.000Z");
    const paged = trackNewMailAbove(
      baseline([a, b, c], 2),
      "inbox",
      [older, a, b, c],
      2,
    );
    expect(paged.arrived.size).toBe(0);

    const counted = trackNewMailAbove(
      paged,
      "inbox",
      [thread("n"), older, a, b, c],
      3,
    );
    expect([...counted.arrived]).toEqual(["n"]);
  });

  it("counts by the newest message, not the thread", () => {
    const replied = { ...thread("n", true), hasUnread: true };
    const state = trackNewMailAbove(
      baseline([a, b, c], 2),
      "inbox",
      [replied, a, b, c],
      2,
    );
    expect(state.arrived.size).toBe(0);
  });

  it("waits while the list still shows the last one's results", () => {
    const counted = trackNewMailAbove(
      baseline([a, b, c], 2),
      "inbox",
      [thread("n"), a, b, c],
      2,
    );
    const pending = trackNewMailAbove(counted, null, [thread("n"), a, b, c], 2);
    expect(pending).toBe(INITIAL_NEW_MAIL_ABOVE);
    expect(trackNewMailAbove(pending, null, [a, b, c], 2)).toBe(pending);

    const resolved = trackNewMailAbove(
      pending,
      "starred",
      [thread("m"), thread("n"), a],
      2,
    );
    expect(resolved.known).toEqual(new Set(["m", "n", "a"]));
    expect(resolved.arrived.size).toBe(0);
  });

  it("keeps the same state when nothing changed", () => {
    const state = baseline([a, b, c], 1);
    expect(trackNewMailAbove(state, "inbox", [a, b, c], 1)).toBe(state);
  });
});

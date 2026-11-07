import { describe, expect, it } from "vitest";

import {
  SUGGESTION_FOLLOW_QUIET_MS,
  SUGGESTION_FOLLOW_RECHECK_MS,
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

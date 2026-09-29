import { describe, expect, it } from "vitest";

import {
  contentRecentHref,
  readContentRecentState,
  recordContentRecentVisit,
  contentRecentVisitKey,
  removeContentRecentEntry,
} from "./content-personal-navigation";

describe("personal Recent navigation", () => {
  it("forgets one destination and returns the same state when nothing matches", () => {
    let state = readContentRecentState(null);
    for (const [target, visitedAt] of [
      [{ documentId: "page" }, "2026-09-09T10:00:00.000Z"],
      [
        { documentId: "db-page", databaseId: "db", viewId: "board" },
        "2026-09-09T11:00:00.000Z",
      ],
    ] as const) {
      state = recordContentRecentVisit(state, { target, visitedAt });
    }
    const removed = removeContentRecentEntry(state, {
      documentId: "db-page",
      databaseId: "db",
    });
    expect(removed.entries.map((entry) => entry.target.documentId)).toEqual([
      "page",
    ]);
    expect(removeContentRecentEntry(removed, { documentId: "missing" })).toBe(
      removed,
    );
  });

  it("preserves a newer same-target visit when an earlier request completes last", () => {
    const target = { documentId: "page", databaseId: "db", viewId: "board" };
    let state = recordContentRecentVisit(readContentRecentState(null), {
      target,
      visitedAt: "2026-09-09T12:00:00.000Z",
    });
    state = recordContentRecentVisit(state, {
      target: { documentId: "another-page" },
      visitedAt: "2026-09-09T11:00:00.000Z",
    });
    state = recordContentRecentVisit(state, {
      target: { ...target, viewId: "table" },
      visitedAt: "2026-09-09T10:00:00.000Z",
    });
    expect(state.entries).toEqual([
      { target, visitedAt: "2026-09-09T12:00:00.000Z" },
      {
        target: { documentId: "another-page" },
        visitedAt: "2026-09-09T11:00:00.000Z",
      },
    ]);
  });

  it("keeps one database entry while restoring its latest visited View", () => {
    const table = { documentId: "page", databaseId: "db", viewId: "table" };
    const board = { ...table, viewId: "board" };
    let state = readContentRecentState(null);
    state = recordContentRecentVisit(state, {
      target: table,
      visitedAt: "2026-09-09T10:00:00.000Z",
    });
    state = recordContentRecentVisit(state, {
      target: board,
      visitedAt: "2026-09-09T11:00:00.000Z",
    });
    state = recordContentRecentVisit(state, {
      target: table,
      visitedAt: "2026-09-09T12:00:00.000Z",
    });
    expect(state.entries.map((entry) => entry.target.viewId)).toEqual([
      "table",
    ]);
    expect(contentRecentVisitKey(table)).not.toBe(contentRecentVisitKey(board));
    expect(contentRecentHref(table)).toBe(
      "/page/page?databaseId=db&viewId=table",
    );
  });

  it("migrates v1 View duplicates deterministically and keeps the newest visit", () => {
    const state = readContentRecentState({
      version: 1,
      entries: [
        {
          target: { documentId: "page", databaseId: "db", viewId: "board" },
          visitedAt: "2026-09-09T12:00:00.000Z",
        },
        {
          target: { documentId: "page", databaseId: "db", viewId: "table" },
          visitedAt: "2026-09-09T12:00:00.000Z",
        },
        {
          target: { documentId: "other" },
          visitedAt: "2026-09-09T11:00:00.000Z",
        },
      ],
    });
    expect(state).toEqual({
      version: 2,
      entries: [
        {
          target: { documentId: "page", databaseId: "db", viewId: "board" },
          visitedAt: "2026-09-09T12:00:00.000Z",
        },
        {
          target: { documentId: "other" },
          visitedAt: "2026-09-09T11:00:00.000Z",
        },
      ],
    });
  });

  it("bounds navigation history without storing target metadata", () => {
    let state = readContentRecentState(null);
    for (let i = 0; i < 60; i++)
      state = recordContentRecentVisit(state, {
        target: { documentId: `page-${i}` },
        visitedAt: new Date(i * 1000).toISOString(),
      });
    expect(state.entries).toHaveLength(50);
    expect(state.entries[0].target.documentId).toBe("page-59");
    expect(state.entries[49].target.documentId).toBe("page-10");
    expect(() =>
      readContentRecentState({ version: 1, entries: "bad" }),
    ).toThrow();
  });
});

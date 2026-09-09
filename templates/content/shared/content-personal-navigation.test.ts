import { describe, expect, it } from "vitest";

import {
  contentRecentHref,
  readContentRecentState,
  recordContentRecentVisit,
} from "./content-personal-navigation";

describe("personal Recent navigation", () => {
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
      target,
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

  it("retains separate Views and promotes only the explicitly visited identity", () => {
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
      "board",
    ]);
    expect(contentRecentHref(table)).toBe(
      "/page/page?databaseId=db&viewId=table",
    );
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

import { describe, expect, it } from "vitest";

import {
  createDatabaseView,
  normalizeClientDatabaseViewConfig,
  resolveRequestedDatabaseView,
  databaseViewHasPersonalQueryChanges,
  databaseViewConfigWithSavedQueryState,
} from "./DatabaseView";

describe("exact personal View navigation", () => {
  const table = createDatabaseView("table");
  const board = createDatabaseView("Board", "board", {}, "board");
  const saved = normalizeClientDatabaseViewConfig({
    activeViewId: table.id,
    views: [table, board],
  });

  it("opens the requested View without changing the shared default", () => {
    const personal = resolveRequestedDatabaseView(saved, board.id)!;
    expect(personal.activeViewId).toBe(board.id);
    expect(saved.activeViewId).toBe(table.id);
    expect(databaseViewHasPersonalQueryChanges(personal, saved)).toBe(true);
    expect(databaseViewConfigWithSavedQueryState(personal, saved)).toEqual(
      saved,
    );
  });

  it("keeps a missing exact View unavailable instead of opening the default", () => {
    expect(resolveRequestedDatabaseView(saved, "missing-view")).toBeNull();
  });

  it("preserves the effective personal View on an ordinary Page open", () => {
    const personal = resolveRequestedDatabaseView(saved, board.id)!;
    expect(resolveRequestedDatabaseView(personal, null)).toBe(personal);
  });
});

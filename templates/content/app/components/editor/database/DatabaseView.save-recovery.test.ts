import { describe, expect, it } from "vitest";

import {
  createDatabaseView,
  defaultDatabaseViewConfig,
  databaseViewConfigWithSavedQueryState,
  rollbackFailedDatabaseViewSave,
} from "./DatabaseView";

function config(wrapped: boolean, frozen: string | null = null) {
  const base = defaultDatabaseViewConfig();
  return {
    ...base,
    views: [
      createDatabaseView("Table", "default", {
        columnWrapOverrides: { name: wrapped },
        frozenThroughColumnId: frozen,
      }),
    ],
  };
}

describe("failed table presentation saves", () => {
  it("restores the latest committed layout after a later save fails", () => {
    const committed = config(true);
    const failed = config(true, "name");
    expect(
      rollbackFailedDatabaseViewSave({
        databaseId: "qa",
        current: failed,
        saved: committed,
        failed,
        personalQueryDirty: false,
      }),
    ).toEqual(committed);
  });

  it("does not overwrite a newer local arrangement with an older failure", () => {
    const saved = config(false);
    const failed = config(true);
    const newer = config(true, "name");
    expect(
      rollbackFailedDatabaseViewSave({
        databaseId: "qa",
        current: newer,
        saved,
        failed,
        personalQueryDirty: false,
      }),
    ).toBe(newer);
  });

  it("keeps personal query exploration when shared presentation rolls back", () => {
    const saved = config(false);
    const current = config(true, "name");
    current.views[0].sorts = [
      { key: "name", label: "Name", direction: "desc" },
    ];
    const failed = databaseViewConfigWithSavedQueryState(current, saved);
    const result = rollbackFailedDatabaseViewSave({
      databaseId: "qa",
      current,
      saved,
      failed,
      personalQueryDirty: true,
    });
    expect(result.views[0].columnWrapOverrides).toEqual({ name: false });
    expect(result.views[0].frozenThroughColumnId).toBeNull();
    expect(result.views[0].sorts).toEqual(current.views[0].sorts);
  });
});

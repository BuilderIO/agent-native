import { describe, expect, it } from "vitest";

import type { ContentDatabaseView } from "./api";
import {
  databaseTableColumnIds,
  reorderDatabaseTableColumn,
  withSavedTableColumnOrder,
} from "./database-table-columns";

const view: ContentDatabaseView = {
  id: "table",
  name: "Table",
  type: "table",
  sorts: [],
  filters: [],
  columnWidths: {},
};

describe("table column presentation", () => {
  it("preserves an omitted order from older clients and honors an explicit reset", () => {
    const saved = [{ id: "table", tableColumnOrderIds: ["text", "name"] }];
    expect(
      withSavedTableColumnOrder({ id: "table" }, saved).tableColumnOrderIds,
    ).toEqual(["text", "name"]);
    expect(
      withSavedTableColumnOrder({ id: "table", tableColumnOrderIds: [] }, saved)
        .tableColumnOrderIds,
    ).toEqual([]);
    expect(
      withSavedTableColumnOrder({ id: "other" }, saved).tableColumnOrderIds,
    ).toEqual([]);
  });
  it("keeps Name first for legacy views and appends new properties", () => {
    expect(databaseTableColumnIds(["text", "status"])).toEqual([
      "name",
      "text",
      "status",
    ]);
    expect(
      databaseTableColumnIds(
        ["text", "status", "new"],
        ["status", "name", "text", "status", "deleted"],
      ),
    ).toEqual(["status", "name", "text", "new"]);
  });
  it("moves Name across properties without changing their schema identity", () => {
    const moved = reorderDatabaseTableColumn(
      view,
      ["text", "hidden", "status"],
      ["text", "status"],
      "name",
      "status",
      "after",
    );
    expect(moved.tableColumnOrderIds).toEqual([
      "text",
      "hidden",
      "status",
      "name",
    ]);
    expect(moved.propertyOrderIds).toEqual(["text", "hidden", "status"]);
    const back = reorderDatabaseTableColumn(
      moved,
      ["text", "hidden", "status"],
      ["text", "status"],
      "status",
      "name",
      "after",
    );
    expect(
      databaseTableColumnIds(["text", "status"], back.tableColumnOrderIds),
    ).toEqual(["text", "name", "status"]);
    expect(moved.hiddenPropertyIds).toBe(view.hiddenPropertyIds);
  });
  it("ignores invalid and hidden drag endpoints", () => {
    expect(
      reorderDatabaseTableColumn(
        view,
        ["text", "hidden"],
        ["text"],
        "name",
        "hidden",
        "before",
      ),
    ).toBe(view);
    expect(
      reorderDatabaseTableColumn(
        view,
        ["text"],
        ["text"],
        "missing",
        "name",
        "after",
      ),
    ).toBe(view);
  });
});

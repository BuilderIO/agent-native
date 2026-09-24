import { describe, expect, it } from "vitest";

import type { ContentDatabaseView } from "./api";
import {
  databaseColumnWraps,
  databaseFrozenColumnIds,
  databaseTableColumnIds,
  reorderDatabaseTableColumn,
  withDatabaseColumnWrap,
  withDatabaseWrapDefault,
  withSavedTableColumnPresentation,
  withSavedTableColumnOrder,
  withoutDatabaseColumnPresentation,
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
  it("preserves omitted column presentation fields from older clients", () => {
    const saved = [
      {
        id: "table",
        tableColumnOrderIds: ["text", "name"],
        wrapCells: false,
        columnWrapOverrides: { text: true },
        frozenThroughColumnId: null,
      },
    ];
    expect(
      withSavedTableColumnPresentation(
        { id: "table", frozenThroughColumnId: "name" },
        saved,
      ),
    ).toMatchObject({
      tableColumnOrderIds: ["text", "name"],
      columnWrapOverrides: { text: true },
      frozenThroughColumnId: "name",
    });
    expect(
      withSavedTableColumnPresentation({ id: "table" }, saved),
    ).toMatchObject({
      columnWrapOverrides: { text: true },
      frozenThroughColumnId: null,
    });
  });
  it("resolves wrap overrides and clears them when the global default changes", () => {
    const wrapped = withDatabaseColumnWrap(view, "text", true);
    expect(databaseColumnWraps(wrapped, "text")).toBe(true);
    expect(databaseColumnWraps(wrapped, "name")).toBe(false);
    expect(
      withDatabaseColumnWrap(wrapped, "text", false).columnWrapOverrides,
    ).toEqual({});
    expect(withDatabaseWrapDefault(wrapped, true)).toMatchObject({
      wrapCells: true,
      columnWrapOverrides: {},
    });
  });
  it("defaults freeze to the first visible column and preserves hidden endpoints", () => {
    const visible = ["content", "name", "text"];
    expect(databaseFrozenColumnIds(view, visible)).toEqual(["content"]);
    expect(
      databaseFrozenColumnIds(
        { ...view, frozenThroughColumnId: "text" },
        visible,
      ),
    ).toEqual(visible);
    expect(
      databaseFrozenColumnIds(
        { ...view, frozenThroughColumnId: "hidden" },
        visible,
      ),
    ).toEqual([]);
    expect(
      databaseFrozenColumnIds(
        { ...view, frozenThroughColumnId: null },
        visible,
      ),
    ).toEqual([]);
  });
  it("caps the effective frozen prefix while preserving the stored endpoint", () => {
    const frozen = { ...view, frozenThroughColumnId: "text" };
    const visible = ["number", "name", "text"];
    const widths = { number: 96, name: 220, text: 180 };
    expect(
      databaseFrozenColumnIds(frozen, visible, {
        widths,
        viewportWidth: 500,
        gutterWidth: 64,
      }),
    ).toEqual(["number", "name"]);
    expect(
      databaseFrozenColumnIds(frozen, visible, {
        widths,
        viewportWidth: 250,
        gutterWidth: 64,
      }),
    ).toEqual([]);
    expect(
      databaseFrozenColumnIds(frozen, visible, {
        widths,
        viewportWidth: 900,
        gutterWidth: 64,
      }),
    ).toEqual(visible);
    expect(
      databaseFrozenColumnIds(frozen, visible, {
        widths,
        viewportWidth: undefined,
      }),
    ).toEqual(visible);
    expect(frozen.frozenThroughColumnId).toBe("text");
  });
  it("clears only an intentionally deleted column's presentation state", () => {
    expect(
      withoutDatabaseColumnPresentation(
        {
          ...view,
          columnWrapOverrides: { hidden: true, deleted: true },
          frozenThroughColumnId: "deleted",
        },
        "deleted",
      ),
    ).toMatchObject({
      columnWrapOverrides: { hidden: true },
      frozenThroughColumnId: null,
    });
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

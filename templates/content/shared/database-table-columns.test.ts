import { describe, expect, it } from "vitest";

import type { ContentDatabaseItemLayout, ContentDatabaseView } from "./api";
import { resolveContentDatabaseItemLayout } from "./database-item-layout";
import {
  databaseColumnWraps,
  databaseFrozenColumnIds,
  databaseTableColumnIds,
  reorderDatabaseTableColumn,
  withDatabaseColumnWrap,
  withDatabaseWrapDefault,
  withSavedTableColumnPresentation,
  withSavedTableColumnOrder,
  withoutDeletedDatabaseProperty,
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
      withoutDeletedDatabaseProperty(
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
  it("drops every view reference to a deleted property", () => {
    const filter = {
      label: "Status",
      operator: "equals" as const,
      value: "published",
    };
    const cleaned = withoutDeletedDatabaseProperty(
      {
        ...view,
        sorts: [
          { key: "deleted", label: "Deleted", direction: "asc" },
          { key: "name", label: "Name", direction: "desc" },
        ],
        filters: [
          { ...filter, key: "deleted" },
          { ...filter, key: "kept" },
        ],
        columnWidths: { deleted: 120, kept: 200 },
        groupByPropertyId: "deleted",
        datePropertyId: "date",
        hiddenPropertyIds: ["deleted", "hidden"],
        propertyOrderIds: ["kept", "deleted"],
        tableColumnOrderIds: ["name", "deleted", "kept"],
        calculations: { deleted: "count_all", kept: "count_values" },
        formQuestions: [
          { key: "deleted", enabled: true, required: false },
          { key: "kept", enabled: true, required: true },
        ],
        itemLayout: {
          leading: { kind: "checkbox", propertyId: "deleted" },
          titleWeight: "medium",
          line2: { propertyId: "deleted", lines: 1 },
          line3: ["deleted", "kept"],
          trailing: ["kept", "deleted"],
        },
      },
      "deleted",
    );

    expect(cleaned).toMatchObject({
      sorts: [{ key: "name" }],
      filters: [{ key: "kept" }],
      columnWidths: { kept: 200 },
      groupByPropertyId: null,
      datePropertyId: "date",
      hiddenPropertyIds: ["hidden"],
      propertyOrderIds: ["kept"],
      tableColumnOrderIds: ["name", "kept"],
      calculations: { kept: "count_values" },
      formQuestions: [{ key: "kept" }],
      itemLayout: {
        leading: { kind: "page_icon", propertyId: null },
        line2: { propertyId: null, lines: 1 },
        line3: ["kept"],
        trailing: ["kept"],
      },
    });
    expect(cleaned.columnWidths).not.toHaveProperty("deleted");
    expect(cleaned.calculations).not.toHaveProperty("deleted");
  });
  it("keeps a deleted leading checkbox from switching to another checkbox", () => {
    const layout: ContentDatabaseItemLayout = {
      leading: { kind: "checkbox", propertyId: "deleted" },
      titleWeight: "medium",
      line2: { propertyId: null, lines: 1 },
      line3: [],
      trailing: [],
    };
    const cleaned = withoutDeletedDatabaseProperty(
      { ...view, itemLayout: layout },
      "deleted",
    ).itemLayout;
    if (!cleaned) throw new Error("the cleaned view lost its item layout");

    expect(
      resolveContentDatabaseItemLayout(cleaned, [
        { definition: { id: "other", type: "checkbox" } },
      ]).leading,
    ).toEqual({ kind: "page_icon", property: null });
    expect(
      withoutDeletedDatabaseProperty({ ...view, itemLayout: layout }, "other")
        .itemLayout?.leading,
    ).toEqual(layout.leading);
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

import { describe, expect, it } from "vitest";

import { parseDatabaseViewConfig } from "./_property-utils";
import action from "./update-content-database-view";

describe("update content database view", () => {
  it("preserves supported per-view settings through action validation", () => {
    const parsed = action.schema.parse({
      databaseId: "database",
      viewConfig: {
        activeViewId: "table",
        views: [
          {
            id: "table",
            name: "Table",
            type: "table",
            sorts: [],
            filters: [
              {
                key: "author",
                label: "Author",
                operator: "contains",
                value: "Alice",
                filterGroupId: "advanced-nested",
                parentFilterGroupId: "advanced",
              },
            ],
            filterMode: "or",
            columnWidths: {},
            groupByPropertyId: "status",
            datePropertyId: "date",
            endDatePropertyId: "end-date",
            hiddenPropertyIds: ["hidden"],
            propertyOrderIds: ["name", "status"],
            tableColumnOrderIds: ["status", "name"],
            collapsedGroupIds: ["status:done"],
            hideEmptyGroups: true,
            calculations: { status: "count_values" },
            wrapCells: true,
            columnWrapOverrides: { status: false, name: true },
            frozenThroughColumnId: "status",
            rowDensity: "comfortable",
            openPagesIn: "full_page",
            formQuestions: [
              { key: "name", enabled: true, required: true },
              { key: "status", enabled: true, required: false },
            ],
          },
        ],
      },
    });

    expect(parsed.viewConfig.views[0]).toMatchObject({
      filterMode: "or",
      filters: [
        {
          filterGroupId: "advanced-nested",
          parentFilterGroupId: "advanced",
        },
      ],
      collapsedGroupIds: ["status:done"],
      propertyOrderIds: ["name", "status"],
      tableColumnOrderIds: ["status", "name"],
      hideEmptyGroups: true,
      calculations: { status: "count_values" },
      wrapCells: true,
      columnWrapOverrides: { status: false, name: true },
      frozenThroughColumnId: "status",
      rowDensity: "comfortable",
      openPagesIn: "full_page",
      formQuestions: [
        { key: "name", enabled: true, required: true },
        { key: "status", enabled: true, required: false },
      ],
    });
  });

  it("preserves explicit null freeze and rejects malformed presentation values", () => {
    const parsed = action.schema.parse({
      databaseId: "database",
      viewConfig: {
        views: [
          {
            id: "table",
            name: "Table",
            type: "table",
            frozenThroughColumnId: null,
          },
        ],
      },
    });
    expect(parsed.viewConfig.views[0]?.frozenThroughColumnId).toBeNull();

    expect(() =>
      action.schema.parse({
        databaseId: "database",
        viewConfig: {
          views: [
            {
              id: "table",
              name: "Table",
              type: "table",
              columnWrapOverrides: { status: "yes" },
            },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      action.schema.parse({
        databaseId: "database",
        viewConfig: {
          views: [
            {
              id: "table",
              name: "Table",
              type: "table",
              frozenThroughColumnId: "",
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("normalizes retired sidebar saved views to tables", () => {
    const parsed = action.schema.parse({
      databaseId: "database",
      viewConfig: {
        activeViewId: "sidebar",
        views: [
          {
            id: "sidebar",
            name: "Navigation",
            type: "sidebar",
            sorts: [],
            filters: [],
            columnWidths: {},
            groupByPropertyId: "status",
          },
        ],
      },
    });

    expect(parsed.viewConfig.views[0]?.type).toBe("table");
  });

  it("keeps legacy JSON compatible and normalizes form questions on startup reads", () => {
    const legacy = parseDatabaseViewConfig(
      JSON.stringify({
        activeViewId: "legacy",
        views: [
          {
            id: "legacy",
            name: "Legacy table",
            type: "table",
            sorts: [],
            filters: [],
            columnWidths: {},
          },
        ],
      }),
    );
    expect(legacy.views[0].formQuestions).toEqual([]);

    const form = parseDatabaseViewConfig(
      JSON.stringify({
        activeViewId: "form",
        views: [
          {
            id: "form",
            name: "Request",
            type: "form",
            formQuestions: [
              { key: "name", enabled: true, required: true },
              { key: "name", enabled: false, required: false },
            ],
          },
        ],
      }),
    );
    expect(form.views[0]).toMatchObject({
      type: "form",
      formQuestions: [{ key: "name", enabled: true, required: true }],
    });
  });

  it("saves a list view's row layout and clears it with null", () => {
    const itemLayout = {
      leading: { kind: "checkbox", propertyId: "done" },
      titleWeight: "bold",
      line2: { propertyId: "pitch", lines: 2 },
      line3: ["due"],
      trailing: ["owner"],
    } as const;
    const parsed = action.schema.parse({
      databaseId: "database",
      viewConfig: {
        activeViewId: "list",
        views: [
          { id: "list", name: "Ideas", type: "list", itemLayout },
          { id: "plain", name: "Plain", type: "list", itemLayout: null },
        ],
      },
    });
    if (!("viewConfig" in parsed) || !("databaseId" in parsed)) {
      throw new Error("Expected the full view config shape");
    }
    expect(parsed.viewConfig.views?.[0].itemLayout).toEqual(itemLayout);

    const saved = parseDatabaseViewConfig(JSON.stringify(parsed.viewConfig));
    expect(saved.views[0].itemLayout).toEqual(itemLayout);
    expect(saved.views[1]).toHaveProperty("itemLayout", null);

    expect(() =>
      action.schema.parse({
        databaseId: "database",
        viewConfig: {
          views: [
            {
              id: "list",
              name: "Ideas",
              type: "list",
              itemLayout: {
                ...itemLayout,
                line2: { propertyId: null, lines: 4 },
              },
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("fails loudly when stored column presentation state is malformed", () => {
    expect(() =>
      parseDatabaseViewConfig(
        JSON.stringify({
          activeViewId: "table",
          views: [
            {
              id: "table",
              name: "Table",
              type: "table",
              columnWrapOverrides: { status: "yes" },
            },
          ],
        }),
      ),
    ).toThrow("Database column wrap overrides must be a boolean map.");
    expect(() =>
      parseDatabaseViewConfig(
        JSON.stringify({
          activeViewId: "table",
          views: [
            {
              id: "table",
              name: "Table",
              type: "table",
              frozenThroughColumnId: 42,
            },
          ],
        }),
      ),
    ).toThrow(
      "Database frozen-through column must be a non-empty column ID or null.",
    );
  });
});

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
            collapsedGroupIds: ["status:done"],
            hideEmptyGroups: true,
            calculations: { status: "count_values" },
            wrapCells: true,
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
      hideEmptyGroups: true,
      calculations: { status: "count_values" },
      wrapCells: true,
      rowDensity: "comfortable",
      openPagesIn: "full_page",
      formQuestions: [
        { key: "name", enabled: true, required: true },
        { key: "status", enabled: true, required: false },
      ],
    });
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
});

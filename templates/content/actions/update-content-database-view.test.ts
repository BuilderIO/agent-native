import { describe, expect, it } from "vitest";

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
            filters: [],
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
          },
        ],
      },
    });

    expect(parsed.viewConfig.views[0]).toMatchObject({
      filterMode: "or",
      collapsedGroupIds: ["status:done"],
      hideEmptyGroups: true,
      calculations: { status: "count_values" },
      wrapCells: true,
      rowDensity: "comfortable",
      openPagesIn: "full_page",
    });
  });
});

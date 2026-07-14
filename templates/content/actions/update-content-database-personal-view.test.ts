import { describe, expect, it } from "vitest";

import { PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION } from "./_content-database-personal-view";
import action from "./update-content-database-personal-view";

describe("update content database personal view", () => {
  it("accepts grouped filter overrides for the current user", () => {
    const parsed = action.schema.parse({
      databaseId: "database",
      overrides: {
        version: PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION,
        activeViewId: "table",
        views: [
          {
            id: "table",
            sorts: [{ key: "name", label: "Name", direction: "asc" }],
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
            filterMode: "and",
          },
        ],
      },
    });

    expect(parsed.overrides?.views[0]?.filters[0]).toMatchObject({
      filterGroupId: "advanced-nested",
      parentFilterGroupId: "advanced",
    });
  });

  it("accepts clearing personal overrides", () => {
    expect(
      action.schema.parse({
        databaseId: "database",
        overrides: null,
      }).overrides,
    ).toBeNull();
  });
});

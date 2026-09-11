import { describe, expect, it, vi } from "vitest";

vi.mock("./_database-utils.js", () => ({
  getContentDatabaseResponse: vi.fn(),
}));

import {
  normalizePersonalDatabaseViewOverrides,
  PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION,
} from "./_content-database-personal-view";
import action, {
  personalSidebarOrderItemIds,
} from "./update-content-database-personal-view";

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

  it("only validates item ids that a sidebar order actually references", () => {
    expect(
      personalSidebarOrderItemIds({
        version: PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION,
        views: [
          {
            id: "table",
            sorts: [{ key: "date", label: "Date", direction: "asc" }],
            filters: [],
            filterMode: "and",
          },
          {
            id: "files",
            sorts: [],
            filters: [],
            filterMode: "and",
            sidebarOrder: {
              mode: "custom",
              itemIds: ["item-b", "item-a", "item-b"],
            },
          },
        ],
      }),
    ).toEqual(["item-b", "item-a"]);
  });

  it("preserves a personal sidebar order and normalizes legacy v2 views", () => {
    const parsed = action.schema.parse({
      databaseId: "database",
      overrides: {
        version: PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION,
        views: [
          {
            id: "table",
            sorts: [],
            filters: [],
            filterMode: "and",
            sidebarOrder: {
              mode: "name",
              itemIds: ["item-b", "item-a", "item-b"],
            },
          },
          { id: "legacy", sorts: [], filters: [], filterMode: "and" },
        ],
      },
    });

    expect(
      normalizePersonalDatabaseViewOverrides(
        parsed.overrides!,
        new Set(["item-a", "item-b"]),
      ),
    ).toMatchObject({
      version: PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION,
      views: [
        { sidebarOrder: { mode: "name", itemIds: ["item-b", "item-a"] } },
        { sidebarOrder: { mode: "custom", itemIds: [] } },
      ],
    });
  });

  it("prunes stale and foreign membership ids on a successful write", () => {
    const parsed = action.schema.parse({
      databaseId: "database",
      overrides: {
        version: PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION,
        views: [
          {
            id: "table",
            sorts: [],
            filters: [],
            filterMode: "and",
            sidebarOrder: {
              mode: "custom",
              itemIds: ["item-a", "stale", "item-b"],
            },
          },
        ],
      },
    });

    expect(
      normalizePersonalDatabaseViewOverrides(
        parsed.overrides!,
        new Set(["item-a", "item-b"]),
      ).views[0]?.sidebarOrder?.itemIds,
    ).toEqual(["item-a", "item-b"]);
  });
});

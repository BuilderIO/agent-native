import { describe, expect, it } from "vitest";

import {
  PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION,
  normalizeStoredPersonalDatabaseViewState,
  orderedPersonalDatabaseViewState,
} from "./_content-database-personal-view";
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

  it("requires mutation ordering fields together", () => {
    expect(() =>
      action.schema.parse({
        databaseId: "database",
        overrides: null,
        mutationSource: "tab-1",
      }),
    ).toThrow(/mutationSource and mutationSequence/);
  });

  it("keeps the newest override when requests arrive out of order", () => {
    const first = orderedPersonalDatabaseViewState({
      current: null,
      mutationSource: "tab-1",
      mutationSequence: 2,
      overrides: personalOverrides("newest"),
    });
    const stale = orderedPersonalDatabaseViewState({
      current: first,
      mutationSource: "tab-1",
      mutationSequence: 1,
      overrides: personalOverrides("stale"),
    });

    expect(
      normalizeStoredPersonalDatabaseViewState(stale).overrides?.views[0]
        ?.filters[0]?.value,
    ).toBe("newest");
  });

  it("keeps an ordered clear as a tombstone against a stale write", () => {
    const cleared = orderedPersonalDatabaseViewState({
      current: null,
      mutationSource: "tab-1",
      mutationSequence: 2,
      overrides: null,
    });
    const stale = orderedPersonalDatabaseViewState({
      current: cleared,
      mutationSource: "tab-1",
      mutationSequence: 1,
      overrides: personalOverrides("stale"),
    });

    expect(
      normalizeStoredPersonalDatabaseViewState(stale).overrides,
    ).toBeNull();
  });
});

function personalOverrides(value: string) {
  return {
    version: PERSONAL_DATABASE_VIEW_OVERRIDES_VERSION,
    activeViewId: "table",
    views: [
      {
        id: "table",
        sorts: [],
        filters: [
          {
            key: "name",
            label: "Name",
            operator: "contains" as const,
            value,
          },
        ],
        filterMode: "and" as const,
      },
    ],
  };
}

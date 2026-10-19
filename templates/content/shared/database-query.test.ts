import { describe, expect, it } from "vitest";

import type {
  ContentDatabaseFilter,
  ContentDatabaseItem,
  DocumentProperty,
} from "./api";
import {
  applyContentDatabaseTableQuery,
  contentDatabaseFilterOperatorsForType,
  contentDatabaseTableQueryUsesProperties,
} from "./database-query";

function item(id: string, title: string, date: string): ContentDatabaseItem {
  return {
    id: `item-${id}`,
    databaseId: "database-1",
    position: 0,
    document: {
      id,
      parentId: "database-page",
      title,
      content: "",
      icon: null,
      position: 0,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    properties: [
      {
        ...dateProperty,
        value: { start: date, includeTime: false },
      },
    ],
  };
}

const dateProperty = {
  definition: {
    id: "date",
    databaseId: "database-1",
    name: "Date",
    type: "date",
    visibility: "always_show",
    options: {},
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  value: null,
  editable: true,
} satisfies DocumentProperty;

describe("content database table query", () => {
  it("applies search, filters, and Date sorting before a caller pages rows", () => {
    const result = applyContentDatabaseTableQuery(
      [
        item("one", "Alpha launch", "2026-01-01"),
        item("two", "Alpha follow-up", "2026-03-01"),
        item("three", "Beta launch", "2026-02-01"),
      ],
      [dateProperty],
      {
        search: "alpha",
        filters: [
          {
            key: "date",
            label: "Date",
            operator: "after",
            value: "2026-01-15",
          },
        ],
        sorts: [{ key: "date", label: "Date", direction: "desc" }],
        filterMode: "and",
      },
    );

    expect(result.map((row) => row.document.id)).toEqual(["two"]);
  });

  it("requires complete client data only when a query can read federated properties", () => {
    const base = {
      search: "",
      filters: [],
      sorts: [{ key: "date", label: "Date", direction: "desc" as const }],
      filterMode: "and" as const,
    };
    expect(
      contentDatabaseTableQueryUsesProperties(base, new Set(["date"])),
    ).toBe(true);
    expect(
      contentDatabaseTableQueryUsesProperties(base, new Set(["author"])),
    ).toBe(false);
    expect(
      contentDatabaseTableQueryUsesProperties(
        { ...base, search: "Alice", sorts: [] },
        new Set(["author"]),
      ),
    ).toBe(true);
  });
});

const rankProperty = {
  definition: {
    ...dateProperty.definition,
    id: "rank",
    name: "Rank",
    type: "number",
  },
  value: null,
  editable: true,
} satisfies DocumentProperty;

function rankedItem(
  id: string,
  rank: DocumentProperty["value"],
): ContentDatabaseItem {
  const row = item(id, id, "2026-01-01");
  return { ...row, properties: [{ ...rankProperty, value: rank }] };
}

const rankedItems = [
  rankedItem("unranked", null),
  rankedItem("blank", ""),
  rankedItem("words", "not a number"),
  rankedItem("rank-4", 4),
  rankedItem("rank-5", 5),
  rankedItem("rank-12", "12"),
  rankedItem("rank-25", 25),
  rankedItem("rank-30", 30),
];

function rankFilter(
  operator: ContentDatabaseFilter["operator"],
  value = "",
): ContentDatabaseFilter {
  return { key: "rank", label: "Rank", operator, value };
}

function matchingIds(
  filters: ContentDatabaseFilter[],
  filterMode: "and" | "or" = "and",
) {
  return applyContentDatabaseTableQuery(rankedItems, [rankProperty], {
    search: "",
    filters,
    sorts: [],
    filterMode,
  }).map((row) => row.document.id);
}

describe("content database number filters", () => {
  it("combines two filters on the same property", () => {
    expect(
      matchingIds([rankFilter("is_not_empty"), rankFilter("less_than", "25")]),
    ).toEqual(["rank-4", "rank-5", "rank-12"]);
    expect(
      matchingIds([
        rankFilter("greater_than_or_equal", "5"),
        rankFilter("less_than_or_equal", "25"),
      ]),
    ).toEqual(["rank-5", "rank-12", "rank-25"]);
    expect(
      matchingIds(
        [rankFilter("less_than", "5"), rankFilter("greater_than", "25")],
        "or",
      ),
    ).toEqual(["rank-4", "rank-30"]);
  });

  it("includes the boundary for ≥ and ≤ but not for > and <", () => {
    expect(matchingIds([rankFilter("greater_than_or_equal", "25")])).toEqual([
      "rank-25",
      "rank-30",
    ]);
    expect(matchingIds([rankFilter("greater_than", "25")])).toEqual([
      "rank-30",
    ]);
    expect(matchingIds([rankFilter("less_than_or_equal", "5")])).toEqual([
      "rank-4",
      "rank-5",
    ]);
    expect(matchingIds([rankFilter("less_than", "5")])).toEqual(["rank-4"]);
  });

  it("never matches empty or non-numeric values with a comparison", () => {
    for (const operator of [
      "greater_than",
      "less_than",
      "greater_than_or_equal",
      "less_than_or_equal",
    ] as const) {
      const ids = matchingIds([rankFilter(operator, "0")]);
      expect(ids).not.toContain("unranked");
      expect(ids).not.toContain("blank");
      expect(ids).not.toContain("words");
    }
    expect(matchingIds([rankFilter("greater_than_or_equal", "abc")])).toEqual(
      [],
    );
  });

  it("offers ≥ and ≤ to number properties in menu order", () => {
    expect(contentDatabaseFilterOperatorsForType("number")).toEqual([
      "equals",
      "does_not_equal",
      "greater_than",
      "less_than",
      "greater_than_or_equal",
      "less_than_or_equal",
      "is_empty",
      "is_not_empty",
    ]);
    expect(contentDatabaseFilterOperatorsForType("text")).not.toContain(
      "greater_than_or_equal",
    );
  });
});

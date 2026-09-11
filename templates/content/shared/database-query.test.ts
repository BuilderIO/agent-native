import { describe, expect, it } from "vitest";

import type { ContentDatabaseItem, DocumentProperty } from "./api";
import {
  applyContentDatabaseTableQuery,
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

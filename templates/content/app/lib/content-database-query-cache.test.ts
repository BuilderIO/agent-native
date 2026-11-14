import type {
  ContentDatabaseItem,
  ContentDatabaseResponse,
  DocumentProperty,
} from "@shared/api";
import { compactContentDatabaseItems } from "@shared/database-row-properties";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  registerContentDatabaseQueryDefaults,
  shareContentDatabaseQueryData,
} from "./content-database-query-cache";

const createdAt = "2026-01-01T00:00:00.000Z";

const statusProperty: DocumentProperty = {
  definition: {
    id: "status",
    databaseId: "database-1",
    name: "Status",
    type: "select",
    visibility: "always_show",
    options: { options: [{ id: "draft", name: "Draft", color: "gray" }] },
    position: 0,
    createdAt,
    updatedAt: createdAt,
  },
  value: null,
  editable: true,
};

function item(id: string): ContentDatabaseItem {
  return {
    id: `item-${id}`,
    databaseId: "database-1",
    position: 0,
    document: {
      id,
      parentId: "database-page",
      title: id,
      content: "",
      icon: null,
      position: 0,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
      createdAt,
      updatedAt: createdAt,
    },
    properties: [{ ...statusProperty, value: "draft" }],
  };
}

function compactRead() {
  return {
    properties: [structuredClone(statusProperty)],
    items: compactContentDatabaseItems([item("one"), item("two")]),
    pagination: {
      offset: 0,
      limit: 100,
      totalItems: 2,
      returnedItems: 2,
      hasMore: false,
    },
  };
}

function cachedClient() {
  const queryClient = new QueryClient();
  registerContentDatabaseQueryDefaults(queryClient);
  return queryClient;
}

describe("content database query cache", () => {
  it("stores Collection reads with each row's definitions attached", () => {
    const queryClient = cachedClient();
    const queryKey = [
      "action",
      "get-content-database",
      { documentId: "database-page" },
    ];

    queryClient.setQueryData(queryKey, compactRead());

    const cached = queryClient.getQueryData<ContentDatabaseResponse>(queryKey)!;
    expect(cached.items.map((row) => row.properties)).toEqual([
      [{ ...statusProperty, value: "draft" }],
      [{ ...statusProperty, value: "draft" }],
    ]);
    expect(cached.items[0]!.properties[0]!.definition).toBe(
      cached.properties[0]!.definition,
    );
  });

  it("keeps the cached rows when a refetch returns the same Collection", () => {
    const queryClient = cachedClient();
    const queryKey = [
      "action",
      "query-content-database-items",
      { documentId: "database-page", tableQuery: { search: "one" } },
    ];

    queryClient.setQueryData(queryKey, compactRead());
    const first = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, compactRead());

    expect(queryClient.getQueryData(queryKey)).toBe(first);
  });

  it("leaves other reads and already complete rows as they are", () => {
    const queryClient = cachedClient();
    const documents = { items: [{ id: "page", properties: [] }] };
    queryClient.setQueryData(["action", "list-documents"], documents);

    expect(queryClient.getQueryData(["action", "list-documents"])).toBe(
      documents,
    );

    const complete = { properties: [statusProperty], items: [item("one")] };
    expect(shareContentDatabaseQueryData(undefined, complete)).toBe(complete);
  });
});

import type {
  ContentDatabaseResponse,
  ContentDatabaseSourceFieldPropertyResponse,
} from "@shared/api";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  applyDocumentPropertiesToDatabaseResponse,
  applyDocumentPropertyValueToDatabaseResponse,
  applyOptimisticSourceFieldPropertyToDatabaseResponse,
  applySourceFieldPropertyToDatabaseResponse,
  clearDeletedContentDatabaseFromCache,
  contentDatabaseQueryKey,
  invalidateBuilderBodyHydrationQueries,
  invalidateContentDatabaseSourceRefreshQueries,
  readCachedContentDatabaseResponse,
  removeDocumentPropertyFromDatabaseResponse,
  writeContentDatabaseResponseToCache,
} from "./use-content-database";

const createdAt = "2026-06-15T12:00:00.000Z";

function databaseResponse(): ContentDatabaseResponse {
  return {
    database: {
      id: "database",
      documentId: "database-page",
      title: "Content",
      viewConfig: {
        activeViewId: "default",
        views: [],
        sorts: [],
        filters: [],
        columnWidths: {},
      },
      createdAt,
      updatedAt: createdAt,
    },
    properties: [
      {
        definition: {
          id: "status",
          databaseId: "database",
          name: "Status",
          type: "text",
          visibility: "always_show",
          options: {},
          position: 0,
          createdAt,
          updatedAt: createdAt,
        },
        value: null,
        editable: true,
      },
    ],
    items: Array.from({ length: 500 }, (_, index) => ({
      id: `item-${index}`,
      databaseId: "database",
      document: {
        id: `document-${index}`,
        parentId: "database-page",
        title: `Article ${index}`,
        content: "",
        icon: null,
        position: index,
        isFavorite: false,
        hideFromSearch: false,
        visibility: "private",
        accessRole: "owner",
        canEdit: true,
        canManage: true,
        createdAt,
        updatedAt: createdAt,
      },
      position: index,
      properties: [],
    })),
    source: {
      id: "source",
      databaseId: "database",
      sourceType: "builder-cms",
      sourceName: "Builder CMS",
      sourceTable: "blog-article",
      syncState: "idle",
      freshness: "fresh",
      lastRefreshedAt: createdAt,
      lastSourceUpdatedAt: createdAt,
      lastError: null,
      capabilities: {
        canRefresh: true,
        canCreateChangeSets: true,
        canWriteFields: true,
        canWriteBody: true,
        canPush: true,
        canPull: true,
        canPublish: true,
        canDelete: false,
        canStageLocalRevision: true,
        liveWritesEnabled: false,
        readOnlyRefresh: true,
      },
      metadata: {
        primaryKey: "id",
        titleField: "title",
        naturalKeyField: null,
        pushMode: "none",
        pushModeLabel: null,
        pushModeDescription: null,
        notes: null,
        readMode: "builder-api",
        liveReadConfigured: true,
      },
      fields: [
        {
          id: "field-handle",
          propertyId: null,
          propertyName: null,
          localFieldKey: "data.handle",
          sourceFieldKey: "data.handle",
          sourceFieldLabel: "Handle",
          sourceFieldType: "text",
          mappingType: "property",
          writeOwner: "source",
          readOnly: false,
          provenance: "Builder model field",
          freshness: "fresh",
          lastSyncedAt: createdAt,
        },
      ],
      rows: [],
      changeSets: [],
    },
  };
}

function sourceFieldPatch(): ContentDatabaseSourceFieldPropertyResponse {
  return {
    databaseId: "database",
    documentId: "database-page",
    property: {
      definition: {
        id: "property-handle",
        databaseId: "database",
        name: "Handle",
        type: "text",
        visibility: "always_show",
        options: {},
        position: 1,
        createdAt,
        updatedAt: createdAt,
      },
      value: null,
      editable: true,
    },
    sourceField: {
      id: "field-handle",
      propertyId: "property-handle",
      propertyName: "Handle",
      localFieldKey: "property-handle",
      sourceFieldKey: "data.handle",
      sourceFieldLabel: "Handle",
      sourceFieldType: "text",
      mappingType: "property",
      writeOwner: "source",
      readOnly: false,
      provenance: "Builder model field",
      freshness: "fresh",
      lastSyncedAt: createdAt,
    },
    itemValues: [
      {
        itemId: "item-0",
        documentId: "document-0",
        value: "welcome-to-builder",
      },
      {
        itemId: "item-1",
        documentId: "document-1",
        value: "second-post",
      },
    ],
  };
}

describe("applySourceFieldPropertyToDatabaseResponse", () => {
  it("patches a high-volume database cache without replacing rows", () => {
    const current = databaseResponse();
    const firstItem = current.items[0];
    const updated = applySourceFieldPropertyToDatabaseResponse(
      current,
      sourceFieldPatch(),
    );

    expect(
      updated?.properties.map((property) => property.definition.id),
    ).toEqual(["status", "property-handle"]);
    expect(updated?.items).toHaveLength(500);
    expect(updated?.items[0]).not.toBe(firstItem);
    expect(updated?.items[0]?.properties[0]).toMatchObject({
      definition: { id: "property-handle", name: "Handle" },
      value: "welcome-to-builder",
    });
    expect(updated?.items[1]?.properties[0]).toMatchObject({
      definition: { id: "property-handle", name: "Handle" },
      value: "second-post",
    });
    expect(updated?.items[2]?.properties[0]).toMatchObject({
      definition: { id: "property-handle", name: "Handle" },
      value: null,
    });
    expect(updated?.source?.fields[0]).toMatchObject({
      id: "field-handle",
      propertyId: "property-handle",
      localFieldKey: "property-handle",
    });
  });

  it("mirrors source field patches into the multi-source cache", () => {
    const current = databaseResponse();
    current.sources = [current.source!];

    const updated = applySourceFieldPropertyToDatabaseResponse(
      current,
      sourceFieldPatch(),
    );

    expect(updated?.sources?.[0]?.fields[0]).toMatchObject({
      id: "field-handle",
      propertyId: "property-handle",
      localFieldKey: "property-handle",
    });
  });

  it("optimistically inserts a pending source-field column with placeholder values", () => {
    const current = databaseResponse();

    const updated = applyOptimisticSourceFieldPropertyToDatabaseResponse(
      current,
      {
        documentId: "database-page",
        sourceFieldId: "field-handle",
      },
    );

    expect(
      updated?.properties.map((property) => property.definition.name),
    ).toEqual(["Status", "Handle"]);
    expect(updated?.properties[1]).toMatchObject({
      definition: {
        id: "optimistic-source-field-property:field-handle",
        name: "Handle",
        type: "text",
      },
      value: null,
      editable: false,
    });
    expect(updated?.items[0]?.properties[0]).toMatchObject({
      definition: { id: "optimistic-source-field-property:field-handle" },
      value: null,
      editable: false,
    });
    expect(updated?.source?.fields[0]).toMatchObject({
      id: "field-handle",
      propertyId: "optimistic-source-field-property:field-handle",
      propertyName: "Handle",
      freshness: "unknown",
    });
  });

  it("ignores patches for a different database", () => {
    const current = databaseResponse();
    const patch = { ...sourceFieldPatch(), databaseId: "other-database" };

    expect(applySourceFieldPropertyToDatabaseResponse(current, patch)).toBe(
      current,
    );
  });
});

describe("applyDocumentPropertyValueToDatabaseResponse", () => {
  it("updates a row property in the cached database response", () => {
    const current = databaseResponse();
    current.items[0]!.properties = [
      { ...current.properties[0]!, value: "Draft" },
    ];

    const updated = applyDocumentPropertyValueToDatabaseResponse(current, {
      documentId: "document-0",
      propertyId: "status",
      value: "Published",
    });

    expect(updated?.items[0]?.properties[0]).toMatchObject({
      definition: { id: "status" },
      value: "Published",
    });
    expect(updated?.items[1]).toBe(current.items[1]);
  });

  it("inserts a visible row property when the row was falling back to the database property", () => {
    const current = databaseResponse();

    const updated = applyDocumentPropertyValueToDatabaseResponse(current, {
      documentId: "document-0",
      propertyId: "status",
      value: "Agent Native",
    });

    expect(updated?.items[0]?.properties[0]).toMatchObject({
      definition: { id: "status", name: "Status" },
      value: "Agent Native",
      editable: true,
    });
  });
});

describe("applyDocumentPropertiesToDatabaseResponse", () => {
  it("updates definitions while preserving each row's stored value", () => {
    const current = databaseResponse();
    current.items[0]!.properties = [
      { ...current.properties[0]!, value: "Draft" },
    ];
    const renamed = {
      ...current.properties[0]!,
      definition: {
        ...current.properties[0]!.definition,
        name: "Workflow",
      },
    };

    const updated = applyDocumentPropertiesToDatabaseResponse(current, {
      databaseId: "database",
      properties: [renamed],
    });

    expect(updated?.properties[0]?.definition.name).toBe("Workflow");
    expect(updated?.items[0]?.properties[0]).toMatchObject({
      definition: { id: "status", name: "Workflow" },
      value: "Draft",
    });
  });

  it("does not patch a cache entry for another database", () => {
    const current = databaseResponse();

    expect(
      applyDocumentPropertiesToDatabaseResponse(current, {
        databaseId: "other-database",
        properties: [],
      }),
    ).toBe(current);
  });
});

describe("removeDocumentPropertyFromDatabaseResponse", () => {
  it("removes a property from the schema and every cached row", () => {
    const current = databaseResponse();
    current.items[0]!.properties = [
      { ...current.properties[0]!, value: "Draft" },
    ];

    const updated = removeDocumentPropertyFromDatabaseResponse(
      current,
      "status",
    );

    expect(updated?.properties).toEqual([]);
    expect(updated?.items[0]?.properties).toEqual([]);
  });
});

describe("invalidateContentDatabaseSourceRefreshQueries", () => {
  it("keeps continuation invalidations linear and narrowly targeted", () => {
    const invalidations: Array<{ queryKey: readonly unknown[] }> = [];
    const queryClient = {
      invalidateQueries: (filters: { queryKey: readonly unknown[] }) => {
        invalidations.push(filters);
      },
    };

    for (let page = 0; page < 5; page++) {
      invalidateContentDatabaseSourceRefreshQueries(
        queryClient,
        "database-page",
      );
    }

    expect(invalidations).toHaveLength(10);
    expect(
      invalidations.filter(
        (filters) =>
          filters.queryKey.length === 1 && filters.queryKey[0] === "action",
      ),
    ).toHaveLength(0);
    expect(invalidations).toEqual(
      Array.from({ length: 5 }).flatMap(() => [
        { queryKey: contentDatabaseQueryKey("database-page") },
        {
          queryKey: [
            "action",
            "get-content-database-source",
            { documentId: "database-page" },
          ],
        },
      ]),
    );
  });
});

describe("clearDeletedContentDatabaseFromCache", () => {
  it("removes stale deleted database page data and invalidates source pickers", () => {
    const queryClient = new QueryClient();
    const database = databaseResponse();
    queryClient.setQueryData(
      contentDatabaseQueryKey("database-page"),
      database,
    );
    queryClient.setQueryData(
      [
        "action",
        "get-content-database",
        { documentId: "database-page", limit: 100 },
      ],
      database,
    );
    queryClient.setQueryData(
      ["action", "get-document", { id: "database-page" }],
      database.items[0]?.document,
    );
    queryClient.setQueryData(["action", "list-content-databases"], {
      databases: [
        {
          databaseId: "database",
          documentId: "database-page",
          title: "Content",
        },
      ],
    });

    clearDeletedContentDatabaseFromCache(queryClient, "database-page");

    expect(
      queryClient.getQueryData(contentDatabaseQueryKey("database-page")),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData([
        "action",
        "get-content-database",
        { documentId: "database-page", limit: 100 },
      ]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData([
        "action",
        "get-document",
        { id: "database-page" },
      ]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryState(["action", "list-content-databases"])
        ?.isInvalidated,
    ).toBe(true);
  });
});

describe("writeContentDatabaseResponseToCache", () => {
  it("stores the attach-source response immediately for the active database", () => {
    const attached = databaseResponse();
    const queryClient = new QueryClient();

    writeContentDatabaseResponseToCache(queryClient, "database-page", attached);

    const cached = queryClient.getQueryData<ContentDatabaseResponse>(
      contentDatabaseQueryKey("database-page"),
    );
    expect(cached).toBe(attached);
    expect(cached?.source?.sourceTable).toBe("blog-article");
  });

  it("updates active paginated database reads after a Builder source attach", () => {
    const beforeAttach = {
      ...databaseResponse(),
      items: [],
      source: null,
    };
    const attached = databaseResponse();
    const queryClient = new QueryClient();
    const visibleQueryKey = [
      "action",
      "get-content-database",
      { documentId: "database-page", limit: 100 },
    ] as const;
    queryClient.setQueryData<ContentDatabaseResponse>(
      visibleQueryKey,
      beforeAttach,
    );

    writeContentDatabaseResponseToCache(queryClient, "database-page", attached);

    const visibleCache =
      queryClient.getQueryData<ContentDatabaseResponse>(visibleQueryKey);
    expect(visibleCache?.source?.sourceTable).toBe("blog-article");
    expect(visibleCache?.items).toHaveLength(500);
  });
});

describe("readCachedContentDatabaseResponse", () => {
  it("reads a cached paginated response for the same database document", () => {
    const response = databaseResponse();
    const queryClient = new QueryClient();
    queryClient.setQueryData<ContentDatabaseResponse>(
      [
        "action",
        "get-content-database",
        { documentId: "database-page", limit: 100 },
      ],
      response,
    );

    expect(
      readCachedContentDatabaseResponse(queryClient, "database-page"),
    ).toBe(response);
  });

  it("prefers the exact unpaginated cache entry when present", () => {
    const paginated = databaseResponse();
    const exact = { ...databaseResponse(), items: [] };
    const queryClient = new QueryClient();
    queryClient.setQueryData<ContentDatabaseResponse>(
      [
        "action",
        "get-content-database",
        { documentId: "database-page", limit: 100 },
      ],
      paginated,
    );
    queryClient.setQueryData<ContentDatabaseResponse>(
      contentDatabaseQueryKey("database-page"),
      exact,
    );

    expect(
      readCachedContentDatabaseResponse(queryClient, "database-page"),
    ).toBe(exact);
  });

  it("never seeds an unavailable (deleted database) payload", () => {
    const unavailable = {
      available: false,
      reason: "deleted",
      databaseId: "database",
      documentId: "database-page",
      message: 'Database "database" has been deleted',
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      contentDatabaseQueryKey("database-page"),
      unavailable,
    );
    queryClient.setQueryData(
      [
        "action",
        "get-content-database",
        { documentId: "database-page", limit: 100 },
      ],
      unavailable,
    );

    expect(
      readCachedContentDatabaseResponse(queryClient, "database-page"),
    ).toBe(undefined);
  });
});

describe("invalidateBuilderBodyHydrationQueries", () => {
  it("keeps a 300-row Builder hydration to a per-page invalidation budget", () => {
    const calls: Array<{ queryKey?: readonly unknown[] }> = [];
    const queryClient = {
      invalidateQueries: (options: { queryKey?: readonly unknown[] }) => {
        calls.push(options);
      },
    };

    for (let page = 0; page < 6; page++) {
      invalidateBuilderBodyHydrationQueries(queryClient, "database-page", {
        documentId: undefined,
      });
    }

    expect(calls).toHaveLength(12);
    expect(calls).toEqual(
      Array.from({ length: 6 }).flatMap(() => [
        { queryKey: contentDatabaseQueryKey("database-page") },
        {
          queryKey: [
            "action",
            "get-content-database-source",
            { documentId: "database-page" },
          ],
        },
      ]),
    );
    expect(calls.some((call) => call.queryKey?.[1] === "list-documents")).toBe(
      false,
    );
  });

  it("invalidates the opened row document only for priority hydration", () => {
    const calls: Array<{ queryKey?: readonly unknown[] }> = [];
    const queryClient = {
      invalidateQueries: (options: { queryKey?: readonly unknown[] }) => {
        calls.push(options);
      },
    };

    invalidateBuilderBodyHydrationQueries(queryClient, "database-page", {
      documentId: "row-page",
    });

    expect(calls).toEqual([
      { queryKey: contentDatabaseQueryKey("database-page") },
      {
        queryKey: [
          "action",
          "get-content-database-source",
          { documentId: "database-page" },
        ],
      },
      { queryKey: ["action", "get-document", { id: "row-page" }] },
    ]);
  });
});

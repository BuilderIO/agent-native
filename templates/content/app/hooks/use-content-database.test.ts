import type {
  ContentDatabaseResponse,
  ContentDatabaseSourceFieldPropertyResponse,
} from "@shared/api";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  applySourceFieldPropertyToDatabaseResponse,
  clearDeletedContentDatabaseFromCache,
  contentDatabaseQueryKey,
  readCachedContentDatabaseResponse,
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

  it("ignores patches for a different database", () => {
    const current = databaseResponse();
    const patch = { ...sourceFieldPatch(), databaseId: "other-database" };

    expect(applySourceFieldPropertyToDatabaseResponse(current, patch)).toBe(
      current,
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
});

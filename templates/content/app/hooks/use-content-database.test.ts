import type {
  ContentDatabaseResponse,
  ContentDatabaseSourceFieldPropertyResponse,
} from "@shared/api";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  applySourceFieldPropertyToDatabaseResponse,
  contentDatabaseQueryKey,
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
});

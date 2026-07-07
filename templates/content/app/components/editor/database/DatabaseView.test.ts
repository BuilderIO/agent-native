import type {
  ContentDatabaseItem,
  ContentDatabaseSource,
  DocumentProperty,
} from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  databaseBuilderBulkUpdateSource,
  databaseBulkEditableProperties,
  builderSourceContinuationKey,
  builderSourceContinuationWatchdogDelay,
  builderSourceContinuationProgressPercent,
  builderSourceContinuationWatchdogDecision,
  builderSourceRowFetchStatus,
} from "./DatabaseView";

describe("Builder source row fetch status", () => {
  it("shows background refresh errors before stale partial progress", () => {
    expect(
      builderSourceRowFetchStatus({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          sourceFetchState: "error",
          lastReadPartial: true,
        },
      }),
    ).toBe("error");
  });

  it("shows partial live reads as still fetching", () => {
    expect(
      builderSourceRowFetchStatus({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          sourceFetchState: "idle",
          lastReadPartial: true,
        },
      }),
    ).toBe("fetching");
  });
});

describe("Builder source continuation state", () => {
  it("keys continuation attempts by source and offset", () => {
    expect(
      builderSourceContinuationKey({
        id: "src-builder",
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          lastReadNextOffset: 250,
        },
      }),
    ).toBe("src-builder:250");
  });

  it("uses determinate progress when fetched count and limit are known", () => {
    expect(
      builderSourceContinuationProgressPercent({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          lastReadFetchedEntryCount: 50,
          lastReadLimit: 100,
          lastReadHasMore: true,
        },
      }),
    ).toBe(50);
  });

  it("caps in-progress determinate progress below complete", () => {
    expect(
      builderSourceContinuationProgressPercent({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          lastReadFetchedEntryCount: 100,
          lastReadLimit: 100,
          lastReadHasMore: true,
        },
      }),
    ).toBe(95);
  });

  it("falls back to indeterminate progress when counts are missing", () => {
    expect(
      builderSourceContinuationProgressPercent({
        metadata: {
          primaryKey: "id",
          titleField: "data.title",
          lastReadFetchedEntryCount: 50,
        },
      }),
    ).toBeNull();
  });

  it("keeps watchdog continuation automatic with capped backoff", () => {
    expect(builderSourceContinuationWatchdogDecision(0)).toBe("refire");
    expect(builderSourceContinuationWatchdogDecision(1)).toBe("refire");
    expect(builderSourceContinuationWatchdogDecision(20)).toBe("refire");
    expect(builderSourceContinuationWatchdogDelay(0)).toBe(5_000);
    expect(builderSourceContinuationWatchdogDelay(1)).toBe(10_000);
    expect(builderSourceContinuationWatchdogDelay(2)).toBe(20_000);
    expect(builderSourceContinuationWatchdogDelay(3)).toBe(30_000);
    expect(builderSourceContinuationWatchdogDelay(20)).toBe(30_000);
  });
});

const baseProperty = (
  id: string,
  type: DocumentProperty["definition"]["type"] = "text",
): DocumentProperty => ({
  definition: {
    id,
    databaseId: "database",
    name: id,
    type,
    position: 0,
    options: {},
    visibility: "always_show",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  },
  value: null,
  editable: true,
});

const builderRowItem = (id: string): ContentDatabaseItem => ({
  id: `item-${id}`,
  databaseId: "database",
  position: 0,
  document: {
    id: `doc-${id}`,
    title: id,
    content: "",
    icon: null,
    parentId: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    canEdit: true,
    canManage: true,
  },
  properties: [],
});

const builderSourceForBulk = (
  fields: ContentDatabaseSource["fields"],
): ContentDatabaseSource =>
  ({
    id: "source-builder",
    databaseId: "database",
    sourceType: "builder-cms",
    sourceName: "Builder Blog",
    sourceTable: "blog-article",
    freshness: "fresh",
    syncState: "fresh",
    capabilities: {
      canCreateChangeSets: true,
      canWriteFields: true,
      liveWritesEnabled: false,
    },
    metadata: {},
    lastRefreshedAt: null,
    lastSourceUpdatedAt: null,
    lastError: null,
    fields,
    rows: [
      {
        documentId: "doc-alpha",
        sourceRowId: "builder-alpha",
      },
    ],
    changeSets: [],
  }) as unknown as ContentDatabaseSource;

describe("Builder-backed database edit helpers", () => {
  it("detects selected Builder rows without requiring a visible Builder-owned field", () => {
    const source = builderSourceForBulk([]);
    expect(
      databaseBuilderBulkUpdateSource([source], null, [builderRowItem("alpha")])
        ?.id,
    ).toBe("source-builder");
  });

  it("keeps Builder-owned fields in the same bulk edit property list", () => {
    const localProperty = baseProperty("local");
    const builderProperty = baseProperty("topics");
    builderSourceForBulk([
      {
        id: "field-topics",
        mappingType: "property",
        propertyId: "topics",
        propertyName: "Topics",
        localFieldKey: "topics",
        sourceFieldKey: "data.topics",
        sourceFieldLabel: "Topics",
        sourceFieldType: "text",
        writeOwner: "source",
        readOnly: false,
        provenance: "source",
        freshness: "fresh",
        lastSyncedAt: "2026-07-07T00:00:00.000Z",
      },
    ]);

    expect(
      databaseBulkEditableProperties([localProperty, builderProperty]).map(
        (property) => property.definition.id,
      ),
    ).toEqual(["local", "topics"]);
  });

  it("keeps unsupported Builder-owned field types locally editable", () => {
    const tagsProperty = baseProperty("tags", "multi_select");
    builderSourceForBulk([
      {
        id: "field-tags",
        mappingType: "property",
        propertyId: "tags",
        propertyName: "Tags",
        localFieldKey: "tags",
        sourceFieldKey: "data.tags",
        sourceFieldLabel: "Tags",
        sourceFieldType: "tags",
        writeOwner: "source",
        readOnly: false,
        provenance: "source",
        freshness: "fresh",
        lastSyncedAt: "2026-07-07T00:00:00.000Z",
      },
    ]);

    expect(
      databaseBulkEditableProperties([tagsProperty]).map(
        (property) => property.definition.id,
      ),
    ).toEqual(["tags"]);
  });
});

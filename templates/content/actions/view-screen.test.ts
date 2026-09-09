import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ContentDatabaseResponse, DocumentProperty } from "../shared/api";
import {
  buildSelectionScreenSection,
  databaseCurrentViewSnapshot,
  documentContentPreview,
  resolveRelationshipScreenContext,
  serializeDocumentTreeItemForScreen,
  SCREEN_DOCUMENT_PREVIEW_CHARS,
} from "./view-screen";

describe("buildSelectionScreenSection", () => {
  it("returns null when there is no selection state", () => {
    expect(buildSelectionScreenSection(null, "doc1")).toBeNull();
  });

  it("returns null when the selection belongs to a different document", () => {
    const selection = {
      documentId: "doc-other",
      collapsed: false,
      selectedText: "hello",
    };
    expect(buildSelectionScreenSection(selection, "doc1")).toBeNull();
  });

  it("returns null when no document is currently open", () => {
    const selection = { documentId: "doc1", selectedText: "hello" };
    expect(buildSelectionScreenSection(selection, undefined)).toBeNull();
  });

  it("builds a collapsed-selection section with a cursor-only hint", () => {
    const selection = {
      documentId: "doc1",
      collapsed: true,
      blockText: "Some paragraph text",
      heading: "Intro",
    };
    const section = buildSelectionScreenSection(selection, "doc1");
    expect(section).toMatchObject({
      documentId: "doc1",
      collapsed: true,
      blockText: "Some paragraph text",
      heading: "Intro",
    });
    expect(section?.hint).toMatch(/no text is selected/i);
  });

  it("builds a real-selection section naming the edit-document call", () => {
    const selection = {
      documentId: "doc1",
      collapsed: false,
      selectedText: "the quick brown fox",
      textTruncated: false,
      blockText: "The quick brown fox jumps.",
      heading: "Section A",
    };
    const section = buildSelectionScreenSection(selection, "doc1");
    expect(section).toMatchObject({
      documentId: "doc1",
      collapsed: false,
      selectedText: "the quick brown fox",
      textTruncated: false,
      heading: "Section A",
    });
    expect(section?.hint).toContain("edit-document");
    expect(section?.hint).toContain("baseRevision");
    expect(section?.hint).toContain("idempotencyKey");
  });
});

describe("view-screen relationship context", () => {
  const databasePath = join(
    tmpdir(),
    `view-screen-relationships-${process.pid}-${Date.now()}.pglite`,
  );
  const prefix = `view-screen-relationships-${process.pid}-${Date.now()}`;
  const owner = `${prefix}-owner@example.test`;
  const viewer = `${prefix}-viewer@example.test`;
  const spaceId = `${prefix}-space`;
  const sourceDatabaseId = `${prefix}-source-database`;
  const targetDatabaseId = `${prefix}-target-database`;
  const sourceDatabasePageId = `${prefix}-source-database-page`;
  const targetDatabasePageId = `${prefix}-target-database-page`;
  const pageId = `${prefix}-page`;
  const typeId = `${prefix}-type`;
  const typeVersionId = `${prefix}-type-version`;
  const archivedTypeId = `${prefix}-archived-type`;
  const unsupportedTypeId = `${prefix}-unsupported-type`;
  const unsupportedTypeVersionId = `${prefix}-unsupported-type-version`;
  const propertyId = `${prefix}-property`;
  let dbModule: typeof import("../server/db/index.js");

  beforeAll(async () => {
    process.env.DATABASE_URL = `pglite:${databasePath}`;
    dbModule = await import("../server/db/index.js");
    await (await import("../server/plugins/db.js")).default(undefined as never);
    await dbModule
      .getDb()
      .insert(dbModule.schema.documents)
      .values([
        {
          id: sourceDatabasePageId,
          spaceId,
          ownerEmail: owner,
          title: "Source database",
        },
        {
          id: targetDatabasePageId,
          spaceId,
          ownerEmail: owner,
          title: "Target database",
        },
        {
          id: pageId,
          spaceId,
          ownerEmail: owner,
          title: "Readable page",
        },
      ]);
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentDatabases)
      .values([
        {
          id: sourceDatabaseId,
          documentId: sourceDatabasePageId,
          spaceId,
          ownerEmail: owner,
          title: "Source database",
          blocksSeeded: 1,
        },
        {
          id: targetDatabaseId,
          documentId: targetDatabasePageId,
          spaceId,
          ownerEmail: owner,
          title: "Target database",
          blocksSeeded: 1,
        },
      ]);
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipTypes)
      .values([
        {
          id: typeId,
          ownerEmail: owner,
          spaceId,
          currentVersionId: typeVersionId,
          createdBy: owner,
        },
        {
          id: archivedTypeId,
          ownerEmail: owner,
          spaceId,
          currentVersionId: `${prefix}-archived-type-version`,
          state: "archived",
          archivedAt: "2026-09-09T00:00:00.000Z",
          createdBy: owner,
        },
        {
          id: unsupportedTypeId,
          ownerEmail: owner,
          spaceId,
          currentVersionId: unsupportedTypeVersionId,
          createdBy: owner,
        },
      ]);
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipTypeVersions)
      .values([
        {
          id: typeVersionId,
          ownerEmail: owner,
          spaceId,
          relationshipTypeId: typeId,
          version: 1,
          forwardLabel: "References",
          inverseLabel: "Referenced by",
          forwardCardinality: "many",
          sourceDatabaseId,
          targetDatabaseId,
          createdBy: owner,
        },
        {
          id: unsupportedTypeVersionId,
          ownerEmail: owner,
          spaceId,
          relationshipTypeId: unsupportedTypeId,
          version: 1,
          forwardLabel: "Unsupported",
          inverseLabel: "Unsupported by",
          forwardCardinality: "many",
          sourceDatabaseId,
          targetDatabaseId,
          selectorKind: "query",
          createdBy: owner,
        },
      ]);
    await dbModule
      .getDb()
      .insert(dbModule.schema.contentRelationshipProjections)
      .values({
        id: `${prefix}-projection`,
        ownerEmail: owner,
        spaceId,
        propertyId,
        databaseId: sourceDatabaseId,
        relationshipTypeId: typeId,
        direction: "forward",
        editable: 1,
        alias: "References",
        createdBy: owner,
      });
  });

  afterAll(() => {
    delete process.env.DATABASE_URL;
    rmSync(databasePath, { recursive: true, force: true });
  });

  it("returns database-only relationship configuration context", async () => {
    await expect(
      runWithRequestContext({ userEmail: owner }, () =>
        resolveRelationshipScreenContext({
          databaseId: sourceDatabaseId,
          surface: "configuration",
        }),
      ),
    ).resolves.toEqual({
      databaseId: sourceDatabaseId,
      surface: "configuration",
      selectedPageIds: undefined,
    });
  });

  it("makes hidden-active, missing, archived, and unsupported type selectors indistinguishable", async () => {
    await dbModule
      .getDb()
      .insert(dbModule.schema.documentShares)
      .values(
        [sourceDatabasePageId, targetDatabasePageId, pageId].map(
          (resourceId, index) => ({
            id: `${prefix}-share-${index}`,
            resourceId,
            principalType: "user",
            principalId: viewer,
            role: "viewer",
            createdBy: owner,
          }),
        ),
      );
    const state = {
      pageId,
      databaseId: sourceDatabaseId,
      typeId,
      propertyId,
      surface: "picker" as const,
    };
    await expect(
      runWithRequestContext({ userEmail: viewer }, () =>
        resolveRelationshipScreenContext(state),
      ),
    ).resolves.toMatchObject(state);

    await dbModule
      .getDb()
      .delete(dbModule.schema.documentShares)
      .where(
        and(
          eq(dbModule.schema.documentShares.resourceId, targetDatabasePageId),
          eq(dbModule.schema.documentShares.principalId, viewer),
        ),
      );

    await expect(
      runWithRequestContext({ userEmail: viewer }, () =>
        Promise.all(
          [
            typeId,
            `${prefix}-missing-type`,
            archivedTypeId,
            unsupportedTypeId,
          ].map((candidateTypeId) =>
            resolveRelationshipScreenContext({
              ...state,
              typeId: candidateTypeId,
            }),
          ),
        ),
      ),
    ).resolves.toEqual([null, null, null, null]);
  });

  it("reports malformed stored relationship context as unavailable", async () => {
    await expect(
      resolveRelationshipScreenContext({
        databaseId: sourceDatabaseId,
        surface: "configuration",
        actorEmail: "forged@example.test",
      }),
    ).rejects.toMatchObject({
      errorCode: "UNAVAILABLE",
      message: "The relationship screen context is unreadable.",
    });
  });
});

function property(
  id: string,
  name: string,
  type: DocumentProperty["definition"]["type"],
  value: DocumentProperty["value"],
  overrides: Partial<DocumentProperty["definition"]> = {},
): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "database",
      name,
      type,
      visibility: "always_show",
      options: {
        options: [
          { id: "published", name: "Published", color: "green" },
          { id: "draft", name: "Draft", color: "gray" },
        ],
      },
      position: overrides.position ?? 0,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
      ...overrides,
    },
    value,
    editable: true,
  };
}

function statusProperty(value: string | null) {
  return property("status", "Status", "status", value, { position: 0 });
}

function ownerProperty(value: string | null) {
  return property("owner", "Owner", "text", value, {
    options: {},
    position: 1,
  });
}

function priorityProperty(value: number | null) {
  return property("priority", "Priority", "number", value, {
    options: {},
    position: 2,
  });
}

function notesProperty(value: string | null) {
  return property("notes", "Notes", "text", value, {
    options: {},
    position: 3,
    visibility: "hide_when_empty",
  });
}

function internalProperty(value: string | null) {
  return property("internal", "Internal", "text", value, {
    options: {},
    position: 4,
    visibility: "always_hide",
  });
}

function publishDateProperty(value: DocumentProperty["value"]) {
  return property("publish", "Publish Date", "date", value, {
    options: {},
    position: 5,
  });
}

function endDateProperty(value: DocumentProperty["value"]) {
  return property("end", "End Date", "date", value, {
    options: {},
    position: 6,
  });
}

function databaseResponse(): ContentDatabaseResponse {
  return {
    database: {
      id: "database",
      documentId: "database-doc",
      title: "Content calendar",
      viewConfig: {
        activeViewId: "editorial",
        views: [
          {
            id: "editorial",
            name: "Editorial",
            type: "table",
            sorts: [{ key: "name", label: "Name", direction: "asc" }],
            filters: [
              {
                key: "status",
                label: "Status",
                operator: "equals",
                value: "published",
              },
            ],
            filterMode: "or",
            columnWidths: {},
            groupByPropertyId: "status",
            collapsedGroupIds: ["status:published"],
            hideEmptyGroups: true,
            calculations: { owner: "count_unique" },
            wrapCells: true,
            columnWrapOverrides: { owner: false },
            frozenThroughColumnId: null,
            rowDensity: "comfortable",
            hiddenPropertyIds: ["priority"],
            propertyOrderIds: ["owner", "status", "missing-property"],
          },
        ],
        sorts: [],
        filters: [],
        columnWidths: {},
      },
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    },
    properties: [
      statusProperty(null),
      ownerProperty(null),
      priorityProperty(null),
      notesProperty(null),
      internalProperty(null),
    ],
    items: [
      {
        id: "item-alpha",
        databaseId: "database",
        position: 0,
        document: {
          id: "alpha",
          parentId: "database-doc",
          title: "Alpha",
          content: "",
          icon: null,
          position: 0,
          isFavorite: false,
          hideFromSearch: false,
          visibility: "private",
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
        properties: [
          statusProperty("published"),
          ownerProperty("Alice"),
          priorityProperty(1),
          notesProperty(null),
          internalProperty("hidden"),
        ],
      },
      {
        id: "item-beta",
        databaseId: "database",
        position: 1,
        document: {
          id: "beta",
          parentId: "database-doc",
          title: "",
          content: "",
          icon: null,
          position: 1,
          isFavorite: false,
          hideFromSearch: false,
          visibility: "private",
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
        properties: [
          statusProperty("draft"),
          ownerProperty("Taylor"),
          priorityProperty(2),
          notesProperty(null),
          internalProperty("hidden"),
        ],
      },
    ],
    source: null,
  };
}

describe("view-screen document tree", () => {
  it("marks database pages in the document tree payload", () => {
    const item = serializeDocumentTreeItemForScreen(
      {
        id: "database-doc",
        parentId: null,
        title: "Content calendar",
        icon: "",
        isFavorite: 1,
        hideFromSearch: 0,
        visibility: "private",
      },
      {
        id: "database",
        ownerEmail: "alice@example.com",
        orgId: null,
        documentId: "database-doc",
        title: "Content calendar",
        viewConfigJson: null,
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
    );

    expect(item).toMatchObject({
      id: "database-doc",
      title: "Content calendar",
      icon: undefined,
      isFavorite: true,
      hideFromSearch: false,
      database: {
        id: "database",
        documentId: "database-doc",
        title: "Content calendar",
      },
    });
  });

  it("leaves ordinary pages as plain document tree items", () => {
    expect(
      serializeDocumentTreeItemForScreen({
        id: "page",
        parentId: "parent",
        title: "",
        icon: "★",
        isFavorite: 0,
        hideFromSearch: 1,
        visibility: "org",
      }),
    ).toEqual({
      id: "page",
      parentId: "parent",
      title: "Untitled",
      icon: "★",
      isFavorite: false,
      hideFromSearch: true,
      visibility: "org",
      database: undefined,
    });
  });
});

describe("view-screen document previews", () => {
  it("keeps short bodies and their full length", () => {
    const content = "  A short page.  ";

    expect(documentContentPreview(content)).toEqual({
      contentPreview: "A short page.",
      contentLength: content.length,
      contentTruncated: false,
    });
  });

  it("bounds long bodies and points to the full-document action", () => {
    const content = `  ${"x".repeat(SCREEN_DOCUMENT_PREVIEW_CHARS + 100)}  `;
    const preview = documentContentPreview(content);

    expect(preview.contentLength).toBe(content.length);
    expect(preview.contentTruncated).toBe(true);
    expect(preview.contentPreview).toHaveLength(
      SCREEN_DOCUMENT_PREVIEW_CHARS +
        "... [document body truncated; call get-document for the full content]"
          .length,
    );
    expect(preview.contentPreview).toContain(
      "call get-document for the full content",
    );
  });
});

describe("view-screen current database view", () => {
  it("normalizes rich database navigation state into a current view snapshot", () => {
    expect(
      databaseCurrentViewSnapshot(
        {
          databaseViewId: "board",
          databaseViewName: "Pipeline",
          databaseViewType: "board",
          databaseViews: [
            { id: "board", name: "Pipeline", type: "board" },
            { id: "calendar", name: "Calendar", type: "calendar" },
          ],
          databaseSearchQuery: " launch ",
          databaseSorts: [
            { key: "publish", label: "Publish", direction: "desc" },
          ],
          databaseActiveFilters: [
            {
              key: "status",
              label: "Status",
              operator: "equals",
              value: "published",
            },
          ],
          databaseFilterMode: "or",
          databaseGroupByPropertyId: "status",
          databaseGroupByPropertyName: "Status",
          databaseCollapsedGroupIds: ["status:published"],
          databaseHideEmptyGroups: true,
          databaseDatePropertyId: "publish",
          databaseDatePropertyName: "Publish Date",
          databaseEndDatePropertyId: "end",
          databaseEndDatePropertyName: "End Date",
          databaseDateRangeStart: "2026-04-26",
          databaseDateRangeEnd: "2026-06-06",
          databaseDateRangeLabel: "May 2026",
          databaseCalculations: { status: "count_values" },
          databaseCalculationResults: [
            {
              propertyId: "status",
              name: "Status",
              type: "status",
              calculation: "count_values",
              result: "1 value",
            },
          ],
          databaseWrapCells: true,
          databaseRowDensity: "compact",
          databaseOpenPagesIn: "full_page",
          databaseVisibleItemCount: 1,
          databaseTotalItemCount: 2,
          databaseVisibleItems: [
            {
              itemId: "item-alpha",
              documentId: "alpha",
              title: "Alpha",
              position: 0,
            },
          ],
          databaseVisibleItemLimit: 50,
          databaseSelectedItemCount: 1,
          databaseSelectedItems: [
            {
              itemId: "item-alpha",
              documentId: "alpha",
              title: "Alpha",
              position: 0,
            },
          ],
        },
        databaseResponse(),
      ),
    ).toEqual({
      id: "board",
      name: "Pipeline",
      type: "board",
      views: [
        { id: "board", name: "Pipeline", type: "board" },
        { id: "calendar", name: "Calendar", type: "calendar" },
      ],
      searchQuery: "launch",
      sorts: [{ key: "publish", label: "Publish", direction: "desc" }],
      filterMode: "or",
      groupByPropertyId: "status",
      groupByPropertyName: "Status",
      collapsedGroupIds: ["status:published"],
      hideEmptyGroups: true,
      openPagesIn: "full_page",
      formQuestions: [],
      datePropertyId: "publish",
      datePropertyName: "Publish Date",
      endDatePropertyId: "end",
      endDatePropertyName: "End Date",
      dateRangeStart: "2026-04-26",
      dateRangeEnd: "2026-06-06",
      dateRangeLabel: "May 2026",
      filters: [
        {
          key: "status",
          label: "Status",
          operator: "equals",
          value: "published",
        },
      ],
      calculations: { status: "count_values" },
      calculationResults: [
        {
          propertyId: "status",
          name: "Status",
          type: "status",
          calculation: "count_values",
          result: "1 value",
        },
      ],
      wrapCells: true,
      rowDensity: "compact",
      visibleItemCount: 1,
      totalItemCount: 2,
      visibleItems: [
        {
          itemId: "item-alpha",
          documentId: "alpha",
          title: "Alpha",
          position: 0,
        },
      ],
      visibleItemLimit: 50,
      selectedItemCount: 1,
      selectedItems: [
        {
          itemId: "item-alpha",
          documentId: "alpha",
          title: "Alpha",
          position: 0,
        },
      ],
    });
  });

  it("falls back to the saved active view and database rows", () => {
    expect(databaseCurrentViewSnapshot({}, databaseResponse())).toEqual({
      tableColumnOrderIds: ["name", "owner", "status"],
      columnWrapOverrides: { owner: false },
      effectiveColumnWrapById: {
        name: true,
        owner: false,
        status: true,
      },
      frozenThroughColumnId: null,
      intendedFrozenColumnIds: [],
      effectiveFrozenColumnIds: undefined,
      id: "editorial",
      name: "Editorial",
      type: "table",
      views: [{ id: "editorial", name: "Editorial", type: "table" }],
      searchQuery: undefined,
      sorts: [{ key: "name", label: "Name", direction: "asc" }],
      filterMode: "or",
      groupByPropertyId: "status",
      groupByPropertyName: "Status",
      collapsedGroupIds: ["status:published"],
      hideEmptyGroups: true,
      openPagesIn: "preview",
      formQuestions: [],
      datePropertyId: undefined,
      datePropertyName: undefined,
      endDatePropertyId: undefined,
      endDatePropertyName: undefined,
      dateRangeStart: undefined,
      dateRangeEnd: undefined,
      dateRangeLabel: undefined,
      filters: [
        {
          key: "status",
          label: "Status",
          operator: "equals",
          value: "published",
        },
      ],
      calculations: { owner: "count_unique" },
      calculationResults: [
        {
          propertyId: "owner",
          name: "Owner",
          type: "text",
          calculation: "count_unique",
          result: "2 unique",
        },
      ],
      wrapCells: true,
      rowDensity: "comfortable",
      visibleItemCount: 2,
      totalItemCount: 2,
      visibleItems: [
        {
          itemId: "item-alpha",
          documentId: "alpha",
          title: "Alpha",
          position: 0,
          properties: [
            {
              propertyId: "owner",
              name: "Owner",
              type: "text",
              value: "Alice",
              text: "Alice",
            },
            {
              propertyId: "status",
              name: "Status",
              type: "status",
              value: "published",
              text: "Published",
            },
          ],
        },
        {
          itemId: "item-beta",
          documentId: "beta",
          title: "Untitled",
          position: 1,
          properties: [
            {
              propertyId: "owner",
              name: "Owner",
              type: "text",
              value: "Taylor",
              text: "Taylor",
            },
            {
              propertyId: "status",
              name: "Status",
              type: "status",
              value: "draft",
              text: "Draft",
            },
          ],
        },
      ],
      visibleItemLimit: 50,
      selectedItemCount: 0,
      selectedItems: [],
    });
  });

  it("preserves explicit navigation unfreeze and resolves effective column wrapping", () => {
    expect(
      databaseCurrentViewSnapshot(
        {
          databaseViewType: "table",
          databaseColumnWrapOverrides: { name: false, owner: true },
          databaseFrozenThroughColumnId: null,
          databaseEffectiveFrozenColumnIds: ["name"],
        },
        databaseResponse(),
      ),
    ).toMatchObject({
      columnWrapOverrides: { name: false, owner: true },
      effectiveColumnWrapById: {
        name: false,
        owner: true,
        status: true,
      },
      frozenThroughColumnId: null,
      intendedFrozenColumnIds: [],
      effectiveFrozenColumnIds: undefined,
    });
  });

  it("reports observed viewport-capped freezing separately from the intended prefix", () => {
    expect(
      databaseCurrentViewSnapshot(
        {
          databaseViewType: "table",
          databaseFrozenThroughColumnId: "status",
          databaseEffectiveFrozenColumnIds: ["name"],
        },
        databaseResponse(),
      ),
    ).toMatchObject({
      frozenThroughColumnId: "status",
      intendedFrozenColumnIds: ["name", "owner", "status"],
      effectiveFrozenColumnIds: ["name"],
    });
  });

  it("does not report malformed or non-prefix observed freeze state", () => {
    expect(
      databaseCurrentViewSnapshot(
        {
          databaseViewType: "table",
          databaseFrozenThroughColumnId: "status",
          databaseEffectiveFrozenColumnIds: ["owner"],
        },
        databaseResponse(),
      ).effectiveFrozenColumnIds,
    ).toBeUndefined();
  });

  it("rejects a stale observation beyond a newly narrowed intended range", () => {
    const response = databaseResponse();
    response.database.viewConfig.views[0].frozenThroughColumnId = undefined;
    expect(
      databaseCurrentViewSnapshot(
        {
          databaseViewType: "table",
          databaseEffectiveFrozenColumnIds: ["name", "owner"],
        },
        response,
      ),
    ).toMatchObject({
      intendedFrozenColumnIds: ["name"],
      effectiveFrozenColumnIds: undefined,
    });
  });

  it("exposes ordered required questions for the active form view", () => {
    const response = databaseResponse();
    response.database.viewConfig.activeViewId = "request-form";
    response.database.viewConfig.views.push({
      id: "request-form",
      name: "Request design",
      type: "form",
      sorts: [],
      filters: [],
      columnWidths: {},
      formQuestions: [
        { key: "name", enabled: true, required: true },
        { key: "priority", enabled: true, required: true },
      ],
    });

    expect(databaseCurrentViewSnapshot({}, response)).toMatchObject({
      id: "request-form",
      type: "form",
      formQuestions: [
        { key: "name", enabled: true, required: true },
        { key: "priority", enabled: true, required: true },
      ],
    });
  });

  it("falls back to saved calendar and timeline date properties", () => {
    const response = databaseResponse();
    const activeView = response.database.viewConfig.views[0]!;
    activeView.type = "timeline";
    activeView.datePropertyId = "publish";
    activeView.endDatePropertyId = "end";
    response.properties.push(publishDateProperty(null), endDateProperty(null));

    expect(databaseCurrentViewSnapshot({}, response)).toMatchObject({
      type: "timeline",
      datePropertyId: "publish",
      datePropertyName: "Publish Date",
      endDatePropertyId: "end",
      endDatePropertyName: "End Date",
    });
  });

  it("summarizes date range values without object placeholders", () => {
    const response = databaseResponse();
    const activeView = response.database.viewConfig.views[0]!;
    activeView.hiddenPropertyIds = [];
    activeView.propertyOrderIds = ["publish"];
    response.properties.push(publishDateProperty(null));
    response.items[0]!.properties.push(
      publishDateProperty({
        start: "2026-05-28T10:30",
        end: "2026-05-29T16:00",
        includeTime: true,
      }),
    );

    expect(
      databaseCurrentViewSnapshot(
        {},
        response,
      ).visibleItems[0]?.properties.find(
        (property) => property.propertyId === "publish",
      ),
    ).toEqual({
      propertyId: "publish",
      name: "Publish Date",
      type: "date",
      value: {
        start: "2026-05-28T10:30",
        end: "2026-05-29T16:00",
        includeTime: true,
      },
      text: "2026-05-28T10:30 - 2026-05-29T16:00",
    });
  });

  it("falls back to a date-like property for unsaved calendar view settings", () => {
    const response = databaseResponse();
    const activeView = response.database.viewConfig.views[0]!;
    activeView.type = "calendar";
    response.properties.push(publishDateProperty(null));

    expect(databaseCurrentViewSnapshot({}, response)).toMatchObject({
      type: "calendar",
      datePropertyId: "publish",
      datePropertyName: "Publish Date",
    });
  });

  it("summarizes richer saved database footer calculations", () => {
    const response = databaseResponse();
    const activeView = response.database.viewConfig.views[0]!;
    activeView.hiddenPropertyIds = [];
    activeView.calculations = {
      owner: "count_unique",
      status: "count_all",
      priority: "median",
    };

    expect(
      databaseCurrentViewSnapshot({}, response).calculationResults,
    ).toEqual([
      {
        propertyId: "owner",
        name: "Owner",
        type: "text",
        calculation: "count_unique",
        result: "2 unique",
      },
      {
        propertyId: "status",
        name: "Status",
        type: "status",
        calculation: "count_all",
        result: "2 rows",
      },
      {
        propertyId: "priority",
        name: "Priority",
        type: "number",
        calculation: "median",
        result: "Median 1.50",
      },
    ]);
  });

  it("keeps totals honest when the current database window is bounded", () => {
    const response = databaseResponse();
    response.pagination = {
      offset: 0,
      limit: 50,
      totalItems: 120,
      returnedItems: 50,
      hasMore: true,
    };

    const snapshot = databaseCurrentViewSnapshot({}, response);

    expect(snapshot.visibleItemCount).toBe(50);
    expect(snapshot.totalItemCount).toBe(120);
    expect(snapshot.calculationResults).toBeNull();
  });
});

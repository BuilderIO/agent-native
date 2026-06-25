import { describe, expect, it } from "vitest";

import type { ContentDatabaseResponse, DocumentProperty } from "../shared/api";
import {
  databaseCurrentViewSnapshot,
  serializeDocumentTreeItemForScreen,
} from "./view-screen";

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
});

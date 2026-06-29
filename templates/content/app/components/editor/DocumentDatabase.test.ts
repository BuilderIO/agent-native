// @vitest-environment happy-dom

import type {
  ContentDatabaseItem,
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceExecution,
  Document,
  DocumentProperty,
  DocumentPropertyOptions,
  DocumentPropertyType,
  DocumentPropertyValue,
} from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  addDatabaseView,
  appendDatabaseFilter,
  applyDatabaseView,
  activeDatabaseConstraintCount,
  boardGroupValueForProperty,
  calendarDateKey,
  clearDatabaseFiltersForColumn,
  clearDatabaseSort,
  createDatabaseView,
  databaseBoardCanCreateGroup,
  databaseBoardCanManageGroup,
  databaseBoardGroups,
  databaseBoardOptionForGroup,
  databaseBoardVisibleCardProperties,
  databaseBulkEditableProperties,
  databaseBulkScalarInputState,
  databaseCalculationOptionsForProperty,
  databaseCalculationSummaries,
  databaseCalendarDateProperty,
  databaseColumnCalculationResult,
  databaseColumnHeaderState,
  databaseCalendarItemsByDate,
  databaseCalendarMonthDays,
  databaseDateViewRange,
  databaseDuplicatedItemFromResponse,
  databaseFilterOptionChoices,
  databaseFilterOptionPropertyForKey,
  databaseFooterVisibleCount,
  databaseItemPageIconText,
  databaseItemPreviewFallbackAfterBulkDelete,
  databaseItemPreviewFallbackAfterDelete,
  databaseItemPreviewNeighbor,
  databaseItemPreviewPosition,
  databaseItemPreviewTitle,
  databaseItemsWithoutDateValue,
  databaseNavigationState,
  builderReviewableChangeSets,
  builderReviewExecutableRows,
  builderSourceLiveWriteControlState,
  buildClientBuilderReviewPayload,
  databasePropertyPickerItems,
  databasePropertyValuesForNewItem,
  databaseQuickFilterOptionsForColumn,
  databaseGroupIsCollapsed,
  databaseScreenVisibleItems,
  databaseSelectedItems,
  databaseTableCellDensityClass,
  databaseTableRowDensityClass,
  databaseTimelineDays,
  databaseTimelineItemSpans,
  databaseViewGroupableProperties,
  databaseVisibleItemSummaries,
  databaseVisibleGroups,
  databaseGridColumns,
  databaseViewSummaries,
  databaseViewItemGroups,
  databaseResultCountLabel,
  databaseViewHasNoMatchingPages,
  deleteDatabaseView,
  duplicateDatabaseView,
  isDatabasePropertyVisibleInView,
  moveDatabaseFilter,
  moveDatabaseSort,
  moveDatabaseViewProperty,
  moveDatabaseView,
  normalizeClientDatabaseFilterMode,
  normalizeClientDatabaseRowDensity,
  normalizeClientDatabaseViewConfig,
  orderDatabasePropertiesForView,
  pruneDatabaseRowSelection,
  reorderDatabaseView,
  reorderDatabaseViewProperty,
  renameDatabaseView,
  selectDatabaseView,
  setDatabaseViewColumnCalculation,
  setDatabaseViewCollapsedGroup,
  setDatabaseViewCollapsedGroups,
  setDatabaseViewGroupByProperty,
  setDatabaseViewHiddenPropertyIds,
  toggleAllDatabaseRowSelection,
  toggleDatabaseRowSelection,
  updateDatabaseViewType,
  upsertDatabaseQuickFilter,
  upsertDatabaseSort,
  type DatabaseFilter,
  type DatabaseSort,
} from "./DocumentDatabase";

function document(id: string, title: string): Document {
  return {
    id,
    parentId: "database-page",
    title,
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
    createdAt: "2026-05-28T12:00:00.000Z",
    updatedAt: "2026-05-28T12:00:00.000Z",
  };
}

function property(
  id: string,
  name: string,
  type: DocumentPropertyType,
  value: DocumentPropertyValue = null,
  options: DocumentPropertyOptions = {},
): DocumentProperty {
  return {
    definition: {
      id,
      databaseId: "database",
      name,
      type,
      visibility: "always_show",
      options,
      position: 0,
      createdAt: "2026-05-28T12:00:00.000Z",
      updatedAt: "2026-05-28T12:00:00.000Z",
    },
    value,
    editable: true,
  };
}

function item(
  id: string,
  title: string,
  values: Record<string, DocumentPropertyValue>,
): ContentDatabaseItem {
  return {
    id: `item-${id}`,
    databaseId: "database",
    document: document(id, title),
    position: 0,
    properties: [
      property("number", "Priority", "number", values.number ?? null),
      property("checkbox", "Done", "checkbox", values.checkbox ?? null),
      property("date", "Publish date", "date", values.date ?? null),
      property("end", "End date", "date", values.end ?? null),
    ],
  };
}

function builderExecution(
  overrides: Partial<ContentDatabaseSourceExecution> = {},
): ContentDatabaseSourceExecution {
  return {
    id: "execution-1",
    changeSetId: "change-1",
    adapter: "builder-cms",
    pushMode: "autosave",
    state: "ready",
    idempotencyKey: "builder-cms:source:change-1:autosave",
    summary: "Prepared Builder autosave execution. Ready to send to Builder.",
    payload: {
      dryRun: {
        status: "validated",
        validatedAt: "2026-06-15T12:00:00.000Z",
        checks: [],
        mismatches: [],
      },
    },
    lastError: null,
    createdAt: "2026-06-15T12:00:00.000Z",
    updatedAt: "2026-06-15T12:00:00.000Z",
    ...overrides,
  };
}

function builderChangeSet(
  overrides: Partial<ContentDatabaseSourceChangeSet> = {},
): ContentDatabaseSourceChangeSet {
  return {
    id: "change-1",
    databaseItemId: "item-row",
    documentId: "row",
    kind: "field_update",
    direction: "outbound",
    state: "approved",
    pushMode: "autosave",
    localOnly: true,
    summary: "Reviewing local Builder CMS title change.",
    fieldChanges: [
      {
        propertyId: null,
        propertyName: "Title",
        localFieldKey: "title",
        sourceFieldKey: "data.title",
        currentValue: "Old title",
        proposedValue: "New title",
      },
    ],
    bodyChange: null,
    riskLevel: "low",
    riskReasons: ["single field diff"],
    conflictState: "none",
    reviewEvents: [],
    executions: [builderExecution()],
    createdAt: "2026-06-15T12:00:00.000Z",
    updatedAt: "2026-06-15T12:00:00.000Z",
    ...overrides,
  };
}

function builderSource(
  overrides: Partial<ContentDatabaseSource> = {},
): ContentDatabaseSource {
  return {
    id: "source",
    databaseId: "database",
    sourceType: "builder-cms",
    sourceName: "Builder CMS",
    sourceTable: "agent-native-blog-article-test",
    syncState: "idle",
    freshness: "fresh",
    lastRefreshedAt: null,
    lastSourceUpdatedAt: null,
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
      titleField: "data.title",
      naturalKeyField: "/blog/[slug]",
      pushMode: "none",
      writeMode: "read_only",
      allowedWriteModes: [],
      allowPublicationTransitions: false,
      allowDraftWrites: false,
      allowPublishWrites: false,
    },
    fields: [],
    rows: [
      {
        id: "row-source",
        databaseItemId: "item-row",
        documentId: "row",
        sourceRowId: "builder-row",
        sourceQualifiedId:
          "builder-cms://agent-native-blog-article-test/builder-row",
        sourceDisplayKey: "Old title",
        provenance: "fixture",
        syncState: "idle",
        freshness: "fresh",
        lastSyncedAt: null,
        lastSourceUpdatedAt: null,
      },
    ],
    changeSets: [builderChangeSet()],
    ...overrides,
  };
}

const properties = [
  property("number", "Priority", "number"),
  property("checkbox", "Done", "checkbox"),
  property("date", "Publish date", "date"),
  property("end", "End date", "date"),
];

function filter(filter: DatabaseFilter) {
  return applyDatabaseView(
    [
      item("alpha", "Alpha", {
        number: 1,
        checkbox: false,
        date: "2026-05-20",
      }),
      item("beta", "Beta", {
        number: 5,
        checkbox: true,
        date: "2026-05-26",
      }),
      item("gamma", "Gamma", {
        number: 10,
        checkbox: false,
        date: "2026-06-01",
      }),
    ],
    properties,
    "",
    [filter],
    [],
  ).map((row) => row.document.title);
}

describe("database property picker", () => {
  it("searches fields while preserving the page name option", () => {
    expect(
      databasePropertyPickerItems(properties, "pub", { includeName: true }),
    ).toEqual([
      {
        key: "date",
        label: "Publish date",
        type: "date",
      },
    ]);

    expect(
      databasePropertyPickerItems(properties, "name", { includeName: true })[0],
    ).toEqual({
      key: "name",
      label: "Name",
      type: "name",
    });
  });

  it("can omit page name for property-only pickers", () => {
    expect(
      databasePropertyPickerItems(properties, "", { includeName: false }).map(
        (item) => item.key,
      ),
    ).toEqual(["number", "checkbox", "date", "end"]);
  });
});

describe("database view filtering", () => {
  it("supports number comparisons", () => {
    expect(
      filter({
        key: "number",
        label: "Priority",
        operator: "greater_than",
        value: "4",
      }),
    ).toEqual(["Beta", "Gamma"]);
  });

  it("supports checkbox checked and unchecked filters", () => {
    expect(
      filter({
        key: "checkbox",
        label: "Done",
        operator: "is_checked",
        value: "",
      }),
    ).toEqual(["Beta"]);

    expect(
      filter({
        key: "checkbox",
        label: "Done",
        operator: "is_unchecked",
        value: "",
      }),
    ).toEqual(["Alpha", "Gamma"]);
  });

  it("supports date comparisons", () => {
    expect(
      filter({
        key: "date",
        label: "Publish date",
        operator: "before",
        value: "2026-05-28",
      }),
    ).toEqual(["Alpha", "Beta"]);
  });

  it("supports option-backed select filters by stable id and label", () => {
    const statusOptions = {
      options: [
        { id: "draft", name: "Draft", color: "gray" as const },
        { id: "published", name: "Published", color: "green" as const },
      ],
    };
    const statusProperty = property(
      "status",
      "Status",
      "select",
      null,
      statusOptions,
    );
    const rows = [
      {
        ...item("alpha", "Alpha", {}),
        properties: [
          property("status", "Status", "select", "draft", statusOptions),
        ],
      },
      {
        ...item("beta", "Beta", {}),
        properties: [
          property("status", "Status", "select", "published", statusOptions),
        ],
      },
    ];

    expect(databaseFilterOptionChoices("status", [statusProperty])).toEqual(
      statusOptions.options,
    );
    expect(
      databaseFilterOptionPropertyForKey("status", [statusProperty])?.definition
        .name,
    ).toBe("Status");
    expect(databaseFilterOptionPropertyForKey("number", properties)).toBeNull();
    expect(
      applyDatabaseView(
        rows,
        [statusProperty],
        "",
        [
          {
            key: "status",
            label: "Status",
            operator: "equals",
            value: "published",
          },
        ],
        [],
      ).map((row) => row.document.title),
    ).toEqual(["Beta"]);
    expect(
      applyDatabaseView(
        rows,
        [statusProperty],
        "",
        [
          {
            key: "status",
            label: "Status",
            operator: "equals",
            value: "Published",
          },
        ],
        [],
      ).map((row) => row.document.title),
    ).toEqual(["Beta"]);
  });

  it("can match any active filter instead of requiring every filter", () => {
    const filters: DatabaseFilter[] = [
      {
        key: "number",
        label: "Priority",
        operator: "greater_than",
        value: "8",
      },
      {
        key: "checkbox",
        label: "Done",
        operator: "is_checked",
        value: "",
      },
    ];

    expect(
      applyDatabaseView(
        [
          item("alpha", "Alpha", { number: 1, checkbox: false }),
          item("beta", "Beta", { number: 5, checkbox: true }),
          item("gamma", "Gamma", { number: 10, checkbox: false }),
        ],
        properties,
        "",
        filters,
        [],
        "or",
      ).map((row) => row.document.title),
    ).toEqual(["Beta", "Gamma"]);
  });
});

describe("Builder source settings helpers", () => {
  it("counts only outbound Builder changes that need source-settings attention", () => {
    expect(
      builderReviewableChangeSets(
        builderSource({
          changeSets: [
            builderChangeSet({ id: "pending", state: "pending_push" }),
            builderChangeSet({ id: "approved", state: "approved" }),
            builderChangeSet({ id: "applied", state: "applied" }),
          ],
        }),
      ).map((changeSet) => changeSet.id),
    ).toEqual(["pending", "approved"]);
  });

  it("shows the live-write enable action only for the safe Builder test collection", () => {
    expect(builderSourceLiveWriteControlState(builderSource())).toMatchObject({
      safeTarget: true,
      enabled: false,
      showAction: true,
      actionLabel: "Enable",
    });

    expect(
      builderSourceLiveWriteControlState(
        builderSource({ sourceTable: "blog_article" }),
      ),
    ).toMatchObject({
      safeTarget: false,
      enabled: false,
      showAction: false,
    });
  });

  it("marks live-enabled validated review rows as executable", () => {
    const source = builderSource({
      capabilities: {
        ...builderSource().capabilities,
        liveWritesEnabled: true,
      },
    });
    const review = buildClientBuilderReviewPayload(source, source.changeSets);

    expect(review.result).toMatchObject({
      status: "validated",
      message: "Push checked successfully. Ready to send to Builder.",
    });
    expect(builderReviewExecutableRows(review)).toHaveLength(1);
  });

  it("keeps write-disabled review rows out of the live execute path", () => {
    const source = builderSource();
    const review = buildClientBuilderReviewPayload(source, source.changeSets);

    expect(review.result).toMatchObject({
      status: "validated",
      message: "Push checked successfully. Nothing was sent to Builder.",
    });
    expect(builderReviewExecutableRows(review)).toEqual([]);
  });

  it("surfaces succeeded and failed execution status in review payloads", () => {
    const succeededSource = builderSource({
      changeSets: [
        builderChangeSet({
          state: "applied",
          executions: [builderExecution({ state: "succeeded" })],
        }),
      ],
    });
    expect(
      buildClientBuilderReviewPayload(
        succeededSource,
        succeededSource.changeSets,
      ).result,
    ).toMatchObject({
      status: "succeeded",
      message: "Pushed to Builder and reconciled locally.",
    });

    const failedSource = builderSource({
      changeSets: [
        builderChangeSet({
          executions: [
            builderExecution({
              state: "failed",
              lastError: "Builder write request failed with HTTP 500.",
            }),
          ],
        }),
      ],
    });
    expect(
      buildClientBuilderReviewPayload(failedSource, failedSource.changeSets)
        .result,
    ).toMatchObject({
      status: "failed",
      message: "Builder push failed. The change remains retryable.",
    });
  });
});

describe("database view sorting", () => {
  it("applies later sorts as tie breakers", () => {
    const rows = [
      item("b", "Beta", { number: 1 }),
      item("a", "Alpha", { number: 1 }),
      item("c", "Gamma", { number: 2 }),
    ];

    expect(
      applyDatabaseView(
        rows,
        properties,
        "",
        [],
        [
          { key: "number", label: "Priority", direction: "asc" },
          { key: "name", label: "Name", direction: "asc" },
        ],
      ).map((row) => row.document.title),
    ).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("promotes header sorts without duplicating the same column", () => {
    const existing: DatabaseSort[] = [
      { key: "status", label: "Status", direction: "asc" },
      { key: "name", label: "Name", direction: "desc" },
    ];

    expect(upsertDatabaseSort(existing, "name", "Name", "asc")).toEqual([
      { key: "name", label: "Name", direction: "asc" },
      { key: "status", label: "Status", direction: "asc" },
    ]);
  });

  it("clears header sorts for one column without touching other sorts", () => {
    expect(
      clearDatabaseSort(
        [
          { key: "name", label: "Name", direction: "asc" },
          { key: "status", label: "Status", direction: "desc" },
        ],
        "name",
      ),
    ).toEqual([{ key: "status", label: "Status", direction: "desc" }]);
  });

  it("reorders stacked sort priority", () => {
    const sorts: DatabaseSort[] = [
      { key: "name", label: "Name", direction: "asc" },
      { key: "number", label: "Priority", direction: "desc" },
      { key: "date", label: "Publish date", direction: "asc" },
    ];

    expect(moveDatabaseSort(sorts, 2, "up").map((sort) => sort.key)).toEqual([
      "name",
      "date",
      "number",
    ]);
    expect(moveDatabaseSort(sorts, 0, "up")).toBe(sorts);
    expect(moveDatabaseSort(sorts, 2, "down")).toBe(sorts);
  });
});

describe("database column filters", () => {
  it("appends quick filters from column menus", () => {
    expect(appendDatabaseFilter([], "name", "Name", "is_not_empty")).toEqual([
      { key: "name", label: "Name", operator: "is_not_empty", value: "" },
    ]);
  });

  it("replaces mutually exclusive quick filters for the same column", () => {
    expect(
      upsertDatabaseQuickFilter(
        [
          { key: "name", label: "Name", operator: "is_empty", value: "" },
          {
            key: "status",
            label: "Status",
            operator: "is_not_empty",
            value: "",
          },
        ],
        "name",
        "Name",
        "is_not_empty",
      ),
    ).toEqual([
      {
        key: "status",
        label: "Status",
        operator: "is_not_empty",
        value: "",
      },
      { key: "name", label: "Name", operator: "is_not_empty", value: "" },
    ]);
  });

  it("uses checkbox-specific quick filters in column menus", () => {
    expect(databaseQuickFilterOptionsForColumn("checkbox")).toEqual([
      { operator: "is_checked", label: "Filter checked" },
      { operator: "is_unchecked", label: "Filter unchecked" },
    ]);
    expect(databaseQuickFilterOptionsForColumn("text")).toEqual([
      { operator: "is_empty", label: "Filter empty" },
      { operator: "is_not_empty", label: "Filter not empty" },
    ]);
    expect(
      upsertDatabaseQuickFilter(
        [
          {
            key: "checkbox",
            label: "Done",
            operator: "is_checked",
            value: "",
          },
        ],
        "checkbox",
        "Done",
        "is_unchecked",
      ),
    ).toEqual([
      {
        key: "checkbox",
        label: "Done",
        operator: "is_unchecked",
        value: "",
      },
    ]);
  });

  it("clears filters for one column without touching other columns", () => {
    expect(
      clearDatabaseFiltersForColumn(
        [
          { key: "name", label: "Name", operator: "contains", value: "A" },
          { key: "name", label: "Name", operator: "is_not_empty", value: "" },
          {
            key: "status",
            label: "Status",
            operator: "equals",
            value: "done",
          },
        ],
        "name",
      ),
    ).toEqual([
      { key: "status", label: "Status", operator: "equals", value: "done" },
    ]);
  });

  it("summarizes active sort and filter state for column headers", () => {
    expect(
      databaseColumnHeaderState(
        [{ key: "name", label: "Name", direction: "desc" }],
        [
          { key: "name", label: "Name", operator: "contains", value: "" },
          { key: "name", label: "Name", operator: "is_not_empty", value: "" },
          { key: "status", label: "Status", operator: "is_empty", value: "" },
        ],
        "name",
      ),
    ).toEqual({
      sortDirection: "desc",
      activeFilterCount: 1,
    });
  });

  it("reorders stacked filters", () => {
    const filters: DatabaseFilter[] = [
      { key: "name", label: "Name", operator: "contains", value: "a" },
      {
        key: "number",
        label: "Priority",
        operator: "greater_than",
        value: "4",
      },
      {
        key: "checkbox",
        label: "Done",
        operator: "is_checked",
        value: "",
      },
    ];

    expect(
      moveDatabaseFilter(filters, 0, "down").map((filter) => filter.key),
    ).toEqual(["number", "name", "checkbox"]);
    expect(moveDatabaseFilter(filters, 0, "up")).toBe(filters);
    expect(moveDatabaseFilter(filters, 2, "down")).toBe(filters);
  });

  it("counts active search, sort, and filter constraints", () => {
    expect(
      activeDatabaseConstraintCount(
        " launch ",
        [{ key: "name", label: "Name", direction: "asc" }],
        [
          { key: "name", label: "Name", operator: "contains", value: "" },
          {
            key: "checkbox",
            label: "Done",
            operator: "is_checked",
            value: "",
          },
        ],
      ),
    ).toBe(3);
  });
});

describe("new database item defaults", () => {
  it("copies simple equality filters into new row property values", () => {
    const statusProperty = property("status", "Status", "select");
    const pillarsProperty = property("pillars", "Pillars", "multi_select");

    expect(
      databasePropertyValuesForNewItem(
        [
          {
            key: "status",
            label: "Status",
            operator: "equals",
            value: "published",
          },
          {
            key: "pillars",
            label: "Pillars",
            operator: "equals",
            value: "design",
          },
        ],
        [statusProperty, pillarsProperty],
      ),
    ).toEqual({
      status: "published",
      pillars: ["design"],
    });
  });

  it("normalizes option-label equality filters into stable option ids for new rows", () => {
    const options = {
      options: [
        { id: "draft", name: "Draft", color: "gray" as const },
        { id: "published", name: "Published", color: "green" as const },
        { id: "design", name: "Design Systems", color: "blue" as const },
      ],
    };
    const statusProperty = property(
      "status",
      "Status",
      "status",
      null,
      options,
    );
    const pillarProperty = property(
      "pillar",
      "Content pillar",
      "multi_select",
      null,
      options,
    );

    expect(
      databasePropertyValuesForNewItem(
        [
          {
            key: "status",
            label: "Status",
            operator: "equals",
            value: "Published",
          },
          {
            key: "pillar",
            label: "Content pillar",
            operator: "equals",
            value: "Design Systems",
          },
        ],
        [statusProperty, pillarProperty],
      ),
    ).toEqual({
      status: "published",
      pillar: ["design"],
    });
  });

  it("copies checkbox filters into new row property values", () => {
    const doneProperty = property("done", "Done", "checkbox");

    expect(
      databasePropertyValuesForNewItem(
        [
          {
            key: "done",
            label: "Done",
            operator: "is_checked",
            value: "",
          },
        ],
        [doneProperty],
      ),
    ).toEqual({ done: true });

    expect(
      databasePropertyValuesForNewItem(
        [
          {
            key: "done",
            label: "Done",
            operator: "is_unchecked",
            value: "",
          },
        ],
        [doneProperty],
      ),
    ).toEqual({ done: false });
  });

  it("does not copy multiple OR filters into new row property values", () => {
    expect(
      databasePropertyValuesForNewItem(
        [
          {
            key: "status",
            label: "Status",
            operator: "equals",
            value: "published",
          },
          {
            key: "done",
            label: "Done",
            operator: "is_checked",
            value: "",
          },
        ],
        [
          property("status", "Status", "select"),
          property("done", "Done", "checkbox"),
        ],
        "or",
      ),
    ).toEqual({});
  });

  it("ignores filters that cannot safely become default row values", () => {
    const createdProperty = {
      ...property("created", "Created", "created_time"),
      editable: false,
    };

    expect(
      databasePropertyValuesForNewItem(
        [
          {
            key: "name",
            label: "Name",
            operator: "contains",
            value: "launch",
          },
          {
            key: "status",
            label: "Status",
            operator: "does_not_equal",
            value: "archived",
          },
          {
            key: "created",
            label: "Created",
            operator: "equals",
            value: "2026-05-28",
          },
        ],
        [property("status", "Status", "select"), createdProperty],
      ),
    ).toEqual({});
  });
});

describe("database column sizing", () => {
  it("uses saved column widths in the table grid", () => {
    expect(
      databaseGridColumns(properties, true, {
        name: 300,
        number: 220,
      }),
    ).toBe("300px 220px 180px 180px 180px 48px");
  });
});

describe("database result count", () => {
  it("labels total and filtered page counts", () => {
    expect(databaseResultCountLabel(1, 3, false)).toBe("Count 1 page");
    expect(databaseResultCountLabel(3, 3, true)).toBe("Count 3 pages");
    expect(databaseResultCountLabel(2, 5, true)).toBe("Count 2 pages of 5");
  });

  it("counts the visible date window in calendar and timeline footers", () => {
    const allRows = [
      item("alpha", "Alpha", { date: "2026-05-20" }),
      item("beta", "Beta", { date: "2026-07-01" }),
    ];
    const visibleWindowRows = allRows.slice(0, 1);

    expect(
      databaseFooterVisibleCount("calendar", allRows, visibleWindowRows),
    ).toBe(1);
    expect(
      databaseFooterVisibleCount("timeline", allRows, visibleWindowRows),
    ).toBe(1);
    expect(databaseFooterVisibleCount("list", allRows, visibleWindowRows)).toBe(
      2,
    );
  });

  it("shows no-match recovery only when constraints hide every page", () => {
    expect(databaseViewHasNoMatchingPages(0, false, 0)).toBe(false);
    expect(databaseViewHasNoMatchingPages(0, true, 0)).toBe(true);
    expect(databaseViewHasNoMatchingPages(0, false, 1)).toBe(true);
    expect(databaseViewHasNoMatchingPages(1, true, 1)).toBe(false);
  });
});

describe("database column calculations", () => {
  it("offers type-aware table footer calculations", () => {
    expect(
      databaseCalculationOptionsForProperty(
        property("title", "Title", "text"),
      ).map((option) => option.value),
    ).toEqual([
      "count_all",
      "count_values",
      "count_empty",
      "count_unique",
      "percent_filled",
      "percent_empty",
    ]);
    expect(
      databaseCalculationOptionsForProperty(
        property("score", "Score", "number"),
      ).map((option) => option.value),
    ).toEqual([
      "count_all",
      "count_values",
      "count_empty",
      "count_unique",
      "percent_filled",
      "percent_empty",
      "sum",
      "average",
      "median",
      "min",
      "max",
      "range",
    ]);
    expect(
      databaseCalculationOptionsForProperty(
        property("done", "Done", "checkbox"),
      ).map((option) => option.value),
    ).toEqual([
      "count_all",
      "count_values",
      "count_empty",
      "count_unique",
      "percent_filled",
      "percent_empty",
      "count_checked",
      "count_unchecked",
      "percent_checked",
      "percent_unchecked",
    ]);
    expect(
      databaseCalculationOptionsForProperty(
        property("publish", "Publish", "date"),
      ).map((option) => option.value),
    ).toEqual([
      "count_all",
      "count_values",
      "count_empty",
      "count_unique",
      "percent_filled",
      "percent_empty",
      "min",
      "max",
      "date_range",
    ]);
  });

  it("persists and clears table footer calculations on a database view", () => {
    const view = createDatabaseView("Table", "default", {
      calculations: { number: "sum" },
    });

    expect(
      setDatabaseViewColumnCalculation(view, "checkbox", "count_values"),
    ).toMatchObject({
      calculations: { number: "sum", checkbox: "count_values" },
    });
    expect(
      setDatabaseViewColumnCalculation(view, "number", null).calculations,
    ).toEqual({});
  });

  it("calculates table footer summaries from visible rows", () => {
    const rows = [
      item("alpha", "Alpha", { number: 10, date: "2026-05-01" }),
      item("beta", "Beta", { number: "bad", date: null }),
      item("gamma", "Gamma", { number: 20, date: "2026-05-03" }),
    ];

    expect(
      databaseColumnCalculationResult("count_all", rows, properties[0]),
    ).toBe("3 rows");
    expect(
      databaseColumnCalculationResult("count_values", rows, properties[0]),
    ).toBe("3 values");
    expect(
      databaseColumnCalculationResult("count_empty", rows, properties[2]),
    ).toBe("1 empty");
    expect(
      databaseColumnCalculationResult("percent_empty", rows, properties[2]),
    ).toBe("33% empty");
    expect(
      databaseColumnCalculationResult("percent_filled", rows, properties[2]),
    ).toBe("67% filled");
    expect(
      databaseColumnCalculationResult("count_unique", rows, properties[0]),
    ).toBe("3 unique");
    expect(databaseColumnCalculationResult("sum", rows, properties[0])).toBe(
      "Sum 30",
    );
    expect(
      databaseColumnCalculationResult("average", rows, properties[0]),
    ).toBe("Avg 15");
    expect(databaseColumnCalculationResult("median", rows, properties[0])).toBe(
      "Median 15",
    );
    expect(databaseColumnCalculationResult("range", rows, properties[0])).toBe(
      "Range 10",
    );
    expect(
      databaseColumnCalculationResult("percent_unchecked", rows, properties[1]),
    ).toBe("100% unchecked");
    expect(databaseColumnCalculationResult("min", rows, properties[2])).toBe(
      "Earliest 2026-05-01",
    );
    expect(
      databaseColumnCalculationResult("date_range", rows, properties[2]),
    ).toBe("Range 2 days");
  });

  it("summarizes visible calculation footer results for navigation state", () => {
    const rows = [
      item("alpha", "Alpha", { number: 4, checkbox: true }),
      item("beta", "Beta", { number: 6, checkbox: false }),
    ];

    expect(
      databaseCalculationSummaries(
        { number: "average", checkbox: "percent_checked", date: "count_empty" },
        rows,
        properties.slice(0, 2),
      ),
    ).toEqual([
      {
        propertyId: "number",
        name: "Priority",
        type: "number",
        calculation: "average",
        result: "Avg 5",
      },
      {
        propertyId: "checkbox",
        name: "Done",
        type: "checkbox",
        calculation: "percent_checked",
        result: "50% checked",
      },
    ]);
  });
});

describe("database item preview", () => {
  it("exposes the previewed database row in navigation state", () => {
    const row = item("row-doc", "Launch brief", {});

    expect(
      databaseNavigationState({
        document: { id: "database-doc", title: "Content calendar" },
        databaseId: "database",
        activeView: { id: "default", name: "Table", type: "table" },
        previewItem: row,
      }),
    ).toEqual({
      view: "editor",
      documentId: "database-doc",
      title: "Content calendar",
      databaseId: "database",
      databaseSourceType: undefined,
      databaseSourceName: undefined,
      databaseSourceTable: undefined,
      databaseSourceSyncState: undefined,
      databaseSourceFreshness: undefined,
      databaseSourcePendingChangeCount: undefined,
      databaseSourceLocalChangeCount: undefined,
      databaseViews: [{ id: "default", name: "Table", type: "table" }],
      databaseViewId: "default",
      databaseViewName: "Table",
      databaseViewType: "table",
      databaseSearchQuery: undefined,
      databaseSortCount: 0,
      databaseSorts: undefined,
      databaseFilterMode: undefined,
      databaseActiveFilterCount: 0,
      databaseActiveFilters: undefined,
      databaseGroupByPropertyId: undefined,
      databaseGroupByPropertyName: undefined,
      databaseCollapsedGroupIds: undefined,
      databaseHideEmptyGroups: undefined,
      databaseDatePropertyId: undefined,
      databaseDatePropertyName: undefined,
      databaseEndDatePropertyId: undefined,
      databaseEndDatePropertyName: undefined,
      databaseDateRangeStart: undefined,
      databaseDateRangeEnd: undefined,
      databaseDateRangeLabel: undefined,
      databaseCalculations: undefined,
      databaseCalculationResults: undefined,
      databaseWrapCells: undefined,
      databaseRowDensity: undefined,
      databaseOpenPagesIn: undefined,
      databaseVisibleItemCount: undefined,
      databaseTotalItemCount: undefined,
      databaseVisibleItems: [],
      databaseVisibleItemLimit: 50,
      databaseSelectedItemCount: 0,
      databaseSelectedItems: undefined,
      databasePreviewItemId: row.id,
      databasePreviewDocumentId: row.document.id,
      databasePreviewTitle: "Launch brief",
    });
  });

  it("includes source status in navigation state when a database is source-backed", () => {
    expect(
      databaseNavigationState({
        document: { id: "database-doc", title: "Content calendar" },
        databaseId: "database",
        source: {
          id: "source",
          databaseId: "database",
          sourceType: "mock-local",
          sourceName: "Mock local source",
          sourceTable: "content_rows",
          syncState: "idle",
          freshness: "fresh",
          lastRefreshedAt: "2026-06-08T12:00:00.000Z",
          lastSourceUpdatedAt: "2026-06-08T12:00:00.000Z",
          lastError: null,
          capabilities: {
            canRefresh: true,
            canCreateChangeSets: true,
            canWriteFields: false,
            canWriteBody: false,
            canPush: false,
            canPull: false,
            canPublish: false,
            canDelete: false,
            canStageLocalRevision: false,
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
          },
          fields: [],
          rows: [],
          changeSets: [
            {
              id: "change-1",
              databaseItemId: null,
              documentId: null,
              kind: "field_update",
              direction: "outbound",
              state: "pending_push",
              pushMode: null,
              localOnly: true,
              summary: "Mock change",
              fieldChanges: [],
              bodyChange: null,
              riskLevel: "low",
              riskReasons: ["single field diff"],
              conflictState: "none",
              reviewEvents: [],
              executions: [],
              createdAt: "2026-06-08T12:00:00.000Z",
              updatedAt: "2026-06-08T12:00:00.000Z",
            },
          ],
        },
        activeView: { id: "default", name: "Table", type: "table" },
        previewItem: null,
      }),
    ).toMatchObject({
      databaseSourceType: "mock-local",
      databaseSourceName: "Mock local source",
      databaseSourceTable: "content_rows",
      databaseSourceSyncState: "idle",
      databaseSourceFreshness: "fresh",
      databaseSourcePendingChangeCount: 1,
      databaseSourceLocalChangeCount: 1,
    });
  });

  it("exposes the active database slice in navigation state", () => {
    expect(
      databaseNavigationState({
        document: { id: "database-doc", title: "Content calendar" },
        databaseId: "database",
        views: [
          { id: "editorial", name: "Editorial", type: "board" },
          { id: "calendar", name: "Calendar", type: "calendar" },
        ],
        activeView: {
          id: "editorial",
          name: "Editorial",
          type: "board",
          filterMode: "or",
          groupByPropertyId: "number",
          collapsedGroupIds: ["number:2"],
          hideEmptyGroups: true,
          datePropertyId: "date",
          endDatePropertyId: "end",
          calculations: { number: "sum" },
          wrapCells: true,
          rowDensity: "comfortable",
        },
        searchQuery: " launch ",
        sorts: [{ key: "name", label: "Name", direction: "asc" }],
        activeFilters: [
          {
            key: "status",
            label: "Status",
            operator: "equals",
            value: "published",
          },
          {
            key: "name",
            label: "Name",
            operator: "contains",
            value: "launch",
          },
        ],
        activeFilterCount: 2,
        visibleItems: [
          item("alpha", "Alpha", { number: 2 }),
          item("beta", "Beta", { number: 3 }),
        ],
        properties,
        dateRange: databaseDateViewRange("timeline", new Date(2026, 4, 15)),
        visibleProperties: [properties[0]],
        selectedItems: [item("beta", "Beta", {})],
        visibleItemCount: 4,
        totalItemCount: 9,
        previewItem: null,
      }),
    ).toMatchObject({
      databaseViews: [
        { id: "editorial", name: "Editorial", type: "board" },
        { id: "calendar", name: "Calendar", type: "calendar" },
      ],
      databaseViewId: "editorial",
      databaseViewName: "Editorial",
      databaseViewType: "board",
      databaseSearchQuery: "launch",
      databaseSortCount: 1,
      databaseSorts: [{ key: "name", label: "Name", direction: "asc" }],
      databaseFilterMode: "or",
      databaseActiveFilterCount: 2,
      databaseActiveFilters: [
        {
          key: "status",
          label: "Status",
          operator: "equals",
          value: "published",
        },
        {
          key: "name",
          label: "Name",
          operator: "contains",
          value: "launch",
        },
      ],
      databaseGroupByPropertyId: "number",
      databaseGroupByPropertyName: "Priority",
      databaseCollapsedGroupIds: ["number:2"],
      databaseHideEmptyGroups: true,
      databaseDatePropertyId: "date",
      databaseDatePropertyName: "Publish date",
      databaseEndDatePropertyId: "end",
      databaseEndDatePropertyName: "End date",
      databaseDateRangeStart: "2026-04-26",
      databaseDateRangeEnd: "2026-06-06",
      databaseDateRangeLabel: "Apr 26 - Jun 6, 2026",
      databaseCalculations: { number: "sum" },
      databaseCalculationResults: [
        {
          propertyId: "number",
          name: "Priority",
          type: "number",
          calculation: "sum",
          result: "Sum 5",
        },
      ],
      databaseWrapCells: true,
      databaseRowDensity: "comfortable",
      databaseVisibleItemCount: 4,
      databaseTotalItemCount: 9,
      databaseVisibleItems: [
        {
          itemId: "item-alpha",
          documentId: "alpha",
          title: "Alpha",
          position: 0,
        },
        {
          itemId: "item-beta",
          documentId: "beta",
          title: "Beta",
          position: 0,
        },
      ],
      databaseVisibleItemLimit: 50,
      databaseSelectedItemCount: 1,
      databaseSelectedItems: [
        {
          itemId: "item-beta",
          documentId: "beta",
          title: "Beta",
          position: 0,
        },
      ],
    });
  });

  it("caps visible row summaries for navigation state", () => {
    const rows = Array.from({ length: 55 }, (_, index) =>
      item(`row-${index}`, `Row ${index}`, {}),
    );

    expect(databaseVisibleItemSummaries(rows)).toHaveLength(50);
    expect(databaseVisibleItemSummaries(rows, [], 2)).toEqual([
      {
        itemId: "item-row-0",
        documentId: "row-0",
        title: "Row 0",
        position: 0,
        properties: [],
      },
      {
        itemId: "item-row-1",
        documentId: "row-1",
        title: "Row 1",
        position: 0,
        properties: [],
      },
    ]);
  });

  it("tracks selected rows against the visible database rows", () => {
    const rows = [item("alpha", "Alpha", {}), item("beta", "Beta", {})];

    expect(toggleDatabaseRowSelection([], "item-alpha")).toEqual([
      "item-alpha",
    ]);
    expect(toggleDatabaseRowSelection(["item-alpha"], "item-alpha")).toEqual(
      [],
    );
    expect(toggleAllDatabaseRowSelection([], rows)).toEqual([
      "item-alpha",
      "item-beta",
    ]);
    expect(
      toggleAllDatabaseRowSelection(["item-alpha", "item-beta"], rows),
    ).toEqual([]);
    expect(
      databaseSelectedItems(rows, ["item-beta", "missing"]).map(
        (row) => row.id,
      ),
    ).toEqual(["item-beta"]);
    expect(pruneDatabaseRowSelection(["item-alpha", "missing"], rows)).toEqual([
      "item-alpha",
    ]);
    const unchangedSelection = ["item-alpha"];
    expect(pruneDatabaseRowSelection(unchangedSelection, rows)).toBe(
      unchangedSelection,
    );
    const emptySelection: string[] = [];
    expect(pruneDatabaseRowSelection(emptySelection, [])).toBe(emptySelection);
  });

  it("keeps bulk-editable selected row properties to editable non-computed fields", () => {
    const editableStatus = property("status", "Status", "status");
    const computedCreatedTime = property("created", "Created", "created_time");
    const lockedText = property("locked", "Locked", "text");
    lockedText.editable = false;

    expect(
      databaseBulkEditableProperties([
        editableStatus,
        computedCreatedTime,
        lockedText,
      ]).map((candidate) => candidate.definition.id),
    ).toEqual(["status"]);
  });

  it("normalizes bulk scalar property inputs before applying them to selected rows", () => {
    expect(databaseBulkScalarInputState("text", "  Draft  ")).toEqual({
      isValid: true,
      value: "Draft",
    });
    expect(databaseBulkScalarInputState("number", " 42 ")).toEqual({
      isValid: true,
      value: 42,
    });
    expect(databaseBulkScalarInputState("number", "forty-two")).toEqual({
      isValid: false,
      value: null,
    });
    expect(databaseBulkScalarInputState("date", "   ")).toEqual({
      isValid: true,
      value: null,
    });
  });

  it("finds the duplicated row returned by a duplicate database item action", () => {
    const alpha = item("alpha", "Alpha", {});
    const beta = item("beta", "Beta", {});

    expect(
      databaseDuplicatedItemFromResponse({
        items: [alpha, beta],
        duplicatedItemId: beta.id,
      })?.document.title,
    ).toBe("Beta");
    expect(
      databaseDuplicatedItemFromResponse({
        items: [alpha],
        duplicatedItemId: "missing",
      }),
    ).toBeNull();
    expect(
      databaseDuplicatedItemFromResponse({
        items: [alpha, beta],
      }),
    ).toBeNull();
  });

  it("includes visible property summaries for current database rows", () => {
    expect(
      databaseVisibleItemSummaries(
        [item("alpha", "Alpha", { number: 3, checkbox: true })],
        properties.slice(0, 2),
      ),
    ).toEqual([
      {
        itemId: "item-alpha",
        documentId: "alpha",
        title: "Alpha",
        position: 0,
        properties: [
          {
            propertyId: "number",
            name: "Priority",
            type: "number",
            value: 3,
            text: "3",
          },
          {
            propertyId: "checkbox",
            name: "Done",
            type: "checkbox",
            value: true,
            text: "Checked",
          },
        ],
      },
    ]);
  });

  it("omits preview row ids from navigation state when no row is open", () => {
    expect(
      databaseNavigationState({
        document: { id: "database-doc", title: "Content calendar" },
        databaseId: "database",
        activeView: { id: "default", name: "Table", type: "table" },
        previewItem: null,
      }),
    ).toEqual({
      view: "editor",
      documentId: "database-doc",
      title: "Content calendar",
      databaseId: "database",
      databaseSourceType: undefined,
      databaseSourceName: undefined,
      databaseSourceTable: undefined,
      databaseSourceSyncState: undefined,
      databaseSourceFreshness: undefined,
      databaseSourcePendingChangeCount: undefined,
      databaseSourceLocalChangeCount: undefined,
      databaseViews: [{ id: "default", name: "Table", type: "table" }],
      databaseViewId: "default",
      databaseViewName: "Table",
      databaseViewType: "table",
      databaseSearchQuery: undefined,
      databaseSortCount: 0,
      databaseSorts: undefined,
      databaseFilterMode: undefined,
      databaseActiveFilterCount: 0,
      databaseActiveFilters: undefined,
      databaseGroupByPropertyId: undefined,
      databaseGroupByPropertyName: undefined,
      databaseCollapsedGroupIds: undefined,
      databaseHideEmptyGroups: undefined,
      databaseDatePropertyId: undefined,
      databaseDatePropertyName: undefined,
      databaseEndDatePropertyId: undefined,
      databaseEndDatePropertyName: undefined,
      databaseDateRangeStart: undefined,
      databaseDateRangeEnd: undefined,
      databaseDateRangeLabel: undefined,
      databaseCalculations: undefined,
      databaseCalculationResults: undefined,
      databaseWrapCells: undefined,
      databaseRowDensity: undefined,
      databaseOpenPagesIn: undefined,
      databaseVisibleItemCount: undefined,
      databaseTotalItemCount: undefined,
      databaseVisibleItems: [],
      databaseVisibleItemLimit: 50,
      databaseSelectedItemCount: 0,
      databaseSelectedItems: undefined,
      databasePreviewItemId: undefined,
      databasePreviewDocumentId: undefined,
      databasePreviewTitle: undefined,
    });
  });

  it("exposes fallback date properties for unsaved calendar view settings", () => {
    expect(
      databaseNavigationState({
        document: { id: "database-doc", title: "Content calendar" },
        databaseId: "database",
        activeView: { id: "calendar", name: "Calendar", type: "calendar" },
        properties,
        previewItem: null,
      }),
    ).toMatchObject({
      databaseDatePropertyId: "date",
      databaseDatePropertyName: "Publish date",
    });
  });

  it("uses a row page custom icon when one exists", () => {
    expect(databaseItemPageIconText({ icon: "★" })).toBe("★");
    expect(databaseItemPageIconText({ icon: "   " })).toBeNull();
    expect(databaseItemPageIconText(null)).toBeNull();
  });

  it("summarizes saved database views for navigation state", () => {
    expect(
      databaseViewSummaries([
        { id: "default", name: "Table", type: "table" },
        { id: "calendar", name: "Calendar", type: "calendar" },
      ]),
    ).toEqual([
      { id: "default", name: "Table", type: "table" },
      { id: "calendar", name: "Calendar", type: "calendar" },
    ]);
  });

  it("uses an untitled fallback for empty row page titles", () => {
    expect(databaseItemPreviewTitle(item("alpha", "Alpha", {}))).toBe("Alpha");
    expect(databaseItemPreviewTitle(item("empty", "", {}))).toBe("Untitled");
    expect(databaseItemPreviewTitle(null)).toBe("Untitled");
  });

  it("finds previous and next preview rows from the visible item order", () => {
    const rows = [
      item("alpha", "Alpha", {}),
      item("beta", "Beta", {}),
      item("gamma", "Gamma", {}),
    ];

    expect(
      databaseItemPreviewNeighbor(rows, "beta", "prev")?.document.title,
    ).toBe("Alpha");
    expect(
      databaseItemPreviewNeighbor(rows, "beta", "next")?.document.title,
    ).toBe("Gamma");
    expect(databaseItemPreviewNeighbor(rows, "alpha", "prev")).toBeNull();
    expect(databaseItemPreviewNeighbor(rows, "missing", "next")).toBeNull();
  });

  it("chooses the next row after deleting the open preview row", () => {
    const rows = [
      item("alpha", "Alpha", {}),
      item("beta", "Beta", {}),
      item("gamma", "Gamma", {}),
    ];

    expect(
      databaseItemPreviewFallbackAfterDelete(rows, "beta")?.document.title,
    ).toBe("Gamma");
    expect(
      databaseItemPreviewFallbackAfterDelete(rows, "gamma")?.document.title,
    ).toBe("Beta");
    expect(
      databaseItemPreviewFallbackAfterDelete([rows[0]], "alpha"),
    ).toBeNull();
    expect(databaseItemPreviewFallbackAfterDelete(rows, "missing")).toBeNull();
  });

  it("chooses the nearest remaining preview row after bulk deleting selected rows", () => {
    const rows = [
      item("alpha", "Alpha", {}),
      item("beta", "Beta", {}),
      item("gamma", "Gamma", {}),
      item("delta", "Delta", {}),
    ];

    expect(
      databaseItemPreviewFallbackAfterBulkDelete(rows, "beta", [
        "beta",
        "gamma",
      ])?.document.title,
    ).toBe("Delta");
    expect(
      databaseItemPreviewFallbackAfterBulkDelete(rows, "gamma", [
        "beta",
        "gamma",
        "delta",
      ])?.document.title,
    ).toBe("Alpha");
    expect(
      databaseItemPreviewFallbackAfterBulkDelete(rows, "beta", [
        "alpha",
        "beta",
        "gamma",
        "delta",
      ]),
    ).toBeNull();
  });

  it("reports the selected preview row position within the visible order", () => {
    const rows = [
      item("alpha", "Alpha", {}),
      item("beta", "Beta", {}),
      item("gamma", "Gamma", {}),
    ];

    expect(databaseItemPreviewPosition(rows, "gamma")).toEqual({
      index: 2,
      total: 3,
    });
    expect(databaseItemPreviewPosition(rows, "missing")).toBeNull();
    expect(databaseItemPreviewPosition(rows, null)).toBeNull();
  });
});

describe("database saved views", () => {
  it("wraps legacy sort, filter, and width settings in a default table view", () => {
    const viewConfig = normalizeClientDatabaseViewConfig({
      sorts: [{ key: "number", label: "Priority", direction: "desc" }],
      filters: [
        {
          key: "checkbox",
          label: "Done",
          operator: "is_checked",
          value: "",
        },
      ],
      columnWidths: { number: 260 },
    });

    expect(viewConfig.activeViewId).toBe("default");
    expect(viewConfig.views).toHaveLength(1);
    expect(viewConfig.views[0]).toMatchObject({
      id: "default",
      name: "Table",
      sorts: [{ key: "number", label: "Priority", direction: "desc" }],
      filters: [
        {
          key: "checkbox",
          label: "Done",
          operator: "is_checked",
          value: "",
        },
      ],
      columnWidths: { number: 260 },
    });
  });

  it("normalizes and renders table row density settings", () => {
    expect(normalizeClientDatabaseFilterMode("or")).toBe("or");
    expect(normalizeClientDatabaseFilterMode("xor")).toBe("and");
    expect(normalizeClientDatabaseRowDensity("compact")).toBe("compact");
    expect(normalizeClientDatabaseRowDensity("comfortable")).toBe(
      "comfortable",
    );
    expect(normalizeClientDatabaseRowDensity("tiny")).toBe("default");

    expect(databaseTableRowDensityClass("compact")).toContain("min-h-8");
    expect(databaseTableRowDensityClass("comfortable")).toContain("min-h-12");
    expect(databaseTableCellDensityClass("compact")).toContain("py-0.5");

    const viewConfig = normalizeClientDatabaseViewConfig({
      activeViewId: "default",
      views: [
        {
          id: "default",
          name: "Editorial",
          type: "table",
          sorts: [],
          filters: [],
          columnWidths: {},
          rowDensity: "compact",
          collapsedGroupIds: ["status:todo"],
          hideEmptyGroups: true,
        },
        {
          id: "invalid",
          name: "Invalid",
          type: "table",
          sorts: [],
          filters: [],
          columnWidths: {},
          rowDensity: "cramped" as any,
        },
      ],
    });

    expect(viewConfig.views[0]?.rowDensity).toBe("compact");
    expect(viewConfig.views[0]?.collapsedGroupIds).toEqual(["status:todo"]);
    expect(viewConfig.views[0]?.hideEmptyGroups).toBe(true);
    expect(viewConfig.views[1]?.rowDensity).toBe("default");
  });

  it("adds, selects, renames, duplicates, and deletes table views", () => {
    const first = normalizeClientDatabaseViewConfig(null);
    const withSecond = addDatabaseView(first, "Editorial");
    const secondId = withSecond.activeViewId;

    expect(withSecond.views.map((view) => view.name)).toEqual([
      "Table",
      "Editorial",
    ]);

    const withDefaultTable = addDatabaseView(withSecond, "   ");
    expect(
      withDefaultTable.views[withDefaultTable.views.length - 1],
    ).toMatchObject({
      name: "Table 2",
      type: "table",
    });

    const withBoard = addDatabaseView(withSecond, "Pipeline", "board");
    expect(withBoard.views[withBoard.views.length - 1]?.type).toBe("board");

    const withList = addDatabaseView(withSecond, "Launch list", "list");
    expect(withList.views[withList.views.length - 1]).toMatchObject({
      name: "Launch list",
      type: "list",
    });

    const withGallery = addDatabaseView(withSecond, "Library", "gallery");
    expect(withGallery.views[withGallery.views.length - 1]).toMatchObject({
      name: "Library",
      type: "gallery",
    });

    const withCalendar = addDatabaseView(
      withSecond,
      "Publishing calendar",
      "calendar",
    );
    expect(withCalendar.views[withCalendar.views.length - 1]).toMatchObject({
      name: "Publishing calendar",
      type: "calendar",
    });

    const withTimeline = addDatabaseView(
      withSecond,
      "Launch timeline",
      "timeline",
    );
    expect(withTimeline.views[withTimeline.views.length - 1]).toMatchObject({
      name: "Launch timeline",
      type: "timeline",
    });

    const renamed = renameDatabaseView(withSecond, secondId, "SEO");
    expect(renamed.views.find((view) => view.id === secondId)?.name).toBe(
      "SEO",
    );

    const blankBoardRename = renameDatabaseView(
      withBoard,
      withBoard.activeViewId,
      "   ",
    );
    expect(
      blankBoardRename.views.find(
        (view) => view.id === blankBoardRename.activeViewId,
      )?.name,
    ).toBe("Board");

    const converted = updateDatabaseViewType(renamed, secondId, "calendar");
    expect(converted.views.find((view) => view.id === secondId)).toMatchObject({
      name: "SEO",
      type: "calendar",
    });
    expect(converted.activeViewId).toBe(secondId);

    const convertedWithSettings = updateDatabaseViewType(
      normalizeClientDatabaseViewConfig({
        activeViewId: "default",
        views: [
          {
            id: "default",
            name: "Editorial",
            type: "table",
            sorts: [{ key: "name", label: "Name", direction: "asc" }],
            filters: [
              {
                key: "status",
                label: "Status",
                operator: "equals",
                value: "Draft",
              },
            ],
            filterMode: "or",
            columnWidths: { name: 320 },
            groupByPropertyId: "status",
            datePropertyId: "publish",
            endDatePropertyId: "end",
            hiddenPropertyIds: ["notes"],
            propertyOrderIds: ["status", "name"],
            collapsedGroupIds: ["status:done"],
            hideEmptyGroups: true,
            calculations: { status: "count_values", number: "sum" },
            wrapCells: true,
            rowDensity: "comfortable",
          },
        ],
        sorts: [],
        filters: [],
        columnWidths: {},
      }),
      "default",
      "timeline",
    );
    expect(convertedWithSettings.views[0]).toMatchObject({
      type: "timeline",
      sorts: [{ key: "name", label: "Name", direction: "asc" }],
      filters: [
        {
          key: "status",
          label: "Status",
          operator: "equals",
          value: "Draft",
        },
      ],
      filterMode: "or",
      columnWidths: { name: 320 },
      groupByPropertyId: "status",
      datePropertyId: "publish",
      endDatePropertyId: "end",
      hiddenPropertyIds: ["notes"],
      propertyOrderIds: ["status", "name"],
      collapsedGroupIds: ["status:done"],
      hideEmptyGroups: true,
      calculations: { status: "count_values", number: "sum" },
      wrapCells: true,
      rowDensity: "comfortable",
    });

    const duplicated = duplicateDatabaseView(renamed, secondId);
    expect(duplicated.activeViewId).not.toBe(secondId);
    expect(duplicated.views[duplicated.views.length - 1]?.name).toBe(
      "SEO copy",
    );

    const duplicatedAgain = duplicateDatabaseView(duplicated, secondId);
    expect(duplicatedAgain.views[duplicatedAgain.views.length - 1]?.name).toBe(
      "SEO copy 2",
    );

    const movedLeft = moveDatabaseView(
      duplicated,
      duplicated.activeViewId,
      "left",
    );
    expect(movedLeft.activeViewId).toBe(duplicated.activeViewId);
    expect(movedLeft.views.map((view) => view.name)).toEqual([
      "Table",
      "SEO copy",
      "SEO",
    ]);

    const movedRight = moveDatabaseView(
      movedLeft,
      movedLeft.activeViewId,
      "right",
    );
    expect(movedRight.views.map((view) => view.name)).toEqual([
      "Table",
      "SEO",
      "SEO copy",
    ]);

    const reordered = reorderDatabaseView(
      movedRight,
      movedRight.activeViewId,
      "default",
    );
    expect(reordered.activeViewId).toBe(movedRight.activeViewId);
    expect(reordered.views.map((view) => view.name)).toEqual([
      "SEO copy",
      "Table",
      "SEO",
    ]);

    const selected = selectDatabaseView(duplicated, "default");
    expect(selected.activeViewId).toBe("default");

    const deleted = deleteDatabaseView(selected, "default");
    expect(deleted.views.some((view) => view.id === "default")).toBe(false);
    expect(deleted.activeViewId).toBe(deleted.views[0].id);
  });

  it("stores hidden properties per view", () => {
    const viewConfig = normalizeClientDatabaseViewConfig({
      activeViewId: "default",
      views: [
        {
          id: "default",
          name: "Table",
          type: "table",
          sorts: [],
          filters: [],
          columnWidths: {},
          datePropertyId: "date",
          endDatePropertyId: "end",
          hiddenPropertyIds: ["number"],
          propertyOrderIds: ["date", "number"],
        },
      ],
      sorts: [],
      filters: [],
      columnWidths: {},
    });
    const view = viewConfig.views[0];

    expect(view.hiddenPropertyIds).toEqual(["number"]);
    expect(view.propertyOrderIds).toEqual(["date", "number"]);
    expect(view.datePropertyId).toBe("date");
    expect(view.endDatePropertyId).toBe("end");
    expect(isDatabasePropertyVisibleInView(properties[0], [], view)).toBe(
      false,
    );
    expect(isDatabasePropertyVisibleInView(properties[1], [], view)).toBe(true);
  });

  it("can hide and reveal multiple properties in one view update", () => {
    const view = createDatabaseView("Table", "default", {
      hiddenPropertyIds: ["number"],
    });

    const hidden = setDatabaseViewHiddenPropertyIds(
      view,
      ["checkbox", "date"],
      true,
    );
    expect(hidden.hiddenPropertyIds).toEqual(["number", "checkbox", "date"]);

    const shown = setDatabaseViewHiddenPropertyIds(
      hidden,
      ["number", "checkbox"],
      false,
    );
    expect(shown.hiddenPropertyIds).toEqual(["date"]);
  });

  it("can collapse and expand database groups per view", () => {
    const view = createDatabaseView("Table", "default");
    const collapsed = setDatabaseViewCollapsedGroup(view, "status:todo", true);
    const collapsedAgain = setDatabaseViewCollapsedGroup(
      collapsed,
      "status:todo",
      true,
    );
    const expanded = setDatabaseViewCollapsedGroup(
      collapsedAgain,
      "status:todo",
      false,
    );

    expect(collapsed.collapsedGroupIds).toEqual(["status:todo"]);
    expect(collapsedAgain.collapsedGroupIds).toEqual(["status:todo"]);
    expect(
      databaseGroupIsCollapsed(collapsedAgain.collapsedGroupIds, "status:todo"),
    ).toBe(true);
    expect(expanded.collapsedGroupIds).toEqual([]);
  });

  it("clears stale collapsed groups when the grouping property changes", () => {
    const view = createDatabaseView("Board", "board", {
      groupByPropertyId: "status",
      collapsedGroupIds: ["status:todo"],
    });
    const unchanged = setDatabaseViewGroupByProperty(view, "status");
    const regrouped = setDatabaseViewGroupByProperty(unchanged, "priority");
    const ungrouped = setDatabaseViewGroupByProperty(regrouped, null);

    expect(unchanged.collapsedGroupIds).toEqual(["status:todo"]);
    expect(regrouped.groupByPropertyId).toBe("priority");
    expect(regrouped.collapsedGroupIds).toEqual([]);
    expect(ungrouped.groupByPropertyId).toBeNull();
    expect(ungrouped.collapsedGroupIds).toEqual([]);
  });

  it("can collapse and expand all visible database groups at once", () => {
    const view = createDatabaseView("Board", "board", {
      collapsedGroupIds: ["status:todo"],
    });
    const collapsed = setDatabaseViewCollapsedGroups(
      view,
      ["status:todo", "status:done", "  ", "status:done"],
      true,
    );
    const expanded = setDatabaseViewCollapsedGroups(
      collapsed,
      ["status:todo", "status:done"],
      false,
    );

    expect(collapsed.collapsedGroupIds).toEqual(["status:todo", "status:done"]);
    expect(expanded.collapsedGroupIds).toEqual([]);
  });

  it("stores table footer calculations per view", () => {
    const view = createDatabaseView("Table", "default", {
      calculations: { number: "sum" },
    });
    const averaged = setDatabaseViewColumnCalculation(
      view,
      "number",
      "average",
    );
    const cleared = setDatabaseViewColumnCalculation(averaged, "number", null);

    expect(averaged.calculations).toEqual({ number: "average" });
    expect(cleared.calculations).toEqual({});
    expect(
      normalizeClientDatabaseViewConfig({
        activeViewId: "default",
        views: [
          {
            ...view,
            calculations: {
              end: "count_all",
              number: "median",
              status: "count_values",
              checkbox: "percent_unchecked",
              date: "date_range",
              invalid: "nope" as any,
            },
          },
        ],
      }).views[0]?.calculations,
    ).toEqual({
      number: "median",
      status: "count_values",
      checkbox: "percent_unchecked",
      date: "date_range",
      end: "count_all",
    });
  });

  it("calculates table footer values for visible rows", () => {
    const rows = [
      item("alpha", "Alpha", { number: 10, date: "2026-05-20" }),
      item("beta", "Beta", { number: 5, date: null }),
      item("gamma", "Gamma", { number: null, date: "2026-05-22" }),
    ];

    expect(
      databaseCalculationOptionsForProperty(properties[0]).map(
        (option) => option.value,
      ),
    ).toContain("count_all");
    expect(
      databaseColumnCalculationResult("count_all", rows, properties[0]),
    ).toBe("3 rows");
    expect(databaseColumnCalculationResult("sum", rows, properties[0])).toBe(
      "Sum 15",
    );
    expect(
      databaseColumnCalculationResult("average", rows, properties[0]),
    ).toBe("Avg 7.50");
    expect(databaseColumnCalculationResult("median", rows, properties[0])).toBe(
      "Median 7.50",
    );
    expect(databaseColumnCalculationResult("range", rows, properties[0])).toBe(
      "Range 5",
    );
    expect(
      databaseColumnCalculationResult("count_empty", rows, properties[0]),
    ).toBe("1 empty");
    expect(
      databaseColumnCalculationResult("percent_empty", rows, properties[0]),
    ).toBe("33% empty");
    expect(
      databaseColumnCalculationResult(
        "percent_checked",
        [
          item("checked", "Checked", { checkbox: true }),
          item("unchecked", "Unchecked", { checkbox: false }),
          item("empty", "Empty", { checkbox: null }),
        ],
        properties[1],
      ),
    ).toBe("33% checked");
    expect(
      databaseColumnCalculationResult(
        "count_unchecked",
        [
          item("checked", "Checked", { checkbox: true }),
          item("unchecked", "Unchecked", { checkbox: false }),
          item("empty", "Empty", { checkbox: null }),
        ],
        properties[1],
      ),
    ).toBe("2 unchecked");
    expect(
      databaseColumnCalculationResult(
        "percent_unchecked",
        [
          item("checked", "Checked", { checkbox: true }),
          item("unchecked", "Unchecked", { checkbox: false }),
          item("empty", "Empty", { checkbox: null }),
        ],
        properties[1],
      ),
    ).toBe("67% unchecked");
    expect(databaseColumnCalculationResult("max", rows, properties[2])).toBe(
      "Latest 2026-05-22",
    );
    expect(
      databaseColumnCalculationResult("date_range", rows, properties[2]),
    ).toBe("Range 2 days");
  });

  it("orders properties per view and moves visible columns past hidden ones", () => {
    const view = createDatabaseView("Table", "default", {
      hiddenPropertyIds: ["checkbox"],
      propertyOrderIds: ["date", "number"],
    });
    const ordered = orderDatabasePropertiesForView(properties, view);
    expect(ordered.map((item) => item.definition.id)).toEqual([
      "date",
      "number",
      "checkbox",
      "end",
    ]);

    const visible = ordered.filter((property) =>
      isDatabasePropertyVisibleInView(property, [], view),
    );
    const moved = moveDatabaseViewProperty(view, "date", "right", {
      allProperties: properties,
      visibleProperties: visible,
    });

    expect(moved.propertyOrderIds).toEqual([
      "number",
      "date",
      "checkbox",
      "end",
    ]);

    const reordered = reorderDatabaseViewProperty(
      view,
      "date",
      "end",
      {
        allProperties: properties,
        visibleProperties: visible,
      },
      "after",
    );

    expect(reordered.propertyOrderIds).toEqual([
      "number",
      "checkbox",
      "end",
      "date",
    ]);
  });
});

describe("database calendar view", () => {
  it("chooses a saved date property or falls back to a date-like property", () => {
    const createdTime = property(
      "created",
      "Created",
      "created_time",
      "2026-05-20T12:00:00.000Z",
    );

    expect(
      databaseCalendarDateProperty({ datePropertyId: "date" }, [
        createdTime,
        properties[2],
      ])?.definition.id,
    ).toBe("date");

    expect(
      databaseCalendarDateProperty({ datePropertyId: "missing" }, [createdTime])
        ?.definition.id,
    ).toBe("created");
  });

  it("builds a six-week month grid starting on Sunday", () => {
    const days = databaseCalendarMonthDays(new Date(2026, 4, 15));

    expect(days).toHaveLength(42);
    expect(calendarDateKey(days[0])).toBe("2026-04-26");
    expect(calendarDateKey(days[41])).toBe("2026-06-06");
    expect(databaseDateViewRange("calendar", new Date(2026, 4, 15))).toEqual({
      start: "2026-04-26",
      end: "2026-06-06",
      label: "May 2026",
    });
  });

  it("groups rows by date-only and timestamp property values", () => {
    const rows = [
      item("alpha", "Alpha", { date: "2026-05-20" }),
      item("beta", "Beta", { date: "2026-05-20T13:00:00.000Z" }),
      item("range", "Range", {
        date: {
          start: "2026-05-20T09:00",
          end: "2026-05-22T17:00",
          includeTime: true,
        },
      }),
      item("gamma", "Gamma", { date: null }),
    ];

    const grouped = databaseCalendarItemsByDate(rows, properties, "date");

    expect(grouped.get("2026-05-20")?.map((row) => row.document.title)).toEqual(
      ["Alpha", "Beta", "Range"],
    );
    expect(grouped.has("")).toBe(false);
  });

  it("keeps rows without the selected date property available separately", () => {
    const rows = [
      item("alpha", "Alpha", { date: "2026-05-20" }),
      item("beta", "Beta", { date: null }),
      item("gamma", "Gamma", {}),
    ];

    expect(
      databaseItemsWithoutDateValue(rows, properties, "date").map(
        (row) => row.document.title,
      ),
    ).toEqual(["Beta", "Gamma"]);
    expect(databaseItemsWithoutDateValue(rows, properties, null)).toEqual([]);
  });

  it("keeps no-date calendar rows agent-visible with the current date window", () => {
    const rows = [
      item("alpha", "Alpha", { date: "2026-05-20" }),
      item("beta", "Beta", { date: "2026-06-06" }),
      item("gamma", "Gamma", { date: "2026-06-07" }),
      item("range", "Range", {
        date: { start: "2026-04-20", end: "2026-04-26", includeTime: false },
      }),
      item("empty", "Empty", { date: null }),
    ];

    expect(
      databaseScreenVisibleItems(
        { type: "calendar", datePropertyId: "date" },
        rows,
        properties,
        databaseDateViewRange("calendar", new Date(2026, 4, 15)),
      ).map((row) => row.document.title),
    ).toEqual(["Alpha", "Beta", "Range", "Empty"]);
    expect(
      databaseScreenVisibleItems(
        { type: "calendar" },
        rows,
        properties,
        databaseDateViewRange("calendar", new Date(2026, 4, 15)),
      ).map((row) => row.document.title),
    ).toEqual(["Alpha", "Beta", "Range", "Empty"]);
  });
});

describe("database timeline view", () => {
  it("uses the same six-week date window as calendar views", () => {
    const days = databaseTimelineDays(new Date(2026, 4, 15));

    expect(days).toHaveLength(42);
    expect(calendarDateKey(days[0])).toBe("2026-04-26");
    expect(calendarDateKey(days[41])).toBe("2026-06-06");
    expect(databaseDateViewRange("timeline", new Date(2026, 4, 15))).toEqual({
      start: "2026-04-26",
      end: "2026-06-06",
      label: "Apr 26 - Jun 6, 2026",
    });
  });

  it("keeps no-date timeline rows agent-visible with cards overlapping the current range", () => {
    const rows = [
      item("alpha", "Alpha", { date: "2026-04-20", end: "2026-04-26" }),
      item("beta", "Beta", { date: "2026-05-20", end: "2026-05-22" }),
      item("gamma", "Gamma", { date: "2026-06-06", end: "2026-06-10" }),
      item("outside", "Outside", { date: "2026-06-07", end: "2026-06-10" }),
      item("empty", "Empty", { date: null }),
    ];

    expect(
      databaseScreenVisibleItems(
        {
          type: "timeline",
          datePropertyId: "date",
          endDatePropertyId: "end",
        },
        rows,
        properties,
        databaseDateViewRange("timeline", new Date(2026, 4, 15)),
      ).map((row) => row.document.title),
    ).toEqual(["Alpha", "Beta", "Gamma", "Empty"]);
    expect(
      databaseScreenVisibleItems(
        {
          type: "timeline",
          endDatePropertyId: "end",
        },
        rows,
        properties,
        databaseDateViewRange("timeline", new Date(2026, 4, 15)),
      ).map((row) => row.document.title),
    ).toEqual(["Alpha", "Beta", "Gamma", "Empty"]);
  });

  it("spans cards from start date to optional end date", () => {
    const days = databaseTimelineDays(new Date(2026, 4, 15));
    const spans = databaseTimelineItemSpans(
      [
        item("alpha", "Alpha", { date: "2026-05-20", end: "2026-05-23" }),
        item("range", "Range", {
          date: { start: "2026-05-24", end: "2026-05-27", includeTime: false },
        }),
        item("beta", "Beta", { date: "2026-05-28" }),
        item("outside", "Outside", {
          date: "2026-06-10",
          end: "2026-06-12",
        }),
      ],
      properties,
      "date",
      "end",
      days,
    );

    expect(
      spans.map((span) => ({
        title: span.item.document.title,
        label: span.label,
        startIndex: span.startIndex,
        endIndex: span.endIndex,
      })),
    ).toEqual([
      {
        title: "Alpha",
        label: "2026-05-20 - 2026-05-23",
        startIndex: 24,
        endIndex: 27,
      },
      {
        title: "Range",
        label: "2026-05-24 - 2026-05-27",
        startIndex: 28,
        endIndex: 31,
      },
      {
        title: "Beta",
        label: "2026-05-28",
        startIndex: 32,
        endIndex: 32,
      },
    ]);
  });
});

describe("database board view", () => {
  const statusOptions = {
    options: [
      { id: "todo", name: "To do", color: "gray" as const },
      { id: "done", name: "Done", color: "green" as const },
    ],
  };
  const statusProperty = property(
    "status",
    "Status",
    "status",
    null,
    statusOptions,
  );

  function statusItem(
    id: string,
    title: string,
    status: DocumentPropertyValue,
  ): ContentDatabaseItem {
    return {
      id: `item-${id}`,
      databaseId: "database",
      document: document(id, title),
      position: 0,
      properties: [
        property("status", "Status", "status", status, statusOptions),
      ],
    };
  }

  it("groups board cards by status option and no-status buckets", () => {
    const groups = databaseBoardGroups(
      [
        statusItem("a", "Alpha", "todo"),
        statusItem("b", "Beta", "done"),
        statusItem("c", "Gamma", null),
      ],
      [statusProperty],
      "status",
    );

    expect(
      groups.map((group) => ({
        label: group.label,
        items: group.items.map((row) => row.document.title),
      })),
    ).toEqual([
      { label: "To do", items: ["Alpha"] },
      { label: "Done", items: ["Beta"] },
      { label: "No Status", items: ["Gamma"] },
    ]);
  });

  it("reuses saved grouping for table, list, and gallery views", () => {
    const alpha = statusItem("a", "Alpha", "todo");
    const groups = databaseViewItemGroups(
      [alpha, statusItem("b", "Beta", "done"), statusItem("c", "Gamma", null)],
      [statusProperty],
      "status",
    );

    expect(
      databaseViewGroupableProperties([statusProperty, properties[0]]),
    ).toEqual([statusProperty]);
    expect(
      groups.map((group) => ({
        label: group.label,
        items: group.items.map((row) => row.document.title),
      })),
    ).toEqual([
      { label: "To do", items: ["Alpha"] },
      { label: "Done", items: ["Beta"] },
      { label: "No Status", items: ["Gamma"] },
    ]);
    expect(databaseViewItemGroups([alpha], [], null)).toEqual([
      {
        id: "all",
        label: "All pages",
        property: null,
        value: "__ungrouped__",
        items: [alpha],
      },
    ]);
  });

  it("can hide empty database groups per view", () => {
    const groups = databaseViewItemGroups(
      [statusItem("a", "Alpha", "todo")],
      [statusProperty],
      "status",
    );

    expect(
      databaseVisibleGroups(groups, false).map((group) => group.label),
    ).toEqual(["To do", "Done", "No Status"]);
    expect(
      databaseVisibleGroups(groups, true).map((group) => group.label),
    ).toEqual(["To do"]);
  });

  it("keeps cards with removed option values in the ungrouped bucket", () => {
    const groups = databaseBoardGroups(
      [
        statusItem("a", "Alpha", "todo"),
        statusItem("b", "Beta", "archived"),
        statusItem("c", "Gamma", null),
      ],
      [statusProperty],
      "status",
    );

    expect(
      groups.map((group) => ({
        label: group.label,
        items: group.items.map((row) => row.document.title),
      })),
    ).toEqual([
      { label: "To do", items: ["Alpha"] },
      { label: "Done", items: [] },
      { label: "No Status", items: ["Beta", "Gamma"] },
    ]);
  });

  it("identifies option-backed groups that can be managed from the header", () => {
    const groups = databaseBoardGroups([], [statusProperty], "status");
    expect(databaseBoardCanManageGroup(groups[0])).toBe(true);
    expect(databaseBoardOptionForGroup(groups[0])).toEqual(
      statusOptions.options[0],
    );
    expect(databaseBoardCanManageGroup(groups[2])).toBe(false);

    const checkboxGroups = databaseBoardGroups(
      [],
      [property("done", "Done", "checkbox")],
      "done",
    );
    expect(databaseBoardCanManageGroup(checkboxGroups[0])).toBe(false);
  });

  it("maps board drop targets to property values", () => {
    expect(boardGroupValueForProperty(statusProperty, "done")).toBe("done");
    expect(
      boardGroupValueForProperty(statusProperty, "__ungrouped__"),
    ).toBeNull();

    const multiSelectProperty = property("pillars", "Pillars", "multi_select");
    expect(boardGroupValueForProperty(multiSelectProperty, "design")).toEqual([
      "design",
    ]);
    expect(
      boardGroupValueForProperty(multiSelectProperty, "__ungrouped__"),
    ).toEqual([]);

    const checkboxProperty = property("done", "Done", "checkbox");
    expect(boardGroupValueForProperty(checkboxProperty, true)).toBe(true);
    expect(boardGroupValueForProperty(checkboxProperty, false)).toBe(false);
  });

  it("allows new board groups for option-backed properties only", () => {
    expect(databaseBoardCanCreateGroup(statusProperty)).toBe(true);
    expect(
      databaseBoardCanCreateGroup(property("select", "Select", "select")),
    ).toBe(true);
    expect(
      databaseBoardCanCreateGroup(property("multi", "Multi", "multi_select")),
    ).toBe(true);
    expect(
      databaseBoardCanCreateGroup(property("done", "Done", "checkbox")),
    ).toBe(false);
    expect(databaseBoardCanCreateGroup(null)).toBe(false);
  });

  it("uses the same property visibility rules for board cards as the active view", () => {
    const visible = property("owner", "Owner", "text");
    const hiddenByView = property("priority", "Priority", "number");
    const notes = property("notes", "Notes", "text");
    const internal = property("internal", "Internal", "text");
    const emptyMetadata = {
      ...notes,
      definition: {
        ...notes.definition,
        visibility: "hide_when_empty" as const,
      },
    };
    const alwaysHidden = {
      ...internal,
      definition: {
        ...internal.definition,
        visibility: "always_hide" as const,
      },
    };
    const row = {
      ...statusItem("a", "Alpha", "todo"),
      properties: [
        property("status", "Status", "status", "todo", statusOptions),
        property("owner", "Owner", "text", "Alice"),
        property("priority", "Priority", "number", 1),
        property("notes", "Notes", "text", null),
        property("internal", "Internal", "text", "hidden"),
      ],
    };

    expect(
      databaseBoardVisibleCardProperties(
        [statusProperty, visible, hiddenByView, emptyMetadata, alwaysHidden],
        [row],
        { hiddenPropertyIds: ["priority"] },
        "status",
      ).map((candidate) => candidate.definition.id),
    ).toEqual(["owner"]);
  });
});

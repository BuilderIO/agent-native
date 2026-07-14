import type {
  ContentDatabaseItem,
  ContentDatabaseResponse,
  ContentDatabaseSource,
  ContentDatabaseSourceReviewPayload,
  Document,
  DocumentProperty,
} from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  acquireDatabaseSourceOperation,
  databaseBuilderBulkUpdateSource,
  databaseBuilderHydrationSourceForItem,
  databaseBulkEditableProperties,
  databaseBulkPropertyValueForItem,
  databaseBulkMultiSelectFilteredOptions,
  databaseBulkMultiSelectOptionPresence,
  databaseBulkMultiSelectToggleOperation,
  databaseBulkMultiSelectValueAfterOperation,
  builderSourceContinuationKey,
  builderSourceContinuationFetchedCountDetail,
  builderSourceContinuationWatchdogDelay,
  builderSourceContinuationProgressPercent,
  builderSourceContinuationWatchdogDecision,
  builderSourceRowFetchStatus,
  builderMissingRequiredFields,
  builderReviewExecutableRows,
  builderReviewSelectionFingerprint,
  databaseBuilderProgressHighWater,
  databaseBuilderExecutionRequiresReconciliation,
  databaseBuilderReviewAfterExecutionError,
  databaseBuilderReviewBelongsToSource,
  databaseBuilderPreparedReviewSelection,
  databaseBuilderReviewExactSelectionIsValid,
  databaseBuilderReviewSelectedChangeSetIds,
  databaseBuilderReviewSelectionIsValid,
  databaseBuilderReviewSessionIsCurrent,
  databaseBuilderReviewSource,
  databaseBuilderWriteModeOperationPending,
  databaseCreatedItemForImmediatePreview,
  databaseCreatedItemNeedsPreview,
  databaseSearchExpandedItemLimit,
  databaseSearchExpansionIsPending,
  databaseAttachedBuilderSources,
  databaseNextBuilderContinuationSource,
  databaseNextBuilderContinuationWatchdogSource,
  databaseNextBuilderHydrationSource,
  databasePreviewItem,
  databaseRecordBuilderContinuationAttempt,
  databaseSourceOperationIsPending,
  pendingMutationSourceId,
  releaseDatabaseSourceOperation,
  previewDraftNeedsConflict,
  previewDraftMissingCasRecovery,
  preparedBuilderReviewMatches,
} from "./DatabaseView";

describe("Builder required publishing fields", () => {
  const source = {
    id: "builder-source",
    sourceType: "builder-cms",
    sourceTable: "agent-native-blog-article-test",
    metadata: {
      primaryKey: "id",
      titleField: "data.title",
      builderModelFields: [
        { name: "title", required: true },
        { name: "blocks", required: true },
        { name: "author", required: true },
        { name: "description", required: true },
        { name: "optionalNote", required: false },
      ],
    },
    fields: [
      {
        id: "author",
        sourceFieldKey: "data.author",
        sourceFieldLabel: "Author",
        sourceFieldType: "text",
        mappingType: "field",
        propertyId: null,
      },
      {
        id: "description",
        sourceFieldKey: "data.description",
        sourceFieldLabel: "Description",
        sourceFieldType: "text",
        mappingType: "field",
        propertyId: "property-description",
      },
      {
        id: "title",
        sourceFieldKey: "data.title",
        sourceFieldLabel: "Title",
        sourceFieldType: "text",
        mappingType: "title",
        propertyId: null,
      },
    ],
  } as ContentDatabaseSource;

  it("finds only unbound required fields for the safe Builder model", () => {
    expect(
      builderMissingRequiredFields(source).map((field) => field.sourceFieldKey),
    ).toEqual(["data.author"]);
  });

  it("does not offer field materialization for another Builder model", () => {
    expect(
      builderMissingRequiredFields({
        ...source,
        sourceTable: "blog-article",
      }),
    ).toEqual([]);
  });
});

describe("preview draft cleanup convergence", () => {
  it("does not freeze when rejected C1 cleanup returns the pending C2 draft", () => {
    expect(
      previewDraftNeedsConflict({
        returnedDraft: { title: "Builder row", content: "C2" },
        pending: { title: "Builder row", content: "C2" },
      }),
    ).toBe(false);
    expect(
      previewDraftNeedsConflict({
        returnedDraft: { title: "Builder row", content: "other tab" },
        pending: { title: "Builder row", content: "C2" },
      }),
    ).toBe(true);
  });

  it("does not freeze when an upsert race returns the same pending draft", () => {
    expect(
      previewDraftNeedsConflict({
        returnedDraft: { title: "Builder row", content: "same draft" },
        pending: { title: "Builder row", content: "same draft" },
      }),
    ).toBe(false);
  });

  it("recovers a stale missing-row CAS without retrying forever", () => {
    expect(
      previewDraftMissingCasRecovery({
        operation: "delete",
        allowCreateRetry: true,
      }),
    ).toBe("converged");
    expect(
      previewDraftMissingCasRecovery({
        operation: "upsert",
        allowCreateRetry: true,
      }),
    ).toBe("retry-create");
    expect(
      previewDraftMissingCasRecovery({
        operation: "upsert",
        allowCreateRetry: false,
      }),
    ).toBe("failed");
  });
});

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

  it("includes the known Builder total in partial fetch details", () => {
    expect(
      builderSourceContinuationFetchedCountDetail(
        {
          metadata: {
            primaryKey: "id",
            titleField: "data.title",
            lastReadFetchedEntryCount: 100,
            lastReadLimit: 300,
            lastReadHasMore: true,
          },
        },
        100,
      ),
    ).toBe("100 of 300");
  });

  it("keeps completed fetch details to the fetched count", () => {
    expect(
      builderSourceContinuationFetchedCountDetail(
        {
          metadata: {
            primaryKey: "id",
            titleField: "data.title",
            lastReadFetchedEntryCount: 300,
            lastReadLimit: 300,
            lastReadHasMore: false,
          },
        },
        300,
        true,
      ),
    ).toBe(300);
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

  it("keeps a direct retry attempted until the watchdog backoff retries it", () => {
    const source = {
      id: "source-builder",
      sourceType: "builder-cms",
      metadata: {
        primaryKey: "id",
        titleField: "data.title",
        sourceFetchState: "fetching",
        lastReadFetchedEntryCount: 500,
        lastReadNextOffset: 500,
        lastReadHasMore: true,
      },
    } as ContentDatabaseSource;
    const continuationKey = builderSourceContinuationKey(source)!;
    const attemptedKeys = new Set<string>();
    databaseRecordBuilderContinuationAttempt(attemptedKeys, continuationKey);

    expect(
      databaseNextBuilderContinuationSource([source], {
        attemptedKeys,
        errorKeys: new Set(),
      }),
    ).toBeNull();
    expect(builderSourceContinuationWatchdogDelay(0)).toBe(5_000);
    expect(
      databaseNextBuilderContinuationWatchdogSource([source], {
        attemptedKeys,
        errorKeys: new Set(),
        refiresByKey: new Map([[continuationKey, 0]]),
      })?.id,
    ).toBe("source-builder");
  });

  it("continues and hydrates a secondary Builder source when the primary is local", () => {
    const primaryLocal = {
      id: "source-local",
      sourceType: "mock-local",
      metadata: { primaryKey: "id", titleField: "title" },
    } as ContentDatabaseSource;
    const secondaryBuilder = {
      id: "source-builder",
      sourceType: "builder-cms",
      metadata: {
        primaryKey: "id",
        titleField: "data.title",
        lastReadFetchedEntryCount: 500,
        lastReadNextOffset: 500,
        lastReadHasMore: true,
        lastReadPartial: true,
      },
    } as ContentDatabaseSource;

    expect(
      databaseNextBuilderContinuationSource(
        databaseAttachedBuilderSources(
          [primaryLocal, secondaryBuilder],
          primaryLocal,
        ),
        {
          attemptedKeys: new Set(),
          errorKeys: new Set(),
        },
      )?.id,
    ).toBe("source-builder");
    expect(builderSourceContinuationKey(secondaryBuilder)).toBe(
      "source-builder:500",
    );

    const hydrationReady = {
      ...secondaryBuilder,
      metadata: {
        ...secondaryBuilder.metadata,
        lastReadFetchedEntryCount: 750,
        lastReadHasMore: false,
        lastReadPartial: false,
        sourceFetchState: "idle",
      },
      bodyHydration: {
        pending: 25,
        hydrating: 0,
        hydrated: 25,
        error: 0,
        total: 50,
      },
    } as ContentDatabaseSource;
    expect(
      databaseNextBuilderHydrationSource([hydrationReady], {
        attemptedKeys: new Set(),
        errorKeys: new Set(),
      })?.id,
    ).toBe("source-builder");

    const progress = databaseBuilderProgressHighWater([hydrationReady], {
      "another-builder": {
        fetchedCount: 999,
        hydratedCount: 999,
        rowsComplete: true,
        generation: 0,
        observedFetchedCount: 999,
        observedHydratedCount: 999,
        hydrationTotal: 999,
        lastRefreshedAt: null,
        sourceFetchState: "idle",
      },
    });
    expect(progress).toMatchObject({
      "source-builder": {
        fetchedCount: 750,
        hydratedCount: 25,
        rowsComplete: true,
      },
    });
    expect(progress["another-builder"]).toBeUndefined();
  });

  it("resets completed high-water progress when the same source begins a new lifecycle", () => {
    const complete = {
      id: "source-builder",
      sourceType: "builder-cms",
      lastRefreshedAt: "2026-07-13T10:00:00.000Z",
      metadata: {
        primaryKey: "id",
        titleField: "data.title",
        sourceFetchState: "idle",
        lastReadFetchedEntryCount: 1_000,
        lastReadHasMore: false,
      },
      bodyHydration: {
        pending: 0,
        hydrating: 0,
        hydrated: 1_000,
        error: 0,
        total: 1_000,
      },
    } as ContentDatabaseSource;
    const previous = databaseBuilderProgressHighWater([complete], {});
    const restarted = {
      ...complete,
      lastRefreshedAt: "2026-07-13T11:00:00.000Z",
      metadata: {
        ...complete.metadata,
        sourceFetchState: "fetching",
        lastReadFetchedEntryCount: 500,
        lastReadHasMore: true,
      },
      bodyHydration: {
        pending: 25,
        hydrating: 0,
        hydrated: 0,
        error: 0,
        total: 500,
      },
    } as ContentDatabaseSource;

    expect(
      databaseBuilderProgressHighWater([restarted], previous)["source-builder"],
    ).toMatchObject({
      fetchedCount: 500,
      hydratedCount: 0,
      rowsComplete: false,
      generation: 1,
      lastRefreshedAt: "2026-07-13T11:00:00.000Z",
      sourceFetchState: "fetching",
    });
  });
});

describe("Builder review source sessions", () => {
  const source = {
    id: "builder-secondary",
    sourceType: "builder-cms",
    sourceTable: "agent-native-blog-article-test",
    changeSets: [{ id: "change-secondary" }],
  } as ContentDatabaseSource;
  const primary = {
    id: "primary-local",
    sourceType: "mock-local",
  } as ContentDatabaseSource;

  it("recognizes first-write ambiguity as reconciliation-required", () => {
    expect(
      databaseBuilderExecutionRequiresReconciliation(
        "Builder write timed out; remote outcome is unknown.",
      ),
    ).toBe(true);
    expect(
      databaseBuilderExecutionRequiresReconciliation(
        "Builder write request failed with HTTP 400.",
      ),
    ).toBe(false);
    expect(
      databaseBuilderReviewAfterExecutionError(
        {
          result: { status: "validated", message: "Ready" },
        } as ContentDatabaseSourceReviewPayload,
        "Builder write timed out; remote outcome is unknown.",
      )?.result,
    ).toEqual({
      status: "reconciliation_required",
      message: "Builder write timed out; remote outcome is unknown.",
    });
    expect(
      databaseBuilderReviewAfterExecutionError(
        {
          result: { status: "running", message: "Running" },
        } as ContentDatabaseSourceReviewPayload,
        "Builder execution is already running.",
      )?.result,
    ).toEqual({
      status: "running",
      message: "Builder push is already running. No second write was sent.",
    });
  });

  it("hands only the selected recoverable execution to the server", () => {
    const execution = (
      changeSetId: string,
      state: "ready" | "running" | "reconciliation_required",
    ) => ({
      id: `execution-${changeSetId}`,
      changeSetId,
      adapter: "builder-cms",
      pushMode: "autosave" as const,
      state,
      idempotencyKey: `builder-cms:source:${changeSetId}:autosave`,
      summary: state,
      payload: {},
      lastError: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    });
    const review = {
      liveWritesEnabled: true,
      result: { status: "running", message: "Working" },
      rows: [
        {
          changeSetId: "inherited-ready",
          execution: execution("inherited-ready", "ready"),
        },
        {
          changeSetId: "selected-running",
          execution: execution("selected-running", "running"),
        },
        {
          changeSetId: "inherited-reconciliation",
          execution: execution(
            "inherited-reconciliation",
            "reconciliation_required",
          ),
        },
      ],
    } as ContentDatabaseSourceReviewPayload;

    expect(
      builderReviewExecutableRows(review, new Set(["selected-running"])).map(
        (row) => row.changeSetId,
      ),
    ).toEqual(["selected-running"]);
  });

  it("resolves only the exact dialog source and never falls back to primary", () => {
    expect(
      databaseBuilderReviewSource(
        [primary, source],
        primary,
        "builder-secondary",
      )?.id,
    ).toBe("builder-secondary");
    expect(
      databaseBuilderReviewSource([primary, source], primary, "missing"),
    ).toBeNull();
    expect(
      databaseBuilderReviewSource([primary, source], primary, null),
    ).toBeNull();
  });

  it("rejects stale generations and cross-source change sets", () => {
    const captured = { sourceId: "builder-secondary", generation: 3 };
    expect(
      databaseBuilderReviewSessionIsCurrent(
        { sourceId: "builder-secondary", generation: 3 },
        captured,
      ),
    ).toBe(true);
    expect(
      databaseBuilderReviewSessionIsCurrent(
        { sourceId: "builder-other", generation: 4 },
        captured,
      ),
    ).toBe(false);
    expect(
      databaseBuilderReviewBelongsToSource(
        {
          rows: [{ changeSetId: "change-secondary" }],
        } as ContentDatabaseSourceReviewPayload,
        source,
      ),
    ).toBe(true);
    expect(
      databaseBuilderReviewBelongsToSource(
        {
          rows: [{ changeSetId: "change-other" }],
        } as ContentDatabaseSourceReviewPayload,
        source,
      ),
    ).toBe(false);
  });

  it("executes only an exact prepared session and selection", () => {
    const firstFingerprint = builderReviewSelectionFingerprint({
      changeSetIds: ["change-b", "change-a"],
      transitions: {
        "change-b": { publicationTransition: "publish" },
        "change-a": {
          publicationTransition: "unpublish",
          confirmUnpublish: true,
        },
      },
    });
    const equivalentFingerprint = builderReviewSelectionFingerprint({
      changeSetIds: ["change-a", "change-b"],
      transitions: {
        "change-a": {
          publicationTransition: "unpublish",
          confirmUnpublish: true,
        },
        "change-b": { publicationTransition: "publish" },
      },
    });
    const session = { sourceId: "builder-secondary", generation: 3 };
    const confirmation = {
      ...session,
      selectionFingerprint: firstFingerprint,
    };

    expect(firstFingerprint).toBe(equivalentFingerprint);
    expect(
      preparedBuilderReviewMatches(
        confirmation,
        session,
        equivalentFingerprint,
      ),
    ).toBe(true);
    expect(
      preparedBuilderReviewMatches(
        confirmation,
        session,
        builderReviewSelectionFingerprint({
          changeSetIds: ["change-a"],
          transitions: {},
        }),
      ),
    ).toBe(false);
    expect(
      preparedBuilderReviewMatches(
        confirmation,
        { sourceId: session.sourceId, generation: 4 },
        firstFingerprint,
      ),
    ).toBe(false);
  });

  it("accepts an exact 1-of-3 review selection for prepare", () => {
    const threeRowSource = {
      ...source,
      changeSets: [{ id: "change-1" }, { id: "change-2" }, { id: "change-3" }],
    } as ContentDatabaseSource;
    const review = {
      rows: [
        { changeSetId: "change-1" },
        { changeSetId: "change-2" },
        { changeSetId: "change-3" },
      ],
    } as ContentDatabaseSourceReviewPayload;

    expect(
      databaseBuilderReviewSelectedChangeSetIds(review, threeRowSource, [
        "change-2",
      ]),
    ).toEqual(["change-2"]);
  });

  it("rejects empty, duplicate, and foreign review selections", () => {
    const review = {
      rows: [{ changeSetId: "change-secondary" }],
    } as ContentDatabaseSourceReviewPayload;

    expect(
      databaseBuilderReviewSelectedChangeSetIds(review, source, []),
    ).toBeNull();
    expect(
      databaseBuilderReviewSelectedChangeSetIds(review, source, [
        "change-secondary",
        "change-secondary",
      ]),
    ).toBeNull();
    expect(
      databaseBuilderReviewSelectedChangeSetIds(review, source, [
        "change-foreign",
      ]),
    ).toBeNull();
  });

  it("requires the prepared review to return exactly the selected ids", () => {
    const prepared = {
      rows: [{ changeSetId: "change-secondary" }],
    } as ContentDatabaseSourceReviewPayload;

    expect(
      databaseBuilderReviewSelectionIsValid(
        prepared,
        source,
        ["change-secondary"],
        true,
      ),
    ).toBe(true);
    expect(
      databaseBuilderReviewSelectionIsValid(
        prepared,
        {
          ...source,
          changeSets: [{ id: "change-secondary" }, { id: "change-other" }],
        } as ContentDatabaseSource,
        ["change-secondary", "change-other"],
        true,
      ),
    ).toBe(false);
  });

  it("accepts an exact prepared revision mapping without confusing it for another source", () => {
    const prepared = {
      sourceTable: "agent-native-blog-article-test",
      rows: [{ changeSetId: "change-secondary-revision-deadbeef" }],
    } as ContentDatabaseSourceReviewPayload;

    expect(
      databaseBuilderPreparedReviewSelection(
        prepared,
        source,
        ["change-secondary"],
        [
          {
            requestedChangeSetId: "change-secondary",
            preparedChangeSetId: "change-secondary-revision-deadbeef",
          },
        ],
      ),
    ).toEqual({
      preparedChangeSetIds: ["change-secondary-revision-deadbeef"],
      changeSetIdMap: {
        "change-secondary": "change-secondary-revision-deadbeef",
      },
    });
    expect(
      databaseBuilderReviewExactSelectionIsValid(prepared, [
        "change-secondary-revision-deadbeef",
      ]),
    ).toBe(true);
  });

  it("rejects incomplete, duplicate, and cross-model prepared revision mappings", () => {
    const prepared = {
      sourceTable: "agent-native-blog-article-test",
      rows: [{ changeSetId: "prepared-1" }],
    } as ContentDatabaseSourceReviewPayload;
    const mapping = [
      {
        requestedChangeSetId: "change-secondary",
        preparedChangeSetId: "prepared-1",
      },
    ];

    expect(
      databaseBuilderPreparedReviewSelection(
        prepared,
        source,
        ["change-secondary", "change-other"],
        mapping,
      ),
    ).toBeNull();
    expect(
      databaseBuilderPreparedReviewSelection(
        { ...prepared, sourceTable: "blog-article" },
        source,
        ["change-secondary"],
        mapping,
      ),
    ).toBeNull();
    expect(
      databaseBuilderReviewExactSelectionIsValid(
        {
          ...prepared,
          rows: [{ changeSetId: "prepared-1" }, { changeSetId: "prepared-1" }],
        } as ContentDatabaseSourceReviewPayload,
        ["prepared-1"],
      ),
    ).toBe(false);
  });
});

describe("Builder source pending operations", () => {
  const idle = {
    attach: false,
    changeRole: false,
    refresh: false,
    hydration: false,
    disconnect: false,
    review: false,
    execute: false,
    writeMode: false,
    changeRoleSourceId: null,
    refreshSourceId: null,
    hydrationSourceId: null,
    disconnectSourceId: null,
    reviewSourceId: null,
    executeSourceId: null,
    writeModeSourceId: null,
  };

  it("keeps write tiers enabled for hydration and operations on other sources", () => {
    expect(
      databaseBuilderWriteModeOperationPending(
        {
          ...idle,
          hydrationSourceId: "builder-selected",
          refreshSourceId: "builder-other",
        },
        "builder-selected",
      ),
    ).toBe(false);
    expect(
      databaseSourceOperationIsPending(
        { ...idle, hydrationSourceId: "builder-selected" },
        "builder-selected",
        ["hydration"],
      ),
    ).toBe(true);
  });

  it("blocks write tiers for same-source refreshes and their own mutation", () => {
    expect(
      databaseBuilderWriteModeOperationPending(
        { ...idle, refreshSourceId: "builder-selected" },
        "builder-selected",
      ),
    ).toBe(true);
    expect(
      databaseBuilderWriteModeOperationPending(
        { ...idle, writeModeSourceId: "builder-selected" },
        "builder-selected",
      ),
    ).toBe(true);
  });

  it("serializes the same operation globally without conflating other operation types", () => {
    expect(
      databaseBuilderWriteModeOperationPending(
        {
          ...idle,
          refresh: true,
          refreshSourceId: "builder-other",
        },
        "builder-selected",
      ),
    ).toBe(false);
    expect(
      databaseBuilderWriteModeOperationPending(
        {
          ...idle,
          writeMode: true,
          writeModeSourceId: "builder-other",
        },
        "builder-selected",
      ),
    ).toBe(true);
  });

  it("keeps the first source lock until that exact operation settles", () => {
    const lock = { current: null as string | null };
    expect(acquireDatabaseSourceOperation(lock, "builder-a")).toBe(true);
    expect(acquireDatabaseSourceOperation(lock, "builder-b")).toBe(false);
    expect(lock.current).toBe("builder-a");
    releaseDatabaseSourceOperation(lock, "builder-b");
    expect(lock.current).toBe("builder-a");
    releaseDatabaseSourceOperation(lock, "builder-a");
    expect(lock.current).toBeNull();
    expect(acquireDatabaseSourceOperation(lock, "builder-b")).toBe(true);
  });

  it("preserves the exact selected source id in pending mutation state", () => {
    expect(
      pendingMutationSourceId(true, { sourceId: "builder-secondary" }),
    ).toBe("builder-secondary");
    expect(
      pendingMutationSourceId(false, { sourceId: "builder-secondary" }),
    ).toBeNull();
  });
});

describe("large database authoring", () => {
  const parentDocument = {
    id: "database-document",
    parentId: null,
    title: "Large database",
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    canEdit: true,
    canManage: true,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  } satisfies Document;

  it("expands a nonblank search in one bounded request without expanding blank searches", () => {
    expect(databaseSearchExpandedItemLimit("", 100, 571)).toBe(100);
    expect(databaseSearchExpandedItemLimit("   ", 100, 571)).toBe(100);
    expect(databaseSearchExpandedItemLimit("Quiet Comet", 100, 571)).toBe(571);
    expect(databaseSearchExpandedItemLimit("Quiet Comet", 100, 10_000)).toBe(
      5_000,
    );
  });

  it("keeps search results pending until the expanded response catches up", () => {
    expect(databaseSearchExpansionIsPending("Quiet Comet", 571, 100)).toBe(
      true,
    );
    expect(databaseSearchExpansionIsPending("Quiet Comet", 571, 571)).toBe(
      false,
    );
    expect(databaseSearchExpansionIsPending("", 571, 100)).toBe(false);
  });

  it("builds an immediate preview item when the appended row is outside the returned page", () => {
    const response = {
      database: { id: "database" },
      properties: [],
      items: Array.from(
        { length: 100 },
        (_, index) =>
          ({
            id: `item-${index}`,
            databaseId: "database",
            position: index,
            document: {
              ...parentDocument,
              id: `document-${index}`,
              position: index,
            },
            properties: [],
          }) satisfies ContentDatabaseItem,
      ),
      source: null,
      pagination: {
        offset: 0,
        limit: 100,
        totalItems: 501,
        returnedItems: 100,
        hasMore: true,
      },
      createdItemId: "created-item",
      createdDocumentId: "created-document",
    } as unknown as ContentDatabaseResponse;

    const createdItem = databaseCreatedItemForImmediatePreview(response, {
      databaseId: "database",
      parentDocument,
      title: "  New QA row  ",
      propertyValues: {},
      now: "2026-07-13T12:00:00.000Z",
    });

    expect(createdItem).toMatchObject({
      id: "created-item",
      databaseId: "database",
      position: 500,
      document: {
        id: "created-document",
        parentId: "database-document",
        title: "New QA row",
        content: "",
      },
    });
    expect(
      databasePreviewItem(response.items, "created-document", createdItem),
    ).toBe(createdItem);
  });

  it("opens a created row in preview when pagination keeps its inline editor off-screen", () => {
    const createdItem = {
      id: "created-item",
      document: { id: "created-document" },
    } as ContentDatabaseItem;

    expect(
      databaseCreatedItemNeedsPreview([], createdItem, {
        openAfterCreate: false,
        focusInlineTitle: true,
      }),
    ).toBe(true);
    expect(
      databaseCreatedItemNeedsPreview([createdItem], createdItem, {
        openAfterCreate: false,
        focusInlineTitle: true,
      }),
    ).toBe(false);
    expect(databaseCreatedItemNeedsPreview([], createdItem, {})).toBe(true);
  });

  it("hydrates only rows whose own membership names a Builder source", () => {
    const builderSource = {
      id: "builder-primary",
      sourceType: "builder-cms",
    } as ContentDatabaseSource;
    const localItem = {
      document: {
        databaseMembership: { sourceId: null },
      },
    } as ContentDatabaseItem;
    const builderItem = {
      document: {
        databaseMembership: { sourceId: "builder-primary" },
      },
    } as ContentDatabaseItem;

    expect(
      databaseBuilderHydrationSourceForItem(localItem, [builderSource]),
    ).toBeNull();
    expect(
      databaseBuilderHydrationSourceForItem(builderItem, [builderSource])?.id,
    ).toBe("builder-primary");
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

const rowWithPropertyValue = (
  id: string,
  property: DocumentProperty,
  value: DocumentProperty["value"],
): ContentDatabaseItem => ({
  ...builderRowItem(id),
  properties: [{ ...property, value }],
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

describe("Database bulk multi-select edit helpers", () => {
  it("filters multi-select options by tag name", () => {
    const options = [
      { id: "agent-native", name: "Agent Native", color: "blue" as const },
      { id: "open-source", name: "Open Source", color: "green" as const },
      { id: "cms", name: "Headless CMS", color: "purple" as const },
    ];

    expect(
      databaseBulkMultiSelectFilteredOptions(options, " source ").map(
        (option) => option.id,
      ),
    ).toEqual(["open-source"]);
    expect(
      databaseBulkMultiSelectFilteredOptions(options, "CMS").map(
        (option) => option.id,
      ),
    ).toEqual(["cms"]);
    expect(databaseBulkMultiSelectFilteredOptions(options, "")).toBe(options);
  });

  it("adds selected options without replacing existing row tags", () => {
    expect(
      databaseBulkMultiSelectValueAfterOperation(["agent-native"], {
        kind: "multi_select_add",
        optionIds: ["open-source"],
      }),
    ).toEqual(["agent-native", "open-source"]);

    expect(
      databaseBulkMultiSelectValueAfterOperation(["agent-native"], {
        kind: "multi_select_add",
        optionIds: ["agent-native", "open-source", "open-source"],
      }),
    ).toEqual(["agent-native", "open-source"]);
  });

  it("applies pending add and remove options together", () => {
    expect(
      databaseBulkMultiSelectValueAfterOperation(
        ["agent-native", "open-source"],
        {
          kind: "multi_select_batch",
          addOptionIds: ["cms"],
          removeOptionIds: ["open-source"],
        },
      ),
    ).toEqual(["agent-native", "cms"]);
  });

  it("removes selected options from existing row tags", () => {
    expect(
      databaseBulkMultiSelectValueAfterOperation(
        ["agent-native", "open-source", "cms"],
        {
          kind: "multi_select_remove",
          optionIds: ["open-source"],
        },
      ),
    ).toEqual(["agent-native", "cms"]);
  });

  it("clears all multi-select options with a set-empty operation", () => {
    const tagsProperty = baseProperty("tags", "multi_select");
    const row = rowWithPropertyValue("alpha", tagsProperty, [
      "agent-native",
      "open-source",
    ]);

    expect(
      databaseBulkPropertyValueForItem(row, tagsProperty, {
        kind: "set",
        value: [],
      }),
    ).toEqual([]);
  });

  it("only enables remove when every selected row has the option", () => {
    const tagsProperty = baseProperty("tags", "multi_select");
    const rows = [
      rowWithPropertyValue("alpha", tagsProperty, [
        "agent-native",
        "open-source",
      ]),
      rowWithPropertyValue("beta", tagsProperty, ["open-source"]),
      rowWithPropertyValue("gamma", tagsProperty, ["agent-native"]),
    ];

    expect(
      databaseBulkMultiSelectOptionPresence(rows, tagsProperty, "open-source"),
    ).toEqual({ presentInAny: true, presentInAll: false });
    expect(
      databaseBulkMultiSelectOptionPresence(
        rows.slice(0, 2),
        tagsProperty,
        "open-source",
      ),
    ).toEqual({ presentInAny: true, presentInAll: true });
  });

  it("toggles all-present options to remove and partial options to add", () => {
    const tagsProperty = baseProperty("tags", "multi_select");
    const rows = [
      rowWithPropertyValue("alpha", tagsProperty, [
        "agent-native",
        "open-source",
      ]),
      rowWithPropertyValue("beta", tagsProperty, ["open-source"]),
    ];

    expect(
      databaseBulkMultiSelectToggleOperation(rows, tagsProperty, "open-source"),
    ).toEqual({
      kind: "multi_select_batch",
      addOptionIds: [],
      removeOptionIds: ["open-source"],
    });
    expect(
      databaseBulkMultiSelectToggleOperation(
        rows,
        tagsProperty,
        "agent-native",
      ),
    ).toEqual({
      kind: "multi_select_batch",
      addOptionIds: ["agent-native"],
      removeOptionIds: [],
    });
  });

  it("uses pending toggles when deciding the next toggle operation", () => {
    const tagsProperty = baseProperty("tags", "multi_select");
    const rows = [
      rowWithPropertyValue("alpha", tagsProperty, ["open-source"]),
      rowWithPropertyValue("beta", tagsProperty, []),
    ];
    const pendingAdd = databaseBulkMultiSelectToggleOperation(
      rows,
      tagsProperty,
      "open-source",
    );

    expect(
      databaseBulkMultiSelectOptionPresence(
        rows,
        tagsProperty,
        "open-source",
        pendingAdd,
      ),
    ).toEqual({ presentInAny: true, presentInAll: true });
    expect(
      databaseBulkMultiSelectToggleOperation(
        rows,
        tagsProperty,
        "open-source",
        pendingAdd,
      ),
    ).toEqual({
      kind: "multi_select_batch",
      addOptionIds: [],
      removeOptionIds: ["open-source"],
    });
  });
});

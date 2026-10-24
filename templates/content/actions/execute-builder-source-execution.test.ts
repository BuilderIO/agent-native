import { describe, expect, it, vi } from "vitest";

import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type ContentDatabaseResponse,
  type ContentDatabaseSource,
  type ContentDatabaseSourceChangeSet,
} from "../shared/api";
import type { BuilderCmsEntryLiveState } from "./_builder-cms-read-client";
import {
  BUILDER_CMS_BODY_BLOCK_COUNT_KEY,
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_ENTRY_NAME_KEY,
} from "./_builder-cms-source-adapter";
import {
  BUILDER_CMS_EDIT_CONFLICTS_KEY,
  BUILDER_CMS_PUBLICATION_INTENT_KEY,
  BUILDER_CMS_UNPUBLISHED_CHANGES_KEY,
  withBuilderCmsEditConflicts,
  withBuilderCmsPublicationIntent,
  withBuilderCmsUnpublishedChanges,
} from "./_builder-cms-unpublished-changes";
import {
  buildBuilderCmsExecutionPlan,
  builderCmsExecutionIdempotencyKey,
} from "./_builder-cms-write-adapter";
import type { BuilderCmsWriteResult } from "./_builder-cms-write-client";
import {
  builderCmsReconciledSourceValuesJson,
  builderCmsReconciledSourceRowPatch,
  builderExecutionAffectedRows,
  builderExecutionConflict,
  executeBuilderSourceExecutionWithDeps,
  type BuilderSourceExecutionRecord,
  type ExecuteBuilderSourceExecutionDeps,
} from "./execute-builder-source-execution";

const NOW = "2026-06-15T12:00:00.000Z";
const BUILDER_LAST_UPDATED_MS = 1782328870774;
const STALE_BUILDER_LAST_UPDATED_MS = 1700000000000;
const RESPONSE: ContentDatabaseResponse = {
  database: {
    id: "database-1",
    documentId: "database-page",
    title: "Editorial calendar",
    viewConfig: {
      activeViewId: "default",
      views: [],
      sorts: [],
      filters: [],
      columnWidths: {},
    },
    createdAt: NOW,
    updatedAt: NOW,
  },
  properties: [],
  items: [],
  source: null,
};

type DatabaseRecord = NonNullable<
  Awaited<ReturnType<ExecuteBuilderSourceExecutionDeps["resolveDatabase"]>>
>;

const DATABASE: DatabaseRecord = {
  id: "database-1",
  ownerEmail: "local@localhost",
  orgId: null,
  documentId: "database-page",
  title: "Editorial calendar",
  viewConfigJson: "{}",
  createdAt: NOW,
  updatedAt: NOW,
};

describe("builderExecutionAffectedRows", () => {
  it("accepts a successful PostgreSQL mutation result", () => {
    expect(builderExecutionAffectedRows({ rowCount: 1 })).toBe(1);
  });

  it("preserves a PostgreSQL zero-row fence", () => {
    expect(builderExecutionAffectedRows({ rowCount: 0 })).toBe(0);
  });

  it("treats a missing mutation result as a zero-row fence", () => {
    expect(builderExecutionAffectedRows(null)).toBe(0);
    expect(builderExecutionAffectedRows(undefined)).toBe(0);
  });
});

describe("builderExecutionConflict", () => {
  it("surfaces only an explicit control-flow message as an HTTP conflict", () => {
    const error = builderExecutionConflict(
      "Builder execution is already running.",
    );

    expect(error).toMatchObject({
      message: "Builder execution is already running.",
      statusCode: 409,
    });
  });
});

function row(
  overrides: Partial<ContentDatabaseSource["rows"][number]> = {},
): ContentDatabaseSource["rows"][number] {
  const sourceTable = BUILDER_CMS_SAFE_WRITE_MODEL;
  const sourceRowId = overrides.sourceRowId ?? "builder-entry-1";
  return {
    id: "row-1",
    databaseItemId: "item-1",
    documentId: "doc-1",
    sourceRowId,
    sourceQualifiedId:
      overrides.sourceQualifiedId ??
      `builder-cms://${sourceTable}/${sourceRowId}`,
    sourceDisplayKey: "Old title",
    provenance: "Builder CMS fixture adapter",
    syncState: "idle",
    freshness: "fresh",
    lastSyncedAt: "2026-06-08T00:00:00.000Z",
    lastSourceUpdatedAt: String(BUILDER_LAST_UPDATED_MS),
    ...overrides,
  };
}

function changeSet(
  overrides: Partial<ContentDatabaseSourceChangeSet> = {},
): ContentDatabaseSourceChangeSet {
  return {
    id: "change-1",
    databaseItemId: "item-1",
    documentId: "doc-1",
    kind: "field_update",
    direction: "outbound",
    state: "approved",
    pushMode: "autosave",
    localOnly: true,
    summary: "Approved local Builder title change.",
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
    executions: [],
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    ...overrides,
  };
}

function source(
  args: {
    liveWritesEnabled?: boolean;
    sourceTable?: string;
    rows?: ContentDatabaseSource["rows"];
    changeSets?: ContentDatabaseSourceChangeSet[];
    metadata?: Partial<ContentDatabaseSource["metadata"]>;
  } = {},
): ContentDatabaseSource {
  const sourceTable = args.sourceTable ?? BUILDER_CMS_SAFE_WRITE_MODEL;
  return {
    id: "source-1",
    databaseId: "database-1",
    sourceType: "builder-cms",
    sourceName: "Builder CMS",
    sourceTable,
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
      liveWritesEnabled: args.liveWritesEnabled ?? true,
      readOnlyRefresh: true,
    },
    metadata: {
      primaryKey: "id",
      titleField: "data.title",
      naturalKeyField: "/blog/[slug]",
      pushMode: "autosave",
      builderSpacePublicKey: "selected-space-key",
      connectionId: "builder-oauth-connection-1",
      ...args.metadata,
    },
    fields: [],
    rows: args.rows ?? [row()],
    changeSets: args.changeSets ?? [changeSet()],
  };
}

function executionFor(args: {
  source: ContentDatabaseSource;
  changeSet: ContentDatabaseSourceChangeSet;
  payloadJson?: string;
  state?: BuilderSourceExecutionRecord["state"];
  updatedAt?: string;
  publicationTransition?: "publish" | "unpublish";
  confirmUnpublish?: boolean;
}): BuilderSourceExecutionRecord {
  const plan = buildBuilderCmsExecutionPlan({
    source: args.source,
    changeSet: args.changeSet,
    pushModeConfirmation: args.changeSet.pushMode ?? undefined,
    publicationTransition: args.publicationTransition,
    confirmUnpublish: args.confirmUnpublish,
  });
  return {
    id: "execution-1",
    state: args.state ?? plan.state,
    idempotencyKey: plan.idempotencyKey,
    payloadJson: args.payloadJson ?? JSON.stringify(plan.payload),
    updatedAt: args.updatedAt ?? NOW,
  };
}

function depsFor(args: {
  source: ContentDatabaseSource;
  execution: BuilderSourceExecutionRecord | null;
  writeResult?: BuilderCmsWriteResult;
  claimExecution?: boolean;
  renewExecutionClaim?: boolean;
  readLiveEntry?: BuilderCmsEntryLiveState;
  lookupMatches?: Array<{
    id: string;
    title: string;
    lastUpdated: string | null;
    published: string | null;
  }>;
  lookupMatchingIntentCount?: number;
  checkpointResponse?: boolean;
}): ExecuteBuilderSourceExecutionDeps {
  return {
    now: vi.fn(() => NOW),
    resolveDatabase: vi.fn(async () => DATABASE),
    assertEditor: vi.fn(async () => {}),
    assertPageEditor: vi.fn(async () => {}),
    getSourceSnapshot: vi.fn(async () => args.source),
    getExecution: vi.fn(async () => args.execution),
    updateExecutionState: vi.fn(async () => {}),
    claimExecution: vi.fn(async () => args.claimExecution ?? true),
    renewExecutionClaim: vi.fn(async () => args.renewExecutionClaim ?? true),
    markResponseCheckpointFailed: vi.fn(async () => true),
    markExecutionSucceeded: vi.fn(async () => {}),
    markExecutionFailed: vi.fn(async () => {}),
    releaseExecutionClaim: vi.fn(async () => {}),
    executeWrite: vi.fn(async () =>
      args.writeResult
        ? args.writeResult
        : {
            ok: true,
            status: 200,
            entryId: "builder-entry-1",
            responseBody: { id: "builder-entry-1" },
          },
    ),
    readLiveEntry: vi.fn(async () =>
      args.readLiveEntry
        ? args.readLiveEntry
        : {
            exists: true,
            published: "draft",
            lastUpdated: BUILDER_LAST_UPDATED_MS,
            blocksHash: null,
            id: "builder-entry-1",
            values: { "data.title": "Old title" },
          },
    ),
    reconcileWrite: vi.fn(async () => {}),
    getResponse: vi.fn(async () => RESPONSE),
    lookupSafeModelIntent:
      args.lookupMatches === undefined
        ? undefined
        : vi.fn(async () => ({
            count: args.lookupMatches!.length,
            matchingIntentCount:
              args.lookupMatchingIntentCount ?? args.lookupMatches!.length,
            matches: args.lookupMatches!,
          })),
    checkpointResponse:
      args.checkpointResponse === undefined
        ? undefined
        : vi.fn(async () => args.checkpointResponse!),
  };
}

describe("execute Builder source execution", () => {
  it("transitions write-disabled plans without calling Builder", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({
      liveWritesEnabled: false,
      changeSets: [approvedChangeSet],
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow("Live Builder writes are disabled for this source.");

    expect(deps.updateExecutionState).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        expected: {
          state: execution.state,
          updatedAt: execution.updatedAt,
          attemptToken: execution.attemptToken,
        },
        state: "write_disabled",
        lastError: "Live Builder writes are disabled for this source.",
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("creates a new Builder entry for an unmatched (synthetic-fixture) row", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({
      liveWritesEnabled: true,
      rows: [
        row({
          documentId: "doc-1",
          sourceRowId: "builder-doc-1",
          sourceQualifiedId: `builder-cms://${BUILDER_CMS_SAFE_WRITE_MODEL}/builder-doc-1`,
          provenance: "Builder CMS fixture adapter",
        }),
      ],
      changeSets: [approvedChangeSet],
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      writeResult: {
        ok: true,
        status: 200,
        entryId: "new-builder-entry",
        responseBody: { id: "new-builder-entry" },
      },
    });

    await executeBuilderSourceExecutionWithDeps(
      {
        databaseId: "database-1",
        changeSetId: approvedChangeSet.id,
        pushModeConfirmation: "autosave",
      },
      deps,
    );

    expect(deps.readLiveEntry).not.toHaveBeenCalled();
    expect(deps.executeWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ published: "draft" }),
        }),
      }),
    );
    expect(deps.markExecutionSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: execution.id }),
    );
  });

  it("fails closed before executing an opted-in production Builder model", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({
      liveWritesEnabled: true,
      sourceTable: "blog_article",
      rows: [
        row({
          sourceQualifiedId: "builder-cms://blog_article/builder-entry-1",
        }),
      ],
      changeSets: [approvedChangeSet],
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow(BUILDER_CMS_SAFE_WRITE_MODEL);

    expect(deps.executeWrite).not.toHaveBeenCalled();
    expect(deps.markExecutionSucceeded).not.toHaveBeenCalled();
  });

  it("rejects stale stored dry runs before the write client is invoked", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: approvedChangeSet,
      pushModeConfirmation: "autosave",
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      payloadJson: JSON.stringify({
        ...plan.payload,
        request: {
          ...plan.payload.request,
          query: {},
        },
      }),
    });
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow(
      "Stored Builder request no longer matches the approved change.",
    );

    expect(deps.updateExecutionState).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        state: "blocked",
        lastError:
          "Stored Builder request no longer matches the approved change.",
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("executes one validated ready plan and reconciles after success", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: approvedChangeSet,
      pushModeConfirmation: "autosave",
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        exists: true,
        published: "published",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
        values: { "data.title": "Old title", "data.slug": "old-title" },
      },
    });

    const result = await executeBuilderSourceExecutionWithDeps(
      {
        databaseId: "database-1",
        changeSetId: approvedChangeSet.id,
        idempotencyKey: plan.idempotencyKey,
        pushModeConfirmation: "autosave",
      },
      deps,
    );

    expect(result).toMatchObject(RESPONSE);
    expect(result.timings?.map((timing) => timing.name)).toEqual([
      "snapshot_read_and_diff_load",
      "approval_gate_and_dry_run_validation",
      "write_dispatch",
      "reconciliation_and_persistence",
      "total",
    ]);
    expect(result.timings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ durationMs: expect.any(Number) }),
      ]),
    );
    expect(result.timings?.every((timing) => timing.durationMs >= 0)).toBe(
      true,
    );

    expect(deps.claimExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        summary: "Running Builder autosave execution.",
      }),
    );
    const claimCallOrder = vi.mocked(deps.claimExecution).mock
      .invocationCallOrder[0];
    const writeCallOrder = vi.mocked(deps.executeWrite).mock
      .invocationCallOrder[0];
    expect(claimCallOrder).toBeLessThan(writeCallOrder);
    expect(deps.executeWrite).toHaveBeenCalledTimes(1);
    expect(deps.executeWrite).toHaveBeenCalledWith({
      request: plan.payload.request,
      expectedSourceSpace: "selected-space-key",
      expectedSourceConnectionId: "builder-oauth-connection-1",
      requireSourceBinding: true,
    });
    expect(deps.markExecutionSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        changeSetId: approvedChangeSet.id,
        summary: "Builder autosave execution succeeded.",
      }),
    );
    expect(deps.reconcileWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        database: DATABASE,
        source: builderSource,
        changeSet: approvedChangeSet,
        plan: expect.objectContaining({
          idempotencyKey: plan.idempotencyKey,
          payload: expect.objectContaining({
            effect: "autosave",
            request: plan.payload.request,
            livePreflight: {
              checkedAt: NOW,
              exists: true,
              id: "builder-entry-1",
              published: "published",
              lastUpdated: BUILDER_LAST_UPDATED_MS,
              blocksHash: null,
              bodyEmpty: false,
              hasAutosaves: null,
              values: {
                "data.title": "Old title",
                [BUILDER_CMS_ENTRY_NAME_KEY]: null,
              },
            },
          }),
        }),
        now: NOW,
      }),
    );
    const reconcileCallOrder = vi.mocked(deps.reconcileWrite).mock
      .invocationCallOrder[0];
    const successCallOrder = vi.mocked(deps.markExecutionSucceeded).mock
      .invocationCallOrder[0];
    expect(reconcileCallOrder).toBeLessThan(successCallOrder);
    expect(deps.assertPageEditor).not.toHaveBeenCalled();
  });

  it("preflights update-in-place writes between the claim and the write when string baseline matches numeric live timestamp", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [row({ sourceValues: { published: "draft" } })],
      changeSets: [approvedChangeSet],
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);

    expect(deps.readLiveEntry).toHaveBeenCalledWith({
      model: BUILDER_CMS_SAFE_WRITE_MODEL,
      entryId: "builder-entry-1",
      fieldPaths: ["data.title", BUILDER_CMS_ENTRY_NAME_KEY],
      expectedSourceSpace: "selected-space-key",
      expectedSourceConnectionId: "builder-oauth-connection-1",
    });
    expect(deps.executeWrite).toHaveBeenCalledTimes(1);
    const readCallOrder = vi.mocked(deps.readLiveEntry).mock
      .invocationCallOrder[0]!;
    const renewCallOrder = vi.mocked(deps.renewExecutionClaim).mock
      .invocationCallOrder[0]!;
    const claimCallOrder = vi.mocked(deps.claimExecution).mock
      .invocationCallOrder[0]!;
    const writeCallOrder = vi.mocked(deps.executeWrite).mock
      .invocationCallOrder[0]!;
    expect(claimCallOrder).toBeLessThan(readCallOrder);
    expect(readCallOrder).toBeLessThan(renewCallOrder);
    expect(renewCallOrder).toBeLessThan(writeCallOrder);
  });

  it.each([
    {
      name: "blocks an update in place when Builder unpublished the entry after review",
      sourceValues: { published: "published", "data.title": "Old title" },
      message:
        "Builder publication state changed since this diff was approved; refresh and re-review.",
    },
    {
      name: "blocks an update in place when the row has no reviewed publication state",
      sourceValues: { "data.title": "Old title" },
      message:
        "This change has no reviewed Builder publication state; refresh and re-review.",
    },
  ])("$name", async ({ sourceValues, message }) => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [row({ sourceValues })],
      changeSets: [approvedChangeSet],
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    // The title Content writes is unchanged, so only the publication state
    // tells this read apart from the reviewed one.
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        exists: true,
        published: "draft",
        lastUpdated: BUILDER_LAST_UPDATED_MS + 1000,
        blocksHash: null,
        id: "builder-entry-1",
        values: { "data.title": "Old title" },
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).rejects.toThrow(message);
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("records that the live body was empty, unlike a read that left it out", async () => {
    const approvedChangeSet = changeSet({ pushMode: "autosave" });
    const builderSource = source({
      rows: [
        row({
          sourceValues: { published: "published", "data.title": "Old title" },
        }),
      ],
      changeSets: [approvedChangeSet],
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        exists: true,
        published: "published",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
        values: {
          "data.title": "Old title",
          [BUILDER_CMS_BODY_BLOCK_COUNT_KEY]: 0,
        },
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);

    expect(deps.reconcileWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          payload: expect.objectContaining({
            livePreflight: expect.objectContaining({ bodyEmpty: true }),
          }),
        }),
      }),
    );
  });

  it("does not dispatch after preflight when another attempt reclaimed the lease", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      renewExecutionClaim: false,
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "Builder execution lease was reclaimed during live preflight.",
    });

    expect(deps.renewExecutionClaim).toHaveBeenCalledTimes(1);
    expect(deps.executeWrite).not.toHaveBeenCalled();
    expect(deps.releaseExecutionClaim).not.toHaveBeenCalled();
  });

  it("releases the execution claim when preflight lease renewal throws", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({ source: builderSource, execution });
    const renewalError = new Error("execution lease store unavailable");
    vi.mocked(deps.renewExecutionClaim).mockRejectedValue(renewalError);

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).rejects.toBe(renewalError);

    expect(deps.releaseExecutionClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        summary: expect.stringContaining("Execution stopped before write."),
        lastError: "execution lease store unavailable",
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("blocks stale live entries before writing and hands the claim back as blocked", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [
        row({
          lastSourceUpdatedAt: String(STALE_BUILDER_LAST_UPDATED_MS),
        }),
      ],
      changeSets: [approvedChangeSet],
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        exists: true,
        published: "draft",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).rejects.toThrow(
      "Builder entry changed since this diff was approved; refresh and re-review.",
    );

    expect(deps.releaseExecutionClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        attemptToken: vi.mocked(deps.claimExecution).mock.calls[0]?.[0]
          .attemptToken,
        restore: expect.objectContaining({
          state: "blocked",
          attemptToken: undefined,
          updatedAt: execution.updatedAt,
        }),
        lastError:
          "Builder entry changed since this diff was approved; refresh and re-review.",
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("blocks missing live entries before writing and hands the claim back as blocked", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        exists: false,
        published: null,
        lastUpdated: null,
        blocksHash: null,
        id: null,
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).rejects.toThrow("Builder entry no longer exists; refresh the source.");

    expect(deps.releaseExecutionClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        restore: expect.objectContaining({
          state: "blocked",
          attemptToken: undefined,
          updatedAt: execution.updatedAt,
        }),
        lastError: "Builder entry no longer exists; refresh the source.",
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("blocks a write when Builder reports no lastUpdated for the live entry", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        exists: true,
        published: "draft",
        lastUpdated: null,
        blocksHash: null,
        id: "builder-entry-1",
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        "Builder did not report when this entry last changed; refresh and re-review.",
    });
    expect(deps.releaseExecutionClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        restore: expect.objectContaining({
          state: "blocked",
          attemptToken: undefined,
          updatedAt: execution.updatedAt,
        }),
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("compares the live entry with the lastUpdated recorded at review, not a later refresh", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const reviewedSource = source({
      rows: [
        row({ lastSourceUpdatedAt: String(STALE_BUILDER_LAST_UPDATED_MS) }),
      ],
      changeSets: [approvedChangeSet],
    });
    const execution = executionFor({
      source: reviewedSource,
      changeSet: approvedChangeSet,
    });
    // A refresh after review saw the newer Builder save and moved the row's
    // baseline to match the live entry.
    const refreshedSource = source({ changeSets: [approvedChangeSet] });
    const deps = depsFor({ source: refreshedSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).rejects.toThrow(
      "Builder entry changed since this change was reviewed. Refresh and review it again.",
    );
    expect(deps.updateExecutionState).toHaveBeenCalledWith(
      expect.objectContaining({ state: "blocked" }),
    );
    expect(deps.claimExecution).not.toHaveBeenCalled();
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("hands the claim back unchanged when the live read fails", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      state: "running",
      updatedAt: "2026-06-15T11:00:00.000Z",
    });
    const deps = depsFor({ source: builderSource, execution });
    vi.mocked(deps.readLiveEntry).mockRejectedValueOnce(
      new Error("Builder CMS live entry read failed with HTTP 503."),
    );

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).rejects.toThrow("Builder CMS live entry read failed with HTTP 503.");
    expect(deps.releaseExecutionClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        restore: expect.objectContaining({
          state: execution.state,
          attemptToken: undefined,
          updatedAt: execution.updatedAt,
        }),
        lastError: "Builder CMS live entry read failed with HTTP 503.",
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("publishes draft entries after live transition preflight", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({
      changeSets: [approvedChangeSet],
      metadata: {
        allowPublicationTransitions: true,
      },
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      publicationTransition: "publish",
    });
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
          publicationTransition: "publish",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);

    expect(deps.readLiveEntry).toHaveBeenCalledTimes(1);
    expect(deps.executeWrite).toHaveBeenCalledWith({
      request: expect.objectContaining({
        body: expect.objectContaining({ published: "published" }),
      }),
      expectedSourceSpace: "selected-space-key",
      expectedSourceConnectionId: "builder-oauth-connection-1",
      requireSourceBinding: true,
    });
  });

  it("refuses a publish from a caller who can't edit the entry's page", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({
      changeSets: [approvedChangeSet],
      metadata: {
        allowPublicationTransitions: true,
      },
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      publicationTransition: "publish",
    });
    const deps = depsFor({ source: builderSource, execution });
    vi.mocked(deps.assertPageEditor).mockRejectedValue(
      new Error("Requires editor role on document doc-1 (have viewer)"),
    );

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
          publicationTransition: "publish",
        },
        deps,
      ),
    ).rejects.toThrow("Requires editor role on document doc-1 (have viewer)");

    expect(deps.assertPageEditor).toHaveBeenCalledWith("doc-1");
    expect(deps.claimExecution).not.toHaveBeenCalled();
    expect(deps.updateExecutionState).not.toHaveBeenCalled();
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("publishes an approved revision when the entry is already published", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({
      changeSets: [approvedChangeSet],
      metadata: {
        allowPublicationTransitions: true,
      },
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      publicationTransition: "publish",
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        exists: true,
        published: "published",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
          publicationTransition: "publish",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);

    expect(deps.readLiveEntry).toHaveBeenCalledTimes(1);
    expect(deps.executeWrite).toHaveBeenCalledWith({
      request: expect.objectContaining({
        body: expect.objectContaining({
          data: expect.objectContaining({ title: "New title" }),
          published: "published",
        }),
      }),
      expectedSourceSpace: "selected-space-key",
      expectedSourceConnectionId: "builder-oauth-connection-1",
      requireSourceBinding: true,
    });
  });

  it("fails closed when a publish preflight cannot verify publication state", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({
      changeSets: [approvedChangeSet],
      metadata: { allowPublicationTransitions: true },
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      publicationTransition: "publish",
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        exists: true,
        published: null,
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
          publicationTransition: "publish",
        },
        deps,
      ),
    ).rejects.toThrow(
      "Builder publication state could not be verified; refresh and re-review.",
    );

    expect(deps.releaseExecutionClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        restore: expect.objectContaining({
          state: "blocked",
          attemptToken: undefined,
          updatedAt: execution.updatedAt,
        }),
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("blocks a publish once Builder's editor holds changes Content can't see", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const run = (
      hasAutosaves: boolean,
      rows: ContentDatabaseSource["rows"] = [row()],
    ) => {
      const builderSource = source({
        rows,
        changeSets: [approvedChangeSet],
        metadata: { allowPublicationTransitions: true },
      });
      const deps = depsFor({
        source: builderSource,
        execution: executionFor({
          source: builderSource,
          changeSet: approvedChangeSet,
          publicationTransition: "publish",
        }),
        readLiveEntry: {
          exists: true,
          published: "published",
          lastUpdated: BUILDER_LAST_UPDATED_MS,
          blocksHash: null,
          id: "builder-entry-1",
          hasAutosaves,
        },
      });
      return {
        deps,
        result: executeBuilderSourceExecutionWithDeps(
          {
            databaseId: "database-1",
            changeSetId: approvedChangeSet.id,
            pushModeConfirmation: "draft",
            publicationTransition: "publish",
          },
          deps,
        ),
      };
    };

    const autosaved = run(true);
    await expect(autosaved.result).rejects.toThrow(
      "This entry has unpublished changes saved in Builder's editor, which Content can't see. Publish it from Builder.",
    );
    expect(autosaved.deps.executeWrite).not.toHaveBeenCalled();

    const clean = run(false);
    await expect(clean.result).resolves.toMatchObject(RESPONSE);
    expect(clean.deps.executeWrite).toHaveBeenCalledTimes(1);

    // Content's own unpublished save doesn't account for the editor's.
    const contentSaved = run(true, [
      row({
        sourceValues: withBuilderCmsUnpublishedChanges(
          { published: "published", "data.title": "Saved title" },
          { liveValues: { "data.title": "Old title" } },
        ),
      }),
    ]);
    await expect(contentSaved.result).rejects.toThrow(
      "This entry has unpublished changes saved in Builder's editor, which Content can't see. Publish it from Builder.",
    );
    expect(contentSaved.deps.executeWrite).not.toHaveBeenCalled();
  });

  it("unpublishes published entries when explicitly confirmed", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({
      changeSets: [approvedChangeSet],
      metadata: {
        allowPublicationTransitions: true,
      },
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      publicationTransition: "unpublish",
      confirmUnpublish: true,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        exists: true,
        published: "published",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
          publicationTransition: "unpublish",
          confirmUnpublish: true,
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);

    expect(deps.readLiveEntry).toHaveBeenCalledTimes(1);
    expect(deps.executeWrite).toHaveBeenCalledWith({
      request: expect.objectContaining({
        body: expect.objectContaining({ published: "draft" }),
      }),
      expectedSourceSpace: "selected-space-key",
      expectedSourceConnectionId: "builder-oauth-connection-1",
      requireSourceBinding: true,
    });
  });

  it("preflights existing-entry autosave writes before patching Builder", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);

    expect(deps.readLiveEntry).toHaveBeenCalledWith({
      model: BUILDER_CMS_SAFE_WRITE_MODEL,
      entryId: "builder-entry-1",
      fieldPaths: ["data.title", BUILDER_CMS_ENTRY_NAME_KEY],
      expectedSourceSpace: "selected-space-key",
      expectedSourceConnectionId: "builder-oauth-connection-1",
    });
    expect(deps.executeWrite).toHaveBeenCalledTimes(1);
  });

  it("blocks existing-entry autosaves when the live Builder body changed", async () => {
    const approvedChangeSet = changeSet({
      bodyChange: {
        summary: "Builder body changed.",
        currentExcerpt: "Old body",
        proposedExcerpt: "New body",
        currentHash: "local-baseline-hash",
        proposedHash: "local-next-hash",
        proposedContent: "New body",
        proposedBlocksJson: "[]",
        sidecarsJson: "{}",
        warnings: [],
      },
    });
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        exists: true,
        published: "draft",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: "new-live-builder-hash",
        id: "builder-entry-1",
        values: { "data.title": "Old title" },
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow(
      "Builder body changed since this diff was approved; refresh and re-review.",
    );

    expect(deps.executeWrite).not.toHaveBeenCalled();
    expect(deps.releaseExecutionClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        restore: expect.objectContaining({
          state: "blocked",
          attemptToken: undefined,
          updatedAt: execution.updatedAt,
        }),
        lastError:
          "Builder body changed since this diff was approved; refresh and re-review.",
      }),
    );
  });

  it("records and throws write failures without applying the change set", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      writeResult: {
        ok: false,
        status: 500,
        responseBody: { message: "nope" },
        error: "Builder write request failed with HTTP 500.",
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow("Builder write request failed with HTTP 500.");

    expect(deps.markExecutionFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        summary: "Builder autosave execution failed.",
        lastError: "Builder write request failed with HTTP 500.",
      }),
    );
    expect(deps.markExecutionSucceeded).not.toHaveBeenCalled();
    expect(deps.reconcileWrite).not.toHaveBeenCalled();
  });

  it("marks safe Builder validation failures as user-facing client errors", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      writeResult: {
        ok: false,
        status: 400,
        responseBody: {
          message: "Blurb must be at least 110 characters",
        },
        error:
          "Builder validation failed: Blurb must be at least 110 characters",
      },
    });

    const result = executeBuilderSourceExecutionWithDeps(
      {
        databaseId: "database-1",
        changeSetId: approvedChangeSet.id,
        pushModeConfirmation: "autosave",
      },
      deps,
    );

    await expect(result).rejects.toMatchObject({
      message:
        "Builder validation failed: Blurb must be at least 110 characters",
      statusCode: 400,
    });
    expect(deps.markExecutionFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "failed",
        lastError:
          "Builder validation failed: Blurb must be at least 110 characters",
      }),
    );
  });

  it("surfaces an HTTP conflict without writing when another caller wins the claim", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      claimExecution: false,
    });

    const result = executeBuilderSourceExecutionWithDeps(
      {
        databaseId: "database-1",
        changeSetId: approvedChangeSet.id,
        pushModeConfirmation: "autosave",
      },
      deps,
    );
    await expect(result).rejects.toMatchObject({
      message: "Builder execution is already running.",
      statusCode: 409,
    });

    expect(deps.claimExecution).toHaveBeenCalledTimes(1);
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("surfaces a visible conflict without reclaiming a fresh running execution", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      state: "running",
      updatedAt: NOW,
    });
    const deps = depsFor({ source: builderSource, execution });

    const result = executeBuilderSourceExecutionWithDeps(
      {
        databaseId: "database-1",
        changeSetId: approvedChangeSet.id,
        pushModeConfirmation: "autosave",
      },
      deps,
    );
    await expect(result).rejects.toMatchObject({
      message: "Builder execution is already running.",
      statusCode: 409,
    });

    expect(deps.claimExecution).not.toHaveBeenCalled();
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("allows stale running executions to be reclaimed through the claim gate", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      state: "running",
      updatedAt: "2026-06-15T11:00:00.000Z",
    });
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);

    expect(deps.claimExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        changeSetId: approvedChangeSet.id,
        expected: {
          state: "running",
          updatedAt: "2026-06-15T11:00:00.000Z",
          attemptToken: undefined,
        },
        staleBefore: "2026-06-15T11:50:00.000Z",
      }),
    );
    expect(deps.executeWrite).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when the write fails before dispatch", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = {
      ...executionFor({
        source: builderSource,
        changeSet: approvedChangeSet,
        state: "failed",
      }),
      attemptToken: "earlier-attempt",
    };
    const deps = depsFor({ source: builderSource, execution });
    vi.mocked(deps.executeWrite).mockRejectedValueOnce(
      new Error("Re-authorize Builder.io to continue."),
    );

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow("Re-authorize Builder.io to continue.");

    const claimToken = vi.mocked(deps.claimExecution).mock.calls[0]?.[0]
      .attemptToken;
    expect(deps.releaseExecutionClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        attemptToken: claimToken,
        restore: expect.objectContaining({
          state: "failed",
          attemptToken: "earlier-attempt",
          updatedAt: execution.updatedAt,
        }),
        lastError: "Re-authorize Builder.io to continue.",
      }),
    );
    expect(deps.markExecutionFailed).not.toHaveBeenCalled();
    expect(deps.reconcileWrite).not.toHaveBeenCalled();
  });

  it("does not mark success when post-write reconciliation fails", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({ source: builderSource, execution });
    vi.mocked(deps.reconcileWrite).mockRejectedValueOnce(
      new Error("local row missing"),
    );

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow(
      "Builder write succeeded, but local reconciliation failed: local row missing",
    );

    expect(deps.executeWrite).toHaveBeenCalledTimes(1);
    expect(deps.markExecutionFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        state: "reconciliation_required",
        summary: "Builder autosave execution requires reconciliation.",
        lastError:
          "Builder write succeeded, but local reconciliation failed: local row missing",
      }),
    );
    expect(deps.markExecutionSucceeded).not.toHaveBeenCalled();
  });

  it("retries failed reconciliation from a stored successful write response", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: approvedChangeSet,
      pushModeConfirmation: "autosave",
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      state: "failed",
      payloadJson: JSON.stringify({
        ...plan.payload,
        response: {
          ok: true,
          status: 200,
          entryId: "builder-entry-1",
          body: { id: "builder-entry-1" },
        },
      }),
    });
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);

    expect(deps.executeWrite).not.toHaveBeenCalled();
    expect(deps.reconcileWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        writeResult: expect.objectContaining({
          ok: true,
          entryId: "builder-entry-1",
        }),
      }),
    );
    expect(deps.markExecutionSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        changeSetId: approvedChangeSet.id,
      }),
    );
  });

  it("treats succeeded executions as idempotent no-ops", async () => {
    const appliedChangeSet = changeSet({ state: "applied" });
    const builderSource = source({ changeSets: [appliedChangeSet] });
    const execution: BuilderSourceExecutionRecord = {
      id: "execution-1",
      state: "succeeded",
      idempotencyKey: builderCmsExecutionIdempotencyKey({
        sourceId: builderSource.id,
        changeSetId: appliedChangeSet.id,
        pushMode: "autosave",
      }),
      payloadJson: "{}",
      updatedAt: NOW,
    };
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: appliedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);

    expect(deps.executeWrite).not.toHaveBeenCalled();
    expect(deps.updateExecutionState).not.toHaveBeenCalled();
  });

  it("rejects mismatched idempotency keys before lookup or write", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          idempotencyKey: "builder-cms:wrong",
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow(
      "Execution idempotency key does not match this write plan.",
    );

    expect(deps.getExecution).not.toHaveBeenCalled();
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("reconciles returned Builder IDs so repeat pushes PATCH the created entry", () => {
    const draftCreate = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [],
      changeSets: [draftCreate],
      metadata: {
        pushMode: "draft",
        allowDraftWrites: true,
        allowedWriteModes: ["draft", "autosave"],
      },
    });
    const createPlan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: draftCreate,
      pushModeConfirmation: "draft",
    });

    expect(createPlan).toMatchObject({
      state: "ready",
      payload: {
        request: {
          method: "POST",
          path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}`,
        },
      },
    });

    const patch = builderCmsReconciledSourceRowPatch({
      source: builderSource,
      changeSet: draftCreate,
      plan: createPlan,
      writeResult: {
        ok: true,
        status: 200,
        entryId: "builder-created-1",
        responseBody: { id: "builder-created-1" },
      },
      now: NOW,
    });

    expect(patch).toMatchObject({
      sourceRowId: "builder-created-1",
      sourceQualifiedId: `builder-cms://${BUILDER_CMS_SAFE_WRITE_MODEL}/builder-created-1`,
      sourceDisplayKey: "New title",
    });

    const repeatChangeSet = changeSet({ id: "change-2" });
    const followUpSource = source({
      rows: [
        row({
          sourceRowId: patch?.sourceRowId,
          sourceQualifiedId: patch?.sourceQualifiedId,
          sourceDisplayKey: patch?.sourceDisplayKey,
        }),
      ],
      changeSets: [repeatChangeSet],
    });
    const repeatPlan = buildBuilderCmsExecutionPlan({
      source: followUpSource,
      changeSet: repeatChangeSet,
      pushModeConfirmation: "autosave",
    });

    expect(repeatPlan.payload.request).toMatchObject({
      method: "PATCH",
      path: `/api/v1/write/${BUILDER_CMS_SAFE_WRITE_MODEL}/builder-created-1`,
    });
  });

  it("reconciles Builder-native field values without copying body blocks into SQL", () => {
    const draftCreate = {
      ...changeSet({ pushMode: "draft" }),
      fieldChanges: [
        {
          propertyId: "author",
          propertyName: "Author",
          localFieldKey: "author",
          sourceFieldKey: "data.author",
          currentValue: null,
          proposedValue: "Alice Moore",
        },
      ],
      bodyChange: {
        summary: "Body changed",
        currentExcerpt: null,
        proposedExcerpt: "Rich body",
        proposedHash: "body-hash",
        proposedContent: "Rich body",
        proposedBlocksJson: '[{"@type":"@builder.io/sdk:Element"}]',
        sidecarsJson: "{}",
        warnings: [],
      },
    } as ContentDatabaseSourceChangeSet;
    const nativeAuthor = {
      "@type": "@builder.io/core:Reference",
      id: "author-alice",
      model: "author",
    };
    const plan = {
      payload: {
        request: {
          body: {
            data: {
              author: nativeAuthor,
              image: "https://example.com/feature.jpg",
              blocks: [{ "@type": "@builder.io/sdk:Element" }],
            },
          },
        },
      },
    } as Parameters<typeof builderCmsReconciledSourceValuesJson>[0]["plan"];

    const values = JSON.parse(
      builderCmsReconciledSourceValuesJson({
        existingSourceValuesJson: null,
        snapshotSourceValues: undefined,
        changeSet: draftCreate,
        plan,
      }),
    );

    expect(values).toMatchObject({
      "data.author": nativeAuthor,
      "data.image": "https://example.com/feature.jpg",
      "__agent_native_builder_reference_id:data.author": "author-alice",
      [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "body-hash",
    });
    expect(values).not.toHaveProperty("data.blocks");
  });

  it("settles a staged publish or unpublish only when the push sends it", () => {
    const existingSourceValuesJson = JSON.stringify(
      withBuilderCmsPublicationIntent(
        { published: "draft", "data.title": "Old title" },
        "publish",
      ),
    );
    const reconciled = (effect: string) =>
      JSON.parse(
        builderCmsReconciledSourceValuesJson({
          existingSourceValuesJson,
          snapshotSourceValues: undefined,
          changeSet: changeSet({ pushMode: "publish" }),
          plan: {
            payload: { effect, request: { body: {} } },
          } as unknown as Parameters<
            typeof builderCmsReconciledSourceValuesJson
          >[0]["plan"],
        }),
      );

    expect(reconciled("publish")).not.toHaveProperty(
      BUILDER_CMS_PUBLICATION_INTENT_KEY,
    );
    // A push that sends the other transition, or neither, keeps the staged
    // change for a later push.
    expect(reconciled("unpublish")).toMatchObject({
      [BUILDER_CMS_PUBLICATION_INTENT_KEY]: "publish",
    });
    expect(reconciled("update_in_place")).toMatchObject({
      [BUILDER_CMS_PUBLICATION_INTENT_KEY]: "publish",
    });
  });

  it("settles the edit conflicts a push overwrites and keeps the rest", () => {
    const reconciled = (pushed: Partial<ContentDatabaseSourceChangeSet>) =>
      JSON.parse(
        builderCmsReconciledSourceValuesJson({
          existingSourceValuesJson: JSON.stringify(
            withBuilderCmsEditConflicts(
              { "data.title": "Old title" },
              {
                ownedKeys: [],
                conflictedKeys: [
                  "data.title",
                  "data.author",
                  BUILDER_CMS_BODY_CONTENT_KEY,
                ],
              },
            ),
          ),
          snapshotSourceValues: undefined,
          changeSet: changeSet(pushed),
          plan: {
            payload: { effect: "update_in_place", request: { body: {} } },
          } as unknown as Parameters<
            typeof builderCmsReconciledSourceValuesJson
          >[0]["plan"],
        }),
      );

    expect(reconciled({})[BUILDER_CMS_EDIT_CONFLICTS_KEY]).toEqual([
      BUILDER_CMS_BODY_CONTENT_KEY,
      "data.author",
    ]);
    expect(
      reconciled({
        fieldChanges: [],
        bodyChange: {
          summary: "Body changed",
          currentExcerpt: null,
          proposedExcerpt: "Body",
        },
      })[BUILDER_CMS_EDIT_CONFLICTS_KEY],
    ).toEqual(["data.author", "data.title"]);
  });

  it("stores Builder's authoritative updated timestamp after a successful write", () => {
    const draftCreate = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [],
      changeSets: [draftCreate],
      metadata: {
        pushMode: "draft",
        allowDraftWrites: true,
        allowedWriteModes: ["draft", "autosave"],
      },
    });
    const createPlan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: draftCreate,
      pushModeConfirmation: "draft",
    });

    const patch = builderCmsReconciledSourceRowPatch({
      source: builderSource,
      changeSet: draftCreate,
      plan: createPlan,
      writeResult: {
        ok: true,
        status: 200,
        entryId: "builder-created-1",
        responseBody: {
          data: {
            id: "builder-created-1",
            lastUpdated: BUILDER_LAST_UPDATED_MS,
          },
        },
      },
      now: NOW,
    });

    expect(patch?.lastSyncedAt).toBe(NOW);
    expect(patch?.lastSourceUpdatedAt).toBe(String(BUILDER_LAST_UPDATED_MS));
  });

  it.each([
    { count: 0, writes: 1, reconciles: 1 },
    { count: 1, writes: 0, reconciles: 1 },
    { count: 2, writes: 0, reconciles: 0 },
  ])(
    "reconciles create drafts by marker before POST (remote count $count)",
    async ({ count, writes, reconciles }) => {
      const draftCreate = changeSet({ pushMode: "draft" });
      const builderSource = source({
        rows: [],
        changeSets: [draftCreate],
        metadata: {
          pushMode: "draft",
          allowDraftWrites: true,
          allowedWriteModes: ["draft", "autosave"],
        },
      });
      const execution = executionFor({
        source: builderSource,
        changeSet: draftCreate,
      });
      const lookupMatches = Array.from({ length: count }, (_, index) => ({
        id: `remote-${index}`,
        title: "New title",
        lastUpdated: NOW,
        published: "draft",
      }));
      const deps = depsFor({
        source: builderSource,
        execution,
        lookupMatches,
      });

      const promise = executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: draftCreate.id,
          pushModeConfirmation: "draft",
        },
        deps,
      );
      if (count > 1) {
        await expect(promise).rejects.toThrow("reconciliation required");
      } else {
        await expect(promise).resolves.toMatchObject(RESPONSE);
      }
      expect(deps.executeWrite).toHaveBeenCalledTimes(writes);
      expect(deps.reconcileWrite).toHaveBeenCalledTimes(reconciles);
      if (count > 1) {
        expect(deps.markExecutionFailed).toHaveBeenCalledWith(
          expect.objectContaining({ state: "reconciliation_required" }),
        );
      }
    },
  );

  it("uses exact title plus all intended fields for a stale pre-marker create", async () => {
    const draftCreate = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [],
      changeSets: [draftCreate],
      metadata: {
        pushMode: "draft",
        allowDraftWrites: true,
        allowedWriteModes: ["draft", "autosave"],
      },
    });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: draftCreate,
      pushModeConfirmation: "draft",
    });
    const legacyPayload = structuredClone(plan.payload);
    delete (legacyPayload.request.body.data as Record<string, unknown>)
      .agentNativeTestNote;
    const execution = executionFor({
      source: builderSource,
      changeSet: draftCreate,
      state: "running",
      updatedAt: "2026-06-15T11:00:00.000Z",
      payloadJson: JSON.stringify(legacyPayload),
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      lookupMatches: [
        {
          id: "legacy-remote",
          title: "New title",
          lastUpdated: NOW,
          published: "draft",
        },
      ],
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: draftCreate.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);
    expect(deps.lookupSafeModelIntent).toHaveBeenCalledWith({
      exactTitle: "New title",
      intendedFields: { title: "New title" },
      expectedSourceSpace: "selected-space-key",
      expectedSourceConnectionId: "builder-oauth-connection-1",
    });
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("blocks instead of POSTing when a unique remote marker has field drift", async () => {
    const draftCreate = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [],
      changeSets: [draftCreate],
      metadata: {
        pushMode: "draft",
        allowDraftWrites: true,
        allowedWriteModes: ["draft", "autosave"],
      },
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: draftCreate,
      state: "reconciliation_required",
      updatedAt: "2026-06-15T11:00:00.000Z",
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      lookupMatches: [
        {
          id: "drifted-remote",
          title: "Changed remotely",
          lastUpdated: NOW,
          published: "draft",
        },
      ],
      lookupMatchingIntentCount: 0,
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: draftCreate.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).rejects.toThrow("marker exists");
    expect(deps.executeWrite).not.toHaveBeenCalled();
    expect(deps.markExecutionFailed).toHaveBeenCalledWith(
      expect.objectContaining({ state: "reconciliation_required" }),
    );
  });

  it("checkpoints a successful response before reconciliation and fences a lost lease", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      checkpointResponse: false,
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow("lease was reclaimed before response checkpoint");
    expect(deps.checkpointResponse).toHaveBeenCalledTimes(1);
    expect(deps.reconcileWrite).not.toHaveBeenCalled();
  });

  it("records accepted writes whose response cannot be stored and never retries them", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      checkpointResponse: true,
    });
    vi.mocked(deps.checkpointResponse!).mockRejectedValueOnce(
      new Error("private blob store unavailable"),
    );

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Do not retry this execution"),
    });

    const attemptToken = vi.mocked(deps.claimExecution).mock.calls[0]?.[0]
      .attemptToken;
    expect(deps.markResponseCheckpointFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        attemptToken,
        lastError: expect.stringContaining("Do not retry this execution"),
      }),
    );
    expect(deps.reconcileWrite).not.toHaveBeenCalled();
    expect(deps.markExecutionSucceeded).not.toHaveBeenCalled();

    const unrecoverableExecution = {
      ...execution,
      state: "reconciliation_required",
      updatedAt: "2026-06-15T10:00:00.000Z",
      lastError:
        "Builder accepted the write, but its response could not be saved for reconciliation. Do not retry this execution; inspect the live Builder entry before preparing another write.",
    };
    const retryDeps = depsFor({
      source: builderSource,
      execution: unrecoverableExecution,
    });
    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        retryDeps,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Do not retry this execution"),
    });
    expect(retryDeps.executeWrite).not.toHaveBeenCalled();
  });

  it("persists transport ambiguity as reconciliation-required", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      writeResult: {
        ok: false,
        status: 0,
        responseBody: null,
        ambiguity: "timeout",
        error: "remote outcome is unknown",
      },
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow("remote outcome is unknown");
    expect(deps.markExecutionFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "reconciliation_required",
        attemptToken: expect.any(String),
      }),
    );
  });

  it("does not retry a fresh ambiguous create before the recovery window", async () => {
    const draftCreate = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [],
      changeSets: [draftCreate],
      metadata: {
        pushMode: "draft",
        allowDraftWrites: true,
        allowedWriteModes: ["draft", "autosave"],
      },
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: draftCreate,
      state: "reconciliation_required",
      updatedAt: NOW,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      lookupMatches: [],
    });

    const result = executeBuilderSourceExecutionWithDeps(
      {
        databaseId: "database-1",
        changeSetId: draftCreate.id,
        pushModeConfirmation: "draft",
      },
      deps,
    );
    await expect(result).rejects.toMatchObject({
      message: expect.stringContaining("Do not retry"),
      statusCode: 409,
    });
    expect(deps.lookupSafeModelIntent).not.toHaveBeenCalled();
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("permits a fenced create retry only after ambiguity is stale and lookup is empty", async () => {
    const draftCreate = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [],
      changeSets: [draftCreate],
      metadata: {
        pushMode: "draft",
        allowDraftWrites: true,
        allowedWriteModes: ["draft", "autosave"],
      },
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: draftCreate,
      state: "reconciliation_required",
      updatedAt: "2026-06-15T11:00:00.000Z",
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      lookupMatches: [],
    });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: draftCreate.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);
    expect(deps.lookupSafeModelIntent).toHaveBeenCalledTimes(1);
    expect(deps.executeWrite).toHaveBeenCalledTimes(1);
    expect(deps.claimExecution).toHaveBeenCalledWith(
      expect.objectContaining({ attemptToken: expect.any(String) }),
    );
  });
});

describe("Builder unpublished saves", () => {
  const publishedRow = (
    overrides: Partial<ContentDatabaseSource["rows"][number]> = {},
  ) =>
    row({
      sourceValues: {
        published: "published",
        "data.title": "Old title",
        [BUILDER_CMS_ENTRY_NAME_KEY]: "Old title",
      },
      ...overrides,
    });

  function unpublishedSave(args: {
    rows?: ContentDatabaseSource["rows"];
    changeSet?: ContentDatabaseSourceChangeSet;
    readLiveEntry: BuilderCmsEntryLiveState;
    writeResult?: BuilderCmsWriteResult;
  }) {
    const approvedChangeSet = args.changeSet ?? changeSet();
    const builderSource = source({
      rows: args.rows ?? [publishedRow()],
      changeSets: [approvedChangeSet],
      metadata: {
        builderModelFields: [
          { name: "title", label: "Title", type: "string", required: true },
          {
            name: "author",
            label: "Author",
            type: "reference",
            model: "blog-author",
          },
        ],
      },
    });
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
    });
    const deps = depsFor({
      source: builderSource,
      execution,
      readLiveEntry: {
        ...args.readLiveEntry,
        values: args.readLiveEntry.values && {
          [BUILDER_CMS_ENTRY_NAME_KEY]: "Old title",
          ...args.readLiveEntry.values,
        },
      },
      writeResult: args.writeResult,
    });
    const run = () =>
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      );
    return { deps, run, execution };
  }

  it("saves a draft when Builder reports the entry unpublished right before the write", async () => {
    const { deps, run } = unpublishedSave({
      readLiveEntry: {
        exists: true,
        published: "draft",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
        values: { "data.title": "Old title" },
      },
    });

    await expect(run()).resolves.toMatchObject(RESPONSE);

    const request = vi.mocked(deps.executeWrite).mock.calls[0]?.[0].request;
    expect(request).toMatchObject({
      method: "PATCH",
      query: { triggerWebhooks: "false" },
    });
    expect(request?.query).not.toHaveProperty("autoSaveOnly");
    expect(request?.body).not.toHaveProperty("published");
    expect(deps.reconcileWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          payload: expect.objectContaining({ effect: "save_draft" }),
        }),
      }),
    );
  });

  it("saves when Builder changed only a field this change does not write", async () => {
    const { deps, run } = unpublishedSave({
      rows: [
        publishedRow({
          lastSourceUpdatedAt: String(STALE_BUILDER_LAST_UPDATED_MS),
        }),
      ],
      readLiveEntry: {
        exists: true,
        published: "published",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
        values: {
          "data.title": "Old title",
          "data.blurb": "Edited in Builder",
        },
      },
    });

    await expect(run()).resolves.toMatchObject(RESPONSE);
    expect(deps.executeWrite).toHaveBeenCalledTimes(1);
  });

  it("names the field Builder changed since the edit and blocks the save", async () => {
    const { deps, run } = unpublishedSave({
      rows: [
        publishedRow({
          lastSourceUpdatedAt: String(STALE_BUILDER_LAST_UPDATED_MS),
        }),
      ],
      readLiveEntry: {
        exists: true,
        published: "published",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
        values: { "data.title": "Edited in Builder" },
      },
    });

    await expect(run()).rejects.toMatchObject({
      statusCode: 409,
      message:
        "Title changed in Builder since you edited it; refresh and re-review.",
    });
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("blocks a save that would overwrite an entry name Builder changed", async () => {
    const { deps, run } = unpublishedSave({
      rows: [
        publishedRow({
          lastSourceUpdatedAt: String(STALE_BUILDER_LAST_UPDATED_MS),
        }),
      ],
      changeSet: changeSet({
        fieldChanges: [
          {
            propertyId: null,
            propertyName: "Blurb",
            localFieldKey: "blurb",
            sourceFieldKey: "data.blurb",
            currentValue: "Old blurb",
            proposedValue: "New blurb",
          },
        ],
      }),
      readLiveEntry: {
        exists: true,
        published: "published",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
        values: { [BUILDER_CMS_ENTRY_NAME_KEY]: "Renamed in Builder" },
      },
    });

    await expect(run()).rejects.toThrow(
      "Entry name changed in Builder since you edited it; refresh and re-review.",
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("checks and keeps Builder's own entry name on a save that leaves the title", async () => {
    const { deps, run } = unpublishedSave({
      rows: [
        publishedRow({
          lastSourceUpdatedAt: String(STALE_BUILDER_LAST_UPDATED_MS),
          sourceValues: {
            published: "published",
            "data.title": "Old title",
            "data.blurb": "Old blurb",
            [BUILDER_CMS_ENTRY_NAME_KEY]: "CMS internal label",
          },
        }),
      ],
      changeSet: changeSet({
        fieldChanges: [
          {
            propertyId: null,
            propertyName: "Blurb",
            localFieldKey: "blurb",
            sourceFieldKey: "data.blurb",
            currentValue: "Old blurb",
            proposedValue: "New blurb",
          },
        ],
      }),
      readLiveEntry: {
        exists: true,
        published: "published",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
        values: {
          "data.blurb": "Old blurb",
          [BUILDER_CMS_ENTRY_NAME_KEY]: "CMS internal label",
        },
      },
    });

    await expect(run()).resolves.toMatchObject(RESPONSE);
    expect(deps.executeWrite).toHaveBeenCalledTimes(1);
    expect(deps.executeWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          body: expect.objectContaining({ name: "CMS internal label" }),
        }),
      }),
    );
  });

  it("treats the live value Content saved over as the value this edit was made against", async () => {
    const { deps, run } = unpublishedSave({
      rows: [
        publishedRow({
          lastSourceUpdatedAt: String(STALE_BUILDER_LAST_UPDATED_MS),
          sourceValues: withBuilderCmsUnpublishedChanges(
            {
              published: "published",
              "data.title": "Saved title",
              [BUILDER_CMS_ENTRY_NAME_KEY]: "Saved title",
            },
            {
              liveValues: {
                "data.title": "Live title",
                [BUILDER_CMS_ENTRY_NAME_KEY]: "Live title",
              },
            },
          ),
        }),
      ],
      readLiveEntry: {
        exists: true,
        published: "published",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
        values: {
          "data.title": "Live title",
          [BUILDER_CMS_ENTRY_NAME_KEY]: "Live title",
        },
      },
    });

    await expect(run()).resolves.toMatchObject(RESPONSE);
    expect(deps.executeWrite).toHaveBeenCalledTimes(1);
  });

  it("compares a reference by id, so another author with the same name blocks the save", async () => {
    const authorChange = changeSet({
      fieldChanges: [
        {
          propertyId: "author-property",
          propertyName: "Author",
          localFieldKey: "author-property",
          sourceFieldKey: "data.author",
          currentValue: "Sam Lee",
          proposedValue: "Alex Kim",
          builderValueJson: JSON.stringify({
            "@type": "@builder.io/core:Reference",
            id: "author-2",
            model: "blog-author",
          }),
        },
      ],
    });
    const reviewedRow = publishedRow({
      lastSourceUpdatedAt: String(STALE_BUILDER_LAST_UPDATED_MS),
      sourceValues: {
        published: "published",
        "data.title": "Old title",
        "data.author": "Sam Lee",
        "__agent_native_builder_reference_id:data.author": "author-1",
        [BUILDER_CMS_ENTRY_NAME_KEY]: "Old title",
      },
    });
    const live = (authorId: string): BuilderCmsEntryLiveState => ({
      exists: true,
      published: "published",
      lastUpdated: BUILDER_LAST_UPDATED_MS,
      blocksHash: null,
      id: "builder-entry-1",
      values: {
        "data.title": "Old title",
        "data.author": "Sam Lee",
        "__agent_native_builder_reference_id:data.author": authorId,
      },
    });

    const otherAuthor = unpublishedSave({
      rows: [reviewedRow],
      changeSet: authorChange,
      readLiveEntry: live("author-3"),
    });
    await expect(otherAuthor.run()).rejects.toThrow(
      "Author changed in Builder since you edited it; refresh and re-review.",
    );
    expect(otherAuthor.deps.executeWrite).not.toHaveBeenCalled();

    const sameAuthor = unpublishedSave({
      rows: [reviewedRow],
      changeSet: authorChange,
      readLiveEntry: live("author-1"),
    });
    await expect(sameAuthor.run()).resolves.toMatchObject(RESPONSE);
    expect(sameAuthor.deps.reconcileWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          payload: expect.objectContaining({
            livePreflight: expect.objectContaining({
              values: {
                "data.author": "Sam Lee",
                "__agent_native_builder_reference_id:data.author": "author-1",
                [BUILDER_CMS_ENTRY_NAME_KEY]: "Old title",
              },
            }),
          }),
        }),
      }),
    );
  });

  it("blocks a body save Builder changed around when the live body cannot be compared", async () => {
    const bodyChangeSet = changeSet({
      fieldChanges: [],
      bodyChange: {
        summary: "Builder body changed.",
        currentExcerpt: "Old body",
        proposedExcerpt: "New body",
        currentHash: "local-baseline-hash",
        proposedHash: "local-next-hash",
        proposedContent: "New body",
        proposedBlocksJson: "[]",
        sidecarsJson: "{}",
        warnings: [],
      },
    });
    const stalePublishedRow = publishedRow({
      lastSourceUpdatedAt: String(STALE_BUILDER_LAST_UPDATED_MS),
    });
    const live = {
      exists: true,
      published: "published",
      lastUpdated: BUILDER_LAST_UPDATED_MS,
      id: "builder-entry-1",
      values: { "data.title": "Old title" },
    } as const;

    const unverifiable = unpublishedSave({
      rows: [stalePublishedRow],
      changeSet: bodyChangeSet,
      readLiveEntry: { ...live, blocksHash: null },
    });
    await expect(unverifiable.run()).rejects.toThrow(
      "Builder entry changed since this diff was approved; refresh and re-review.",
    );
    expect(unverifiable.deps.executeWrite).not.toHaveBeenCalled();

    const unchangedBody = unpublishedSave({
      rows: [stalePublishedRow],
      changeSet: bodyChangeSet,
      readLiveEntry: { ...live, blocksHash: "local-baseline-hash" },
    });
    await expect(unchangedBody.run()).resolves.toMatchObject(RESPONSE);
    expect(unchangedBody.deps.executeWrite).toHaveBeenCalledTimes(1);
  });

  it("blocks an unpublished save when Builder does not return the entry's values", async () => {
    const { deps, run } = unpublishedSave({
      readLiveEntry: {
        exists: true,
        published: "published",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
      },
    });

    await expect(run()).rejects.toThrow(
      "Builder did not return this entry's current values; refresh and re-review.",
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("blocks an unpublished save to an archived entry", async () => {
    const { deps, run } = unpublishedSave({
      readLiveEntry: {
        exists: true,
        published: "archived",
        lastUpdated: BUILDER_LAST_UPDATED_MS,
        blocksHash: null,
        id: "builder-entry-1",
        values: { "data.title": "Old title" },
      },
    });

    await expect(run()).rejects.toThrow(
      "This entry is archived in Builder; restore it there before saving.",
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("says so when a draft save lands on an entry Builder just published", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { deps, run } = unpublishedSave({
        readLiveEntry: {
          exists: true,
          published: "draft",
          lastUpdated: BUILDER_LAST_UPDATED_MS,
          blocksHash: null,
          id: "builder-entry-1",
          values: { "data.title": "Old title" },
        },
        writeResult: {
          ok: true,
          status: 200,
          entryId: "builder-entry-1",
          responseBody: { id: "builder-entry-1", published: "published" },
        },
      });

      await expect(run()).resolves.toMatchObject(RESPONSE);
      expect(deps.markExecutionSucceeded).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.stringContaining("this change is live"),
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("records the live values an autosave saved over", () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({
      rows: [publishedRow()],
      changeSets: [approvedChangeSet],
    });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: approvedChangeSet,
      pushModeConfirmation: "autosave",
    });
    expect(plan.payload.effect).toBe("autosave");

    const values = JSON.parse(
      builderCmsReconciledSourceValuesJson({
        existingSourceValuesJson: JSON.stringify({
          published: "published",
          "data.title": "Old title",
          [BUILDER_CMS_ENTRY_NAME_KEY]: "Old title",
        }),
        snapshotSourceValues: undefined,
        changeSet: approvedChangeSet,
        plan: {
          ...plan,
          payload: {
            ...plan.payload,
            livePreflight: {
              checkedAt: NOW,
              exists: true,
              id: "builder-entry-1",
              published: "published",
              lastUpdated: BUILDER_LAST_UPDATED_MS,
              blocksHash: null,
              hasAutosaves: null,
              values: {
                "data.title": "Old title",
                [BUILDER_CMS_ENTRY_NAME_KEY]: "Old title",
              },
            },
          },
        },
      }),
    );

    expect(values["data.title"]).toBe("New title");
    expect(values[BUILDER_CMS_ENTRY_NAME_KEY]).toBe("New title");
    expect(JSON.parse(values[BUILDER_CMS_UNPUBLISHED_CHANGES_KEY])).toEqual({
      liveValues: {
        "data.title": "Old title",
        [BUILDER_CMS_ENTRY_NAME_KEY]: "Old title",
      },
      liveLastUpdated: BUILDER_LAST_UPDATED_MS,
    });
  });

  it("records an empty body save as a body with no blocks", () => {
    const approvedChangeSet = changeSet({
      fieldChanges: [],
      bodyChange: {
        summary: "Builder body blocks changed.",
        currentExcerpt: "Old body",
        proposedExcerpt: "",
        currentHash: "live-hash",
        proposedHash: "empty-hash",
        proposedContent: "",
        proposedBlocksJson: "[]",
        sidecarsJson: "{}",
        warnings: [],
      },
    });
    const builderSource = source({
      rows: [publishedRow()],
      changeSets: [approvedChangeSet],
    });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: approvedChangeSet,
      pushModeConfirmation: "autosave",
    });
    expect(plan.payload.effect).toBe("autosave");

    const values = JSON.parse(
      builderCmsReconciledSourceValuesJson({
        existingSourceValuesJson: JSON.stringify({
          published: "published",
          "data.title": "Old title",
          [BUILDER_CMS_ENTRY_NAME_KEY]: "Old title",
          [BUILDER_CMS_BODY_CONTENT_KEY]: "Old body",
          [BUILDER_CMS_BODY_BLOCKS_HASH_KEY]: "live-hash",
          [BUILDER_CMS_BODY_BLOCK_COUNT_KEY]: 2,
        }),
        snapshotSourceValues: undefined,
        changeSet: approvedChangeSet,
        plan: {
          ...plan,
          payload: {
            ...plan.payload,
            livePreflight: {
              checkedAt: NOW,
              exists: true,
              id: "builder-entry-1",
              published: "published",
              lastUpdated: BUILDER_LAST_UPDATED_MS,
              blocksHash: "live-hash",
              hasAutosaves: null,
              values: { [BUILDER_CMS_ENTRY_NAME_KEY]: "Old title" },
            },
          },
        },
      }),
    );

    expect(values[BUILDER_CMS_BODY_CONTENT_KEY]).toBe("");
    expect(values[BUILDER_CMS_BODY_BLOCKS_HASH_KEY]).toBe("empty-hash");
    expect(values[BUILDER_CMS_BODY_BLOCK_COUNT_KEY]).toBe(0);
    expect(JSON.parse(values[BUILDER_CMS_UNPUBLISHED_CHANGES_KEY])).toEqual(
      expect.objectContaining({ liveBlocksHash: "live-hash" }),
    );
  });

  it("stores the entry's publication state once the write lands", () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [publishedRow()],
      changeSets: [approvedChangeSet],
    });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: approvedChangeSet,
      pushModeConfirmation: "draft",
    });
    const publishedAfter = (args: {
      effect: (typeof plan)["payload"]["effect"];
      existing: string;
      existingLastUpdated?: string;
      livePublished?: string;
      responseBody?: unknown;
    }) =>
      JSON.parse(
        builderCmsReconciledSourceValuesJson({
          existingSourceValuesJson: JSON.stringify({
            published: args.existing,
            ...(args.existingLastUpdated
              ? { lastUpdated: args.existingLastUpdated }
              : {}),
          }),
          snapshotSourceValues: undefined,
          changeSet: approvedChangeSet,
          plan: {
            ...plan,
            payload: {
              ...plan.payload,
              effect: args.effect,
              ...(args.livePublished
                ? {
                    livePreflight: {
                      checkedAt: NOW,
                      exists: true,
                      id: "builder-entry-1",
                      published: args.livePublished,
                      lastUpdated: BUILDER_LAST_UPDATED_MS,
                      blocksHash: null,
                      hasAutosaves: null,
                      values: {},
                    },
                  }
                : {}),
            },
          },
          responseBody: args.responseBody,
        }),
      ).published;

    expect(publishedAfter({ effect: "publish", existing: "draft" })).toBe(
      "published",
    );
    expect(publishedAfter({ effect: "unpublish", existing: "published" })).toBe(
      "draft",
    );
    // A draft save can land on an entry someone published since the refresh.
    expect(
      publishedAfter({
        effect: "save_draft",
        existing: "draft",
        livePublished: "draft",
        responseBody: { published: "published" },
      }),
    ).toBe("published");
    // Builder's reply to an autosave describes the autosave, not the entry.
    expect(
      publishedAfter({
        effect: "autosave",
        existing: "draft",
        livePublished: "published",
        responseBody: { published: "draft" },
      }),
    ).toBe("published");
    expect(publishedAfter({ effect: "save_draft", existing: "draft" })).toBe(
      "draft",
    );
    // A reply without the state takes the live check's, unless a refresh
    // read Builder after the check.
    const readAt = (offsetMs: number) =>
      new Date(BUILDER_LAST_UPDATED_MS + offsetMs).toISOString();
    for (const effect of ["save_draft", "update_in_place"] as const) {
      expect(
        publishedAfter({
          effect,
          existing: "published",
          existingLastUpdated: readAt(-60_000),
          livePublished: "draft",
          responseBody: { id: "builder-entry-1" },
        }),
      ).toBe("draft");
      expect(
        publishedAfter({
          effect,
          existing: "published",
          existingLastUpdated: readAt(60_000),
          livePublished: "draft",
          responseBody: { id: "builder-entry-1" },
        }),
      ).toBe("published");
    }
    expect(
      publishedAfter({
        effect: "autosave",
        existing: "draft",
        existingLastUpdated: readAt(60_000),
        livePublished: "published",
      }),
    ).toBe("draft");
  });

  it("takes a live write's fields out of the record, even from a response stored without live values", () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({
      rows: [publishedRow()],
      changeSets: [approvedChangeSet],
    });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: approvedChangeSet,
      pushModeConfirmation: "draft",
    });
    expect(plan.payload.effect).toBe("update_in_place");

    const values = JSON.parse(
      builderCmsReconciledSourceValuesJson({
        existingSourceValuesJson: JSON.stringify(
          withBuilderCmsUnpublishedChanges(
            { published: "published", "data.title": "Saved title" },
            { liveValues: { "data.title": "Live title" } },
          ),
        ),
        snapshotSourceValues: undefined,
        changeSet: approvedChangeSet,
        plan,
      }),
    );

    expect(values["data.title"]).toBe("New title");
    expect(values).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
  });

  it("reconciles a stored live-write response with the live values it recorded", async () => {
    const approvedChangeSet = changeSet({ pushMode: "draft" });
    const builderSource = source({ changeSets: [approvedChangeSet] });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: approvedChangeSet,
      pushModeConfirmation: "draft",
    });
    const livePreflight = {
      checkedAt: NOW,
      exists: true,
      id: "builder-entry-1",
      published: "published",
      lastUpdated: BUILDER_LAST_UPDATED_MS,
      blocksHash: null,
      hasAutosaves: null,
      values: { "data.title": "Old title" },
    };
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      state: "failed",
      payloadJson: JSON.stringify({
        ...plan.payload,
        livePreflight,
        response: {
          ok: true,
          status: 200,
          entryId: "builder-entry-1",
          body: { id: "builder-entry-1" },
        },
      }),
    });
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "draft",
        },
        deps,
      ),
    ).resolves.toMatchObject(RESPONSE);

    expect(deps.executeWrite).not.toHaveBeenCalled();
    expect(deps.reconcileWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          payload: expect.objectContaining({
            effect: "update_in_place",
            livePreflight,
          }),
        }),
      }),
    );
  });

  it("says a recovered draft save went live when Builder's stored response says so", async () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({
      rows: [
        row({
          sourceValues: { published: "draft", "data.title": "Old title" },
        }),
      ],
      changeSets: [approvedChangeSet],
    });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: approvedChangeSet,
      pushModeConfirmation: "autosave",
    });
    expect(plan.payload.effect).toBe("save_draft");
    const execution = executionFor({
      source: builderSource,
      changeSet: approvedChangeSet,
      state: "failed",
      payloadJson: JSON.stringify({
        ...plan.payload,
        response: {
          ok: true,
          status: 200,
          entryId: "builder-entry-1",
          body: { id: "builder-entry-1", published: "published" },
        },
      }),
    });
    const deps = depsFor({ source: builderSource, execution });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        executeBuilderSourceExecutionWithDeps(
          {
            databaseId: "database-1",
            changeSetId: approvedChangeSet.id,
            pushModeConfirmation: "autosave",
          },
          deps,
        ),
      ).resolves.toMatchObject(RESPONSE);
    } finally {
      warn.mockRestore();
    }

    expect(deps.executeWrite).not.toHaveBeenCalled();
    expect(deps.markExecutionSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining("this change is live"),
      }),
    );
  });

  it("leaves the record alone for a stored response from before live values were kept", () => {
    const approvedChangeSet = changeSet();
    const builderSource = source({
      rows: [publishedRow()],
      changeSets: [approvedChangeSet],
    });
    const plan = buildBuilderCmsExecutionPlan({
      source: builderSource,
      changeSet: approvedChangeSet,
      pushModeConfirmation: "autosave",
    });

    const values = JSON.parse(
      builderCmsReconciledSourceValuesJson({
        existingSourceValuesJson: JSON.stringify({
          published: "published",
          "data.title": "Old title",
        }),
        snapshotSourceValues: undefined,
        changeSet: approvedChangeSet,
        plan,
      }),
    );

    expect(values["data.title"]).toBe("New title");
    expect(values).not.toHaveProperty(BUILDER_CMS_UNPUBLISHED_CHANGES_KEY);
  });
});

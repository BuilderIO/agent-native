import { describe, expect, it, vi } from "vitest";
import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type ContentDatabaseResponse,
  type ContentDatabaseSource,
  type ContentDatabaseSourceChangeSet,
} from "../shared/api";
import {
  buildBuilderCmsExecutionPlan,
  builderCmsExecutionIdempotencyKey,
} from "./_builder-cms-write-adapter";
import type { BuilderCmsWriteResult } from "./_builder-cms-write-client";
import {
  builderCmsReconciledSourceRowPatch,
  executeBuilderSourceExecutionWithDeps,
  type BuilderSourceExecutionRecord,
  type ExecuteBuilderSourceExecutionDeps,
} from "./execute-builder-source-execution";

const NOW = "2026-06-15T12:00:00.000Z";
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
    lastSourceUpdatedAt: "2026-06-08T00:00:00.000Z",
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
}): BuilderSourceExecutionRecord {
  const plan = buildBuilderCmsExecutionPlan({
    source: args.source,
    changeSet: args.changeSet,
    pushModeConfirmation: args.changeSet.pushMode ?? undefined,
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
}): ExecuteBuilderSourceExecutionDeps {
  return {
    now: vi.fn(() => NOW),
    resolveDatabase: vi.fn(async () => DATABASE),
    assertEditor: vi.fn(async () => {}),
    getSourceSnapshot: vi.fn(async () => args.source),
    getExecution: vi.fn(async () => args.execution),
    updateExecutionState: vi.fn(async () => {}),
    claimExecution: vi.fn(async () => args.claimExecution ?? true),
    markExecutionSucceeded: vi.fn(async () => {}),
    markExecutionFailed: vi.fn(async () => {}),
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
    reconcileWrite: vi.fn(async () => {}),
    getResponse: vi.fn(async () => RESPONSE),
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
        state: "write_disabled",
        lastError: "Live Builder writes are disabled for this source.",
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("blocks synthetic fixture rows before any live write", async () => {
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
      "This row is not matched to a Builder entry yet. Refresh or match a Builder row before pushing.",
    );

    expect(deps.updateExecutionState).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        state: "blocked",
        lastError:
          "This row is not matched to a Builder entry yet. Refresh or match a Builder row before pushing.",
        payload: expect.objectContaining({
          target: expect.objectContaining({
            entryId: null,
            sourceQualifiedId: null,
          }),
        }),
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
  });

  it("blocks non-test Builder models before any write", async () => {
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
    ).rejects.toThrow(
      `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
    );

    expect(deps.updateExecutionState).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        state: "blocked",
        lastError: `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
      }),
    );
    expect(deps.executeWrite).not.toHaveBeenCalled();
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
    const deps = depsFor({ source: builderSource, execution });

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          idempotencyKey: plan.idempotencyKey,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).resolves.toBe(RESPONSE);

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
        plan,
        now: NOW,
      }),
    );
    const reconcileCallOrder = vi.mocked(deps.reconcileWrite).mock
      .invocationCallOrder[0];
    const successCallOrder = vi.mocked(deps.markExecutionSucceeded).mock
      .invocationCallOrder[0];
    expect(reconcileCallOrder).toBeLessThan(successCallOrder);
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

  it("does not write when another caller already claimed the execution", async () => {
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

    await expect(
      executeBuilderSourceExecutionWithDeps(
        {
          databaseId: "database-1",
          changeSetId: approvedChangeSet.id,
          pushModeConfirmation: "autosave",
        },
        deps,
      ),
    ).rejects.toThrow("Builder execution is already running.");

    expect(deps.claimExecution).toHaveBeenCalledTimes(1);
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
    ).resolves.toBe(RESPONSE);

    expect(deps.claimExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: execution.id,
        staleBefore: "2026-06-15T11:50:00.000Z",
      }),
    );
    expect(deps.executeWrite).toHaveBeenCalledTimes(1);
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
        summary: "Builder autosave execution reconciliation failed.",
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
    ).resolves.toBe(RESPONSE);

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
    ).resolves.toBe(RESPONSE);

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
});

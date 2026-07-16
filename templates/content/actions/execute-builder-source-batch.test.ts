import { describe, expect, it, vi } from "vitest";

import {
  type ContentDatabaseSource,
  type ContentDatabaseSourceChangeSet,
  type ContentDatabaseSourceExecution,
} from "../shared/api";
import {
  executeBuilderSourceBatchWithDeps,
  type ExecuteBuilderSourceBatchDeps,
} from "./execute-builder-source-batch";

const NOW = "2026-06-24T12:00:00.000Z";

type DatabaseRecord = NonNullable<
  Awaited<ReturnType<ExecuteBuilderSourceBatchDeps["resolveDatabase"]>>
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

function execution(
  overrides: Partial<ContentDatabaseSourceExecution> = {},
): ContentDatabaseSourceExecution {
  return {
    id: "execution-1",
    changeSetId: "change-1",
    adapter: "builder-cms",
    pushMode: "autosave",
    state: "ready",
    idempotencyKey: "builder-cms:source-1:change-1:autosave",
    summary: "Prepared Builder autosave execution.",
    payload: {},
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function changeSet(
  id: string,
  overrides: Partial<ContentDatabaseSourceChangeSet> = {},
): ContentDatabaseSourceChangeSet {
  return {
    id,
    databaseItemId: `item-${id}`,
    documentId: `doc-${id}`,
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function source(
  changeSets: ContentDatabaseSourceChangeSet[],
): ContentDatabaseSource {
  return {
    id: "source-1",
    databaseId: "database-1",
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
      liveWritesEnabled: true,
      readOnlyRefresh: true,
    },
    metadata: {
      primaryKey: "id",
      titleField: "data.title",
      pushMode: "autosave",
    },
    fields: [],
    rows: [],
    changeSets,
  };
}

function depsFor(args: {
  source: ContentDatabaseSource;
  runOne: ExecuteBuilderSourceBatchDeps["runOne"];
}): ExecuteBuilderSourceBatchDeps {
  return {
    resolveDatabase: vi.fn(async () => DATABASE),
    assertEditor: vi.fn(async () => {}),
    getSourceSnapshot: vi.fn(async () => args.source),
    runOne: args.runOne,
  };
}

describe("execute Builder source batch", () => {
  it("returns an all-succeeded summary", async () => {
    const runOne = vi.fn(async (changeSetId: string) => ({
      changeSetId,
      status: "succeeded" as const,
    }));
    const result = await executeBuilderSourceBatchWithDeps(
      { databaseId: "database-1" },
      depsFor({
        source: source([
          changeSet("change-1"),
          changeSet("change-2"),
          changeSet("change-3"),
        ]),
        runOne,
      }),
    );

    expect(result.summary).toEqual({
      total: 3,
      succeeded: 3,
      blocked: 0,
      reconciliationRequired: 0,
      failed: 0,
    });
    expect(result.results.map((item) => item.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(result.timings?.map((timing) => timing.name)).toEqual([
      "snapshot_read_and_diff_load",
      "batch_dispatch",
      "approval_gate_preparation_and_dry_run_validation",
      "write_dispatch",
      "reconciliation_and_persistence",
      "total",
    ]);
    expect(result.timings?.every((timing) => timing.durationMs >= 0)).toBe(
      true,
    );
    expect(runOne).toHaveBeenCalledTimes(3);
  });

  it("continues after blocked and failed items", async () => {
    const runOne = vi.fn(async (changeSetId: string) => {
      if (changeSetId === "change-2") {
        throw new Error("Builder execution is blocked before write.");
      }
      if (changeSetId === "change-3") {
        throw new Error("Network write failed.");
      }
      return { changeSetId, status: "succeeded" as const };
    });
    const result = await executeBuilderSourceBatchWithDeps(
      { databaseId: "database-1" },
      depsFor({
        source: source([
          changeSet("change-1"),
          changeSet("change-2"),
          changeSet("change-3"),
        ]),
        runOne,
      }),
    );

    expect(result.summary).toEqual({
      total: 3,
      succeeded: 1,
      blocked: 1,
      reconciliationRequired: 0,
      failed: 1,
    });
    expect(result.results).toEqual([
      { changeSetId: "change-1", status: "succeeded" },
      {
        changeSetId: "change-2",
        status: "blocked",
        message: "Builder execution is blocked before write.",
      },
      {
        changeSetId: "change-3",
        status: "failed",
        message: "Network write failed.",
      },
    ]);
  });

  it("respects the concurrency cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const runOne = vi.fn(async (changeSetId: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { changeSetId, status: "succeeded" as const };
    });

    await executeBuilderSourceBatchWithDeps(
      { databaseId: "database-1", maxConcurrency: 2 },
      depsFor({
        source: source([
          changeSet("change-1"),
          changeSet("change-2"),
          changeSet("change-3"),
          changeSet("change-4"),
          changeSet("change-5"),
        ]),
        runOne,
      }),
    );

    expect(maxInFlight).toBe(2);
    expect(runOne).toHaveBeenCalledTimes(5);
  });

  it("skips already-succeeded executions", async () => {
    const runOne = vi.fn(async (changeSetId: string) => ({
      changeSetId,
      status: "succeeded" as const,
    }));
    const result = await executeBuilderSourceBatchWithDeps(
      {
        databaseId: "database-1",
        changeSetIds: ["change-1", "change-2"],
      },
      depsFor({
        source: source([
          changeSet("change-1", {
            state: "applied",
            executions: [execution({ state: "succeeded" })],
          }),
          changeSet("change-2"),
        ]),
        runOne,
      }),
    );

    expect(result.summary).toEqual({
      total: 2,
      succeeded: 2,
      blocked: 0,
      reconciliationRequired: 0,
      failed: 0,
    });
    expect(result.results[0]).toEqual({
      changeSetId: "change-1",
      status: "succeeded",
      message: "Builder execution already succeeded; skipped.",
    });
    expect(runOne).toHaveBeenCalledTimes(1);
    expect(runOne).toHaveBeenCalledWith("change-2", undefined);
  });

  it("passes transitions only when explicitly mapped", async () => {
    const runOne = vi.fn(async (changeSetId: string) => ({
      changeSetId,
      status: "succeeded" as const,
    }));
    await executeBuilderSourceBatchWithDeps(
      {
        databaseId: "database-1",
        maxConcurrency: 1,
        transitions: {
          "change-2": { publicationTransition: "publish" },
        },
      },
      depsFor({
        source: source([changeSet("change-1"), changeSet("change-2")]),
        runOne,
      }),
    );

    expect(runOne).toHaveBeenNthCalledWith(1, "change-1", undefined);
    expect(runOne).toHaveBeenNthCalledWith(2, "change-2", {
      publicationTransition: "publish",
    });
  });
});

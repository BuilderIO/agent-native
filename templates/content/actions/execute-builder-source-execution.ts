import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, lt, notInArray, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type ContentDatabaseResponse,
  type ContentDatabaseSource,
  type ContentDatabaseSourceChangeSet,
  type ContentDatabaseSourceExecutionState,
  type ContentDatabaseSourcePushMode,
  type ExecuteBuilderSourceExecutionRequest,
} from "../shared/api.js";
import { builderCmsQualifiedId } from "./_builder-cms-source-adapter.js";
import type {
  BuilderCmsExecutionPayload,
  BuilderCmsExecutionPlan,
} from "./_builder-cms-write-adapter.js";
import {
  buildBuilderCmsExecutionPlan,
  builderCmsExecutionIdempotencyKey,
  validateBuilderCmsExecutionDryRun,
} from "./_builder-cms-write-adapter.js";
import {
  type BuilderCmsWriteResult,
  executeBuilderCmsWrite,
} from "./_builder-cms-write-client.js";
import {
  getContentDatabaseSourceSnapshot,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

type DatabaseRecord = NonNullable<
  Awaited<ReturnType<typeof resolveDatabaseForSourceMutation>>
>;

export interface BuilderSourceExecutionRecord {
  id: string;
  state: ContentDatabaseSourceExecutionState | string;
  idempotencyKey: string;
  payloadJson: string;
  updatedAt: string;
}

export interface ExecuteBuilderSourceExecutionDeps {
  now: () => string;
  resolveDatabase: (
    args: Pick<
      ExecuteBuilderSourceExecutionRequest,
      "databaseId" | "documentId"
    >,
  ) => Promise<DatabaseRecord | null>;
  assertEditor: (database: DatabaseRecord) => Promise<void>;
  getSourceSnapshot: (
    database: DatabaseRecord,
  ) => Promise<ContentDatabaseSource | null>;
  getExecution: (args: {
    sourceId: string;
    changeSetId: string;
    idempotencyKey: string;
  }) => Promise<BuilderSourceExecutionRecord | null>;
  updateExecutionState: (args: {
    executionId: string;
    state: ContentDatabaseSourceExecutionState;
    summary: string;
    payload: unknown;
    lastError: string | null;
    now: string;
  }) => Promise<void>;
  claimExecution: (args: {
    executionId: string;
    summary: string;
    payload: unknown;
    now: string;
    staleBefore: string;
  }) => Promise<boolean>;
  markExecutionSucceeded: (args: {
    executionId: string;
    changeSetId: string;
    summary: string;
    payload: unknown;
    now: string;
  }) => Promise<void>;
  markExecutionFailed: (args: {
    executionId: string;
    summary: string;
    payload: unknown;
    lastError: string;
    now: string;
  }) => Promise<void>;
  executeWrite: (args: {
    request: BuilderCmsExecutionPayload["request"];
  }) => ReturnType<typeof executeBuilderCmsWrite>;
  reconcileWrite: (args: {
    database: DatabaseRecord;
    source: ContentDatabaseSource;
    changeSet: ContentDatabaseSourceChangeSet;
    plan: BuilderCmsExecutionPlan;
    writeResult: BuilderCmsWriteResult;
    now: string;
  }) => Promise<void>;
  getResponse: (databaseId: string) => Promise<ContentDatabaseResponse>;
}

const RUNNING_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;

function parsePayload(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function successfulStoredWriteResult(
  payload: Record<string, unknown>,
): BuilderCmsWriteResult | null {
  const response = recordValue(payload.response);
  if (response?.ok !== true) return null;
  return {
    ok: true,
    status: typeof response.status === "number" ? response.status : 200,
    entryId:
      typeof response.entryId === "string" && response.entryId.trim()
        ? response.entryId.trim()
        : undefined,
    responseBody: Object.prototype.hasOwnProperty.call(response, "body")
      ? response.body
      : null,
    error: typeof response.error === "string" ? response.error : undefined,
  };
}

function reconciliationErrorMessage(error: unknown) {
  const detail =
    error instanceof Error && error.message
      ? error.message
      : "Unknown reconciliation error.";
  return `Builder write succeeded, but local reconciliation failed: ${detail}`;
}

function executablePushMode(
  mode: ContentDatabaseSourcePushMode | null | undefined,
): Exclude<ContentDatabaseSourcePushMode, "none"> | null {
  return mode === "autosave" || mode === "draft" || mode === "publish"
    ? mode
    : null;
}

function staleRunningCutoff(now: string) {
  const timestamp = Date.parse(now);
  return new Date(
    (Number.isFinite(timestamp) ? timestamp : Date.now()) -
      RUNNING_EXECUTION_TIMEOUT_MS,
  ).toISOString();
}

function isReclaimableRunningExecution(
  execution: BuilderSourceExecutionRecord,
  now: string,
) {
  if (execution.state !== "running") return true;
  const updatedAt = Date.parse(execution.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  return updatedAt < Date.parse(staleRunningCutoff(now));
}

function executionResponsePayload(args: {
  payload: BuilderCmsExecutionPayload;
  writeResult: BuilderCmsWriteResult;
}) {
  return {
    ...args.payload,
    response: {
      ok: args.writeResult.ok,
      status: args.writeResult.status,
      entryId: args.writeResult.entryId,
      body: args.writeResult.responseBody,
      error: args.writeResult.error,
    },
  };
}

function proposedSourceDisplayKey(
  changeSet: ContentDatabaseSourceChangeSet,
  fallback: string,
) {
  const titleChange = changeSet.fieldChanges.find(
    (field) => field.localFieldKey === "title",
  );
  return typeof titleChange?.proposedValue === "string" &&
    titleChange.proposedValue.trim()
    ? titleChange.proposedValue.trim()
    : fallback;
}

export function builderCmsReconciledSourceRowPatch(args: {
  source: ContentDatabaseSource;
  changeSet: ContentDatabaseSourceChangeSet;
  plan: BuilderCmsExecutionPlan;
  writeResult: BuilderCmsWriteResult;
  now: string;
}) {
  const currentRow =
    args.source.rows.find(
      (row) =>
        row.documentId === args.changeSet.documentId ||
        row.databaseItemId === args.changeSet.databaseItemId,
    ) ?? null;
  const entryId =
    args.writeResult.entryId ?? args.plan.payload.target.entryId ?? null;
  if (!entryId) return null;

  return {
    sourceRowId: entryId,
    sourceQualifiedId: builderCmsQualifiedId({
      sourceTable: args.source.sourceTable,
      entryId,
    }),
    sourceDisplayKey: proposedSourceDisplayKey(
      args.changeSet,
      currentRow?.sourceDisplayKey ?? entryId,
    ),
    provenance: "Builder CMS write adapter",
    syncState: "idle",
    freshness: "fresh",
    lastSyncedAt: args.now,
    lastSourceUpdatedAt: args.now,
    updatedAt: args.now,
  };
}

async function reconcileBuilderCmsWrite(args: {
  database: DatabaseRecord;
  source: ContentDatabaseSource;
  changeSet: ContentDatabaseSourceChangeSet;
  plan: BuilderCmsExecutionPlan;
  writeResult: BuilderCmsWriteResult;
  now: string;
}) {
  const patch = builderCmsReconciledSourceRowPatch(args);
  if (!patch) {
    throw new Error(
      "Builder write succeeded, but no Builder entry ID was returned.",
    );
  }

  const db = getDb();
  const existingRow =
    args.changeSet.documentId || args.changeSet.databaseItemId
      ? await db
          .select()
          .from(schema.contentDatabaseSourceRows)
          .where(
            and(
              eq(schema.contentDatabaseSourceRows.sourceId, args.source.id),
              args.changeSet.documentId
                ? eq(
                    schema.contentDatabaseSourceRows.documentId,
                    args.changeSet.documentId,
                  )
                : eq(
                    schema.contentDatabaseSourceRows.databaseItemId,
                    args.changeSet.databaseItemId as string,
                  ),
            ),
          )
          .limit(1)
      : [];

  const [row] = existingRow;
  if (row) {
    await db
      .update(schema.contentDatabaseSourceRows)
      .set(patch)
      .where(eq(schema.contentDatabaseSourceRows.id, row.id));
  } else if (args.changeSet.documentId && args.changeSet.databaseItemId) {
    await db.insert(schema.contentDatabaseSourceRows).values({
      id: crypto.randomUUID(),
      ownerEmail: args.database.ownerEmail,
      sourceId: args.source.id,
      databaseItemId: args.changeSet.databaseItemId,
      documentId: args.changeSet.documentId,
      createdAt: args.now,
      ...patch,
    });
  } else {
    throw new Error(
      "Builder write succeeded, but the local source row was missing.",
    );
  }

  await db
    .update(schema.contentDatabaseSourceFields)
    .set({
      freshness: "fresh",
      lastSyncedAt: args.now,
      updatedAt: args.now,
    })
    .where(eq(schema.contentDatabaseSourceFields.sourceId, args.source.id));
  await db
    .update(schema.contentDatabaseSources)
    .set({
      syncState: "idle",
      freshness: "fresh",
      lastRefreshedAt: args.now,
      lastSourceUpdatedAt: args.now,
      lastError: null,
      updatedAt: args.now,
    })
    .where(eq(schema.contentDatabaseSources.id, args.source.id));
}

function realExecutionDeps(): ExecuteBuilderSourceExecutionDeps {
  return {
    now: () => new Date().toISOString(),
    resolveDatabase: (args) => resolveDatabaseForSourceMutation(args),
    assertEditor: async (database) => {
      await assertAccess("document", database.documentId, "editor");
    },
    getSourceSnapshot: (database) => getContentDatabaseSourceSnapshot(database),
    getExecution: async (args) => {
      const [execution] = await getDb()
        .select()
        .from(schema.contentDatabaseSourceExecutions)
        .where(
          and(
            eq(schema.contentDatabaseSourceExecutions.sourceId, args.sourceId),
            eq(
              schema.contentDatabaseSourceExecutions.changeSetId,
              args.changeSetId,
            ),
            eq(
              schema.contentDatabaseSourceExecutions.idempotencyKey,
              args.idempotencyKey,
            ),
          ),
        );
      return execution ?? null;
    },
    updateExecutionState: async (args) => {
      await getDb()
        .update(schema.contentDatabaseSourceExecutions)
        .set({
          state: args.state,
          summary: args.summary,
          payloadJson: JSON.stringify(args.payload),
          lastError: args.lastError,
          updatedAt: args.now,
        })
        .where(eq(schema.contentDatabaseSourceExecutions.id, args.executionId));
    },
    claimExecution: async (args) => {
      const result = await getDb()
        .update(schema.contentDatabaseSourceExecutions)
        .set({
          state: "running",
          summary: args.summary,
          payloadJson: JSON.stringify(args.payload),
          lastError: null,
          updatedAt: args.now,
        })
        .where(
          and(
            eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
            or(
              notInArray(schema.contentDatabaseSourceExecutions.state, [
                "running",
                "succeeded",
              ]),
              and(
                eq(schema.contentDatabaseSourceExecutions.state, "running"),
                lt(
                  schema.contentDatabaseSourceExecutions.updatedAt,
                  args.staleBefore,
                ),
              ),
            ),
          ),
        );
      const changes =
        (result as { rowsAffected?: number; changes?: number }).rowsAffected ??
        (result as { rowsAffected?: number; changes?: number }).changes ??
        0;
      return changes > 0;
    },
    markExecutionSucceeded: async (args) => {
      const db = getDb();
      await db
        .update(schema.contentDatabaseSourceExecutions)
        .set({
          state: "succeeded",
          summary: args.summary,
          payloadJson: JSON.stringify(args.payload),
          lastError: null,
          updatedAt: args.now,
        })
        .where(eq(schema.contentDatabaseSourceExecutions.id, args.executionId));
      await db
        .update(schema.contentDatabaseSourceChangeSets)
        .set({ state: "applied", updatedAt: args.now })
        .where(eq(schema.contentDatabaseSourceChangeSets.id, args.changeSetId));
    },
    markExecutionFailed: async (args) => {
      await getDb()
        .update(schema.contentDatabaseSourceExecutions)
        .set({
          state: "failed",
          summary: args.summary,
          payloadJson: JSON.stringify(args.payload),
          lastError: args.lastError,
          updatedAt: args.now,
        })
        .where(eq(schema.contentDatabaseSourceExecutions.id, args.executionId));
    },
    executeWrite: (args) => executeBuilderCmsWrite(args),
    reconcileWrite: reconcileBuilderCmsWrite,
    getResponse: (databaseId) => getContentDatabaseResponse(databaseId),
  };
}

export async function executeBuilderSourceExecutionWithDeps(
  args: ExecuteBuilderSourceExecutionRequest,
  deps: ExecuteBuilderSourceExecutionDeps,
) {
  const database = await deps.resolveDatabase(args);
  if (!database) throw new Error("Database not found.");
  await deps.assertEditor(database);

  const source = await deps.getSourceSnapshot(database);
  if (!source || source.sourceType !== "builder-cms") {
    throw new Error("Attach a Builder CMS source before executing a write.");
  }

  const changeSet = source.changeSets.find(
    (candidate) => candidate.id === args.changeSetId,
  );
  if (!changeSet) throw new Error("Source change-set not found.");
  if (changeSet.direction !== "outbound") {
    throw new Error("Only outbound Builder change sets can be executed.");
  }

  const pushMode = executablePushMode(
    args.pushModeConfirmation ?? changeSet.pushMode ?? source.metadata.pushMode,
  );
  if (!pushMode) {
    throw new Error(
      "Builder execution requires Autosave, Draft, or Publish push mode.",
    );
  }
  const expectedKey = builderCmsExecutionIdempotencyKey({
    sourceId: source.id,
    changeSetId: changeSet.id,
    pushMode,
  });
  if (args.idempotencyKey && args.idempotencyKey !== expectedKey) {
    throw new Error(
      "Execution idempotency key does not match this write plan.",
    );
  }

  const execution = await deps.getExecution({
    sourceId: source.id,
    changeSetId: changeSet.id,
    idempotencyKey: expectedKey,
  });
  if (!execution) {
    throw new Error("Prepare the Builder execution gate before executing it.");
  }
  const now = deps.now();
  if (execution.state === "succeeded") {
    return deps.getResponse(database.id);
  }
  if (!isReclaimableRunningExecution(execution, now)) {
    throw new Error("Builder execution is already running.");
  }

  if (changeSet.state !== "approved") {
    throw new Error("Approve the Builder change set before executing it.");
  }

  const plan = buildBuilderCmsExecutionPlan({
    source,
    changeSet,
    pushModeConfirmation: pushMode,
  });
  const storedPayload = parsePayload(execution.payloadJson);
  const validatedPayload = validateBuilderCmsExecutionDryRun({
    storedPayload,
    plan,
    now,
  });
  const dryRun = validatedPayload.dryRun;
  if (dryRun?.status !== "validated") {
    const message =
      dryRun?.status === "stale" && dryRun.mismatches.length > 0
        ? dryRun.mismatches.join(" ")
        : (plan.lastError ?? "Builder execution is blocked.");
    await deps.updateExecutionState({
      executionId: execution.id,
      state: "blocked",
      summary: `${plan.summary} Execution blocked before write.`,
      payload: validatedPayload,
      lastError: message,
      now,
    });
    throw new Error(message);
  }
  if (plan.state !== "ready") {
    const message = plan.lastError ?? "Builder execution is not ready.";
    await deps.updateExecutionState({
      executionId: execution.id,
      state: plan.state,
      summary: plan.summary,
      payload: validatedPayload,
      lastError: message,
      now,
    });
    throw new Error(message);
  }

  if (
    source.capabilities.liveWritesEnabled !== true ||
    source.sourceTable !== BUILDER_CMS_SAFE_WRITE_MODEL
  ) {
    const message =
      source.capabilities.liveWritesEnabled === true
        ? `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`
        : "Live Builder writes are disabled for this source.";
    await deps.updateExecutionState({
      executionId: execution.id,
      state:
        source.capabilities.liveWritesEnabled === true
          ? "blocked"
          : "write_disabled",
      summary: `${plan.summary} Execution blocked before write.`,
      payload: validatedPayload,
      lastError: message,
      now,
    });
    throw new Error(message);
  }

  const storedWriteResult = successfulStoredWriteResult(storedPayload);
  if (storedWriteResult) {
    const payloadWithResponse = executionResponsePayload({
      payload: validatedPayload,
      writeResult: storedWriteResult,
    });
    const reconciledAt = deps.now();
    try {
      await deps.reconcileWrite({
        database,
        source,
        changeSet,
        plan,
        writeResult: storedWriteResult,
        now: reconciledAt,
      });
    } catch (error) {
      const lastError = reconciliationErrorMessage(error);
      await deps.markExecutionFailed({
        executionId: execution.id,
        summary: `Builder ${plan.pushMode} execution reconciliation failed.`,
        payload: payloadWithResponse,
        lastError,
        now: deps.now(),
      });
      throw new Error(lastError);
    }
    await deps.markExecutionSucceeded({
      executionId: execution.id,
      changeSetId: changeSet.id,
      summary: `Builder ${plan.pushMode} execution succeeded.`,
      payload: payloadWithResponse,
      now: reconciledAt,
    });
    return deps.getResponse(database.id);
  }

  const claimed = await deps.claimExecution({
    executionId: execution.id,
    summary: `Running Builder ${plan.pushMode} execution.`,
    payload: validatedPayload,
    now,
    staleBefore: staleRunningCutoff(now),
  });
  if (!claimed) {
    throw new Error("Builder execution is already running.");
  }

  const writeResult = await deps.executeWrite({
    request: plan.payload.request,
  });
  const payloadWithResponse = executionResponsePayload({
    payload: validatedPayload,
    writeResult,
  });

  if (!writeResult.ok) {
    const lastError =
      writeResult.error ??
      `Builder write request failed with HTTP ${writeResult.status}.`;
    await deps.markExecutionFailed({
      executionId: execution.id,
      summary: `Builder ${plan.pushMode} execution failed.`,
      payload: payloadWithResponse,
      lastError,
      now: deps.now(),
    });
    throw new Error(lastError);
  }

  const succeededAt = deps.now();
  try {
    await deps.reconcileWrite({
      database,
      source,
      changeSet,
      plan,
      writeResult,
      now: succeededAt,
    });
  } catch (error) {
    const lastError = reconciliationErrorMessage(error);
    await deps.markExecutionFailed({
      executionId: execution.id,
      summary: `Builder ${plan.pushMode} execution reconciliation failed.`,
      payload: payloadWithResponse,
      lastError,
      now: deps.now(),
    });
    throw new Error(lastError);
  }
  await deps.markExecutionSucceeded({
    executionId: execution.id,
    changeSetId: changeSet.id,
    summary: `Builder ${plan.pushMode} execution succeeded.`,
    payload: payloadWithResponse,
    now: succeededAt,
  });

  return deps.getResponse(database.id);
}

export default defineAction({
  description:
    "Execute a prepared Builder CMS write gate. This performs a real Builder write only when the approved outbound change-set, push mode, source capability, safe test model, and idempotency gates all pass.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    changeSetId: z.string().describe("Approved source change-set ID"),
    idempotencyKey: z
      .string()
      .optional()
      .describe("Optional execution idempotency key that must match the plan"),
    pushModeConfirmation: z
      .enum(["autosave", "draft", "publish"])
      .optional()
      .describe("Explicit push mode confirmation for the live write"),
  }),
  run: async (
    args: ExecuteBuilderSourceExecutionRequest,
  ): Promise<ContentDatabaseResponse> => {
    return executeBuilderSourceExecutionWithDeps(args, realExecutionDeps());
  },
});

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
  type DocumentPropertyValue,
  type ExecuteBuilderSourceExecutionRequest,
} from "../shared/api.js";
import {
  lookupBuilderCmsSafeModelIntent,
  type BuilderCmsIntentMatch,
} from "./_builder-cms-intent-lookup.js";
import {
  type BuilderCmsEntryLiveState,
  readBuilderCmsEntryLiveState,
} from "./_builder-cms-read-client.js";
import {
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_SIDECARS_KEY,
  builderCmsQualifiedId,
} from "./_builder-cms-source-adapter.js";
import type {
  BuilderCmsExecutionPayload,
  BuilderCmsExecutionPlan,
} from "./_builder-cms-write-adapter.js";
import {
  buildBuilderCmsExecutionPlan,
  builderCmsExecutionIdempotencyKey,
  resolveBuilderCmsExecutionPushMode,
  validateBuilderCmsExecutionDryRun,
  BUILDER_CMS_EXECUTION_MARKER_FIELD,
} from "./_builder-cms-write-adapter.js";
import {
  type BuilderCmsWriteResult,
  executeBuilderCmsWrite,
} from "./_builder-cms-write-client.js";
import { createBuilderSourceTiming } from "./_builder-source-timings.js";
import {
  getContentDatabaseSourceSnapshotForWrite,
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
  attemptToken?: string | null;
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
    ownerEmail: string;
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
    attemptToken: string;
  }) => Promise<boolean>;
  checkpointResponse?: (args: {
    executionId: string;
    attemptToken: string;
    payload: unknown;
    now: string;
  }) => Promise<boolean>;
  markExecutionSucceeded: (args: {
    executionId: string;
    changeSetId: string;
    summary: string;
    payload: unknown;
    now: string;
    attemptToken?: string;
  }) => Promise<void>;
  markExecutionFailed: (args: {
    executionId: string;
    summary: string;
    payload: unknown;
    lastError: string;
    now: string;
    attemptToken?: string;
    state?: "failed" | "reconciliation_required";
  }) => Promise<void>;
  executeWrite: (args: {
    request: BuilderCmsExecutionPayload["request"];
  }) => ReturnType<typeof executeBuilderCmsWrite>;
  readLiveEntry: (args: {
    model: string;
    entryId: string;
  }) => Promise<BuilderCmsEntryLiveState>;
  reconcileWrite: (args: {
    database: DatabaseRecord;
    source: ContentDatabaseSource;
    changeSet: ContentDatabaseSourceChangeSet;
    plan: BuilderCmsExecutionPlan;
    writeResult: BuilderCmsWriteResult;
    now: string;
  }) => Promise<void>;
  getResponse: (databaseId: string) => Promise<ContentDatabaseResponse>;
  lookupSafeModelIntent?: (args: {
    marker?: string;
    exactTitle?: string;
    intendedFields?: Record<string, unknown>;
  }) => Promise<{
    count: number;
    matchingIntentCount?: number;
    matches: BuilderCmsIntentMatch[];
  }>;
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

export function builderExecutionAffectedRows(result: unknown) {
  return (
    (
      result as {
        rowsAffected?: number;
        changes?: number;
        rowCount?: number | null;
      }
    ).rowsAffected ??
    (result as { changes?: number }).changes ??
    (result as { rowCount?: number | null }).rowCount ??
    0
  );
}

export function builderExecutionConflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function isReclaimableRunningExecution(
  execution: BuilderSourceExecutionRecord,
  now: string,
) {
  if (
    execution.state !== "running" &&
    execution.state !== "reconciliation_required"
  )
    return true;
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

function createDraftIntent(request: BuilderCmsExecutionPayload["request"]) {
  if (request.method !== "POST") return null;
  const body = recordValue(request.body);
  const data = recordValue(body?.data);
  if (!data) return null;
  const marker =
    typeof data[BUILDER_CMS_EXECUTION_MARKER_FIELD] === "string"
      ? data[BUILDER_CMS_EXECUTION_MARKER_FIELD]
      : undefined;
  const exactTitle = typeof data.title === "string" ? data.title : undefined;
  const intendedFields = Object.fromEntries(
    Object.entries(data).filter(
      ([key]) => key !== BUILDER_CMS_EXECUTION_MARKER_FIELD,
    ),
  );
  return { marker, exactTitle, intendedFields };
}

function recoveredWriteResult(
  match: BuilderCmsIntentMatch,
): BuilderCmsWriteResult {
  return {
    ok: true,
    status: 200,
    entryId: match.id,
    responseBody: {
      id: match.id,
      lastUpdated: match.lastUpdated,
      published: match.published,
      recoveredByReadOnlyLookup: true,
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

function builderCmsResponseRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function builderCmsResponseValue(
  value: unknown,
  keys: string[],
): number | string | null {
  const record = builderCmsResponseRecord(value);
  if (!record) return null;
  for (const key of keys) {
    const direct = record[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  }
  for (const key of ["entry", "result", "content", "data"]) {
    const nested = builderCmsResponseValue(record[key], keys);
    if (nested !== null) return nested;
  }
  return null;
}

function builderCmsAuthoritativeLastUpdated(
  writeResult: BuilderCmsWriteResult,
  fallback: string,
) {
  return String(
    builderCmsResponseValue(writeResult.responseBody, [
      "lastUpdated",
      "lastUpdatedAt",
      "updatedAt",
      "last_source_updated_at",
    ]) ?? fallback,
  );
}

function parseSourceValues(
  value: string | null | undefined,
): Record<string, DocumentPropertyValue> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, DocumentPropertyValue>)
      : {};
  } catch {
    return {};
  }
}

export function builderCmsReconciledSourceValuesJson(args: {
  existingSourceValuesJson: string | null | undefined;
  snapshotSourceValues: Record<string, DocumentPropertyValue> | undefined;
  changeSet: ContentDatabaseSourceChangeSet;
  plan: BuilderCmsExecutionPlan;
}) {
  const next = {
    ...(args.snapshotSourceValues ?? {}),
    ...parseSourceValues(args.existingSourceValuesJson),
  };
  for (const field of args.changeSet.fieldChanges) {
    next[field.sourceFieldKey] = field.proposedValue;
  }
  const bodyChange = args.changeSet.bodyChange;
  if (bodyChange) {
    if (bodyChange.proposedHash !== undefined) {
      next[BUILDER_CMS_BODY_BLOCKS_HASH_KEY] = bodyChange.proposedHash;
    }
    if (bodyChange.proposedContent !== undefined) {
      next[BUILDER_CMS_BODY_CONTENT_KEY] = bodyChange.proposedContent;
    }
    if (bodyChange.sidecarsJson !== undefined) {
      next[BUILDER_CMS_BODY_SIDECARS_KEY] = bodyChange.sidecarsJson;
    }
  }
  const requestData = args.plan.payload.request.body.data;
  if (
    requestData &&
    typeof requestData === "object" &&
    !Array.isArray(requestData)
  ) {
    for (const [fieldName, value] of Object.entries(requestData)) {
      // Builder blocks remain in body/blob storage. The compact body hash above
      // is the durable proof used by later required-field validation.
      if (fieldName === "blocks") continue;
      const sourceFieldKey = `data.${fieldName}`;
      next[sourceFieldKey] = value as DocumentPropertyValue;
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>)["@type"] ===
          "@builder.io/core:Reference" &&
        typeof (value as Record<string, unknown>).id === "string"
      ) {
        next[`__agent_native_builder_reference_id:${sourceFieldKey}`] = (
          value as Record<string, unknown>
        ).id as string;
      }
    }
  }
  return JSON.stringify(next);
}

function sourceRowForChangeSet(
  source: ContentDatabaseSource,
  changeSet: ContentDatabaseSourceChangeSet,
) {
  return (
    source.rows.find(
      (row) =>
        row.documentId === changeSet.documentId ||
        row.databaseItemId === changeSet.databaseItemId,
    ) ?? null
  );
}

function requiresLivePreflight(effect: BuilderCmsExecutionPayload["effect"]) {
  return (
    effect === "autosave" ||
    effect === "update_in_place" ||
    effect === "publish" ||
    effect === "unpublish"
  );
}

function normalizedLiveTimestamp(value: number | string | null | undefined) {
  return value === null || value === undefined ? null : String(value);
}

function toEpochMs(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function liveTimestampsDiffer(args: {
  liveLastUpdated: number | string | null | undefined;
  baselineLastUpdated: string | null | undefined;
}) {
  const liveEpoch = toEpochMs(args.liveLastUpdated);
  const baselineEpoch = toEpochMs(args.baselineLastUpdated);
  if (liveEpoch !== null && baselineEpoch !== null) {
    return liveEpoch !== baselineEpoch;
  }
  return (
    normalizedLiveTimestamp(args.liveLastUpdated) !==
    normalizedLiveTimestamp(args.baselineLastUpdated)
  );
}

function livePreflightBlockMessage(args: {
  liveState: BuilderCmsEntryLiveState;
  baselineLastUpdated: string | null;
  baselineBlocksHash: string | null;
  effect: BuilderCmsExecutionPayload["effect"];
}) {
  if (!args.liveState.exists) {
    return "Builder entry no longer exists; refresh the source.";
  }
  if (
    liveTimestampsDiffer({
      liveLastUpdated: args.liveState.lastUpdated,
      baselineLastUpdated: args.baselineLastUpdated,
    })
  ) {
    return "Builder entry changed since this diff was approved; refresh and re-review.";
  }
  if (
    args.baselineBlocksHash &&
    args.liveState.blocksHash &&
    args.baselineBlocksHash !== args.liveState.blocksHash
  ) {
    return "Builder body changed since this diff was approved; refresh and re-review.";
  }
  if (args.effect === "publish" && args.liveState.published !== "draft") {
    return "Entry is already published.";
  }
  if (args.effect === "unpublish" && args.liveState.published !== "published") {
    return "Entry is not currently published.";
  }
  return null;
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
  const sourceUpdatedAt = builderCmsAuthoritativeLastUpdated(
    args.writeResult,
    args.now,
  );

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
    lastSourceUpdatedAt: sourceUpdatedAt,
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
  const snapshotRow = sourceRowForChangeSet(args.source, args.changeSet);
  const sourceValuesJson = builderCmsReconciledSourceValuesJson({
    existingSourceValuesJson: row?.sourceValuesJson,
    snapshotSourceValues: snapshotRow?.sourceValues,
    changeSet: args.changeSet,
    plan: args.plan,
  });
  const patchWithValues = {
    ...patch,
    sourceValuesJson,
  };
  if (row) {
    await db
      .update(schema.contentDatabaseSourceRows)
      .set(patchWithValues)
      .where(eq(schema.contentDatabaseSourceRows.id, row.id));
  } else if (args.changeSet.documentId && args.changeSet.databaseItemId) {
    await db.insert(schema.contentDatabaseSourceRows).values({
      id: crypto.randomUUID(),
      ownerEmail: args.database.ownerEmail,
      sourceId: args.source.id,
      databaseItemId: args.changeSet.databaseItemId,
      documentId: args.changeSet.documentId,
      createdAt: args.now,
      ...patchWithValues,
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
      lastSourceUpdatedAt: patch.lastSourceUpdatedAt,
      lastError: null,
      updatedAt: args.now,
    })
    .where(eq(schema.contentDatabaseSources.id, args.source.id));
}

export function realExecutionDeps(
  sourceId?: string,
): ExecuteBuilderSourceExecutionDeps {
  return {
    now: () => new Date().toISOString(),
    resolveDatabase: (args) => resolveDatabaseForSourceMutation(args),
    assertEditor: async (database) => {
      await assertAccess("document", database.documentId, "editor");
    },
    getSourceSnapshot: (database) =>
      getContentDatabaseSourceSnapshotForWrite(database, sourceId),
    getExecution: async (args) => {
      const [claim] = await getDb()
        .select({
          executionId: schema.contentDatabaseSourceExecutionClaims.executionId,
        })
        .from(schema.contentDatabaseSourceExecutionClaims)
        .where(
          and(
            eq(
              schema.contentDatabaseSourceExecutionClaims.ownerEmail,
              args.ownerEmail,
            ),
            eq(
              schema.contentDatabaseSourceExecutionClaims.sourceId,
              args.sourceId,
            ),
            eq(
              schema.contentDatabaseSourceExecutionClaims.idempotencyKey,
              args.idempotencyKey,
            ),
          ),
        )
        .limit(1);
      if (!claim) return null;
      const [execution] = await getDb()
        .select()
        .from(schema.contentDatabaseSourceExecutions)
        .where(
          and(
            eq(schema.contentDatabaseSourceExecutions.id, claim.executionId),
            eq(
              schema.contentDatabaseSourceExecutions.ownerEmail,
              args.ownerEmail,
            ),
          ),
        )
        .limit(1);
      if (
        execution?.sourceId !== args.sourceId ||
        execution?.changeSetId !== args.changeSetId ||
        execution?.idempotencyKey !== args.idempotencyKey
      ) {
        return null;
      }
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
          attemptToken: args.attemptToken,
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
      return builderExecutionAffectedRows(result) > 0;
    },
    checkpointResponse: async (args) => {
      const result = await getDb()
        .update(schema.contentDatabaseSourceExecutions)
        .set({
          state: "response_received",
          summary: "Builder response received; reconciling locally.",
          payloadJson: JSON.stringify(args.payload),
          lastError: null,
          updatedAt: args.now,
        })
        .where(
          and(
            eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
            eq(
              schema.contentDatabaseSourceExecutions.attemptToken,
              args.attemptToken,
            ),
          ),
        );
      return builderExecutionAffectedRows(result) > 0;
    },
    markExecutionSucceeded: async (args) => {
      const db = getDb();
      await db.transaction(async (tx) => {
        const result = await tx
          .update(schema.contentDatabaseSourceExecutions)
          .set({
            state: "succeeded",
            summary: args.summary,
            payloadJson: JSON.stringify(args.payload),
            lastError: null,
            updatedAt: args.now,
          })
          .where(
            args.attemptToken
              ? and(
                  eq(
                    schema.contentDatabaseSourceExecutions.id,
                    args.executionId,
                  ),
                  eq(
                    schema.contentDatabaseSourceExecutions.attemptToken,
                    args.attemptToken,
                  ),
                )
              : eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
          );
        if (args.attemptToken && builderExecutionAffectedRows(result) === 0) {
          throw new Error("Execution lease was reclaimed before completion.");
        }
        await tx
          .update(schema.contentDatabaseSourceChangeSets)
          .set({ state: "applied", updatedAt: args.now })
          .where(
            eq(schema.contentDatabaseSourceChangeSets.id, args.changeSetId),
          );
      });
    },
    markExecutionFailed: async (args) => {
      await getDb()
        .update(schema.contentDatabaseSourceExecutions)
        .set({
          state: args.state ?? "failed",
          summary: args.summary,
          payloadJson: JSON.stringify(args.payload),
          lastError: args.lastError,
          updatedAt: args.now,
        })
        .where(
          args.attemptToken
            ? and(
                eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
                eq(
                  schema.contentDatabaseSourceExecutions.attemptToken,
                  args.attemptToken,
                ),
              )
            : eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
        );
    },
    executeWrite: (args) => executeBuilderCmsWrite(args),
    readLiveEntry: (args) => readBuilderCmsEntryLiveState(args),
    reconcileWrite: reconcileBuilderCmsWrite,
    getResponse: (databaseId) => getContentDatabaseResponse(databaseId),
    lookupSafeModelIntent: lookupBuilderCmsSafeModelIntent,
  };
}

export async function executeBuilderSourceExecutionWithDeps(
  args: ExecuteBuilderSourceExecutionRequest,
  deps: ExecuteBuilderSourceExecutionDeps,
) {
  const timing = createBuilderSourceTiming("execute_builder_source_execution");
  try {
    const { database, source } = await timing.measure(
      "snapshot_read_and_diff_load",
      async () => {
        const database = await deps.resolveDatabase(args);
        if (!database) throw new Error("Database not found.");
        await deps.assertEditor(database);
        const source = await deps.getSourceSnapshot(database);
        return { database, source };
      },
    );
    if (!source || source.sourceType !== "builder-cms") {
      throw new Error("Attach a Builder CMS source before executing a write.");
    }
    if (source.sourceTable !== BUILDER_CMS_SAFE_WRITE_MODEL) {
      throw new Error(
        `Live Builder writes are only allowed for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
      );
    }

    const gateStartedAt = timing.start();
    const changeSet = source.changeSets.find(
      (candidate) => candidate.id === args.changeSetId,
    );
    if (!changeSet) throw new Error("Source change-set not found.");
    if (changeSet.direction !== "outbound") {
      throw new Error("Only outbound Builder change sets can be executed.");
    }

    const resolvedPushMode = resolveBuilderCmsExecutionPushMode({
      source,
      changeSet,
    });
    const effectivePushMode =
      resolvedPushMode === "none" ? "autosave" : resolvedPushMode;
    const pushMode = executablePushMode(
      args.pushModeConfirmation ?? effectivePushMode,
    );
    if (!pushMode) {
      throw new Error(
        "Builder execution requires Autosave, Draft, or Publish push mode.",
      );
    }
    // The gate key is keyed on the RAW resolved push mode (matching the plan in
    // buildBuilderCmsExecutionPlan) — NOT on pushModeConfirmation. Keying on the
    // confirmation would let a caller's confirmation diverge the key from the
    // prepared gate; the confirmation is still validated inside the plan below.
    const expectedKey = builderCmsExecutionIdempotencyKey({
      sourceId: source.id,
      changeSetId: changeSet.id,
      pushMode: resolvedPushMode,
    });
    if (args.idempotencyKey && args.idempotencyKey !== expectedKey) {
      throw new Error(
        "Execution idempotency key does not match this write plan.",
      );
    }

    const execution = await deps.getExecution({
      ownerEmail: database.ownerEmail,
      sourceId: source.id,
      changeSetId: changeSet.id,
      idempotencyKey: expectedKey,
    });
    if (!execution) {
      throw new Error(
        "Prepare the Builder execution gate before executing it.",
      );
    }
    const now = deps.now();
    if (execution.state === "succeeded") {
      timing.record("approval_gate_and_dry_run_validation", gateStartedAt);
      timing.ensure("write_dispatch");
      const response = await timing.measure(
        "reconciliation_and_persistence",
        () => deps.getResponse(database.id),
      );
      const result = { ...response, timings: timing.finish() };
      timing.log("succeeded");
      return result;
    }
    const initialStoredPayload = parsePayload(execution.payloadJson);
    const hasSuccessfulResponse = Boolean(
      successfulStoredWriteResult(initialStoredPayload),
    );
    if (
      !hasSuccessfulResponse &&
      !isReclaimableRunningExecution(execution, now)
    ) {
      throw builderExecutionConflict(
        execution.state === "reconciliation_required"
          ? "Builder reconciliation required; wait for the recovery window before a read-only lookup. Do not retry."
          : "Builder execution is already running.",
      );
    }

    if (changeSet.state !== "approved") {
      throw new Error("Approve the Builder change set before executing it.");
    }

    const plan = buildBuilderCmsExecutionPlan({
      source,
      changeSet,
      pushModeConfirmation: pushMode,
      publicationTransition: args.publicationTransition,
      confirmUnpublish: args.confirmUnpublish,
    });
    const storedPayload = initialStoredPayload;
    const storedRequest = recordValue(storedPayload.request) as
      | BuilderCmsExecutionPayload["request"]
      | null;
    const storedIntent = storedRequest
      ? createDraftIntent(storedRequest)
      : null;
    const planIntent = createDraftIntent(plan.payload.request);
    const legacyPreMarkerCreate = Boolean(
      planIntent?.marker && storedIntent && !storedIntent.marker,
    );
    const validationStoredPayload = legacyPreMarkerCreate
      ? {
          ...storedPayload,
          request: plan.payload.request,
        }
      : storedPayload;
    const validatedPayload = validateBuilderCmsExecutionDryRun({
      storedPayload: validationStoredPayload,
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

    if (source.capabilities.liveWritesEnabled !== true) {
      const message = "Live Builder writes are disabled for this source.";
      await deps.updateExecutionState({
        executionId: execution.id,
        state: "write_disabled",
        summary: `${plan.summary} Execution blocked before write.`,
        payload: validatedPayload,
        lastError: message,
        now,
      });
      throw new Error(message);
    }

    let storedWriteResult = successfulStoredWriteResult(storedPayload);
    if (!storedWriteResult && planIntent && deps.lookupSafeModelIntent) {
      const lookup = await deps.lookupSafeModelIntent(
        legacyPreMarkerCreate
          ? {
              exactTitle: storedIntent?.exactTitle,
              intendedFields: storedIntent?.intendedFields,
            }
          : {
              marker: planIntent.marker,
              intendedFields: planIntent.intendedFields,
            },
      );
      const matchingIntentCount = lookup.matchingIntentCount ?? lookup.count;
      if (lookup.count > 1) {
        const lastError =
          "Builder reconciliation required: more than one remote draft matches this execution intent.";
        await deps.markExecutionFailed({
          executionId: execution.id,
          state: "reconciliation_required",
          summary: "Builder execution requires reconciliation.",
          payload: validatedPayload,
          lastError,
          now: deps.now(),
        });
        throw builderExecutionConflict(lastError);
      }
      if (lookup.count === 1 && matchingIntentCount !== 1) {
        const lastError = legacyPreMarkerCreate
          ? "Builder reconciliation required: an exact-title legacy candidate exists, but its intended fields do not match. Do not retry."
          : "Builder reconciliation required: the remote draft marker exists, but its intended fields drifted. Do not retry.";
        await deps.markExecutionFailed({
          executionId: execution.id,
          state: "reconciliation_required",
          summary: "Builder execution requires reconciliation.",
          payload: validatedPayload,
          lastError,
          now: deps.now(),
        });
        throw builderExecutionConflict(lastError);
      }
      if (lookup.count === 1) {
        storedWriteResult = recoveredWriteResult(lookup.matches[0]!);
      }
    }
    if (storedWriteResult) {
      timing.record("approval_gate_and_dry_run_validation", gateStartedAt);
      timing.ensure("write_dispatch");
      const reconciliationStartedAt = timing.start();
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
        timing.record(
          "reconciliation_and_persistence",
          reconciliationStartedAt,
        );
        const lastError = reconciliationErrorMessage(error);
        await deps.markExecutionFailed({
          executionId: execution.id,
          state: "reconciliation_required",
          summary: `Builder ${plan.pushMode} execution requires reconciliation.`,
          payload: payloadWithResponse,
          lastError,
          now: deps.now(),
        });
        throw builderExecutionConflict(lastError);
      }
      await deps.markExecutionSucceeded({
        executionId: execution.id,
        changeSetId: changeSet.id,
        summary: `Builder ${plan.pushMode} execution succeeded.`,
        payload: payloadWithResponse,
        now: reconciledAt,
      });
      const response = await deps.getResponse(database.id);
      timing.record("reconciliation_and_persistence", reconciliationStartedAt);
      const result = { ...response, timings: timing.finish() };
      timing.log("succeeded");
      return result;
    }

    if (requiresLivePreflight(plan.payload.effect)) {
      const entryId = plan.payload.target.entryId;
      if (!entryId) {
        const message = "Builder entry no longer exists; refresh the source.";
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

      const liveState = await deps.readLiveEntry({
        model: plan.payload.target.model,
        entryId,
      });
      const targetRow = sourceRowForChangeSet(source, changeSet);
      console.info("builder_source_live_preflight", {
        executionId: execution.id,
        changeSetId: changeSet.id,
        targetEntryId: entryId,
        baselineLastUpdated: targetRow?.lastSourceUpdatedAt ?? null,
        liveLastUpdated: liveState.lastUpdated,
        baselineBlocksHash: changeSet.bodyChange?.currentHash ?? null,
        liveBlocksHash: liveState.blocksHash,
        livePublished: liveState.published,
      });
      const message = livePreflightBlockMessage({
        liveState,
        baselineLastUpdated: targetRow?.lastSourceUpdatedAt ?? null,
        baselineBlocksHash: changeSet.bodyChange?.currentHash ?? null,
        effect: plan.payload.effect,
      });
      if (message) {
        await deps.updateExecutionState({
          executionId: execution.id,
          state: "blocked",
          summary: `${plan.summary} Execution blocked before write.`,
          payload: {
            ...validatedPayload,
            livePreflight: {
              checkedAt: now,
              exists: liveState.exists,
              published: liveState.published,
              lastUpdated: liveState.lastUpdated,
              blocksHash: liveState.blocksHash,
              id: liveState.id,
            },
          },
          lastError: message,
          now,
        });
        throw new Error(message);
      }
    }

    const attemptToken = crypto.randomUUID();
    const claimed = await deps.claimExecution({
      executionId: execution.id,
      summary: `Running Builder ${plan.pushMode} execution.`,
      payload: validatedPayload,
      now,
      staleBefore: staleRunningCutoff(now),
      attemptToken,
    });
    if (!claimed) {
      throw builderExecutionConflict("Builder execution is already running.");
    }
    timing.record("approval_gate_and_dry_run_validation", gateStartedAt);

    const writeResult = await timing.measure("write_dispatch", () =>
      deps.executeWrite({ request: plan.payload.request }),
    );
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
        state: writeResult.ambiguity ? "reconciliation_required" : "failed",
        summary: writeResult.ambiguity
          ? `Builder ${plan.pushMode} execution requires reconciliation.`
          : `Builder ${plan.pushMode} execution failed.`,
        payload: payloadWithResponse,
        lastError,
        now: deps.now(),
        attemptToken,
      });
      throw writeResult.ambiguity
        ? builderExecutionConflict(lastError)
        : new Error(lastError);
    }

    const reconciliationStartedAt = timing.start();
    if (deps.checkpointResponse) {
      const checkpointed = await deps.checkpointResponse({
        executionId: execution.id,
        attemptToken,
        payload: payloadWithResponse,
        now: deps.now(),
      });
      if (!checkpointed) {
        throw new Error(
          "Execution lease was reclaimed before response checkpoint.",
        );
      }
    } else {
      await deps.updateExecutionState({
        executionId: execution.id,
        state: "response_received",
        summary: "Builder response received; reconciling locally.",
        payload: payloadWithResponse,
        lastError: null,
        now: deps.now(),
      });
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
      timing.record("reconciliation_and_persistence", reconciliationStartedAt);
      const lastError = reconciliationErrorMessage(error);
      await deps.markExecutionFailed({
        executionId: execution.id,
        state: "reconciliation_required",
        summary: `Builder ${plan.pushMode} execution requires reconciliation.`,
        payload: payloadWithResponse,
        lastError,
        now: deps.now(),
        attemptToken,
      });
      throw builderExecutionConflict(lastError);
    }
    await deps.markExecutionSucceeded({
      executionId: execution.id,
      changeSetId: changeSet.id,
      summary: `Builder ${plan.pushMode} execution succeeded.`,
      payload: payloadWithResponse,
      now: succeededAt,
      attemptToken,
    });

    const response = await deps.getResponse(database.id);
    timing.record("reconciliation_and_persistence", reconciliationStartedAt);
    const result = { ...response, timings: timing.finish() };
    timing.log("succeeded");
    return result;
  } catch (error) {
    timing.ensure("approval_gate_and_dry_run_validation");
    timing.ensure("write_dispatch");
    timing.ensure("reconciliation_and_persistence");
    timing.log("failed");
    throw error;
  }
}

export default defineAction({
  description:
    "Execute a prepared Builder CMS write gate. This performs a real Builder write only when the approved outbound change-set, push mode, per-source capability, validation, publication, and idempotency gates all pass.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Target source ID (defaults to the primary source)"),
    changeSetId: z.string().describe("Approved source change-set ID"),
    idempotencyKey: z
      .string()
      .optional()
      .describe("Optional execution idempotency key that must match the plan"),
    pushModeConfirmation: z
      .enum(["autosave", "draft", "publish"])
      .optional()
      .describe("Explicit push mode confirmation for the live write"),
    publicationTransition: z
      .enum(["publish", "unpublish"])
      .optional()
      .describe("Explicit publication transition to validate at write time"),
    confirmUnpublish: z
      .boolean()
      .optional()
      .describe("Required explicit confirmation for unpublish transitions"),
  }),
  run: async (
    args: ExecuteBuilderSourceExecutionRequest,
  ): Promise<ContentDatabaseResponse> => {
    return executeBuilderSourceExecutionWithDeps(
      args,
      realExecutionDeps(args.sourceId),
    );
  },
});

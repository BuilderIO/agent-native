import {
  defineAction,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import {
  and,
  eq,
  exists,
  gte,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  BUILDER_CMS_SAFE_WRITE_MODEL,
  type ContentDatabaseResponse,
  type ContentDatabaseResponsePayload,
  type ContentDatabaseSource,
  type ContentDatabaseSourceChangeSet,
  type ContentDatabaseSourceExecutionState,
  type ContentDatabaseSourcePushMode,
  type DocumentPropertyValue,
  type ExecuteBuilderSourceExecutionRequest,
} from "../shared/api.js";
import {
  builderExecutionPayloadReference,
  cleanupBuilderPrivatePayload,
  enqueueBuilderPrivatePayloadCleanup,
  readBuilderExecutionPayload,
  storeBuilderExecutionPayload,
} from "./_builder-cms-blob-custody.js";
import {
  builderExecutionStaleBefore,
  isBuilderExecutionClaimStale,
} from "./_builder-cms-execution-lease.js";
import {
  lookupBuilderCmsSafeModelIntent,
  type BuilderCmsIntentMatch,
} from "./_builder-cms-intent-lookup.js";
import {
  type BuilderCmsEntryLiveState,
  readBuilderCmsEntryLiveState,
} from "./_builder-cms-read-client.js";
import {
  BUILDER_CMS_BODY_BLOCK_COUNT_KEY,
  BUILDER_CMS_BODY_BLOCKS_HASH_KEY,
  BUILDER_CMS_BODY_CONTENT_KEY,
  BUILDER_CMS_BODY_SIDECARS_KEY,
  BUILDER_CMS_ENTRY_NAME_KEY,
  builderCmsQualifiedId,
  builderCmsReferenceIdKey,
} from "./_builder-cms-source-adapter.js";
import {
  builderCmsEditConflictKey,
  builderCmsSourceFieldMatches,
  builderCmsUnpublishedChangesAfterWrite,
  readBuilderCmsEditConflicts,
  readBuilderCmsPublicationIntent,
  readBuilderCmsUnpublishedChanges,
  withBuilderCmsEditConflicts,
  withBuilderCmsPublicationIntent,
  withBuilderCmsUnpublishedChanges,
} from "./_builder-cms-unpublished-changes.js";
import type {
  BuilderCmsExecutionPayload,
  BuilderCmsExecutionPlan,
  BuilderCmsLivePreflight,
} from "./_builder-cms-write-adapter.js";
import {
  buildBuilderCmsExecutionPlan,
  builderCmsExecutionIdempotencyKey,
  builderCmsPayloadForLivePublication,
  builderCmsWrittenSourceFields,
  isBuilderCmsUnpublishedSaveEffect,
  resolveBuilderCmsExecutionPushMode,
  validateBuilderCmsExecutionDryRun,
  BUILDER_CMS_EXECUTION_MARKER_FIELD,
} from "./_builder-cms-write-adapter.js";
import {
  type BuilderCmsWriteResult,
  executeBuilderCmsWrite,
} from "./_builder-cms-write-client.js";
import { createBuilderSourceTiming } from "./_builder-source-timings.js";
import { writeBuilderStatusValues } from "./_builder-status-property.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";
import {
  getContentDatabaseSourceSnapshotForWrite,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import {
  contentDatabaseResponseForCaller,
  getContentDatabaseResponse,
} from "./_database-utils.js";

type DatabaseRecord = NonNullable<
  Awaited<ReturnType<typeof resolveDatabaseForSourceMutation>>
>;

export interface BuilderSourceExecutionRecord {
  id: string;
  state: ContentDatabaseSourceExecutionState | (string & {});
  idempotencyKey: string;
  payloadJson: string;
  lastError?: string | null;
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
  assertPageEditor: (documentId: string) => Promise<void>;
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
    expected: Pick<
      BuilderSourceExecutionRecord,
      "state" | "updatedAt" | "attemptToken"
    >;
    state: ContentDatabaseSourceExecutionState;
    summary: string;
    payload: unknown;
    lastError: string | null;
    now: string;
  }) => Promise<void>;
  claimExecution: (args: {
    executionId: string;
    changeSetId: string;
    /** The row the gate validated; any later write voids the claim. */
    expected: Pick<
      BuilderSourceExecutionRecord,
      "state" | "updatedAt" | "attemptToken"
    >;
    summary: string;
    payload: unknown;
    now: string;
    staleBefore: string;
    attemptToken: string;
    /**
     * The existing entry this execution overwrites. Its claim is refused while
     * another source's push to the same entry holds a live claim.
     */
    builderEntry?: { model: string; entryId: string } | null;
  }) => Promise<boolean>;
  renewExecutionClaim: (args: {
    executionId: string;
    attemptToken: string;
    now: string;
  }) => Promise<boolean>;
  checkpointResponse?: (args: {
    executionId: string;
    attemptToken: string;
    payload: unknown;
    now: string;
  }) => Promise<boolean>;
  markResponseCheckpointFailed: (args: {
    executionId: string;
    attemptToken: string;
    lastError: string;
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
  releaseExecutionClaim: (args: {
    executionId: string;
    attemptToken: string;
    restore: Pick<
      BuilderSourceExecutionRecord,
      "state" | "attemptToken" | "updatedAt"
    >;
    summary: string;
    payload: unknown;
    lastError: string;
    now: string;
  }) => Promise<void>;
  executeWrite: (args: {
    request: BuilderCmsExecutionPayload["request"];
    expectedSourceSpace?: string | null;
    expectedSourceConnectionId?: string | null;
    requireSourceBinding?: boolean;
  }) => ReturnType<typeof executeBuilderCmsWrite>;
  readLiveEntry: (args: {
    model: string;
    entryId: string;
    fieldPaths: readonly string[];
    expectedSourceSpace?: string | null;
    expectedSourceConnectionId?: string | null;
  }) => Promise<BuilderCmsEntryLiveState>;
  reconcileWrite: (args: {
    database: DatabaseRecord;
    source: ContentDatabaseSource;
    changeSet: ContentDatabaseSourceChangeSet;
    plan: BuilderCmsExecutionPlan;
    writeResult: BuilderCmsWriteResult;
    now: string;
  }) => Promise<void>;
  getResponse: (
    databaseId: string,
    changeSet: ContentDatabaseSourceChangeSet,
  ) => Promise<ContentDatabaseResponse>;
  lookupSafeModelIntent?: (args: {
    marker?: string;
    exactTitle?: string;
    intendedFields?: Record<string, unknown>;
    expectedSourceSpace?: string | null;
    expectedSourceConnectionId?: string | null;
  }) => Promise<{
    count: number;
    matchingIntentCount?: number;
    matches: BuilderCmsIntentMatch[];
  }>;
}

const BUILDER_LIVE_PREFLIGHT_TIMEOUT_MS = 60 * 1000;
const BUILDER_RESPONSE_CHECKPOINT_FAILURE =
  "Builder accepted the write, but its response could not be saved for reconciliation. Do not retry this execution; inspect the live Builder entry before preparing another write.";

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
  return builderExecutionStaleBefore(now);
}

export function builderExecutionAffectedRows(result: unknown) {
  if (!result || typeof result !== "object") return 0;
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

// Collections are separate sources, so the database lock a claim takes does not
// keep two collections bound to the same Builder model apart. The live preflight
// only protects a push if no other Content push to the entry can land between
// its read and its write, so a push holds the entry from claim to write.
async function builderEntryHasOtherLiveClaim(
  tx: ReturnType<typeof getDb>,
  args: {
    model: string;
    entryId: string;
    executionId: string;
    staleBefore: string;
  },
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`content-builder-entry-write:${args.model}:${args.entryId}`}, 0::bigint))`,
  );
  const executions = schema.contentDatabaseSourceExecutions;
  const changeSets = schema.contentDatabaseSourceChangeSets;
  const rows = schema.contentDatabaseSourceRows;
  const sources = schema.contentDatabaseSources;
  const claims = await tx
    .select({ id: executions.id })
    .from(sources)
    .innerJoin(rows, eq(rows.sourceId, sources.id))
    .innerJoin(
      changeSets,
      and(
        eq(changeSets.sourceId, sources.id),
        eq(changeSets.databaseItemId, rows.databaseItemId),
      ),
    )
    .innerJoin(executions, eq(executions.changeSetId, changeSets.id))
    .where(
      and(
        eq(sources.sourceType, "builder-cms"),
        eq(sources.sourceTable, args.model),
        eq(rows.sourceRowId, args.entryId),
        eq(executions.sourceId, sources.id),
        ne(executions.id, args.executionId),
        eq(executions.state, "running"),
        gte(executions.updatedAt, args.staleBefore),
      ),
    )
    .limit(1);
  return claims.length > 0;
}

function isReclaimableRunningExecution(
  execution: BuilderSourceExecutionRecord,
  now: string,
) {
  if (
    execution.state === "reconciliation_required" &&
    execution.lastError === BUILDER_RESPONSE_CHECKPOINT_FAILURE
  ) {
    return false;
  }
  if (
    execution.state !== "running" &&
    execution.state !== "reconciliation_required"
  )
    return true;
  return isBuilderExecutionClaimStale(execution.updatedAt, now);
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

/**
 * The entry's publication state once the write landed. Builder's reply wins
 * for a draft save, which can land on an entry published since the check; its
 * reply to an autosave describes the autosave, not the entry. Without a reply,
 * the write left the state as the live check found it, unless the stored row
 * was read from Builder after the check. Null keeps the stored state.
 */
function builderCmsPublishedAfterWrite(args: {
  effect: BuilderCmsExecutionPayload["effect"];
  livePreflight: BuilderCmsExecutionPayload["livePreflight"];
  storedLastUpdated: DocumentPropertyValue | undefined;
  responseBody: unknown;
}) {
  if (args.effect === "publish") return "published";
  if (args.effect === "unpublish" || args.effect === "create_draft") {
    return "draft";
  }
  if (args.effect !== "autosave") {
    const replied = builderCmsResponseValue(args.responseBody, ["published"]);
    if (typeof replied === "string") return replied;
  }
  const storedEpoch = toEpochMs(
    typeof args.storedLastUpdated === "string" ||
      typeof args.storedLastUpdated === "number"
      ? args.storedLastUpdated
      : null,
  );
  const checkedEpoch = toEpochMs(args.livePreflight?.lastUpdated);
  if (
    storedEpoch !== null &&
    checkedEpoch !== null &&
    storedEpoch > checkedEpoch
  ) {
    return null;
  }
  return args.livePreflight?.published ?? null;
}

export function builderCmsReconciledSourceValuesJson(args: {
  existingSourceValuesJson: string | null | undefined;
  snapshotSourceValues: Record<string, DocumentPropertyValue> | undefined;
  changeSet: ContentDatabaseSourceChangeSet;
  plan: BuilderCmsExecutionPlan;
  responseBody?: unknown;
}) {
  const existing = {
    ...(args.snapshotSourceValues ?? {}),
    ...parseSourceValues(args.existingSourceValuesJson),
  };
  const effect = args.plan.payload.effect;
  // A push settles the staged change it sent, and the one it started with
  // when it sent the other transition instead. One staged while it was in
  // flight, or left out of its review, still waits for a push.
  const staged = readBuilderCmsPublicationIntent(existing);
  const settledIntent =
    staged.state === "staged" &&
    (staged.transition === effect ||
      ((effect === "publish" || effect === "unpublish") &&
        staged.transition === args.changeSet.stagedPublicationTransition))
      ? withBuilderCmsPublicationIntent(existing, null)
      : { ...existing };
  // It settles the edit conflicts it pushed over too: the review showed
  // them, and the push overwrote Builder's change.
  const pushedKeys = args.changeSet.fieldChanges.map(builderCmsEditConflictKey);
  if (args.changeSet.bodyChange) pushedKeys.push(BUILDER_CMS_BODY_CONTENT_KEY);
  const next =
    readBuilderCmsEditConflicts(existing).state === "recorded"
      ? withBuilderCmsEditConflicts(settledIntent, {
          ownedKeys: pushedKeys,
          conflictedKeys: [],
        })
      : settledIntent;
  const published = builderCmsPublishedAfterWrite({
    effect: args.plan.payload.effect,
    livePreflight: args.plan.payload.livePreflight,
    storedLastUpdated: existing.lastUpdated,
    responseBody: args.responseBody,
  });
  if (published) next.published = published;
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
  const requestBody = args.plan.payload.request.body;
  if (typeof requestBody.name === "string") {
    next[BUILDER_CMS_ENTRY_NAME_KEY] = requestBody.name;
  }
  const requestData = requestBody.data;
  if (
    requestData &&
    typeof requestData === "object" &&
    !Array.isArray(requestData)
  ) {
    const requestBlocks = (requestData as Record<string, unknown>).blocks;
    if (Array.isArray(requestBlocks)) {
      next[BUILDER_CMS_BODY_BLOCK_COUNT_KEY] = requestBlocks.length;
    }
    for (const [fieldName, value] of Object.entries(requestData)) {
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
        next[builderCmsReferenceIdKey(sourceFieldKey)] = (
          value as Record<string, unknown>
        ).id as string;
      }
    }
  }
  const livePreflight = args.plan.payload.livePreflight;
  // An autosave response stored before live reads were recorded carries no
  // live values, so it leaves the unpublished-changes record as it was.
  if (!livePreflight && args.plan.payload.effect === "autosave") {
    return JSON.stringify(next);
  }
  const written = builderCmsWrittenSourceFields(args.plan.payload.request);
  return JSON.stringify(
    withBuilderCmsUnpublishedChanges(
      next,
      builderCmsUnpublishedChangesAfterWrite({
        existing,
        effect: args.plan.payload.effect,
        writtenFieldKeys: written.fieldKeys,
        wroteBody: written.wroteBody,
        live: {
          values: livePreflight?.values ?? null,
          blocksHash: livePreflight?.blocksHash ?? null,
          bodyEmpty: livePreflight?.bodyEmpty === true,
          lastUpdated: livePreflight?.lastUpdated ?? null,
        },
      }),
    ),
  );
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
    isBuilderCmsUnpublishedSaveEffect(effect) ||
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
  baselineValues: Record<string, DocumentPropertyValue> | undefined;
  effect: BuilderCmsExecutionPayload["effect"];
  request: BuilderCmsExecutionPayload["request"];
  fieldLabel: (sourceFieldKey: string) => string;
}) {
  if (!args.liveState.exists) {
    return "Builder entry no longer exists; refresh the source.";
  }
  // Two missing timestamps compare equal, so an absent value must block
  // rather than read as "unchanged".
  if (!args.baselineLastUpdated?.trim()) {
    return "This change has no reviewed Builder update time; refresh and re-review.";
  }
  if (toEpochMs(args.liveState.lastUpdated) === null) {
    return "Builder did not report when this entry last changed; refresh and re-review.";
  }
  // An autosave records the live values it saves over, so it cannot run
  // without them.
  if (
    isBuilderCmsUnpublishedSaveEffect(args.effect) &&
    !args.liveState.values
  ) {
    return "Builder did not return this entry's current values; refresh and re-review.";
  }
  const unpublished = readBuilderCmsUnpublishedChanges(args.baselineValues);
  const savedOver =
    unpublished.state === "pending" ? unpublished.changes : null;
  // A Builder value Content saved unpublished changes over is still the one
  // this edit was made against.
  const fieldStillReviewed = (
    key: string,
    liveValues: Record<string, DocumentPropertyValue>,
  ) =>
    builderCmsSourceFieldMatches({
      key,
      values: liveValues,
      expected: args.baselineValues,
    }) ||
    (!!savedOver &&
      (Object.prototype.hasOwnProperty.call(savedOver.liveValues, key) ||
        Object.prototype.hasOwnProperty.call(
          savedOver.liveValues,
          builderCmsReferenceIdKey(key),
        )) &&
      builderCmsSourceFieldMatches({
        key,
        values: liveValues,
        expected: savedOver.liveValues,
      }));
  if (
    liveTimestampsDiffer({
      liveLastUpdated: args.liveState.lastUpdated,
      baselineLastUpdated: args.baselineLastUpdated,
    })
  ) {
    // A save sends only the fields it changes, so an edit elsewhere in the
    // entry is no conflict. Publication changes still need a fresh review.
    const fieldLevel =
      isBuilderCmsUnpublishedSaveEffect(args.effect) ||
      args.effect === "update_in_place";
    const liveValues = args.liveState.values;
    const written = builderCmsWrittenSourceFields(args.request);
    // The body check below skips a missing hash, which is only safe while
    // the timestamps still vouch for the body.
    const bodyUnverifiable =
      written.wroteBody &&
      (!args.baselineBlocksHash || !args.liveState.blocksHash);
    if (!fieldLevel || !liveValues || bodyUnverifiable) {
      return "Builder entry changed since this diff was approved; refresh and re-review.";
    }
    const changedFields = written.fieldKeys.filter(
      (key) => !fieldStillReviewed(key, liveValues),
    );
    if (changedFields.length > 0) {
      return `${changedFields.map(args.fieldLabel).join(", ")} changed in Builder since you edited it; refresh and re-review.`;
    }
  }
  if (
    args.baselineBlocksHash &&
    args.liveState.blocksHash &&
    args.liveState.blocksHash !== args.baselineBlocksHash &&
    args.liveState.blocksHash !== savedOver?.liveBlocksHash
  ) {
    return "Builder body changed since this diff was approved; refresh and re-review.";
  }
  // An update in place lands in whatever state the entry is in now, so a
  // publish or unpublish in Builder would change what was approved.
  if (args.effect === "update_in_place") {
    const reviewedPublished = args.baselineValues?.published;
    if (typeof reviewedPublished !== "string") {
      return "This change has no reviewed Builder publication state; refresh and re-review.";
    }
    if (args.liveState.published !== reviewedPublished) {
      return "Builder publication state changed since this diff was approved; refresh and re-review.";
    }
  }
  if (
    isBuilderCmsUnpublishedSaveEffect(args.effect) &&
    args.liveState.published === "archived"
  ) {
    return "This entry is archived in Builder; restore it there before saving.";
  }
  if (
    (args.effect === "publish" ||
      isBuilderCmsUnpublishedSaveEffect(args.effect)) &&
    args.liveState.published !== "draft" &&
    args.liveState.published !== "published"
  ) {
    return "Builder publication state could not be verified; refresh and re-review.";
  }
  if (args.effect === "unpublish" && args.liveState.published !== "published") {
    return "Entry is not currently published.";
  }
  // An autosave in Builder's editor can leave the entry's update time alone,
  // so the timestamp check above doesn't catch one made after the review.
  // Content's own unpublished save doesn't account for it either.
  if (args.effect === "publish" && args.liveState.hasAutosaves === true) {
    return "This entry has unpublished changes saved in Builder's editor, which Content can't see. Publish it from Builder.";
  }
  return null;
}

function builderCmsLivePreflightRecord(args: {
  liveState: BuilderCmsEntryLiveState;
  request: BuilderCmsExecutionPayload["request"];
  checkedAt: string;
}): BuilderCmsLivePreflight {
  const liveValues = args.liveState.values;
  return {
    checkedAt: args.checkedAt,
    exists: args.liveState.exists,
    id: args.liveState.id,
    published: args.liveState.published,
    lastUpdated: args.liveState.lastUpdated,
    blocksHash: args.liveState.blocksHash,
    bodyEmpty: liveValues?.[BUILDER_CMS_BODY_BLOCK_COUNT_KEY] === 0,
    hasAutosaves: args.liveState.hasAutosaves ?? null,
    values: liveValues
      ? Object.fromEntries(
          builderCmsWrittenSourceFields(args.request).fieldKeys.flatMap(
            (key) => {
              const referenceKey = builderCmsReferenceIdKey(key);
              return [
                [
                  key,
                  Object.prototype.hasOwnProperty.call(liveValues, key)
                    ? liveValues[key]
                    : null,
                ],
                ...(Object.prototype.hasOwnProperty.call(
                  liveValues,
                  referenceKey,
                )
                  ? [[referenceKey, liveValues[referenceKey]]]
                  : []),
              ];
            },
          ),
        )
      : null,
  };
}

/**
 * A draft save sends no published field, so an entry published after the
 * live check takes the change live; the summary says so rather than "saved".
 */
function builderExecutionSucceededSummary(args: {
  pushMode: string;
  effect: BuilderCmsExecutionPayload["effect"];
  writeResult: BuilderCmsWriteResult;
  executionId: string;
  changeSetId: string;
}) {
  const draftSaveWentLive =
    args.effect === "save_draft" &&
    builderCmsResponseValue(args.writeResult.responseBody, ["published"]) ===
      "published";
  if (!draftSaveWentLive)
    return `Builder ${args.pushMode} execution succeeded.`;
  console.warn("builder_source_draft_save_went_live", {
    executionId: args.executionId,
    changeSetId: args.changeSetId,
  });
  return `Builder ${args.pushMode} execution succeeded. Builder published this entry while Content was saving, so this change is live.`;
}

function builderSourceFieldLabel(source: ContentDatabaseSource) {
  return (sourceFieldKey: string) => {
    if (sourceFieldKey === BUILDER_CMS_ENTRY_NAME_KEY) return "Entry name";
    const name = sourceFieldKey.replace(/^data\./, "");
    return (
      source.metadata.builderModelFields
        ?.find((field) => field.name.trim() === name)
        ?.label?.trim() ||
      source.fields
        .find((field) => field.sourceFieldKey === sourceFieldKey)
        ?.sourceFieldLabel.trim() ||
      name
    );
  };
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
  await db.transaction(async (tx) => {
    if (args.changeSet.databaseItemId) {
      await lockDatabaseMemberships(tx, [args.changeSet.databaseItemId]);
    }
    const existingRow =
      args.changeSet.documentId || args.changeSet.databaseItemId
        ? await tx
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

    const [row = null] = existingRow;
    const snapshotRow = sourceRowForChangeSet(args.source, args.changeSet);
    const sourceValuesJson = builderCmsReconciledSourceValuesJson({
      existingSourceValuesJson: row?.sourceValuesJson,
      snapshotSourceValues: snapshotRow?.sourceValues,
      changeSet: args.changeSet,
      plan: args.plan,
      responseBody: args.writeResult.responseBody,
    });
    const patchWithValues = {
      ...patch,
      sourceValuesJson,
    };
    if (row) {
      await tx
        .update(schema.contentDatabaseSourceRows)
        .set(patchWithValues)
        .where(eq(schema.contentDatabaseSourceRows.id, row.id));
    } else if (args.changeSet.documentId && args.changeSet.databaseItemId) {
      await tx.insert(schema.contentDatabaseSourceRows).values({
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
    await writeBuilderStatusValues(tx, {
      sourceId: args.source.id,
      rows: [
        {
          documentId: row?.documentId ?? args.changeSet.documentId,
          sourceValues: parseSourceValues(sourceValuesJson),
        },
      ],
      now: args.now,
    });

    await tx
      .update(schema.contentDatabaseSourceFields)
      .set({
        freshness: "fresh",
        lastSyncedAt: args.now,
        updatedAt: args.now,
      })
      .where(eq(schema.contentDatabaseSourceFields.sourceId, args.source.id));
    await tx
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
  });
}

export function realExecutionDeps(
  sourceId?: string,
  changeSetId?: string,
): ExecuteBuilderSourceExecutionDeps {
  const storedPayloadJson = async (executionId: string, payload: unknown) => {
    const [execution] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceExecutions)
      .where(eq(schema.contentDatabaseSourceExecutions.id, executionId))
      .limit(1);
    if (!execution)
      fail("Builder execution disappeared.", {
        errorCode: "builder_execution_changed",
        statusCode: 409,
      });
    const payloadJson = await storeBuilderExecutionPayload({
      payload,
      binding: {
        ownerEmail: execution.ownerEmail,
        sourceId: execution.sourceId,
        changeSetId: execution.changeSetId,
        executionId: execution.id,
        idempotencyKey: execution.idempotencyKey,
      },
    });
    return {
      payloadJson,
      previousPayloadJson: execution.payloadJson,
      previousState: execution.state,
      previousAttemptToken: execution.attemptToken,
      previousReference: builderExecutionPayloadReference(
        execution.payloadJson,
      ),
      nextReference: builderExecutionPayloadReference(payloadJson),
    };
  };
  const previousAttemptFilter = (prepared: {
    previousAttemptToken: string | null;
  }) =>
    prepared.previousAttemptToken
      ? eq(
          schema.contentDatabaseSourceExecutions.attemptToken,
          prepared.previousAttemptToken,
        )
      : isNull(schema.contentDatabaseSourceExecutions.attemptToken);
  const discardUncommittedPayload = async (prepared: {
    nextReference: string | null;
  }) => {
    if (prepared.nextReference) {
      await cleanupBuilderPrivatePayload(
        prepared.nextReference,
        "uncommitted execution payload",
      );
    }
  };
  const updateStoredPayload = async (
    prepared: Awaited<ReturnType<typeof storedPayloadJson>>,
    update: (tx: ReturnType<typeof getDb>) => PromiseLike<unknown>,
  ) =>
    getDb().transaction(async (tx) => {
      const transactionDb = tx as unknown as ReturnType<typeof getDb>;
      const result = await update(transactionDb);
      if (
        builderExecutionAffectedRows(result) > 0 &&
        prepared.previousReference &&
        prepared.previousReference !== prepared.nextReference
      ) {
        await enqueueBuilderPrivatePayloadCleanup(
          transactionDb,
          prepared.previousReference,
        );
      }
      return result;
    });
  const resolveAmbiguousPayloadWrite = async (
    executionId: string,
    prepared: {
      payloadJson: string;
      previousReference: string | null;
      nextReference: string | null;
    },
  ) => {
    try {
      const [current] = await getDb()
        .select({
          payloadJson: schema.contentDatabaseSourceExecutions.payloadJson,
        })
        .from(schema.contentDatabaseSourceExecutions)
        .where(eq(schema.contentDatabaseSourceExecutions.id, executionId))
        .limit(1);
      if (current?.payloadJson === prepared.payloadJson) {
        return "committed" as const;
      }
      if (current) {
        await discardUncommittedPayload(prepared);
        return "orphan" as const;
      }
    } catch {
      // coercion-ok: an unavailable readback is explicitly the unknown outcome.
      // Inconclusive readback retains both refs for a later SQL-truth reload.
    }
    return "unknown" as const;
  };
  return {
    now: () => new Date().toISOString(),
    resolveDatabase: (args) => resolveDatabaseForSourceMutation(args),
    assertEditor: async (database) => {
      await assertAccess("document", database.documentId, "editor");
    },
    assertPageEditor: async (documentId) => {
      await assertAccess("document", documentId, "editor");
    },
    getSourceSnapshot: async (database) => {
      const [target] = changeSetId
        ? await getDb()
            .select({
              documentId: schema.contentDatabaseSourceChangeSets.documentId,
              sourceId: schema.contentDatabaseSourceChangeSets.sourceId,
            })
            .from(schema.contentDatabaseSourceChangeSets)
            .where(
              sourceId
                ? and(
                    eq(schema.contentDatabaseSourceChangeSets.id, changeSetId),
                    eq(
                      schema.contentDatabaseSourceChangeSets.sourceId,
                      sourceId,
                    ),
                  )
                : eq(schema.contentDatabaseSourceChangeSets.id, changeSetId),
            )
            .limit(1)
        : [];
      return getContentDatabaseSourceSnapshotForWrite(
        database,
        sourceId ?? target?.sourceId,
        target?.documentId ? [target.documentId] : undefined,
      );
    },
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
      if (!execution) return null;
      const payload = await readBuilderExecutionPayload({
        payloadJson: execution.payloadJson,
        binding: {
          ownerEmail: execution.ownerEmail,
          sourceId: execution.sourceId,
          changeSetId: execution.changeSetId,
          executionId: execution.id,
          idempotencyKey: execution.idempotencyKey,
        },
      });
      return { ...execution, payloadJson: JSON.stringify(payload) };
    },
    updateExecutionState: async (args) => {
      const prepared = await storedPayloadJson(args.executionId, args.payload);
      let result;
      try {
        result = await updateStoredPayload(prepared, (tx) =>
          tx
            .update(schema.contentDatabaseSourceExecutions)
            .set({
              state: args.state,
              summary: args.summary,
              payloadJson: prepared.payloadJson,
              lastError: args.lastError,
              updatedAt: args.now,
            })
            .where(
              and(
                eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
                eq(
                  schema.contentDatabaseSourceExecutions.payloadJson,
                  prepared.previousPayloadJson,
                ),
                eq(
                  schema.contentDatabaseSourceExecutions.state,
                  prepared.previousState,
                ),
                previousAttemptFilter(prepared),
                eq(
                  schema.contentDatabaseSourceExecutions.state,
                  args.expected.state,
                ),
                eq(
                  schema.contentDatabaseSourceExecutions.updatedAt,
                  args.expected.updatedAt,
                ),
                previousAttemptFilter({
                  previousAttemptToken: args.expected.attemptToken ?? null,
                }),
              ),
            ),
        );
      } catch (error) {
        if (
          (await resolveAmbiguousPayloadWrite(args.executionId, prepared)) ===
          "committed"
        ) {
          return;
        }
        throw error;
      }
      if (builderExecutionAffectedRows(result) === 0) {
        await discardUncommittedPayload(prepared);
        fail("Builder execution changed before state update.", {
          errorCode: "builder_execution_changed",
          statusCode: 409,
        });
      }
    },
    claimExecution: async (args) => {
      const prepared = await storedPayloadJson(args.executionId, args.payload);
      let result;
      try {
        result = await getDb().transaction(async (tx) => {
          const transactionDb = tx as unknown as ReturnType<typeof getDb>;
          const [scope] = await tx
            .select({ databaseId: schema.contentDatabaseSources.databaseId })
            .from(schema.contentDatabaseSourceExecutions)
            .innerJoin(
              schema.contentDatabaseSources,
              eq(
                schema.contentDatabaseSourceExecutions.sourceId,
                schema.contentDatabaseSources.id,
              ),
            )
            .where(
              eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
            )
            .limit(1);
          if (!scope) return null;
          if (
            args.builderEntry &&
            (await builderEntryHasOtherLiveClaim(transactionDb, {
              ...args.builderEntry,
              executionId: args.executionId,
              staleBefore: args.staleBefore,
            }))
          ) {
            return "entry_busy" as const;
          }
          await lockContentDatabaseMutation(transactionDb, scope.databaseId);
          const updated = await tx
            .update(schema.contentDatabaseSourceExecutions)
            .set({
              state: "running",
              summary: args.summary,
              payloadJson: prepared.payloadJson,
              lastError: null,
              attemptToken: args.attemptToken,
              updatedAt: args.now,
            })
            .where(
              and(
                eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
                eq(
                  schema.contentDatabaseSourceExecutions.payloadJson,
                  prepared.previousPayloadJson,
                ),
                eq(
                  schema.contentDatabaseSourceExecutions.state,
                  prepared.previousState,
                ),
                previousAttemptFilter(prepared),
                eq(
                  schema.contentDatabaseSourceExecutions.state,
                  args.expected.state,
                ),
                eq(
                  schema.contentDatabaseSourceExecutions.updatedAt,
                  args.expected.updatedAt,
                ),
                previousAttemptFilter({
                  previousAttemptToken: args.expected.attemptToken ?? null,
                }),
                exists(
                  tx
                    .select({ id: schema.contentDatabaseSourceChangeSets.id })
                    .from(schema.contentDatabaseSourceChangeSets)
                    .where(
                      and(
                        eq(
                          schema.contentDatabaseSourceChangeSets.id,
                          args.changeSetId,
                        ),
                        eq(
                          schema.contentDatabaseSourceChangeSets.state,
                          "approved",
                        ),
                      ),
                    ),
                ),
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
          if (
            builderExecutionAffectedRows(updated) > 0 &&
            prepared.previousReference &&
            prepared.previousReference !== prepared.nextReference
          ) {
            await enqueueBuilderPrivatePayloadCleanup(
              transactionDb,
              prepared.previousReference,
            );
          }
          return updated;
        });
      } catch (error) {
        if (
          (await resolveAmbiguousPayloadWrite(args.executionId, prepared)) ===
          "committed"
        ) {
          return true;
        }
        throw error;
      }
      if (result === "entry_busy") {
        await discardUncommittedPayload(prepared);
        fail(
          "Another Content collection is pushing to this Builder entry. Try again in a moment.",
          { errorCode: "builder_entry_write_in_progress", statusCode: 409 },
        );
      }
      if (builderExecutionAffectedRows(result) === 0) {
        await discardUncommittedPayload(prepared);
      }
      return builderExecutionAffectedRows(result) > 0;
    },
    renewExecutionClaim: async (args) => {
      const result = await getDb()
        .update(schema.contentDatabaseSourceExecutions)
        .set({ updatedAt: args.now })
        .where(
          and(
            eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
            eq(schema.contentDatabaseSourceExecutions.state, "running"),
            eq(
              schema.contentDatabaseSourceExecutions.attemptToken,
              args.attemptToken,
            ),
          ),
        )
        .returning({ id: schema.contentDatabaseSourceExecutions.id });
      return result.length > 0;
    },
    checkpointResponse: async (args) => {
      const prepared = await storedPayloadJson(args.executionId, args.payload);
      let result;
      try {
        result = await updateStoredPayload(prepared, (tx) =>
          tx
            .update(schema.contentDatabaseSourceExecutions)
            .set({
              state: "response_received",
              summary: "Builder response received; reconciling locally.",
              payloadJson: prepared.payloadJson,
              lastError: null,
              updatedAt: args.now,
            })
            .where(
              and(
                eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
                eq(
                  schema.contentDatabaseSourceExecutions.payloadJson,
                  prepared.previousPayloadJson,
                ),
                eq(schema.contentDatabaseSourceExecutions.state, "running"),
                eq(
                  schema.contentDatabaseSourceExecutions.attemptToken,
                  args.attemptToken,
                ),
              ),
            ),
        );
      } catch (error) {
        if (
          (await resolveAmbiguousPayloadWrite(args.executionId, prepared)) ===
          "committed"
        ) {
          return true;
        }
        throw error;
      }
      if (builderExecutionAffectedRows(result) === 0) {
        await discardUncommittedPayload(prepared);
      }
      return builderExecutionAffectedRows(result) > 0;
    },
    markResponseCheckpointFailed: async (args) => {
      const result = await getDb()
        .update(schema.contentDatabaseSourceExecutions)
        .set({
          state: "reconciliation_required",
          summary:
            "Builder write response could not be stored for reconciliation.",
          lastError: args.lastError,
          updatedAt: args.now,
        })
        .where(
          and(
            eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
            eq(schema.contentDatabaseSourceExecutions.state, "running"),
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
      const prepared = await storedPayloadJson(args.executionId, args.payload);
      try {
        await db.transaction(async (tx) => {
          const result = await tx
            .update(schema.contentDatabaseSourceExecutions)
            .set({
              state: "succeeded",
              summary: args.summary,
              payloadJson: prepared.payloadJson,
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
                    eq(
                      schema.contentDatabaseSourceExecutions.payloadJson,
                      prepared.previousPayloadJson,
                    ),
                    eq(
                      schema.contentDatabaseSourceExecutions.state,
                      prepared.previousState,
                    ),
                  )
                : and(
                    eq(
                      schema.contentDatabaseSourceExecutions.id,
                      args.executionId,
                    ),
                    eq(
                      schema.contentDatabaseSourceExecutions.payloadJson,
                      prepared.previousPayloadJson,
                    ),
                    eq(
                      schema.contentDatabaseSourceExecutions.state,
                      prepared.previousState,
                    ),
                    previousAttemptFilter(prepared),
                  ),
            );
          if (builderExecutionAffectedRows(result) === 0) {
            fail("Execution lease was reclaimed before completion.", {
              errorCode: "builder_execution_changed",
              statusCode: 409,
            });
          }
          if (
            prepared.previousReference &&
            prepared.previousReference !== prepared.nextReference
          ) {
            await enqueueBuilderPrivatePayloadCleanup(
              tx as unknown as ReturnType<typeof getDb>,
              prepared.previousReference,
            );
          }
          await tx
            .update(schema.contentDatabaseSourceChangeSets)
            .set({ state: "applied", updatedAt: args.now })
            .where(
              eq(schema.contentDatabaseSourceChangeSets.id, args.changeSetId),
            );
        });
      } catch (error) {
        if (
          (await resolveAmbiguousPayloadWrite(args.executionId, prepared)) ===
          "committed"
        ) {
          return;
        }
        throw error;
      }
    },
    markExecutionFailed: async (args) => {
      let prepared: Awaited<ReturnType<typeof storedPayloadJson>>;
      try {
        prepared = await storedPayloadJson(args.executionId, args.payload);
      } catch (error) {
        if (args.state !== "reconciliation_required") throw error;
        const [current] = await getDb()
          .select()
          .from(schema.contentDatabaseSourceExecutions)
          .where(
            eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
          )
          .limit(1);
        if (!current) throw error;
        const result = await getDb()
          .update(schema.contentDatabaseSourceExecutions)
          .set({
            state: "reconciliation_required",
            summary: args.summary,
            lastError:
              args.lastError ??
              "Builder outcome requires reconciliation; payload could not be checkpointed.",
            updatedAt: args.now,
          })
          .where(
            and(
              eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
              eq(
                schema.contentDatabaseSourceExecutions.payloadJson,
                current.payloadJson,
              ),
              eq(schema.contentDatabaseSourceExecutions.state, current.state),
              notInArray(schema.contentDatabaseSourceExecutions.state, [
                "succeeded",
                "failed",
              ]),
              args.attemptToken
                ? eq(
                    schema.contentDatabaseSourceExecutions.attemptToken,
                    args.attemptToken,
                  )
                : isNull(schema.contentDatabaseSourceExecutions.attemptToken),
            ),
          )
          .returning({ id: schema.contentDatabaseSourceExecutions.id });
        if (result.length === 0) {
          fail(
            "Builder execution changed before reconciliation was recorded.",
            {
              errorCode: "builder_execution_changed",
              statusCode: 409,
            },
          );
        }
        return;
      }
      let result;
      try {
        result = await updateStoredPayload(prepared, (tx) =>
          tx
            .update(schema.contentDatabaseSourceExecutions)
            .set({
              state: args.state ?? "failed",
              summary: args.summary,
              payloadJson: prepared.payloadJson,
              lastError: args.lastError,
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
                    eq(
                      schema.contentDatabaseSourceExecutions.payloadJson,
                      prepared.previousPayloadJson,
                    ),
                    eq(
                      schema.contentDatabaseSourceExecutions.state,
                      prepared.previousState,
                    ),
                  )
                : and(
                    eq(
                      schema.contentDatabaseSourceExecutions.id,
                      args.executionId,
                    ),
                    eq(
                      schema.contentDatabaseSourceExecutions.payloadJson,
                      prepared.previousPayloadJson,
                    ),
                    eq(
                      schema.contentDatabaseSourceExecutions.state,
                      prepared.previousState,
                    ),
                    previousAttemptFilter(prepared),
                  ),
            ),
        );
      } catch (error) {
        if (
          (await resolveAmbiguousPayloadWrite(args.executionId, prepared)) ===
          "committed"
        ) {
          return;
        }
        throw error;
      }
      if (builderExecutionAffectedRows(result) === 0) {
        await discardUncommittedPayload(prepared);
        fail("Builder execution changed before failure checkpoint.", {
          errorCode: "builder_execution_changed",
          statusCode: 409,
        });
      }
    },
    releaseExecutionClaim: async (args) => {
      let prepared: Awaited<ReturnType<typeof storedPayloadJson>>;
      try {
        prepared = await storedPayloadJson(args.executionId, args.payload);
      } catch (error) {
        if (
          !isActionContractError(error) ||
          error.errorCode !== "BUILDER_PRIVATE_PAYLOAD_UNAVAILABLE"
        ) {
          throw error;
        }
        // Nothing was sent, so the stored payload is still accurate. Blob
        // storage being down must not hold the claim until its lease expires.
        // Cancelling a blocked gate needs the preflight evidence that could
        // not be stored; a ready gate stays cancellable and re-checks the
        // live entry on its next run.
        const result = await getDb()
          .update(schema.contentDatabaseSourceExecutions)
          .set({
            state:
              args.restore.state === "blocked" ? "ready" : args.restore.state,
            summary: args.summary,
            lastError: args.lastError,
            attemptToken: args.restore.attemptToken ?? null,
            updatedAt:
              args.restore.state === "running"
                ? args.restore.updatedAt
                : args.now,
          })
          .where(
            and(
              eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
              eq(schema.contentDatabaseSourceExecutions.state, "running"),
              eq(
                schema.contentDatabaseSourceExecutions.attemptToken,
                args.attemptToken,
              ),
            ),
          );
        if (builderExecutionAffectedRows(result) === 0) {
          fail("Builder execution changed before its claim was released.", {
            errorCode: "builder_execution_changed",
            statusCode: 409,
          });
        }
        return;
      }
      let result;
      try {
        result = await updateStoredPayload(prepared, (tx) =>
          tx
            .update(schema.contentDatabaseSourceExecutions)
            .set({
              state: args.restore.state,
              summary: args.summary,
              payloadJson: prepared.payloadJson,
              lastError: args.lastError,
              attemptToken: args.restore.attemptToken ?? null,
              updatedAt:
                args.restore.state === "running"
                  ? args.restore.updatedAt
                  : args.now,
            })
            .where(
              and(
                eq(schema.contentDatabaseSourceExecutions.id, args.executionId),
                eq(schema.contentDatabaseSourceExecutions.state, "running"),
                eq(
                  schema.contentDatabaseSourceExecutions.attemptToken,
                  args.attemptToken,
                ),
                eq(
                  schema.contentDatabaseSourceExecutions.payloadJson,
                  prepared.previousPayloadJson,
                ),
              ),
            ),
        );
      } catch (error) {
        if (
          (await resolveAmbiguousPayloadWrite(args.executionId, prepared)) ===
          "committed"
        ) {
          return;
        }
        throw error;
      }
      if (builderExecutionAffectedRows(result) === 0) {
        await discardUncommittedPayload(prepared);
        fail("Builder execution changed before its claim was released.", {
          errorCode: "builder_execution_changed",
          statusCode: 409,
        });
      }
    },
    executeWrite: (args) => executeBuilderCmsWrite(args),
    readLiveEntry: async (args) => {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(
            "Builder live preflight exceeded its time limit.",
          );
          controller.abort(error);
          reject(error);
        }, BUILDER_LIVE_PREFLIGHT_TIMEOUT_MS);
      });
      try {
        return await Promise.race([
          readBuilderCmsEntryLiveState({
            ...args,
            requireBoundOAuth: true,
            signal: controller.signal,
          }),
          deadline,
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
    reconcileWrite: reconcileBuilderCmsWrite,
    // A page read scopes source change sets to that page's rows, so a row past
    // the first page would come back without the change set just executed.
    getResponse: async (databaseId, changeSet) =>
      getContentDatabaseResponse(databaseId, {
        limit: 100,
        offset: 0,
        documentIds: await changeSetDocumentIds(changeSet),
      }),
    lookupSafeModelIntent: lookupBuilderCmsSafeModelIntent,
  };
}

async function changeSetDocumentIds(
  changeSet: ContentDatabaseSourceChangeSet,
): Promise<string[]> {
  if (changeSet.documentId) return [changeSet.documentId];
  if (!changeSet.databaseItemId) return [];
  const items = await getDb()
    .select({ documentId: schema.contentDatabaseItems.documentId })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.id, changeSet.databaseItemId))
    .limit(1);
  return items.map((item) => item.documentId);
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
    // A collection editor may only view a page, and publishing or
    // unpublishing one needs edit access to it, as staging the pick does.
    if (args.publicationTransition && changeSet.documentId) {
      await deps.assertPageEditor(changeSet.documentId);
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
        () => deps.getResponse(database.id, changeSet),
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
        execution.state === "reconciliation_required" &&
          execution.lastError === BUILDER_RESPONSE_CHECKPOINT_FAILURE
          ? BUILDER_RESPONSE_CHECKPOINT_FAILURE
          : execution.state === "reconciliation_required"
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
        expected: {
          state: execution.state,
          updatedAt: execution.updatedAt,
          attemptToken: execution.attemptToken,
        },
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
        expected: {
          state: execution.state,
          updatedAt: execution.updatedAt,
          attemptToken: execution.attemptToken,
        },
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
        expected: {
          state: execution.state,
          updatedAt: execution.updatedAt,
          attemptToken: execution.attemptToken,
        },
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
              expectedSourceSpace: source.metadata.builderSpacePublicKey,
              expectedSourceConnectionId: source.metadata.connectionId,
            }
          : {
              marker: planIntent.marker,
              intendedFields: planIntent.intendedFields,
              expectedSourceSpace: source.metadata.builderSpacePublicKey,
              expectedSourceConnectionId: source.metadata.connectionId,
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
      // The live check may have picked the other unpublished save; the
      // stored payload says which one Builder received, and what the live
      // check read before the write.
      const writtenPayload: BuilderCmsExecutionPayload = {
        ...validatedPayload,
        ...(isBuilderCmsUnpublishedSaveEffect(validatedPayload.effect) &&
        isBuilderCmsUnpublishedSaveEffect(storedPayload.effect) &&
        storedRequest
          ? { effect: storedPayload.effect, request: storedRequest }
          : {}),
        ...(recordValue(storedPayload.livePreflight)
          ? {
              livePreflight:
                storedPayload.livePreflight as BuilderCmsLivePreflight,
            }
          : {}),
      };
      const payloadWithResponse = executionResponsePayload({
        payload: writtenPayload,
        writeResult: storedWriteResult,
      });
      const reconciledAt = deps.now();
      try {
        await deps.reconcileWrite({
          database,
          source,
          changeSet,
          plan: { ...plan, payload: writtenPayload },
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
        summary: builderExecutionSucceededSummary({
          pushMode: plan.pushMode,
          effect: writtenPayload.effect,
          writeResult: storedWriteResult,
          executionId: execution.id,
          changeSetId: changeSet.id,
        }),
        payload: payloadWithResponse,
        now: reconciledAt,
      });
      const response = await deps.getResponse(database.id, changeSet);
      timing.record("reconciliation_and_persistence", reconciliationStartedAt);
      const result = { ...response, timings: timing.finish() };
      timing.log("succeeded");
      return result;
    }

    const preflightEntryId = requiresLivePreflight(plan.payload.effect)
      ? plan.payload.target.entryId
      : null;
    if (requiresLivePreflight(plan.payload.effect) && !preflightEntryId) {
      const message = "Builder entry no longer exists; refresh the source.";
      await deps.updateExecutionState({
        executionId: execution.id,
        expected: {
          state: execution.state,
          updatedAt: execution.updatedAt,
          attemptToken: execution.attemptToken,
        },
        state: "blocked",
        summary: `${plan.summary} Execution blocked before write.`,
        payload: validatedPayload,
        lastError: message,
        now,
      });
      throw new Error(message);
    }

    const attemptToken = crypto.randomUUID();
    const claimed = await deps.claimExecution({
      executionId: execution.id,
      changeSetId: changeSet.id,
      expected: {
        state: execution.state,
        updatedAt: execution.updatedAt,
        attemptToken: execution.attemptToken,
      },
      summary: `Running Builder ${plan.pushMode} execution.`,
      payload: validatedPayload,
      now,
      staleBefore: staleRunningCutoff(now),
      attemptToken,
      builderEntry: preflightEntryId
        ? { model: plan.payload.target.model, entryId: preflightEntryId }
        : null,
    });
    if (!claimed) {
      throw builderExecutionConflict("Builder execution is already running.");
    }
    // Nothing has reached Builder until executeWrite returns a result, so any
    // stop before then hands the gate back instead of stranding a claim that
    // cancel and review must treat as an attempted write.
    const releaseClaim = (args: {
      state: BuilderSourceExecutionRecord["state"];
      summary: string;
      payload: unknown;
      lastError: string;
    }) =>
      deps.releaseExecutionClaim({
        executionId: execution.id,
        attemptToken,
        restore: {
          state: args.state,
          attemptToken: execution.attemptToken,
          updatedAt: execution.updatedAt,
        },
        summary: args.summary,
        payload: args.payload,
        lastError: args.lastError,
        now: deps.now(),
      });

    let writePayload: BuilderCmsExecutionPayload = validatedPayload;
    if (preflightEntryId) {
      // This check runs after the claim so it sits as close to the write as
      // possible. The claim keeps other Content pushes to this entry out, but a
      // save made in Builder that lands after this read and before the write
      // below is still overwritten: closing that needs a conditional write on
      // Builder's side.
      let liveState: BuilderCmsEntryLiveState;
      try {
        liveState = await deps.readLiveEntry({
          model: plan.payload.target.model,
          entryId: preflightEntryId,
          fieldPaths: builderCmsWrittenSourceFields(plan.payload.request)
            .fieldKeys,
          expectedSourceSpace: source.metadata.builderSpacePublicKey,
          expectedSourceConnectionId: source.metadata.connectionId,
        });
      } catch (error) {
        await releaseClaim({
          state: execution.state,
          summary: `${plan.summary} Execution stopped before write.`,
          payload: validatedPayload,
          lastError: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      let claimRenewed: boolean;
      try {
        claimRenewed = await deps.renewExecutionClaim({
          executionId: execution.id,
          attemptToken,
          now: deps.now(),
        });
      } catch (error) {
        await releaseClaim({
          state: execution.state,
          summary: `${plan.summary} Execution stopped before write.`,
          payload: validatedPayload,
          lastError: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      if (!claimRenewed) {
        throw builderExecutionConflict(
          "Builder execution lease was reclaimed during live preflight.",
        );
      }
      const baselineLastUpdated = plan.payload.target.reviewedLastUpdated;
      console.info("builder_source_live_preflight", {
        executionId: execution.id,
        changeSetId: changeSet.id,
        targetEntryId: preflightEntryId,
        baselineLastUpdated,
        liveLastUpdated: liveState.lastUpdated,
        baselineBlocksHash: changeSet.bodyChange?.currentHash ?? null,
        liveBlocksHash: liveState.blocksHash,
        livePublished: liveState.published,
      });
      const livePreflight = builderCmsLivePreflightRecord({
        liveState,
        request: plan.payload.request,
        checkedAt: now,
      });
      const message = livePreflightBlockMessage({
        liveState,
        baselineLastUpdated,
        baselineBlocksHash: changeSet.bodyChange?.currentHash ?? null,
        baselineValues: sourceRowForChangeSet(source, changeSet)?.sourceValues,
        effect: plan.payload.effect,
        request: plan.payload.request,
        fieldLabel: builderSourceFieldLabel(source),
      });
      if (message) {
        await releaseClaim({
          state: "blocked",
          summary: `${plan.summary} Execution blocked before write.`,
          payload: { ...validatedPayload, livePreflight },
          lastError: message,
        });
        fail(message, {
          errorCode: "builder_entry_changed_since_review",
          statusCode: 409,
        });
      }
      writePayload = {
        ...builderCmsPayloadForLivePublication(
          validatedPayload,
          liveState.published,
        ),
        livePreflight,
      };
    }
    // The claim and live preflight can take a while, so the page edit access
    // a publish or unpublish needs is checked again just before it is sent.
    if (args.publicationTransition && changeSet.documentId) {
      try {
        await deps.assertPageEditor(changeSet.documentId);
      } catch (error) {
        await releaseClaim({
          state: execution.state,
          summary: `${plan.summary} Execution stopped before write.`,
          payload: validatedPayload,
          lastError: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    const writePlan: BuilderCmsExecutionPlan = {
      ...plan,
      payload: writePayload,
    };
    timing.record("approval_gate_and_dry_run_validation", gateStartedAt);

    let writeResult: BuilderCmsWriteResult;
    try {
      writeResult = await timing.measure("write_dispatch", () =>
        deps.executeWrite({
          request: writePayload.request,
          expectedSourceSpace: source.metadata.builderSpacePublicKey,
          expectedSourceConnectionId: source.metadata.connectionId,
          requireSourceBinding: true,
        }),
      );
    } catch (error) {
      // executeWrite reports every post-dispatch outcome as a result.
      await releaseClaim({
        state: execution.state,
        summary: `${plan.summary} Execution stopped before write.`,
        payload: validatedPayload,
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const payloadWithResponse = executionResponsePayload({
      payload: writePayload,
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
      if (writeResult.ambiguity) {
        throw builderExecutionConflict(lastError);
      }
      const error = new Error(lastError) as Error & { statusCode?: number };
      if (writeResult.status >= 400 && writeResult.status < 500) {
        error.statusCode = writeResult.status;
      }
      throw error;
    }

    const reconciliationStartedAt = timing.start();
    let checkpointed = true;
    try {
      if (deps.checkpointResponse) {
        checkpointed = await deps.checkpointResponse({
          executionId: execution.id,
          attemptToken,
          payload: payloadWithResponse,
          now: deps.now(),
        });
      } else {
        await deps.updateExecutionState({
          executionId: execution.id,
          expected: { state: "running", updatedAt: now, attemptToken },
          state: "response_received",
          summary: "Builder response received; reconciling locally.",
          payload: payloadWithResponse,
          lastError: null,
          now: deps.now(),
        });
      }
    } catch {
      const recorded = await deps.markResponseCheckpointFailed({
        executionId: execution.id,
        attemptToken,
        lastError: BUILDER_RESPONSE_CHECKPOINT_FAILURE,
        now: deps.now(),
      });
      if (!recorded) {
        throw builderExecutionConflict(
          "Execution lease was reclaimed before response custody could be recorded.",
        );
      }
      throw builderExecutionConflict(BUILDER_RESPONSE_CHECKPOINT_FAILURE);
    }
    if (!checkpointed) {
      throw builderExecutionConflict(
        "Execution lease was reclaimed before response checkpoint.",
      );
    }

    const succeededAt = deps.now();
    try {
      await deps.reconcileWrite({
        database,
        source,
        changeSet,
        plan: writePlan,
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
      summary: builderExecutionSucceededSummary({
        pushMode: plan.pushMode,
        effect: writePayload.effect,
        writeResult,
        executionId: execution.id,
        changeSetId: changeSet.id,
      }),
      payload: payloadWithResponse,
      now: succeededAt,
      attemptToken,
    });

    const response = await deps.getResponse(database.id, changeSet);
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
    databaseId: z.string().optional().describe("Collection ID"),
    documentId: z.string().optional().describe("Collection document/page ID"),
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
    context,
  ): Promise<ContentDatabaseResponsePayload> => {
    return contentDatabaseResponseForCaller(
      await executeBuilderSourceExecutionWithDeps(
        args,
        realExecutionDeps(args.sourceId, args.changeSetId),
      ),
      context,
    );
  },
});

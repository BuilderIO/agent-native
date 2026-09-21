import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceExecution,
  ContentDatabaseSourceFieldChange,
  ContentDatabaseSourcePushMode,
  ContentDatabaseSourceReviewPayload,
  ContentDatabaseSourceRiskLevel,
  ExecuteBuilderSourceBatchTransition,
  PrepareBuilderSourceReviewRequest,
  PrepareBuilderSourceReviewResponse,
} from "../shared/api.js";
import {
  builderExecutionPayloadReference,
  cleanupBuilderPrivatePayload,
  deleteBuilderPrivatePayload,
  readBuilderExecutionPayload,
  storeBuilderExecutionPayload,
} from "./_builder-cms-blob-custody.js";
import { BUILDER_CMS_WRITE_CANONICAL_JSON_KEY } from "./_builder-cms-source-adapter.js";
import {
  buildBuilderCmsExecutionPlan,
  resolveBuilderCmsWriteEffect,
  validateBuilderCmsExecutionDryRun,
} from "./_builder-cms-write-adapter.js";
import { claimBuilderSourceExecutionGate } from "./_builder-source-execution-claim.js";
import { shouldPreserveBuilderExecution } from "./_builder-source-execution-preservation.js";
import { createBuilderSourceTiming } from "./_builder-source-timings.js";
import {
  findOpenSourceChangeSet,
  getContentDatabaseSourceSnapshotForReview,
  getContentDatabaseSourceSnapshotForWrite,
  reviewedBuilderChangeSetRevisionId,
  resolveDatabaseForSourceMutation,
  serializeSourceRowRecord,
  sourceChangeSetKey,
} from "./_database-source-utils.js";

export const BUILDER_SOURCE_REVIEW_PREPARE_LIMIT = 100;

export async function withAuthoritativeBuilderTargetRows(args: {
  source: ContentDatabaseSource;
  changeSets: ContentDatabaseSourceChangeSet[];
}) {
  const representedDocumentIds = new Set(
    args.source.rows.map((row) => row.documentId),
  );
  const representedItemIds = new Set(
    args.source.rows.map((row) => row.databaseItemId),
  );
  const missingDocumentIds = args.changeSets.flatMap((changeSet) =>
    changeSet.documentId && !representedDocumentIds.has(changeSet.documentId)
      ? [changeSet.documentId]
      : [],
  );
  const missingItemIds = args.changeSets.flatMap((changeSet) =>
    changeSet.databaseItemId &&
    !representedItemIds.has(changeSet.databaseItemId)
      ? [changeSet.databaseItemId]
      : [],
  );
  if (missingDocumentIds.length === 0 && missingItemIds.length === 0) {
    return args.source;
  }
  const identityFilters = [
    ...(missingDocumentIds.length > 0
      ? [
          inArray(
            schema.contentDatabaseSourceRows.documentId,
            missingDocumentIds,
          ),
        ]
      : []),
    ...(missingItemIds.length > 0
      ? [
          inArray(
            schema.contentDatabaseSourceRows.databaseItemId,
            missingItemIds,
          ),
        ]
      : []),
  ];
  const authoritativeRows = await getDb()
    .select()
    .from(schema.contentDatabaseSourceRows)
    .where(
      and(
        eq(schema.contentDatabaseSourceRows.sourceId, args.source.id),
        or(...identityFilters),
      ),
    );
  const existingIds = new Set(args.source.rows.map((row) => row.id));
  return {
    ...args.source,
    rows: [
      ...args.source.rows,
      ...authoritativeRows
        .filter((row) => !existingIds.has(row.id))
        .map((row) =>
          serializeSourceRowRecord(row, {
            includeHeavyBuilderBodyValues: true,
          }),
        ),
    ],
  };
}

const publicationTransitionSchema = z.object({
  publicationTransition: z.enum(["publish", "unpublish"]).optional(),
  confirmUnpublish: z.boolean().optional(),
});

function riskRank(level: ContentDatabaseSourceRiskLevel) {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function maxRisk(
  current: ContentDatabaseSourceRiskLevel,
  next: ContentDatabaseSourceRiskLevel,
) {
  return riskRank(next) > riskRank(current) ? next : current;
}

export function reviewPreparePriority(
  changeSet: ContentDatabaseSourceChangeSet,
  source?: ContentDatabaseSource,
) {
  const statePriority =
    changeSet.state === "pending_push"
      ? 0
      : changeSet.state === "staged_revision"
        ? 2
        : 4;
  const effectPriority =
    source &&
    resolveBuilderCmsWriteEffect({ source, changeSet }) === "create_draft"
      ? 0
      : 1;
  return statePriority + effectPriority;
}

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

function dryRunStatus(execution: ContentDatabaseSourceExecution | null) {
  const dryRun =
    execution?.payload.dryRun &&
    typeof execution.payload.dryRun === "object" &&
    !Array.isArray(execution.payload.dryRun)
      ? (execution.payload.dryRun as Record<string, unknown>)
      : null;
  const status = dryRun?.status;
  return status === "validated" || status === "blocked" || status === "stale"
    ? status
    : null;
}

const BUILDER_REVIEW_ABSENT_VALUE = "(absent)";

function reviewRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stableReviewJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableReviewJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableReviewJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function builderReviewValue(
  value: unknown,
  present: boolean,
): ContentDatabaseSourceFieldChange["currentValue"] {
  if (!present || value === undefined) return BUILDER_REVIEW_ABSENT_VALUE;
  if (typeof value === "number" || typeof value === "boolean") {
    return value as ContentDatabaseSourceFieldChange["currentValue"];
  }
  return stableReviewJson(value);
}

function builderReviewJsonPointer(path: string[], key: string) {
  return [...path, key]
    .map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1"))
    .map((part) => `/${part}`)
    .join("");
}

export function builderPublishPayloadReviewChanges(args: {
  canonical: Record<string, unknown>;
  publishedBody: Record<string, unknown>;
}): ContentDatabaseSourceFieldChange[] {
  const publishedBody = Object.fromEntries(
    Object.entries(args.publishedBody).filter(([key]) => key !== "__write"),
  );
  const changes: ContentDatabaseSourceFieldChange[] = [];
  const visit = (
    current: unknown,
    proposed: unknown,
    path: string[],
    currentPresent: boolean,
    proposedPresent: boolean,
  ) => {
    if (
      currentPresent &&
      proposedPresent &&
      stableReviewJson(current) === stableReviewJson(proposed)
    ) {
      return;
    }
    const currentRecord = reviewRecord(current);
    const proposedRecord = reviewRecord(proposed);
    const keys = new Set([
      ...Object.keys(currentRecord ?? {}),
      ...Object.keys(proposedRecord ?? {}),
    ]);
    if (
      currentPresent &&
      proposedPresent &&
      currentRecord &&
      proposedRecord &&
      keys.size > 0
    ) {
      for (const key of [...keys].sort()) {
        visit(
          currentRecord?.[key],
          proposedRecord?.[key],
          [...path, key],
          currentRecord
            ? Object.prototype.hasOwnProperty.call(currentRecord, key)
            : false,
          proposedRecord
            ? Object.prototype.hasOwnProperty.call(proposedRecord, key)
            : false,
        );
      }
      return;
    }
    const pointer = builderReviewJsonPointer(
      path.slice(0, -1),
      path[path.length - 1]!,
    );
    changes.push({
      propertyId: null,
      propertyName: `Builder publish payload ${pointer}`,
      localFieldKey: `__builder.publish${pointer}`,
      sourceFieldKey: pointer,
      currentValue: builderReviewValue(current, currentPresent),
      proposedValue: builderReviewValue(proposed, proposedPresent),
    });
  };
  visit(args.canonical, publishedBody, [], true, true);
  return changes;
}

export function builderPublicationReviewChanges(args: {
  row: ContentDatabaseSource["rows"][number] | null;
  execution: ContentDatabaseSourceExecution | null;
}) {
  if (args.execution?.payload.effect !== "publish") return [];
  const request = reviewRecord(args.execution.payload.request);
  const publishedBody = reviewRecord(request?.body);
  const writeGuard = reviewRecord(publishedBody?.__write);
  const isGuardedPublish =
    typeof writeGuard?.version === "string" && writeGuard.version.length > 0;
  const canonicalJson =
    args.row?.sourceValues?.[BUILDER_CMS_WRITE_CANONICAL_JSON_KEY];
  if (!publishedBody) return [];
  const reviewBaseUnavailable = () => {
    throw new ActionContractError(
      "Builder publish review requires the guarded canonical source payload.",
      {
        errorCode: "BUILDER_PUBLISH_REVIEW_BASE_UNAVAILABLE",
        statusCode: 409,
      },
    );
  };
  if (typeof canonicalJson !== "string") {
    if (isGuardedPublish) reviewBaseUnavailable();
    return [];
  }
  try {
    const canonical = reviewRecord(JSON.parse(canonicalJson) as unknown);
    if (!canonical) {
      if (isGuardedPublish) reviewBaseUnavailable();
      return [];
    }
    return builderPublishPayloadReviewChanges({ canonical, publishedBody });
  } catch {
    if (isGuardedPublish) reviewBaseUnavailable();
    return [];
  }
}

export function buildBuilderSourceReviewPayload(args: {
  source: ContentDatabaseSource;
  changeSets: ContentDatabaseSourceChangeSet[];
}): ContentDatabaseSourceReviewPayload {
  let riskLevel: ContentDatabaseSourceRiskLevel = "low";
  const riskReasons = new Set<string>();
  const rows = args.changeSets.map((changeSet) => {
    riskLevel = maxRisk(riskLevel, changeSet.riskLevel);
    for (const reason of changeSet.riskReasons) riskReasons.add(reason);
    if (changeSet.conflictState === "source_changed") {
      riskLevel = maxRisk(riskLevel, "medium");
      riskReasons.add("source changed");
    }
    const row =
      args.source.rows.find(
        (candidate) =>
          candidate.documentId === changeSet.documentId ||
          candidate.databaseItemId === changeSet.databaseItemId,
      ) ?? null;
    const latestExecution =
      changeSet.executions[changeSet.executions.length - 1] ?? null;
    const changedTitle =
      changeSet.fieldChanges.find((field) => field.localFieldKey === "title")
        ?.proposedValue ?? null;
    const plannedEffect = latestExecution?.payload.effect;
    const effect =
      plannedEffect === "autosave" ||
      plannedEffect === "update_in_place" ||
      plannedEffect === "create_draft" ||
      plannedEffect === "publish" ||
      plannedEffect === "unpublish"
        ? plannedEffect
        : resolveBuilderCmsWriteEffect({
            source: args.source,
            changeSet,
          });

    return {
      changeSetId: changeSet.id,
      databaseItemId: changeSet.databaseItemId,
      documentId: changeSet.documentId,
      title:
        typeof changedTitle === "string" && changedTitle.trim()
          ? changedTitle
          : row?.sourceDisplayKey || "Untitled",
      targetEntryId:
        effect === "create_draft" ? null : (row?.sourceRowId ?? null),
      fieldChanges: [
        ...changeSet.fieldChanges,
        ...builderPublicationReviewChanges({ row, execution: latestExecution }),
      ],
      bodyChange: changeSet.bodyChange,
      riskLevel: changeSet.riskLevel,
      riskReasons: changeSet.riskReasons,
      conflictState: changeSet.conflictState,
      effect,
      execution: latestExecution,
    };
  });

  const statuses = rows
    .map((row) => dryRunStatus(row.execution))
    .filter((status): status is "validated" | "blocked" | "stale" => !!status);
  const executionStates = rows
    .map((row) => row.execution?.state)
    .filter(Boolean);
  const hasExecutionEvidence =
    statuses.length > 0 || executionStates.length > 0;
  const resultStatus =
    executionStates.length > 0 &&
    executionStates.every((state) => state === "succeeded")
      ? "succeeded"
      : executionStates.includes("reconciliation_required") ||
          executionStates.includes("response_received")
        ? "reconciliation_required"
        : executionStates.includes("failed")
          ? "failed"
          : executionStates.includes("running")
            ? "running"
            : statuses.includes("stale")
              ? "stale"
              : statuses.includes("blocked")
                ? "blocked"
                : statuses.includes("validated")
                  ? "validated"
                  : args.source.capabilities.liveWritesEnabled
                    ? "validated"
                    : "write_disabled";
  const pushMode = args.source.metadata.pushMode ?? "autosave";
  const summary =
    rows.length === 1
      ? `1 Builder row has changes ready to review.`
      : `${rows.length} Builder rows have changes ready to review.`;

  return {
    summary,
    sourceName: args.source.sourceName,
    sourceTable: args.source.sourceTable,
    totalRowCount: args.changeSets.length,
    preparedRowLimit: args.changeSets.length,
    pushMode,
    dryRunOnly: !args.source.capabilities.liveWritesEnabled,
    liveWritesEnabled: args.source.capabilities.liveWritesEnabled,
    riskLevel,
    riskReasons: Array.from(riskReasons),
    rows,
    result: {
      status: resultStatus,
      message:
        resultStatus === "succeeded"
          ? "Pushed to Builder and reconciled locally."
          : resultStatus === "failed"
            ? "Builder push failed. The change remains retryable."
            : resultStatus === "running"
              ? "Builder push is running."
              : resultStatus === "validated"
                ? args.source.capabilities.liveWritesEnabled
                  ? hasExecutionEvidence
                    ? "Push checked successfully. Ready to send to Builder."
                    : "Ready to send to Builder."
                  : "Push checked successfully. Nothing was sent to Builder."
                : resultStatus === "blocked"
                  ? "Push needs attention before anything can be sent to Builder."
                  : resultStatus === "stale"
                    ? "Push needs a fresh review because the plan changed."
                    : "Builder writes are off in this local build. Push will check the update only.",
    },
  };
}

async function approveChangeSetForReview(args: {
  sourceId: string;
  ownerEmail: string;
  changeSet: ContentDatabaseSourceChangeSet;
  reviewerEmail: string;
  now: string;
}) {
  const key = sourceChangeSetKey({
    documentId: args.changeSet.documentId,
    databaseItemId: args.changeSet.databaseItemId,
    kind: args.changeSet.kind,
    direction: "outbound",
    pushMode: args.changeSet.pushMode ?? "autosave",
    fieldChanges: args.changeSet.fieldChanges,
    bodyChange: args.changeSet.bodyChange,
  });
  const db = getDb();
  const [selectedExisting] = await db
    .select()
    .from(schema.contentDatabaseSourceChangeSets)
    .where(
      and(
        eq(schema.contentDatabaseSourceChangeSets.sourceId, args.sourceId),
        eq(schema.contentDatabaseSourceChangeSets.id, args.changeSet.id),
      ),
    )
    .limit(1);
  const existing =
    selectedExisting &&
    (selectedExisting.state === "pending_push" ||
      selectedExisting.state === "staged_revision" ||
      selectedExisting.state === "approved")
      ? selectedExisting
      : await findOpenSourceChangeSet({
          sourceId: args.sourceId,
          key,
          states: ["pending_push", "staged_revision", "approved"],
        });
  const summary = args.changeSet.summary
    .replace(/^Pending local Builder CMS/, "Reviewing local Builder CMS")
    .replace(/^Staged local-only Builder CMS/, "Reviewing local Builder CMS");
  const approvedChangeSet = (id: string): ContentDatabaseSourceChangeSet => ({
    ...args.changeSet,
    id,
    direction: "outbound",
    state: "approved",
    pushMode: args.changeSet.pushMode ?? "autosave",
    localOnly: true,
    summary,
    updatedAt: args.now,
  });

  const existingPayloadMatches = (row: {
    fieldChangesJson: string;
    bodyChangeJson: string | null;
  }) =>
    row.fieldChangesJson === JSON.stringify(args.changeSet.fieldChanges) &&
    row.bodyChangeJson ===
      (args.changeSet.bodyChange
        ? JSON.stringify(args.changeSet.bodyChange)
        : null);

  if (existing) {
    // An approved payload is immutable execution evidence. Even a locally
    // blocked gate can be claimed after this read, so a materially changed
    // proposal always receives a new revision identity instead of rewriting
    // the proposal beneath an in-flight execution.
    if (existing.state === "approved") {
      if (existingPayloadMatches(existing)) {
        return {
          id: existing.id,
          state: "approved" as const,
          changeSet: {
            ...approvedChangeSet(existing.id),
            summary: existing.summary,
            fieldChanges: JSON.parse(
              existing.fieldChangesJson,
            ) as ContentDatabaseSourceChangeSet["fieldChanges"],
            bodyChange: existing.bodyChangeJson
              ? (JSON.parse(
                  existing.bodyChangeJson,
                ) as ContentDatabaseSourceChangeSet["bodyChange"])
              : null,
            updatedAt: existing.updatedAt,
          },
        };
      }
      // Fall through to a revision-bound change-set ID below.
    } else {
      const [updated] = await db
        .update(schema.contentDatabaseSourceChangeSets)
        .set({
          direction: "outbound",
          state: "approved",
          pushMode: args.changeSet.pushMode ?? "autosave",
          localOnly: 1,
          summary,
          fieldChangesJson: JSON.stringify(args.changeSet.fieldChanges),
          bodyChangeJson: args.changeSet.bodyChange
            ? JSON.stringify(args.changeSet.bodyChange)
            : null,
          updatedAt: args.now,
        })
        .where(
          and(
            eq(schema.contentDatabaseSourceChangeSets.id, existing.id),
            eq(schema.contentDatabaseSourceChangeSets.state, existing.state),
            eq(
              schema.contentDatabaseSourceChangeSets.fieldChangesJson,
              existing.fieldChangesJson,
            ),
            existing.bodyChangeJson === null
              ? isNull(schema.contentDatabaseSourceChangeSets.bodyChangeJson)
              : eq(
                  schema.contentDatabaseSourceChangeSets.bodyChangeJson,
                  existing.bodyChangeJson,
                ),
          ),
        )
        .returning({ id: schema.contentDatabaseSourceChangeSets.id });
      if (!updated) {
        throw new Error("Builder change set changed during approval.");
      }
      if (existing.state !== "approved") {
        await db.insert(schema.contentDatabaseSourceChangeReviews).values({
          id: crypto.randomUUID(),
          ownerEmail: args.ownerEmail,
          sourceId: args.sourceId,
          changeSetId: existing.id,
          reviewerEmail: args.reviewerEmail,
          decision: "approved",
          stateFrom: existing.state,
          stateTo: "approved",
          note: "Approved by Builder update review.",
          createdAt: args.now,
        });
      }
      return {
        id: existing.id,
        state: "approved" as const,
        changeSet: approvedChangeSet(existing.id),
      };
    }
  }

  // Local Builder diffs are materialized with deterministic IDs (for example,
  // `local-pending-create-*`) before they have a persisted change-set row. Keep
  // that exact identity on first approval so the prepared review matches the
  // row the operator selected. A cancelled/rejected/applied audit row is
  // immutable, though, and may already own that category-level synthetic ID.
  // Bind a materially changed follow-up to a deterministic payload revision so
  // its review, execution, and idempotency evidence cannot alias the old row.
  const changeSetId = selectedExisting
    ? reviewedBuilderChangeSetRevisionId(args.changeSet)
    : args.changeSet.id;
  await db.insert(schema.contentDatabaseSourceChangeSets).values({
    id: changeSetId,
    ownerEmail: args.ownerEmail,
    sourceId: args.sourceId,
    databaseItemId: args.changeSet.databaseItemId,
    documentId: args.changeSet.documentId,
    kind: args.changeSet.kind,
    direction: "outbound",
    state: "approved",
    pushMode: args.changeSet.pushMode ?? "autosave",
    localOnly: 1,
    summary,
    fieldChangesJson: JSON.stringify(args.changeSet.fieldChanges),
    bodyChangeJson: args.changeSet.bodyChange
      ? JSON.stringify(args.changeSet.bodyChange)
      : null,
    createdAt: args.now,
    updatedAt: args.now,
  });
  await db.insert(schema.contentDatabaseSourceChangeReviews).values({
    id: crypto.randomUUID(),
    ownerEmail: args.ownerEmail,
    sourceId: args.sourceId,
    changeSetId,
    reviewerEmail: args.reviewerEmail,
    decision: "approved",
    stateFrom: "pending_push",
    stateTo: "approved",
    note: "Approved by Builder update review.",
    createdAt: args.now,
  });
  return {
    id: changeSetId,
    state: "approved" as const,
    changeSet: approvedChangeSet(changeSetId),
  };
}

async function upsertExecutionGate(args: {
  source: ContentDatabaseSource;
  changeSet: ContentDatabaseSourceChangeSet;
  pushModeConfirmation?: ContentDatabaseSourcePushMode;
  publicationTransition?: PrepareBuilderSourceReviewRequest["publicationTransition"];
  confirmUnpublish?: boolean;
  ownerEmail: string;
  now: string;
}) {
  const plan = buildBuilderCmsExecutionPlan({
    source: args.source,
    changeSet: args.changeSet,
    pushModeConfirmation: args.pushModeConfirmation,
    publicationTransition: args.publicationTransition,
    confirmUnpublish: args.confirmUnpublish,
  });
  const db = getDb();
  let executionId = await claimBuilderSourceExecutionGate({
    ownerEmail: args.ownerEmail,
    sourceId: args.source.id,
    idempotencyKey: plan.idempotencyKey,
    now: args.now,
  });
  const [existing] = await db
    .select()
    .from(schema.contentDatabaseSourceExecutions)
    .where(eq(schema.contentDatabaseSourceExecutions.id, executionId));

  if (
    existing &&
    (shouldPreserveBuilderExecution({
      state: existing.state,
      payloadJson: existing.payloadJson,
    }) ||
      existing.state === "failed" ||
      Boolean(existing.attemptToken))
  ) {
    return;
  }
  if (existing) {
    const payloadJson = await storeBuilderExecutionPayload({
      payload: plan.payload as unknown as Record<string, unknown>,
      binding: {
        ownerEmail: args.ownerEmail,
        sourceId: args.source.id,
        changeSetId: args.changeSet.id,
        executionId: existing.id,
        idempotencyKey: plan.idempotencyKey,
      },
    });
    const nextReference = builderExecutionPayloadReference(payloadJson);
    const previousReference = builderExecutionPayloadReference(
      existing.payloadJson,
    );
    try {
      const [updated] = await db
        .update(schema.contentDatabaseSourceExecutions)
        .set({
          state: plan.state,
          summary: plan.summary,
          payloadJson,
          lastError: plan.lastError,
          updatedAt: args.now,
        })
        .where(
          and(
            eq(schema.contentDatabaseSourceExecutions.id, existing.id),
            eq(
              schema.contentDatabaseSourceExecutions.payloadJson,
              existing.payloadJson,
            ),
            eq(schema.contentDatabaseSourceExecutions.state, existing.state),
            existing.attemptToken
              ? eq(
                  schema.contentDatabaseSourceExecutions.attemptToken,
                  existing.attemptToken,
                )
              : isNull(schema.contentDatabaseSourceExecutions.attemptToken),
          ),
        )
        .returning({ id: schema.contentDatabaseSourceExecutions.id });
      if (!updated)
        throw new Error("Builder execution changed during prepare.");
    } catch (error) {
      let currentPayloadJson: string | null | undefined;
      try {
        const [current] = await db
          .select({
            payloadJson: schema.contentDatabaseSourceExecutions.payloadJson,
          })
          .from(schema.contentDatabaseSourceExecutions)
          .where(eq(schema.contentDatabaseSourceExecutions.id, existing.id))
          .limit(1);
        currentPayloadJson = current?.payloadJson;
      } catch {
        // Inconclusive readback retains both refs.
      }
      if (currentPayloadJson === payloadJson) {
        // The replacement committed despite an ambiguous acknowledgement.
      } else {
        if (currentPayloadJson !== undefined && nextReference) {
          await deleteBuilderPrivatePayload(nextReference).catch(
            () => undefined,
          );
        }
        throw error;
      }
    }
    if (previousReference && previousReference !== nextReference) {
      await cleanupBuilderPrivatePayload(
        previousReference,
        "superseded prepared execution",
      );
    }
  } else {
    let insertedReference: string | null = null;
    let insertedPayloadJson: string | null = null;
    try {
      const payloadJson = await storeBuilderExecutionPayload({
        payload: plan.payload as unknown as Record<string, unknown>,
        binding: {
          ownerEmail: args.ownerEmail,
          sourceId: args.source.id,
          changeSetId: args.changeSet.id,
          executionId,
          idempotencyKey: plan.idempotencyKey,
        },
      });
      insertedReference = builderExecutionPayloadReference(payloadJson);
      insertedPayloadJson = payloadJson;
      await db.insert(schema.contentDatabaseSourceExecutions).values({
        id: executionId,
        ownerEmail: args.ownerEmail,
        sourceId: args.source.id,
        changeSetId: args.changeSet.id,
        adapter: plan.adapter,
        pushMode: plan.pushMode,
        state: plan.state,
        idempotencyKey: plan.idempotencyKey,
        summary: plan.summary,
        payloadJson,
        lastError: plan.lastError,
        createdAt: args.now,
        updatedAt: args.now,
      });
    } catch (error) {
      let winner:
        | typeof schema.contentDatabaseSourceExecutions.$inferSelect
        | null
        | undefined;
      try {
        [winner] = await db
          .select()
          .from(schema.contentDatabaseSourceExecutions)
          .where(eq(schema.contentDatabaseSourceExecutions.id, executionId))
          .limit(1);
      } catch {
        // Inconclusive readback retains the new ref.
      }
      if (!winner) throw error;
      if (winner.payloadJson === insertedPayloadJson) {
        // The insert committed despite an ambiguous acknowledgement.
      } else if (insertedReference) {
        await deleteBuilderPrivatePayload(insertedReference).catch(
          () => undefined,
        );
      }
      if (
        shouldPreserveBuilderExecution({
          state: winner.state,
          payloadJson: winner.payloadJson,
        }) ||
        winner.state === "failed" ||
        Boolean(winner.attemptToken)
      ) {
        return;
      }
      executionId = winner.id;
    }
  }

  const [execution] = await db
    .select()
    .from(schema.contentDatabaseSourceExecutions)
    .where(eq(schema.contentDatabaseSourceExecutions.id, executionId));
  if (!execution) return;

  const storedPayload = await readBuilderExecutionPayload({
    payloadJson: execution.payloadJson,
    binding: {
      ownerEmail: execution.ownerEmail,
      sourceId: execution.sourceId,
      changeSetId: execution.changeSetId,
      executionId: execution.id,
      idempotencyKey: execution.idempotencyKey,
    },
  });
  const payload = validateBuilderCmsExecutionDryRun({
    storedPayload,
    plan,
    now: args.now,
  });
  const dryRun = payload.dryRun;
  const summary =
    dryRun?.status === "validated"
      ? `${plan.summary} Dry run validated locally.`
      : dryRun?.status === "blocked"
        ? `${plan.summary} Dry run validated blockers locally.`
        : `${plan.summary} Dry run found a stale execution gate.`;

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
  const nextReference = builderExecutionPayloadReference(payloadJson);
  const previousReference = builderExecutionPayloadReference(
    execution.payloadJson,
  );
  try {
    const [updated] = await db
      .update(schema.contentDatabaseSourceExecutions)
      .set({
        state: dryRun?.status === "stale" ? "blocked" : plan.state,
        summary,
        payloadJson,
        lastError:
          dryRun?.status === "stale" ? dryRun.mismatches[0] : plan.lastError,
        updatedAt: args.now,
      })
      .where(
        and(
          eq(schema.contentDatabaseSourceExecutions.id, executionId),
          eq(
            schema.contentDatabaseSourceExecutions.payloadJson,
            execution.payloadJson,
          ),
          eq(schema.contentDatabaseSourceExecutions.state, execution.state),
          execution.attemptToken
            ? eq(
                schema.contentDatabaseSourceExecutions.attemptToken,
                execution.attemptToken,
              )
            : isNull(schema.contentDatabaseSourceExecutions.attemptToken),
        ),
      )
      .returning({ id: schema.contentDatabaseSourceExecutions.id });
    if (!updated)
      throw new Error("Builder execution changed during validation.");
  } catch (error) {
    let currentPayloadJson: string | null | undefined;
    try {
      const [current] = await db
        .select({
          payloadJson: schema.contentDatabaseSourceExecutions.payloadJson,
        })
        .from(schema.contentDatabaseSourceExecutions)
        .where(eq(schema.contentDatabaseSourceExecutions.id, executionId))
        .limit(1);
      currentPayloadJson = current?.payloadJson;
    } catch {
      // Inconclusive readback retains both refs.
    }
    if (currentPayloadJson !== payloadJson) {
      if (currentPayloadJson !== undefined && nextReference) {
        await deleteBuilderPrivatePayload(nextReference).catch(() => undefined);
      }
      throw error;
    }
  }
  if (previousReference && previousReference !== nextReference) {
    await cleanupBuilderPrivatePayload(
      previousReference,
      "superseded validated execution",
    );
  }
}

export default defineAction({
  description:
    "Prepare one local Builder CMS review payload from pending outbound changes. This approves, prepares, and validates a dry-run plan, but never calls Builder APIs.",
  schema: z
    .object({
      databaseId: z.string().optional().describe("Collection ID"),
      documentId: z.string().optional().describe("Collection document/page ID"),
      sourceId: z
        .string()
        .optional()
        .describe("Target source ID (defaults to the primary source)"),
      changeSetIds: z
        .array(z.string())
        .max(BUILDER_SOURCE_REVIEW_PREPARE_LIMIT)
        .optional()
        .describe("Optional bounded set of Builder change-set IDs to prepare"),
      documentIds: z
        .array(z.string())
        .max(BUILDER_SOURCE_REVIEW_PREPARE_LIMIT)
        .optional()
        .describe(
          "Optional document IDs that bound heavy Builder snapshot loading",
        ),
      pushModeConfirmation: z
        .enum(["autosave", "draft", "publish"])
        .optional()
        .describe("Explicit push mode confirmation for the planned write"),
      publicationTransition: z
        .enum(["publish", "unpublish"])
        .optional()
        .describe("Explicit publication transition to validate at write time"),
      confirmUnpublish: z
        .boolean()
        .optional()
        .describe("Required explicit confirmation for unpublish transitions"),
      transitions: z
        .record(z.string(), publicationTransitionSchema)
        .optional()
        .describe(
          "Bounded publication transition intents keyed by selected Builder change-set ID",
        ),
    })
    .superRefine((value, ctx) => {
      if (
        Object.keys(value.transitions ?? {}).length >
        BUILDER_SOURCE_REVIEW_PREPARE_LIMIT
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transitions"],
          message: `Too many publication transitions; maximum is ${BUILDER_SOURCE_REVIEW_PREPARE_LIMIT}.`,
        });
      }
    }),
  run: async (
    args: PrepareBuilderSourceReviewRequest,
  ): Promise<PrepareBuilderSourceReviewResponse> => {
    const timing = createBuilderSourceTiming("prepare_builder_source_review");
    try {
      const { database, snapshot } = await timing.measure(
        "snapshot_read_and_diff_load",
        async () => {
          const database = await resolveDatabaseForSourceMutation(args);
          if (!database) throw new Error("Database not found.");
          await assertAccess("document", database.documentId, "editor");
          const snapshot = await getContentDatabaseSourceSnapshotForReview(
            database,
            args.sourceId,
            args.documentIds,
          );
          return { database, snapshot };
        },
      );
      if (!snapshot || snapshot.sourceType !== "builder-cms") {
        throw new Error(
          "Attach a Builder CMS source before reviewing updates.",
        );
      }
      const requestedIds = new Set(args.changeSetIds ?? []);
      const transitionEntries = Object.entries(args.transitions ?? {}) as Array<
        [string, ExecuteBuilderSourceBatchTransition]
      >;
      const foreignTransitionIds = transitionEntries
        .map(([changeSetId]) => changeSetId)
        .filter((changeSetId) => !requestedIds.has(changeSetId));
      if (foreignTransitionIds.length > 0) {
        throw new Error(
          `Publication transition does not belong to the requested Builder selection: ${foreignTransitionIds.join(", ")}.`,
        );
      }
      const allReviewableChanges = snapshot.changeSets.filter(
        (changeSet) =>
          changeSet.direction === "outbound" &&
          (changeSet.state === "pending_push" ||
            changeSet.state === "staged_revision" ||
            changeSet.state === "approved") &&
          (requestedIds.size === 0 || requestedIds.has(changeSet.id)),
      );
      if (
        requestedIds.size > 0 &&
        allReviewableChanges.length !== requestedIds.size
      ) {
        const foundIds = new Set(
          allReviewableChanges.map((changeSet) => changeSet.id),
        );
        const missingIds = [...requestedIds].filter((id) => !foundIds.has(id));
        throw new Error(
          `Requested Builder change-set is not reviewable: ${missingIds.join(", ")}.`,
        );
      }
      if (allReviewableChanges.length === 0) {
        throw new Error("No pending local Builder changes to review.");
      }
      const reviewableChanges = [...allReviewableChanges]
        .sort(
          (a, b) =>
            reviewPreparePriority(a, snapshot) -
            reviewPreparePriority(b, snapshot),
        )
        .slice(0, BUILDER_SOURCE_REVIEW_PREPARE_LIMIT);
      const authoritativeSnapshot = await withAuthoritativeBuilderTargetRows({
        source: snapshot,
        changeSets: reviewableChanges,
      });

      const approvalStartedAt = timing.start();
      const now = new Date().toISOString();
      const reviewerEmail =
        getRequestUserEmail() ?? "agent-runtime@agent-native.local";
      const approvedIds: string[] = [];
      const preparedChangeSetMappings: PrepareBuilderSourceReviewResponse["preparedChangeSetMappings"] =
        [];
      for (const changeSet of reviewableChanges) {
        const approved = await approveChangeSetForReview({
          sourceId: snapshot.id,
          ownerEmail: database.ownerEmail,
          changeSet,
          reviewerEmail,
          now,
        });
        approvedIds.push(approved.id);
        preparedChangeSetMappings.push({
          requestedChangeSetId: changeSet.id,
          preparedChangeSetId: approved.id,
        });
        const transition =
          args.transitions?.[changeSet.id] ?? args.transitions?.[approved.id];
        await upsertExecutionGate({
          source: authoritativeSnapshot,
          changeSet: approved.changeSet,
          pushModeConfirmation: args.pushModeConfirmation,
          publicationTransition:
            transition?.publicationTransition ?? args.publicationTransition,
          confirmUnpublish:
            transition?.confirmUnpublish ?? args.confirmUnpublish,
          ownerEmail: database.ownerEmail,
          now,
        });
      }

      await getDb()
        .update(schema.contentDatabaseSources)
        .set({ updatedAt: now })
        .where(eq(schema.contentDatabaseSources.id, snapshot.id));
      timing.record(
        "approval_gate_preparation_and_dry_run_validation",
        approvalStartedAt,
      );

      const reviewedSnapshot = await timing.measure(
        "reconciliation_snapshot_load",
        () =>
          getContentDatabaseSourceSnapshotForWrite(
            database,
            args.sourceId,
            reviewableChanges.every((changeSet) => changeSet.documentId)
              ? reviewableChanges.map((changeSet) => changeSet.documentId!)
              : args.documentIds,
          ),
      );
      if (!reviewedSnapshot) throw new Error("Builder source disappeared.");
      // Build the review payload from the TARGET source snapshot, not
      // response.source (which is always the primary). Re-read after the gate
      // upsert so newly validated/blocked/stale execution rows are visible to
      // the returned review payload.
      const reviewedChangeSets = reviewedSnapshot.changeSets.filter(
        (changeSet) => approvedIds.includes(changeSet.id),
      );
      const authoritativeReviewedSnapshot =
        await withAuthoritativeBuilderTargetRows({
          source: reviewedSnapshot,
          changeSets: reviewedChangeSets,
        });
      const review = buildBuilderSourceReviewPayload({
        source: authoritativeReviewedSnapshot,
        changeSets: reviewedChangeSets,
      });
      review.totalRowCount = allReviewableChanges.length;
      review.preparedRowLimit = reviewableChanges.length;

      const result = {
        review,
        preparedChangeSetMappings,
        timings: timing.finish(),
      };
      timing.log("succeeded");
      return result;
    } catch (error) {
      timing.ensure("approval_gate_preparation_and_dry_run_validation");
      timing.log("failed");
      throw error;
    }
  },
});

import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceExecution,
  ContentDatabaseSourcePushMode,
  ContentDatabaseSourceReviewPayload,
  ContentDatabaseSourceRiskLevel,
  ExecuteBuilderSourceBatchTransition,
  PrepareBuilderSourceReviewRequest,
  PrepareBuilderSourceReviewResponse,
} from "../shared/api.js";
import {
  buildBuilderCmsExecutionPlan,
  resolveBuilderCmsWriteEffect,
  validateBuilderCmsExecutionDryRun,
} from "./_builder-cms-write-adapter.js";
import { claimBuilderSourceExecutionGate } from "./_builder-source-execution-claim.js";
import { shouldPreserveBuilderExecution } from "./_builder-source-execution-preservation.js";
import { createBuilderSourceTiming } from "./_builder-source-timings.js";
import {
  canRefreshLocallyBlockedBuilderReview,
  findOpenSourceChangeSet,
  getContentDatabaseSourceSnapshotForWrite,
  resolveDatabaseForSourceMutation,
  serializeSourceRowRecord,
  sourceChangeSetKey,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

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
) {
  if (changeSet.state === "pending_push") return 0;
  if (changeSet.state === "staged_revision") return 1;
  return 2;
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

function stableReviewValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableReviewValue).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableReviewValue(record[key])}`)
    .join(",")}}`;
}

function reviewedRevisionChangeSetId(
  changeSet: ContentDatabaseSourceChangeSet,
) {
  const revision = createHash("sha256")
    .update(
      stableReviewValue({
        databaseItemId: changeSet.databaseItemId,
        documentId: changeSet.documentId,
        kind: changeSet.kind,
        direction: "outbound",
        pushMode: changeSet.pushMode ?? "autosave",
        fieldChanges: changeSet.fieldChanges,
        bodyChange: changeSet.bodyChange,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return `${changeSet.id}-revision-${revision}`;
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
    const effect = resolveBuilderCmsWriteEffect({
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
      fieldChanges: changeSet.fieldChanges,
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

  if (existing) {
    const existingExecutions = await db
      .select({
        state: schema.contentDatabaseSourceExecutions.state,
        payloadJson: schema.contentDatabaseSourceExecutions.payloadJson,
        attemptToken: schema.contentDatabaseSourceExecutions.attemptToken,
      })
      .from(schema.contentDatabaseSourceExecutions)
      .where(
        and(
          eq(schema.contentDatabaseSourceExecutions.sourceId, args.sourceId),
          eq(schema.contentDatabaseSourceExecutions.changeSetId, existing.id),
        ),
      );
    const mayRefreshApprovedPayload =
      canRefreshLocallyBlockedBuilderReview(existingExecutions);

    // Once dispatch may have happened, the approved payload is evidence. Keep
    // it byte-for-byte and let reconciliation decide what can happen next.
    if (existing.state === "approved" && !mayRefreshApprovedPayload) {
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
    await db
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
      .where(eq(schema.contentDatabaseSourceChangeSets.id, existing.id));
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

  // Local Builder diffs are materialized with deterministic IDs (for example,
  // `local-pending-create-*`) before they have a persisted change-set row. Keep
  // that exact identity on first approval so the prepared review matches the
  // row the operator selected. A cancelled/rejected/applied audit row is
  // immutable, though, and may already own that category-level synthetic ID.
  // Bind a materially changed follow-up to a deterministic payload revision so
  // its review, execution, and idempotency evidence cannot alias the old row.
  const changeSetId = selectedExisting
    ? reviewedRevisionChangeSetId(args.changeSet)
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
    await db
      .update(schema.contentDatabaseSourceExecutions)
      .set({
        state: plan.state,
        summary: plan.summary,
        payloadJson: JSON.stringify(plan.payload),
        lastError: plan.lastError,
        updatedAt: args.now,
      })
      .where(eq(schema.contentDatabaseSourceExecutions.id, existing.id));
  } else {
    try {
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
        payloadJson: JSON.stringify(plan.payload),
        lastError: plan.lastError,
        createdAt: args.now,
        updatedAt: args.now,
      });
    } catch (error) {
      const [winner] = await db
        .select()
        .from(schema.contentDatabaseSourceExecutions)
        .where(eq(schema.contentDatabaseSourceExecutions.id, executionId))
        .limit(1);
      if (!winner) throw error;
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

  const payload = validateBuilderCmsExecutionDryRun({
    storedPayload: parsePayload(execution.payloadJson),
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

  await db
    .update(schema.contentDatabaseSourceExecutions)
    .set({
      state: dryRun?.status === "stale" ? "blocked" : plan.state,
      summary,
      payloadJson: JSON.stringify(payload),
      lastError:
        dryRun?.status === "stale" ? dryRun.mismatches[0] : plan.lastError,
      updatedAt: args.now,
    })
    .where(eq(schema.contentDatabaseSourceExecutions.id, executionId));
}

export default defineAction({
  description:
    "Prepare one local Builder CMS review payload from pending outbound changes. This approves, prepares, and validates a dry-run plan, but never calls Builder APIs.",
  schema: z
    .object({
      databaseId: z.string().optional().describe("Database ID"),
      documentId: z.string().optional().describe("Database document/page ID"),
      sourceId: z
        .string()
        .optional()
        .describe("Target source ID (defaults to the primary source)"),
      changeSetIds: z
        .array(z.string())
        .max(BUILDER_SOURCE_REVIEW_PREPARE_LIMIT)
        .optional()
        .describe("Optional bounded set of Builder change-set IDs to prepare"),
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
          const snapshot = await getContentDatabaseSourceSnapshotForWrite(
            database,
            args.sourceId,
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
        .sort((a, b) => reviewPreparePriority(a) - reviewPreparePriority(b))
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

      const { reviewedSnapshot, response } = await timing.measure(
        "reconciliation_and_response_load",
        async () => ({
          reviewedSnapshot: await getContentDatabaseSourceSnapshotForWrite(
            database,
            args.sourceId,
          ),
          response: await getContentDatabaseResponse(database.id),
        }),
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
        ...response,
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

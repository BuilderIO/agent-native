import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseSource,
  ContentDatabaseSourceChangeSet,
  ContentDatabaseSourceExecution,
  ContentDatabaseSourcePushMode,
  ContentDatabaseSourceReviewPayload,
  ContentDatabaseSourceRiskLevel,
  PrepareBuilderSourceReviewRequest,
  PrepareBuilderSourceReviewResponse,
} from "../shared/api.js";
import {
  buildBuilderCmsExecutionPlan,
  resolveBuilderCmsWriteEffect,
  validateBuilderCmsExecutionDryRun,
} from "./_builder-cms-write-adapter.js";
import {
  findOpenSourceChangeSet,
  getContentDatabaseSourceSnapshotForWrite,
  resolveDatabaseForSourceMutation,
  sourceChangeSetKey,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

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

    return {
      changeSetId: changeSet.id,
      databaseItemId: changeSet.databaseItemId,
      documentId: changeSet.documentId,
      title:
        typeof changedTitle === "string" && changedTitle.trim()
          ? changedTitle
          : row?.sourceDisplayKey || "Untitled",
      fieldChanges: changeSet.fieldChanges,
      bodyChange: changeSet.bodyChange,
      riskLevel: changeSet.riskLevel,
      riskReasons: changeSet.riskReasons,
      conflictState: changeSet.conflictState,
      effect: resolveBuilderCmsWriteEffect({
        source: args.source,
        changeSet,
      }),
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
  const existing = await findOpenSourceChangeSet({
    sourceId: args.sourceId,
    key,
    states: ["pending_push", "staged_revision", "approved"],
  });
  const db = getDb();
  const summary = args.changeSet.summary
    .replace(/^Pending local Builder CMS/, "Reviewing local Builder CMS")
    .replace(/^Staged local-only Builder CMS/, "Reviewing local Builder CMS");

  if (existing) {
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
    return existing.id;
  }

  const changeSetId = crypto.randomUUID();
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
  return changeSetId;
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
  const [existing] = await db
    .select()
    .from(schema.contentDatabaseSourceExecutions)
    .where(
      and(
        eq(
          schema.contentDatabaseSourceExecutions.idempotencyKey,
          plan.idempotencyKey,
        ),
        eq(schema.contentDatabaseSourceExecutions.sourceId, args.source.id),
      ),
    );

  const executionId = existing?.id ?? crypto.randomUUID();
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
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Target source ID (defaults to the primary source)"),
    changeSetIds: z
      .array(z.string())
      .optional()
      .describe(
        "Optional pending Builder change-set IDs to prepare. Defaults to every reviewable outbound change-set.",
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
  }),
  run: async (
    args: PrepareBuilderSourceReviewRequest,
  ): Promise<PrepareBuilderSourceReviewResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const snapshot = await getContentDatabaseSourceSnapshotForWrite(
      database,
      args.sourceId,
    );
    if (!snapshot || snapshot.sourceType !== "builder-cms") {
      throw new Error("Attach a Builder CMS source before reviewing updates.");
    }
    const requestedIds = new Set(args.changeSetIds ?? []);
    const reviewableChanges = snapshot.changeSets.filter(
      (changeSet) =>
        changeSet.direction === "outbound" &&
        (changeSet.state === "pending_push" ||
          changeSet.state === "staged_revision" ||
          changeSet.state === "approved") &&
        (requestedIds.size === 0 || requestedIds.has(changeSet.id)),
    );
    if (reviewableChanges.length === 0) {
      throw new Error("No pending local Builder changes to review.");
    }
    if (
      requestedIds.size > 0 &&
      reviewableChanges.length !== requestedIds.size
    ) {
      const foundIds = new Set(
        reviewableChanges.map((changeSet) => changeSet.id),
      );
      const missingIds = [...requestedIds].filter((id) => !foundIds.has(id));
      throw new Error(
        `Requested Builder change-set is not reviewable: ${missingIds.join(", ")}.`,
      );
    }

    const now = new Date().toISOString();
    const reviewerEmail =
      getRequestUserEmail() ?? "agent-runtime@agent-native.local";
    const approvedIds: string[] = [];
    for (const changeSet of reviewableChanges) {
      approvedIds.push(
        await approveChangeSetForReview({
          sourceId: snapshot.id,
          ownerEmail: database.ownerEmail,
          changeSet,
          reviewerEmail,
          now,
        }),
      );
    }

    const approvedSnapshot = await getContentDatabaseSourceSnapshotForWrite(
      database,
      args.sourceId,
    );
    if (!approvedSnapshot) throw new Error("Builder source disappeared.");
    const approvedChangeSets = approvedSnapshot.changeSets.filter(
      (changeSet) =>
        approvedIds.includes(changeSet.id) && changeSet.state === "approved",
    );
    for (const changeSet of approvedChangeSets) {
      await upsertExecutionGate({
        source: approvedSnapshot,
        changeSet,
        pushModeConfirmation: args.pushModeConfirmation,
        publicationTransition: args.publicationTransition,
        confirmUnpublish: args.confirmUnpublish,
        ownerEmail: database.ownerEmail,
        now,
      });
    }

    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ updatedAt: now })
      .where(eq(schema.contentDatabaseSources.id, snapshot.id));

    const reviewedSnapshot = await getContentDatabaseSourceSnapshotForWrite(
      database,
      args.sourceId,
    );
    if (!reviewedSnapshot) throw new Error("Builder source disappeared.");
    // Build the review payload from the TARGET source snapshot, not
    // response.source (which is always the primary). Re-read after the gate
    // upsert so newly validated/blocked/stale execution rows are visible to
    // the returned review payload.
    const reviewedChangeSets = reviewedSnapshot.changeSets.filter((changeSet) =>
      approvedIds.includes(changeSet.id),
    );
    const response = await getContentDatabaseResponse(database.id);

    return {
      ...response,
      review: buildBuilderSourceReviewPayload({
        source: reviewedSnapshot,
        changeSets: reviewedChangeSets,
      }),
    };
  },
});

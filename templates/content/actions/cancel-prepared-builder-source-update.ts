import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  CancelPreparedBuilderSourceUpdateRequest,
  CancelPreparedBuilderSourceUpdateResponse,
} from "../shared/api.js";
import {
  CANCELLED_BUILDER_EXECUTION_SUMMARY,
  CANCELLED_BUILDER_REVIEW_NOTE_PREFIX,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

const PRE_DISPATCH_STATES = new Set(["ready", "write_disabled", "blocked"]);

function parseExecutionPayload(payloadJson: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error(
      "Cannot cancel this Builder update because its execution evidence is unreadable.",
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      "Cannot cancel this Builder update because its execution evidence is ambiguous.",
    );
  }
  return payload as Record<string, unknown>;
}

function isLocalBlockedDryRun(payload: Record<string, unknown>) {
  const dryRun = payload.dryRun;
  return (
    !!dryRun &&
    typeof dryRun === "object" &&
    !Array.isArray(dryRun) &&
    (dryRun as Record<string, unknown>).status === "blocked"
  );
}

function assertProvablyPreDispatch(execution: {
  state: string;
  summary: string;
  payloadJson: string;
  attemptToken: string | null;
}) {
  if (!PRE_DISPATCH_STATES.has(execution.state)) {
    throw new Error(
      `Cannot cancel a Builder execution in state ${execution.state}. Its outcome must be preserved.`,
    );
  }
  if (execution.attemptToken) {
    throw new Error(
      "Cannot cancel this Builder update because a dispatch attempt was recorded.",
    );
  }

  const payload = parseExecutionPayload(execution.payloadJson);
  if (
    Object.prototype.hasOwnProperty.call(payload, "response") ||
    Object.prototype.hasOwnProperty.call(payload, "dispatch")
  ) {
    throw new Error(
      "Cannot cancel this Builder update because dispatch or response evidence was recorded.",
    );
  }
  if (
    execution.state === "blocked" &&
    execution.summary !== CANCELLED_BUILDER_EXECUTION_SUMMARY &&
    !isLocalBlockedDryRun(payload)
  ) {
    throw new Error(
      "Cannot cancel this blocked Builder update because it is not provably a local pre-dispatch block.",
    );
  }
}

function assertCanonicalClaims(
  executions: Array<{ id: string; idempotencyKey: string }>,
  claims: Array<{ idempotencyKey: string; executionId: string }>,
) {
  const idempotencyKeys = executions.map((row) => row.idempotencyKey);
  if (new Set(idempotencyKeys).size !== executions.length) {
    throw new Error(
      "Cannot cancel this Builder update because duplicate execution gates share an idempotency key.",
    );
  }
  if (claims.length !== executions.length) {
    throw new Error(
      "Cannot cancel this Builder update because its canonical execution claim is missing or foreign.",
    );
  }
  const claimByKey = new Map(
    claims.map((claim) => [claim.idempotencyKey, claim.executionId]),
  );
  for (const execution of executions) {
    if (claimByKey.get(execution.idempotencyKey) !== execution.id) {
      throw new Error(
        "Cannot cancel this Builder update because an execution claim points to a different gate.",
      );
    }
  }
}

export default defineAction({
  description:
    "Cancel one exact prepared Builder update only when every execution is provably pre-dispatch. This never calls Builder or deletes audit history.",
  schema: z
    .object({
      databaseId: z.string().optional().describe("Database ID"),
      documentId: z.string().optional().describe("Database document/page ID"),
      sourceId: z.string().describe("Exact Builder source ID"),
      changeSetId: z.string().describe("Exact prepared Builder change-set ID"),
      note: z
        .string()
        .max(500)
        .optional()
        .describe("Optional cancellation note"),
    })
    .refine((value) => value.databaseId || value.documentId, {
      message: "Provide databaseId or documentId.",
    }),
  run: async (
    args: CancelPreparedBuilderSourceUpdateRequest,
  ): Promise<CancelPreparedBuilderSourceUpdateResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const db = getDb();
    const actor = getRequestUserEmail() ?? "agent-runtime@agent-native.local";
    const now = new Date().toISOString();
    let executionIds: string[] = [];
    let status: "cancelled" | "already_cancelled" = "cancelled";

    await db.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(schema.contentDatabaseSources)
        .where(
          and(
            eq(schema.contentDatabaseSources.id, args.sourceId),
            eq(schema.contentDatabaseSources.databaseId, database.id),
          ),
        )
        .limit(1);
      if (!source || source.sourceType !== "builder-cms") {
        throw new Error("The exact Builder source was not found.");
      }

      const [changeSet] = await tx
        .select()
        .from(schema.contentDatabaseSourceChangeSets)
        .where(
          and(
            eq(schema.contentDatabaseSourceChangeSets.id, args.changeSetId),
            eq(schema.contentDatabaseSourceChangeSets.sourceId, source.id),
          ),
        )
        .limit(1);
      if (!changeSet) throw new Error("Source change-set not found.");

      const executions = await tx
        .select()
        .from(schema.contentDatabaseSourceExecutions)
        .where(
          and(
            eq(schema.contentDatabaseSourceExecutions.sourceId, source.id),
            eq(
              schema.contentDatabaseSourceExecutions.changeSetId,
              changeSet.id,
            ),
          ),
        );
      executionIds = executions.map((execution) => execution.id);

      if (executions.length === 0) {
        throw new Error("No prepared Builder execution was found to cancel.");
      }
      for (const execution of executions) assertProvablyPreDispatch(execution);

      const idempotencyKeys = [
        ...new Set(executions.map((row) => row.idempotencyKey)),
      ];
      const claims = await tx
        .select({
          idempotencyKey:
            schema.contentDatabaseSourceExecutionClaims.idempotencyKey,
          executionId: schema.contentDatabaseSourceExecutionClaims.executionId,
        })
        .from(schema.contentDatabaseSourceExecutionClaims)
        .where(
          and(
            eq(
              schema.contentDatabaseSourceExecutionClaims.ownerEmail,
              database.ownerEmail,
            ),
            eq(schema.contentDatabaseSourceExecutionClaims.sourceId, source.id),
            inArray(
              schema.contentDatabaseSourceExecutionClaims.idempotencyKey,
              idempotencyKeys,
            ),
          ),
        );
      assertCanonicalClaims(executions, claims);

      if (changeSet.state === "rejected") {
        const cancellationReviews = await tx
          .select()
          .from(schema.contentDatabaseSourceChangeReviews)
          .where(
            and(
              eq(schema.contentDatabaseSourceChangeReviews.sourceId, source.id),
              eq(
                schema.contentDatabaseSourceChangeReviews.changeSetId,
                changeSet.id,
              ),
              eq(
                schema.contentDatabaseSourceChangeReviews.decision,
                "rejected",
              ),
            ),
          );
        const wasCancelled =
          executions.length > 0 &&
          executions.every(
            (execution) =>
              execution.state === "blocked" &&
              execution.summary === CANCELLED_BUILDER_EXECUTION_SUMMARY,
          ) &&
          cancellationReviews.some((review) =>
            review.note?.startsWith(CANCELLED_BUILDER_REVIEW_NOTE_PREFIX),
          );
        if (!wasCancelled) {
          throw new Error(
            "This Builder change-set was rejected through another review path, not cancelled as a prepared update.",
          );
        }
        status = "already_cancelled";
        return;
      }

      if (changeSet.state !== "approved") {
        throw new Error(
          `Only an approved, prepared Builder change-set can be cancelled; current state is ${changeSet.state}.`,
        );
      }

      await tx
        .update(schema.contentDatabaseSourceExecutions)
        .set({
          state: "blocked",
          summary: CANCELLED_BUILDER_EXECUTION_SUMMARY,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.contentDatabaseSourceExecutions.sourceId, source.id),
            eq(
              schema.contentDatabaseSourceExecutions.changeSetId,
              changeSet.id,
            ),
          ),
        );

      const noteSuffix = args.note?.trim() ? ` Note: ${args.note.trim()}` : "";
      await tx.insert(schema.contentDatabaseSourceChangeReviews).values({
        id: crypto.randomUUID(),
        ownerEmail: database.ownerEmail,
        sourceId: source.id,
        changeSetId: changeSet.id,
        reviewerEmail: actor,
        decision: "rejected",
        stateFrom: changeSet.state,
        stateTo: "rejected",
        note: `${CANCELLED_BUILDER_REVIEW_NOTE_PREFIX} by ${actor} at ${now}.${noteSuffix}`,
        createdAt: now,
      });
      await tx
        .update(schema.contentDatabaseSourceChangeSets)
        .set({ state: "rejected", updatedAt: now })
        .where(eq(schema.contentDatabaseSourceChangeSets.id, changeSet.id));
      await tx
        .update(schema.contentDatabaseSources)
        .set({ updatedAt: now })
        .where(eq(schema.contentDatabaseSources.id, source.id));
    });

    return {
      ...(await getContentDatabaseResponse(database.id)),
      cancellation: {
        sourceId: args.sourceId,
        changeSetId: args.changeSetId,
        executionIds,
        status,
        cancelledAt: now,
        cancelledBy: actor,
      },
    };
  },
});

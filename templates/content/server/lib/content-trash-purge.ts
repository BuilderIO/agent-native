import { createHash, randomUUID } from "node:crypto";

import {
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  AGENT_BACKGROUND_PROCESSOR_ROUTE,
  AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD,
  dispatchPathTargetsNetlifyBackgroundFunction,
  fireInternalDispatch,
  getConfiguredAppBasePath,
  resolveDurableBackgroundDispatchPath,
  signScopedAgentAccessToken,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import {
  deleteTrashedDocumentSubtree,
  PermanentDeleteScopeChangedError,
} from "../../actions/delete-document.js";
import { getDb, schema } from "../db/index.js";

export const CONTENT_TRASH_PURGE_TOKEN_KIND = "content-trash-purge-operation";
export const CONTENT_TRASH_PURGE_WORKER_PATH =
  "/api/_agent-native-background/content-trash-purge-worker";
const BATCH_UNITS = 5;
const LEASE_MS = 2 * 60 * 1000;

class ContentTrashPurgeLeaseLostError extends Error {}

export function hashTrashScopeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function contentTrashPurgeHasDurableTransport(): boolean {
  return dispatchPathTargetsNetlifyBackgroundFunction(
    resolveDurableBackgroundDispatchPath(CONTENT_TRASH_PURGE_WORKER_PATH),
  );
}

export async function dispatchContentTrashPurge(
  operationId: string,
): Promise<void> {
  const processorRoute = `${getConfiguredAppBasePath()}${CONTENT_TRASH_PURGE_WORKER_PATH}`;
  const dispatchPath = resolveDurableBackgroundDispatchPath(
    CONTENT_TRASH_PURGE_WORKER_PATH,
  );
  const durable = dispatchPathTargetsNetlifyBackgroundFunction(dispatchPath);
  const token = signScopedAgentAccessToken({
    resourceKind: CONTENT_TRASH_PURGE_TOKEN_KIND,
    resourceId: operationId,
    ttlSeconds: 15 * 60,
  });
  await fireInternalDispatch({
    path: dispatchPath,
    taskId: operationId,
    awaitResponse: true,
    body: {
      operationId,
      token,
      ...(durable
        ? {
            [AGENT_BACKGROUND_PROCESSOR_FIELD]:
              AGENT_BACKGROUND_PROCESSOR_ROUTE,
            [AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD]: processorRoute,
          }
        : {}),
    },
  });
}

export async function processContentTrashPurge(operationId: string) {
  const db = getDb();
  const leaseToken = randomUUID();
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString();
  const [claimed] = await db
    .update(schema.contentTrashPurgeOperations)
    .set({ status: "running", leaseToken, leaseExpiresAt, updatedAt: now })
    .where(
      and(
        eq(schema.contentTrashPurgeOperations.id, operationId),
        or(
          eq(schema.contentTrashPurgeOperations.status, "queued"),
          eq(schema.contentTrashPurgeOperations.status, "retryable"),
          and(
            eq(schema.contentTrashPurgeOperations.status, "running"),
            or(
              isNull(schema.contentTrashPurgeOperations.leaseExpiresAt),
              lt(schema.contentTrashPurgeOperations.leaseExpiresAt, now),
            ),
          ),
        ),
      ),
    )
    .returning();
  if (!claimed)
    return { accepted: false, reason: "already-claimed-or-terminal" };

  const allPending = await db
    .select({
      unitId: schema.contentTrashPurgePlanItems.unitId,
      rootDocumentId: schema.contentTrashPurgePlanItems.rootDocumentId,
      ownerEmail: schema.contentTrashPurgePlanItems.ownerEmail,
      ancestorUnitIdsJson:
        schema.contentTrashPurgePlanItems.ancestorUnitIdsJson,
    })
    .from(schema.contentTrashPurgePlanItems)
    .where(
      and(
        eq(schema.contentTrashPurgePlanItems.planId, claimed.planId),
        eq(schema.contentTrashPurgePlanItems.eligibility, "eligible"),
        eq(schema.contentTrashPurgePlanItems.outcome, "pending"),
      ),
    );
  const pendingUnits = [
    ...new Map(allPending.map((item) => [item.unitId, item])).values(),
  ];
  const blockedUnits = new Set<string>();
  for (const unit of pendingUnits) {
    try {
      await assertAccess("document", unit.rootDocumentId, "admin");
    } catch {
      blockedUnits.add(unit.unitId);
      for (const item of allPending.filter(
        (row) => row.unitId === unit.unitId,
      )) {
        for (const ancestor of JSON.parse(
          item.ancestorUnitIdsJson,
        ) as string[]) {
          blockedUnits.add(ancestor);
        }
      }
    }
  }
  if (blockedUnits.size > 0) {
    await db.transaction(async (tx) => {
      const transactionDb = tx as unknown as ReturnType<typeof getDb>;
      const completedAt = new Date().toISOString();
      const receipts = await transactionDb
        .update(schema.contentTrashPurgePlanItems)
        .set({
          outcome: "blocked",
          outcomeDetail:
            "Access changed after confirmation in a dependent deletion unit",
          completedAt,
        })
        .where(
          and(
            eq(schema.contentTrashPurgePlanItems.planId, claimed.planId),
            inArray(schema.contentTrashPurgePlanItems.unitId, [
              ...blockedUnits,
            ]),
            eq(schema.contentTrashPurgePlanItems.outcome, "pending"),
          ),
        )
        .returning({ id: schema.contentTrashPurgePlanItems.id });
      if (receipts.length === 0) return;
      const [operationReceipt] = await transactionDb
        .update(schema.contentTrashPurgeOperations)
        .set({
          blockedCount: sql`${schema.contentTrashPurgeOperations.blockedCount} + ${receipts.length}`,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(schema.contentTrashPurgeOperations.id, operationId),
            eq(schema.contentTrashPurgeOperations.leaseToken, leaseToken),
            eq(schema.contentTrashPurgeOperations.status, "running"),
          ),
        )
        .returning({ id: schema.contentTrashPurgeOperations.id });
      if (!operationReceipt) throw new ContentTrashPurgeLeaseLostError();
      claimed.blockedCount += receipts.length;
    });
  }
  const units = pendingUnits
    .filter((unit) => !blockedUnits.has(unit.unitId))
    .slice(0, BATCH_UNITS);

  for (const unit of units) {
    try {
      await db.transaction(async (tx) => {
        const transactionDb = tx as unknown as ReturnType<typeof getDb>;
        const transactionNow = new Date().toISOString();
        const renewedUntil = new Date(Date.now() + LEASE_MS).toISOString();
        const [leaseReceipt] = await transactionDb
          .update(schema.contentTrashPurgeOperations)
          .set({ leaseExpiresAt: renewedUntil, updatedAt: transactionNow })
          .where(
            and(
              eq(schema.contentTrashPurgeOperations.id, operationId),
              eq(schema.contentTrashPurgeOperations.leaseToken, leaseToken),
              eq(schema.contentTrashPurgeOperations.status, "running"),
              gt(
                schema.contentTrashPurgeOperations.leaseExpiresAt,
                transactionNow,
              ),
            ),
          )
          .returning({ id: schema.contentTrashPurgeOperations.id });
        if (!leaseReceipt) throw new ContentTrashPurgeLeaseLostError();
        const frozen = await transactionDb
          .select({
            documentId: schema.contentTrashPurgePlanItems.documentId,
            expectedTrashedAt:
              schema.contentTrashPurgePlanItems.expectedTrashedAt,
            expectedParentId:
              schema.contentTrashPurgePlanItems.expectedParentId,
            expectedScopeFingerprint:
              schema.contentTrashPurgePlanItems.expectedScopeFingerprint,
          })
          .from(schema.contentTrashPurgePlanItems)
          .where(
            and(
              eq(schema.contentTrashPurgePlanItems.planId, claimed.planId),
              eq(schema.contentTrashPurgePlanItems.unitId, unit.unitId),
            ),
          );
        let deleted: string[];
        try {
          deleted = await deleteTrashedDocumentSubtree(
            transactionDb,
            unit.rootDocumentId,
            unit.ownerEmail,
            frozen,
            frozen[0]?.expectedScopeFingerprint,
          );
        } catch (error) {
          if (!(error instanceof PermanentDeleteScopeChangedError)) throw error;
          await transactionDb
            .update(schema.contentTrashPurgePlanItems)
            .set({
              outcome: "conflicted",
              outcomeDetail: "Trash scope changed after confirmation",
              completedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(schema.contentTrashPurgePlanItems.planId, claimed.planId),
                eq(schema.contentTrashPurgePlanItems.unitId, unit.unitId),
              ),
            );
          return;
        }
        await transactionDb
          .update(schema.contentTrashPurgePlanItems)
          .set({ outcome: "deleted", completedAt: new Date().toISOString() })
          .where(
            and(
              eq(schema.contentTrashPurgePlanItems.planId, claimed.planId),
              eq(schema.contentTrashPurgePlanItems.unitId, unit.unitId),
            ),
          );
        const [countReceipt] = await transactionDb
          .update(schema.contentTrashPurgeOperations)
          .set({
            deletedCount: sql`${schema.contentTrashPurgeOperations.deletedCount} + ${deleted.length}`,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(schema.contentTrashPurgeOperations.id, operationId),
              eq(schema.contentTrashPurgeOperations.leaseToken, leaseToken),
            ),
          )
          .returning({
            deletedCount: schema.contentTrashPurgeOperations.deletedCount,
          });
        if (!countReceipt) throw new ContentTrashPurgeLeaseLostError();
        claimed.deletedCount += deleted.length;
      });
    } catch (error) {
      if (error instanceof ContentTrashPurgeLeaseLostError) throw error;
      await db.transaction(async (tx) => {
        const transactionDb = tx as unknown as ReturnType<typeof getDb>;
        const completedAt = new Date().toISOString();
        const receipts = await transactionDb
          .update(schema.contentTrashPurgePlanItems)
          .set({
            outcome: "blocked",
            outcomeDetail:
              error instanceof Error ? error.message : String(error),
            completedAt,
          })
          .where(
            and(
              eq(schema.contentTrashPurgePlanItems.planId, claimed.planId),
              eq(schema.contentTrashPurgePlanItems.unitId, unit.unitId),
              eq(schema.contentTrashPurgePlanItems.outcome, "pending"),
            ),
          )
          .returning({ id: schema.contentTrashPurgePlanItems.id });
        if (receipts.length === 0) return;
        const [operationReceipt] = await transactionDb
          .update(schema.contentTrashPurgeOperations)
          .set({
            blockedCount: sql`${schema.contentTrashPurgeOperations.blockedCount} + ${receipts.length}`,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(schema.contentTrashPurgeOperations.id, operationId),
              eq(schema.contentTrashPurgeOperations.leaseToken, leaseToken),
              eq(schema.contentTrashPurgeOperations.status, "running"),
            ),
          )
          .returning({ id: schema.contentTrashPurgeOperations.id });
        if (!operationReceipt) throw new ContentTrashPurgeLeaseLostError();
        claimed.blockedCount += receipts.length;
      });
    }
  }

  const remaining = await db
    .select({ id: schema.contentTrashPurgePlanItems.id })
    .from(schema.contentTrashPurgePlanItems)
    .where(
      and(
        eq(schema.contentTrashPurgePlanItems.planId, claimed.planId),
        eq(schema.contentTrashPurgePlanItems.eligibility, "eligible"),
        eq(schema.contentTrashPurgePlanItems.outcome, "pending"),
      ),
    )
    .limit(1);
  if (remaining.length > 0) {
    if (!contentTrashPurgeHasDurableTransport()) {
      const [releaseReceipt] = await db
        .update(schema.contentTrashPurgeOperations)
        .set({
          status: "retryable",
          leaseToken: null,
          leaseExpiresAt: null,
          lastError:
            "The current host has no durable continuation transport; retry to process the next bounded batch",
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.contentTrashPurgeOperations.id, operationId),
            eq(schema.contentTrashPurgeOperations.leaseToken, leaseToken),
          ),
        )
        .returning({ id: schema.contentTrashPurgeOperations.id });
      if (!releaseReceipt)
        throw new Error("Trash purge lease was lost before continuation");
      return { accepted: true, continued: false, status: "retryable" };
    }
    const [queueReceipt] = await db
      .update(schema.contentTrashPurgeOperations)
      .set({
        status: "queued",
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.contentTrashPurgeOperations.id, operationId),
          eq(schema.contentTrashPurgeOperations.leaseToken, leaseToken),
        ),
      )
      .returning({ id: schema.contentTrashPurgeOperations.id });
    if (!queueReceipt)
      throw new Error("Trash purge lease was lost before continuation");
    try {
      await dispatchContentTrashPurge(operationId);
    } catch (error) {
      await db
        .update(schema.contentTrashPurgeOperations)
        .set({
          status: "retryable",
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.contentTrashPurgeOperations.id, operationId));
      throw error;
    }
    return { accepted: true, continued: true };
  }

  const outcomes = await db
    .select({
      outcome: schema.contentTrashPurgePlanItems.outcome,
      eligibility: schema.contentTrashPurgePlanItems.eligibility,
    })
    .from(schema.contentTrashPurgePlanItems)
    .where(eq(schema.contentTrashPurgePlanItems.planId, claimed.planId));
  const conflictedCount = outcomes.filter(
    (item) => item.outcome === "conflicted",
  ).length;
  const status =
    conflictedCount > 0
      ? "conflicted"
      : claimed.blockedCount > 0
        ? "partially_completed"
        : "succeeded";
  const [completionReceipt] = await db
    .update(schema.contentTrashPurgeOperations)
    .set({
      status,
      blockedCount: claimed.blockedCount,
      conflictedCount,
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(schema.contentTrashPurgeOperations.id, operationId),
        eq(schema.contentTrashPurgeOperations.leaseToken, leaseToken),
      ),
    )
    .returning({ id: schema.contentTrashPurgeOperations.id });
  if (!completionReceipt)
    throw new Error("Trash purge lease was lost before completion");
  return { accepted: true, continued: false, status };
}

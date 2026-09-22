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
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { contentTrashPredicates } from "../../actions/_content-trash-query.js";
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

export async function authorizedTrashDocumentIds(
  db: ReturnType<typeof getDb>,
  documentIds: string[],
) {
  if (documentIds.length === 0) return new Set<string>();
  const document = alias(schema.documents, "purge_worker_document");
  const database = alias(schema.contentDatabases, "purge_worker_database");
  const host = alias(schema.documents, "purge_worker_host");
  const canonicalDatabaseId = sql<string>`(select min(${schema.contentDatabases.id}) from ${schema.contentDatabases} where ${schema.contentDatabases.documentId} = ${document.id})`;
  const { authority, deletedAt } = contentTrashPredicates(
    document,
    database,
    accessFilter(document, schema.documentShares, undefined, "admin"),
    accessFilter(document, schema.documentShares),
    accessFilter(host, schema.documentShares, undefined, "editor"),
  );
  const rows = await db
    .select({ id: document.id })
    .from(document)
    .leftJoin(database, eq(database.id, canonicalDatabaseId))
    .leftJoin(host, eq(host.id, database.ownerDocumentId))
    .where(
      and(inArray(document.id, documentIds), isNotNull(deletedAt), authority),
    );
  return new Set(rows.map(({ id }) => id));
}

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

  try {
    const batchResult = await db.transaction(
      async (tx) => {
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

        const allPending = await transactionDb
          .select({
            unitId: schema.contentTrashPurgePlanItems.unitId,
            rootDocumentId: schema.contentTrashPurgePlanItems.rootDocumentId,
            documentId: schema.contentTrashPurgePlanItems.documentId,
            ownerEmail: schema.contentTrashPurgePlanItems.ownerEmail,
            expectedTrashedAt:
              schema.contentTrashPurgePlanItems.expectedTrashedAt,
            expectedParentId:
              schema.contentTrashPurgePlanItems.expectedParentId,
            expectedScopeFingerprint:
              schema.contentTrashPurgePlanItems.expectedScopeFingerprint,
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
        const authorizedIds = await authorizedTrashDocumentIds(
          transactionDb,
          allPending.map(({ documentId }) => documentId),
        );
        const blockedUnits = new Set<string>();
        for (const item of allPending) {
          if (authorizedIds.has(item.documentId)) continue;
          blockedUnits.add(item.unitId);
          for (const ancestor of JSON.parse(
            item.ancestorUnitIdsJson,
          ) as string[]) {
            blockedUnits.add(ancestor);
          }
        }

        let blockedDelta = 0;
        if (blockedUnits.size > 0) {
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
          blockedDelta = receipts.length;
          if (blockedDelta > 0) {
            const [operationReceipt] = await transactionDb
              .update(schema.contentTrashPurgeOperations)
              .set({
                blockedCount: sql`${schema.contentTrashPurgeOperations.blockedCount} + ${blockedDelta}`,
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
          }
        }

        const pendingUnits = [
          ...new Map(allPending.map((item) => [item.unitId, item])).values(),
        ];
        const units = pendingUnits
          .filter((unit) => !blockedUnits.has(unit.unitId))
          .slice(0, BATCH_UNITS);
        let deletedDelta = 0;
        for (const unit of units) {
          const frozen = allPending.filter(
            (item) => item.unitId === unit.unitId,
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
            if (!(error instanceof PermanentDeleteScopeChangedError))
              throw error;
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
            continue;
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
          deletedDelta += deleted.length;
        }
        if (deletedDelta > 0) {
          const [countReceipt] = await transactionDb
            .update(schema.contentTrashPurgeOperations)
            .set({
              deletedCount: sql`${schema.contentTrashPurgeOperations.deletedCount} + ${deletedDelta}`,
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
        }
        return { blockedDelta, deletedDelta };
      },
      { isolationLevel: "serializable" },
    );
    claimed.blockedCount += batchResult.blockedDelta;
    claimed.deletedCount += batchResult.deletedDelta;
  } catch (error) {
    if (error instanceof ContentTrashPurgeLeaseLostError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const [retryReceipt] = await db
      .update(schema.contentTrashPurgeOperations)
      .set({
        status: "retryable",
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: message,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.contentTrashPurgeOperations.id, operationId),
          eq(schema.contentTrashPurgeOperations.leaseToken, leaseToken),
          eq(schema.contentTrashPurgeOperations.status, "running"),
        ),
      )
      .returning({ id: schema.contentTrashPurgeOperations.id });
    if (!retryReceipt) throw new ContentTrashPurgeLeaseLostError();
    return { accepted: true, continued: false, status: "retryable" };
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
      const [retryReceipt] = await db
        .update(schema.contentTrashPurgeOperations)
        .set({
          status: "retryable",
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.contentTrashPurgeOperations.id, operationId),
            eq(schema.contentTrashPurgeOperations.status, "queued"),
          ),
        )
        .returning({ id: schema.contentTrashPurgeOperations.id });
      if (!retryReceipt) {
        const [current] = await db
          .select({ status: schema.contentTrashPurgeOperations.status })
          .from(schema.contentTrashPurgeOperations)
          .where(eq(schema.contentTrashPurgeOperations.id, operationId))
          .limit(1);
        if (!current)
          throw new Error("Trash purge operation disappeared after dispatch");
        return { accepted: true, continued: true, status: current.status };
      }
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

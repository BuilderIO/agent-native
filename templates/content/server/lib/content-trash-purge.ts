import { createHash, randomUUID } from "node:crypto";

import {
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  AGENT_BACKGROUND_PROCESSOR_ROUTE,
  AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD,
  dispatchPathTargetsNetlifyBackgroundFunction,
  fireInternalDispatch,
  getConfiguredAppBasePath,
  resolveDurableBackgroundDispatchPath,
  scopedAgentAccessResourceId,
  signShortLivedToken,
} from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { cleanupBuilderPrivatePayload } from "../../actions/_builder-cms-blob-custody.js";
import { contentTrashPredicates } from "../../actions/_content-trash-query.js";
import { transactionRows } from "../../actions/_user-setting-transaction.js";
import {
  deleteTrashedDocumentSubtree,
  PermanentDeleteScopeChangedError,
} from "../../actions/delete-document.js";
import { getDb, schema } from "../db/index.js";
import {
  CONTENT_TRASH_PROTECTION_GROUP_BUDGET,
  inspectTrashGroupProtection,
  type TrashGroupProtection,
} from "./content-trash-protection.js";
import { firstRow } from "./first-row.js";

export const CONTENT_TRASH_PURGE_TOKEN_KIND = "content-trash-purge-operation";
export const CONTENT_TRASH_PURGE_WORKER_PATH =
  "/api/_agent-native-background/content-trash-purge-worker";
export const CONTENT_TRASH_RETENTION_ACTOR =
  "content-trash-retention@system.invalid";
export const CONTENT_TRASH_RETENTION_PLAN_MODE = "retention";
export const CONTENT_TRASH_RETENTION_UNIT_ATTEMPTS = 3;
export const CONTENT_TRASH_RETENTION_SETTING_KEY = "content-trash-retention";
export const CONTENT_TRASH_RETENTION_REARM_REASON =
  "Cancelled because automatic deletion started its 30 days again";
const CONTENT_TRASH_RETENTION_LOCK = "content-trash-retention:publish";
const BATCH_UNITS = 5;
const LEASE_MS = 2 * 60 * 1000;
const TRANSIENT_SQLSTATES = new Set(["40001", "40P01", "57014"]);
const PROTECTION_CONFLICT_DETAIL: Record<
  Exclude<TrashGroupProtection, "clear">,
  string
> = {
  protected: "Protected from automatic deletion after it was planned",
  "over-budget": "Too many related Pages to check before automatic deletion",
  "out-of-time": "Ran out of time checking related Pages before deletion",
};

const retentionScanCursorSchema = z.object({
  trashedAt: z.string(),
  id: z.string(),
});
const retentionPlanFiltersSchema = z.looseObject({
  cutoff: z.string(),
  startedAt: z.string(),
  scan: z
    .object({
      startedAfter: retentionScanCursorSchema.nullable(),
      stoppedAt: retentionScanCursorSchema.nullable(),
      exhausted: z.boolean(),
      bound: retentionScanCursorSchema.nullable().optional(),
    })
    .optional(),
  skipped: z.record(z.string(), z.string()).optional(),
  unitFailures: z.record(z.string(), z.number().int().positive()).optional(),
});
export type ContentTrashRetentionPlanFilters = z.infer<
  typeof retentionPlanFiltersSchema
>;

export function parseContentTrashRetentionPlanFilters(
  filtersJson: string,
): ContentTrashRetentionPlanFilters {
  return retentionPlanFiltersSchema.parse(JSON.parse(filtersJson));
}

const retentionSettingSchema = z.object({
  startedAt: z.iso.datetime(),
  lastSweepAt: z.iso.datetime().optional(),
});
export type ContentTrashRetentionSetting = z.infer<
  typeof retentionSettingSchema
>;

export function parseContentTrashRetentionSetting(
  value: unknown,
): ContentTrashRetentionSetting {
  const parsed = retentionSettingSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Setting "${CONTENT_TRASH_RETENTION_SETTING_KEY}" is invalid; automatic Trash deletion will not run until it is repaired: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

type RetentionStateTransaction = { execute(query: SQL): Promise<unknown> };

export async function lockContentTrashRetentionState(
  tx: RetentionStateTransaction,
  mode: "exclusive" | "shared",
): Promise<ContentTrashRetentionSetting | null> {
  await tx.execute(
    mode === "exclusive"
      ? sql`SELECT pg_advisory_xact_lock(hashtextextended(${CONTENT_TRASH_RETENTION_LOCK}, 0::bigint))`
      : sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${CONTENT_TRASH_RETENTION_LOCK}, 0::bigint))`,
  );
  const row = firstRow(
    transactionRows(
      await tx.execute(
        mode === "exclusive"
          ? sql`SELECT value FROM public.settings WHERE key = ${CONTENT_TRASH_RETENTION_SETTING_KEY} FOR UPDATE`
          : sql`SELECT value FROM public.settings WHERE key = ${CONTENT_TRASH_RETENTION_SETTING_KEY} FOR SHARE`,
      ),
    ),
  );
  return row
    ? parseContentTrashRetentionSetting(JSON.parse(String(row.value)))
    : null;
}

function isTransientDatabaseError(error: unknown): boolean {
  let cause = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!cause || typeof cause !== "object") return false;
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      return TRANSIENT_SQLSTATES.has(code) || code.startsWith("08");
    }
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}

class ContentTrashPurgeLeaseLostError extends Error {}

class RetentionUnitFailedError extends Error {
  constructor(
    readonly unitId: string,
    cause: unknown,
  ) {
    super(
      `Automatic deletion of Trash root ${unitId} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

async function recordRetentionUnitFailure(
  db: ReturnType<typeof getDb>,
  options: {
    operationId: string;
    planId: string;
    leaseToken: string;
    failure: RetentionUnitFailedError;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const transactionDb = tx as unknown as ReturnType<typeof getDb>;
    const now = new Date().toISOString();
    const receipt = firstRow(
      await transactionDb
        .update(schema.contentTrashPurgeOperations)
        .set({ lastError: options.failure.message, updatedAt: now })
        .where(
          and(
            eq(schema.contentTrashPurgeOperations.id, options.operationId),
            eq(
              schema.contentTrashPurgeOperations.leaseToken,
              options.leaseToken,
            ),
            eq(schema.contentTrashPurgeOperations.status, "running"),
            gt(schema.contentTrashPurgeOperations.leaseExpiresAt, now),
          ),
        )
        .returning({ id: schema.contentTrashPurgeOperations.id }),
    );
    if (!receipt) throw new ContentTrashPurgeLeaseLostError();
    const plan = firstRow(
      await transactionDb
        .select({ filtersJson: schema.contentTrashPurgePlans.filtersJson })
        .from(schema.contentTrashPurgePlans)
        .where(eq(schema.contentTrashPurgePlans.id, options.planId))
        .limit(1),
    );
    if (!plan) throw new Error(`Retention plan ${options.planId} is missing`);
    const filters = parseContentTrashRetentionPlanFilters(plan.filtersJson);
    const { unitId } = options.failure;
    const attempts = (filters.unitFailures?.[unitId] ?? 0) + 1;
    await transactionDb
      .update(schema.contentTrashPurgePlans)
      .set({
        filtersJson: JSON.stringify({
          ...filters,
          unitFailures: { ...filters.unitFailures, [unitId]: attempts },
        }),
        updatedAt: now,
      })
      .where(eq(schema.contentTrashPurgePlans.id, options.planId));
    const exhausted = attempts >= CONTENT_TRASH_RETENTION_UNIT_ATTEMPTS;
    if (exhausted) {
      await transactionDb
        .update(schema.contentTrashPurgePlanItems)
        .set({
          outcome: "failed",
          outcomeDetail: `${options.failure.message} (attempt ${attempts} of ${CONTENT_TRASH_RETENTION_UNIT_ATTEMPTS})`,
          completedAt: now,
        })
        .where(
          and(
            eq(schema.contentTrashPurgePlanItems.planId, options.planId),
            eq(schema.contentTrashPurgePlanItems.unitId, unitId),
            eq(schema.contentTrashPurgePlanItems.outcome, "pending"),
          ),
        );
    }
    return exhausted;
  });
}

async function stillTrashedDocumentIds(
  db: ReturnType<typeof getDb>,
  items: Array<{ documentId: string; ownerEmail: string }>,
) {
  if (items.length === 0) return new Set<string>();
  // guard:allow-unscoped — automatic deletion acts for every owner; it re-checks that each frozen Page is still in Trash with the same owner.
  const rows = await db
    .select({
      id: schema.documents.id,
      ownerEmail: schema.documents.ownerEmail,
    })
    .from(schema.documents)
    .where(
      and(
        inArray(
          schema.documents.id,
          items.map(({ documentId }) => documentId),
        ),
        isNotNull(schema.documents.trashedAt),
      ),
    );
  const ownerById = new Map(rows.map((row) => [row.id, row.ownerEmail]));
  return new Set(
    items
      .filter((item) => ownerById.get(item.documentId) === item.ownerEmail)
      .map(({ documentId }) => documentId),
  );
}

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
  // Legacy token format on purpose: this only travels in the dispatch body to
  // another build of this app, so a rolling deploy must verify what an older
  // build minted, and an older build must verify what this one mints.
  const token = signShortLivedToken({
    resourceId: scopedAgentAccessResourceId(
      CONTENT_TRASH_PURGE_TOKEN_KIND,
      operationId,
    ),
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
    const planRows = await db
      .select({
        mode: schema.contentTrashPurgePlans.mode,
        filtersJson: schema.contentTrashPurgePlans.filtersJson,
      })
      .from(schema.contentTrashPurgePlans)
      .where(eq(schema.contentTrashPurgePlans.id, claimed.planId))
      .limit(1);
    const plan = firstRow(planRows);
    const retention =
      claimed.actorEmail === CONTENT_TRASH_RETENTION_ACTOR &&
      plan?.mode === CONTENT_TRASH_RETENTION_PLAN_MODE;
    const retentionGeneration = retention
      ? parseContentTrashRetentionPlanFilters(plan.filtersJson).startedAt
      : null;
    const permittedDocumentIds = (
      transactionDb: ReturnType<typeof getDb>,
      items: Array<{ documentId: string; ownerEmail: string }>,
    ) =>
      retention
        ? stillTrashedDocumentIds(transactionDb, items)
        : authorizedTrashDocumentIds(
            transactionDb,
            items.map(({ documentId }) => documentId),
          );
    const blockedDetail = retention
      ? "No longer in Trash when automatic deletion ran"
      : "Access changed after confirmation in a dependent deletion unit";
    // One transaction per Trash unit. Each unit sorts only its own locks, so
    // holding one unit's pages while locking the next unit's collections
    // would break Content's row-lock order.
    for (let pass = 0; pass < BATCH_UNITS; pass += 1) {
      const batch = db.transaction(
        async (tx) => {
          const transactionDb = tx as unknown as ReturnType<typeof getDb>;
          const current =
            retentionGeneration === null
              ? null
              : await lockContentTrashRetentionState(transactionDb, "shared");
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
          if (
            retentionGeneration !== null &&
            current?.startedAt !== retentionGeneration
          ) {
            await transactionDb
              .update(schema.contentTrashPurgeOperations)
              .set({
                status: "failed",
                lastError: CONTENT_TRASH_RETENTION_REARM_REASON,
                leaseToken: null,
                leaseExpiresAt: null,
                completedAt: transactionNow,
                updatedAt: transactionNow,
              })
              .where(eq(schema.contentTrashPurgeOperations.id, operationId));
            await transactionDb
              .update(schema.contentTrashPurgePlanItems)
              .set({
                outcome: "cancelled",
                outcomeDetail: CONTENT_TRASH_RETENTION_REARM_REASON,
                completedAt: transactionNow,
              })
              .where(
                and(
                  eq(schema.contentTrashPurgePlanItems.planId, claimed.planId),
                  eq(schema.contentTrashPurgePlanItems.outcome, "pending"),
                ),
              );
            return { cancelled: true as const };
          }

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
            )
            .orderBy(
              asc(schema.contentTrashPurgePlanItems.unitId),
              asc(schema.contentTrashPurgePlanItems.documentId),
            );
          // Through every item of a blocked unit, as the planner propagates:
          // the item that lost access may not be the one whose collection
          // another unit owns.
          const ancestorsOf = new Map<string, Set<string>>();
          const dependentsOf = new Map<string, Set<string>>();
          for (const item of allPending) {
            for (const ancestor of JSON.parse(
              item.ancestorUnitIdsJson,
            ) as string[]) {
              ancestorsOf.set(
                item.unitId,
                (ancestorsOf.get(item.unitId) ?? new Set()).add(ancestor),
              );
              dependentsOf.set(
                ancestor,
                (dependentsOf.get(ancestor) ?? new Set()).add(item.unitId),
              );
            }
          }
          const closure = (start: string, edges: Map<string, Set<string>>) => {
            const reached = new Set([start]);
            for (const unitId of reached) {
              for (const next of edges.get(unitId) ?? []) reached.add(next);
            }
            return reached;
          };

          // In the same transaction as the delete it allows: a check from an
          // earlier unit's transaction misses a share revoked since it
          // committed. A unit is blocked exactly when it or a unit that
          // depends on it has lost access, so only those are checked.
          const pendingUnits = [
            ...new Map(allPending.map((item) => [item.unitId, item])).values(),
          ];
          const checkedUnits = new Set<string>();
          const blockedUnits = new Set<string>();
          let unitToDelete: (typeof pendingUnits)[number] | undefined;
          for (const candidate of pendingUnits) {
            if (blockedUnits.has(candidate.unitId)) continue;
            const unchecked = new Set(
              [...closure(candidate.unitId, dependentsOf)].filter(
                (unitId) => !checkedUnits.has(unitId),
              ),
            );
            const items = allPending.filter((item) =>
              unchecked.has(item.unitId),
            );
            const authorizedIds = await permittedDocumentIds(
              transactionDb,
              items,
            );
            for (const unitId of unchecked) checkedUnits.add(unitId);
            for (const item of items) {
              if (authorizedIds.has(item.documentId)) continue;
              for (const unitId of closure(item.unitId, ancestorsOf))
                blockedUnits.add(unitId);
            }
            if (!blockedUnits.has(candidate.unitId)) {
              unitToDelete = candidate;
              break;
            }
          }

          let blockedDelta = 0;
          if (blockedUnits.size > 0) {
            const completedAt = new Date().toISOString();
            const receipts = await transactionDb
              .update(schema.contentTrashPurgePlanItems)
              .set({
                outcome: "blocked",
                outcomeDetail: blockedDetail,
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
                    eq(
                      schema.contentTrashPurgeOperations.leaseToken,
                      leaseToken,
                    ),
                    eq(schema.contentTrashPurgeOperations.status, "running"),
                  ),
                )
                .returning({ id: schema.contentTrashPurgeOperations.id });
              if (!operationReceipt)
                throw new ContentTrashPurgeLeaseLostError();
            }
          }

          const units = unitToDelete ? [unitToDelete] : [];
          const deletedBlobReferences = new Set<string>();
          let deletedDelta = 0;
          for (const unit of units) {
            const frozen = allPending.filter(
              (item) => item.unitId === unit.unitId,
            );
            let deleted: string[] = [];
            let conflict: string | null = null;
            try {
              const protection = retention
                ? await inspectTrashGroupProtection(
                    transactionDb,
                    frozen.map(({ documentId }) => documentId),
                    {
                      maxGroups: CONTENT_TRASH_PROTECTION_GROUP_BUDGET,
                      deadlineAt: Date.now() + LEASE_MS / 2,
                    },
                  )
                : "clear";
              if (protection === "clear") {
                deleted = await deleteTrashedDocumentSubtree(
                  transactionDb,
                  unit.rootDocumentId,
                  unit.ownerEmail,
                  deletedBlobReferences,
                  frozen,
                  frozen[0]?.expectedScopeFingerprint,
                );
              } else {
                conflict = PROTECTION_CONFLICT_DETAIL[protection];
              }
            } catch (error) {
              if (!(error instanceof PermanentDeleteScopeChangedError))
                throw retention && !isTransientDatabaseError(error)
                  ? new RetentionUnitFailedError(unit.unitId, error)
                  : error;
              conflict = "Trash scope changed after confirmation";
            }
            if (conflict !== null) {
              await transactionDb
                .update(schema.contentTrashPurgePlanItems)
                .set({
                  outcome: "conflicted",
                  outcomeDetail: conflict,
                  completedAt: new Date().toISOString(),
                })
                .where(
                  and(
                    eq(
                      schema.contentTrashPurgePlanItems.planId,
                      claimed.planId,
                    ),
                    eq(schema.contentTrashPurgePlanItems.unitId, unit.unitId),
                  ),
                );
              continue;
            }
            await transactionDb
              .update(schema.contentTrashPurgePlanItems)
              .set({
                outcome: "deleted",
                completedAt: new Date().toISOString(),
              })
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
          return {
            cancelled: false as const,
            blockedDelta,
            deletedDelta,
            deletedBlobReferences,
            unitCount: units.length,
          };
        },
        { isolationLevel: "serializable" },
      );
      let batchResult: Awaited<typeof batch>;
      try {
        batchResult = await batch;
      } catch (error) {
        if (!(error instanceof RetentionUnitFailedError)) throw error;
        const exhausted = await recordRetentionUnitFailure(db, {
          operationId,
          planId: claimed.planId,
          leaseToken,
          failure: error,
        });
        if (!exhausted) throw error;
        continue;
      }
      if (batchResult.cancelled) {
        return { accepted: true, continued: false, status: "failed" };
      }
      claimed.blockedCount += batchResult.blockedDelta;
      claimed.deletedCount += batchResult.deletedDelta;
      for (const reference of batchResult.deletedBlobReferences) {
        await cleanupBuilderPrivatePayload(
          reference,
          "deleted document source",
        );
      }
      if (batchResult.unitCount === 0) break;
    }
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
  const failedCount = outcomes.filter(
    (item) => item.outcome === "failed",
  ).length;
  const status =
    conflictedCount > 0
      ? "conflicted"
      : claimed.blockedCount > 0 || failedCount > 0
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

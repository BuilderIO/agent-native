import { createHash, randomUUID } from "node:crypto";

import { opaqueIdSchema } from "@agent-native/core/e2ee";
import {
  deleteProtectedCiphertextAt,
  deleteProtectedCiphertextPrefix,
  ProtectedCiphertextNotFoundError,
  type ProtectedCiphertextCoordinate,
} from "@agent-native/core/protected-ciphertext";
import {
  and,
  type AnyColumn,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import { privateVaultCiphertextStagingService } from "./private-vault-ciphertext-staging.js";

export const PRIVATE_VAULT_ACTIVE_PURGE_MAX_MS = 30 * 24 * 60 * 60 * 1000;
export const PRIVATE_VAULT_EVIDENCE_LIVE_MS = 90 * 24 * 60 * 60 * 1000;
export const PRIVATE_VAULT_EVIDENCE_PURGE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
export const PRIVATE_VAULT_RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const resourceKindSchema = z.enum([
  "vault",
  "object",
  "endpoint",
  "key-epoch",
  "key-envelope",
  "grant",
  "job",
]);

export type PrivateVaultRetentionResourceKind = z.infer<
  typeof resourceKindSchema
>;

const triggerSchema = z
  .object({
    ownerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(320)
      .regex(/^[^\u0000-\u001f\u007f]+$/),
    orgId: z.string().trim().max(240),
    vaultId: opaqueIdSchema,
    resourceKind: resourceKindSchema,
    resourceId: opaqueIdSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    triggerAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.resourceKind === "key-epoch" && value.epoch === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["epoch"],
        message: "Key-epoch retention entries require an epoch",
      });
    }
    if (value.resourceKind !== "key-epoch" && value.epoch !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["epoch"],
        message: "Only key-epoch retention entries may carry an epoch",
      });
    }
  });

export interface PrivateVaultRetentionItem {
  id: string;
  ownerEmail: string;
  orgId: string;
  vaultId: string;
  resourceKind: PrivateVaultRetentionResourceKind;
  resourceId: string;
  epoch: number | null;
  triggerGeneration: string;
  phase: "pending" | "blob_deleted" | "purged";
  triggerAt: string;
  dueAt: string;
  deadlineAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  purgedAt: string | null;
}

export interface PrivateVaultRetentionStore {
  enqueue(input: PrivateVaultRetentionItem): Promise<void>;
  claimDue(input: {
    now: string;
    leaseOwner: string;
    leaseExpiresAt: string;
    limit: number;
  }): Promise<PrivateVaultRetentionItem[]>;
  listCiphertextCoordinates(
    item: PrivateVaultRetentionItem,
  ): Promise<ProtectedCiphertextCoordinate[]>;
  assertLease(item: PrivateVaultRetentionItem, now: string): Promise<boolean>;
  markBlobDeleted(
    item: PrivateVaultRetentionItem,
    now: string,
  ): Promise<boolean>;
  deleteMetadata(
    item: PrivateVaultRetentionItem,
    now: string,
  ): Promise<boolean>;
  release(item: PrivateVaultRetentionItem): Promise<boolean>;
  purgeExpiredEvidence(cutoff: string, limit: number): Promise<number>;
}

export interface PrivateVaultRetentionCiphertextStore {
  delete(item: PrivateVaultRetentionItem): Promise<void>;
}

export class PrivateVaultRetentionCoordinateReusedError extends Error {
  constructor() {
    super("Private Vault retention coordinate was already retired");
    this.name = "PrivateVaultRetentionCoordinateReusedError";
  }
}

function addMs(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function entryId(
  input: Pick<
    PrivateVaultRetentionItem,
    "ownerEmail" | "orgId" | "vaultId" | "resourceKind" | "resourceId"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.ownerEmail,
        input.orgId,
        input.vaultId,
        input.resourceKind,
        input.resourceId,
      ]),
    )
    .digest("hex");
}

function newTriggerGeneration(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

export function buildPrivateVaultRetentionItem(
  input: z.input<typeof triggerSchema>,
): PrivateVaultRetentionItem {
  const parsed = triggerSchema.parse(input);
  return {
    id: entryId(parsed),
    ...parsed,
    triggerGeneration: newTriggerGeneration(),
    phase: "pending",
    // Resource ciphertext is eligible immediately after its explicit trigger.
    // The separate deadline proves that every active copy must be gone by day 30.
    dueAt: parsed.triggerAt,
    deadlineAt: addMs(parsed.triggerAt, PRIVATE_VAULT_ACTIVE_PURGE_MAX_MS),
    leaseOwner: null,
    leaseExpiresAt: null,
    purgedAt: null,
  };
}

export async function queuePrivateVaultRetentionTrigger(
  input: z.input<typeof triggerSchema>,
  store: PrivateVaultRetentionStore = sqlPrivateVaultRetentionStore,
): Promise<PrivateVaultRetentionItem> {
  const item = buildPrivateVaultRetentionItem(input);
  await store.enqueue(item);
  return item;
}

function scopeWhere(
  table: {
    ownerEmail: AnyColumn;
    orgId: AnyColumn;
    vaultId: AnyColumn;
  },
  item: PrivateVaultRetentionItem,
) {
  return and(
    eq(table.ownerEmail, item.ownerEmail),
    eq(table.orgId, item.orgId),
    eq(table.vaultId, item.vaultId),
  );
}

function stagingScopeWhere(item: PrivateVaultRetentionItem) {
  return and(
    eq(
      schema.contentEncryptedVaultCiphertextStaging.ownerEmail,
      item.ownerEmail,
    ),
    eq(schema.contentEncryptedVaultCiphertextStaging.orgId, item.orgId),
    eq(schema.contentEncryptedVaultCiphertextStaging.vaultId, item.vaultId),
  );
}

function rowToItem(
  row: typeof schema.contentEncryptedVaultRetentionQueue.$inferSelect,
): PrivateVaultRetentionItem {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
    vaultId: row.vaultId,
    resourceKind: resourceKindSchema.parse(row.resourceKind),
    resourceId: row.resourceId,
    epoch: row.epoch,
    triggerGeneration: row.triggerGeneration,
    phase: z.enum(["pending", "blob_deleted", "purged"]).parse(row.phase),
    triggerAt: row.triggerAt,
    dueAt: row.dueAt,
    deadlineAt: row.deadlineAt,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    purgedAt: row.purgedAt,
  };
}

type PrivateVaultRetentionWriteDb = Pick<
  ReturnType<typeof getDb>,
  "insert" | "select"
>;

/**
 * Transaction-compatible terminal enqueue. Callers pass their existing Drizzle
 * transaction so every resource transition and immutable tombstone either all
 * commit or all roll back. The batch uses one insert plus one verification read;
 * a prior generation is a permanent coordinate reservation, never a retry.
 */
export async function enqueuePrivateVaultRetentionItems(
  db: PrivateVaultRetentionWriteDb,
  items: PrivateVaultRetentionItem[],
): Promise<void> {
  if (items.length === 0) return;
  const expected = new Map<string, PrivateVaultRetentionItem>();
  for (const item of items) {
    const duplicate = expected.get(item.id);
    if (duplicate && duplicate.triggerGeneration !== item.triggerGeneration) {
      throw new PrivateVaultRetentionCoordinateReusedError();
    }
    expected.set(item.id, item);
  }
  await db
    .insert(schema.contentEncryptedVaultRetentionQueue)
    .values([...expected.values()])
    .onConflictDoNothing();
  const stored = await db
    .select({
      id: schema.contentEncryptedVaultRetentionQueue.id,
      triggerGeneration:
        schema.contentEncryptedVaultRetentionQueue.triggerGeneration,
    })
    .from(schema.contentEncryptedVaultRetentionQueue)
    .where(
      inArray(schema.contentEncryptedVaultRetentionQueue.id, [
        ...expected.keys(),
      ]),
    )
    .limit(expected.size);
  const storedById = new Map(stored.map((row) => [row.id, row]));
  for (const item of expected.values()) {
    const existing = storedById.get(item.id);
    if (!existing) throw new Error("Private Vault retention enqueue failed");
    if (existing.triggerGeneration !== item.triggerGeneration) {
      throw new PrivateVaultRetentionCoordinateReusedError();
    }
  }
}

export async function enqueuePrivateVaultRetentionItem(
  db: PrivateVaultRetentionWriteDb,
  item: PrivateVaultRetentionItem,
): Promise<void> {
  await enqueuePrivateVaultRetentionItems(db, [item]);
}

export const sqlPrivateVaultRetentionStore: PrivateVaultRetentionStore = {
  enqueue: async (item) => {
    await enqueuePrivateVaultRetentionItem(getDb(), item);
  },

  claimDue: async ({ now, leaseOwner, leaseExpiresAt, limit }) => {
    const db = getDb();
    const candidates = await db
      .select()
      .from(schema.contentEncryptedVaultRetentionQueue)
      .where(
        and(
          lte(schema.contentEncryptedVaultRetentionQueue.dueAt, now),
          inArray(schema.contentEncryptedVaultRetentionQueue.phase, [
            "pending",
            "blob_deleted",
          ]),
          or(
            isNull(schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt),
            lt(schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt, now),
          ),
        ),
      )
      .limit(Math.max(1, Math.min(limit, 100)));

    const claimed: PrivateVaultRetentionItem[] = [];
    for (const candidate of candidates) {
      const rows = await db
        .update(schema.contentEncryptedVaultRetentionQueue)
        .set({
          leaseOwner,
          leaseExpiresAt,
          lastAttemptAt: now,
          attemptCount: sql`${schema.contentEncryptedVaultRetentionQueue.attemptCount} + 1`,
        })
        .where(
          and(
            eq(schema.contentEncryptedVaultRetentionQueue.id, candidate.id),
            eq(
              schema.contentEncryptedVaultRetentionQueue.triggerGeneration,
              candidate.triggerGeneration,
            ),
            eq(
              schema.contentEncryptedVaultRetentionQueue.phase,
              candidate.phase,
            ),
            lte(schema.contentEncryptedVaultRetentionQueue.dueAt, now),
            or(
              isNull(schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt),
              lt(
                schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt,
                now,
              ),
            ),
          ),
        )
        .returning();
      if (rows[0]) claimed.push(rowToItem(rows[0]));
    }
    return claimed;
  },

  assertLease: async (item, now) => {
    if (!item.leaseOwner || !item.leaseExpiresAt) return false;
    const [row] = await getDb()
      .select({ id: schema.contentEncryptedVaultRetentionQueue.id })
      .from(schema.contentEncryptedVaultRetentionQueue)
      .where(
        and(
          eq(schema.contentEncryptedVaultRetentionQueue.id, item.id),
          eq(
            schema.contentEncryptedVaultRetentionQueue.triggerGeneration,
            item.triggerGeneration,
          ),
          eq(
            schema.contentEncryptedVaultRetentionQueue.leaseOwner,
            item.leaseOwner,
          ),
          eq(
            schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt,
            item.leaseExpiresAt,
          ),
          gt(schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt, now),
          inArray(schema.contentEncryptedVaultRetentionQueue.phase, [
            "pending",
            "blob_deleted",
          ]),
        ),
      )
      .limit(1);
    return Boolean(row);
  },

  listCiphertextCoordinates: async (item) => {
    if (item.resourceKind === "key-envelope") {
      return [
        {
          kind: "key-envelope",
          vaultId: item.vaultId,
          envelopeId: item.resourceId,
        },
      ];
    }
    if (item.resourceKind === "grant") {
      return [
        { kind: "grant", vaultId: item.vaultId, grantId: item.resourceId },
      ];
    }
    if (item.resourceKind !== "endpoint" && item.resourceKind !== "key-epoch") {
      return [];
    }

    const envelopePredicate =
      item.resourceKind === "endpoint"
        ? or(
            eq(
              schema.contentEncryptedVaultKeyEnvelopes.senderEndpointId,
              item.resourceId,
            ),
            eq(
              schema.contentEncryptedVaultKeyEnvelopes.recipientEndpointId,
              item.resourceId,
            ),
          )
        : eq(
            schema.contentEncryptedVaultKeyEnvelopes.epoch,
            item.epoch as number,
          );
    const envelopes = await getDb()
      .select({
        envelopeId: schema.contentEncryptedVaultKeyEnvelopes.envelopeId,
      })
      .from(schema.contentEncryptedVaultKeyEnvelopes)
      .where(
        and(
          scopeWhere(schema.contentEncryptedVaultKeyEnvelopes, item),
          envelopePredicate,
        ),
      );
    const coordinates: ProtectedCiphertextCoordinate[] = envelopes.map(
      ({ envelopeId }) => ({
        kind: "key-envelope",
        vaultId: item.vaultId,
        envelopeId,
      }),
    );

    if (item.resourceKind === "endpoint") {
      const grants = await getDb()
        .select({ grantId: schema.contentEncryptedVaultGrants.grantId })
        .from(schema.contentEncryptedVaultGrants)
        .where(
          and(
            scopeWhere(schema.contentEncryptedVaultGrants, item),
            eq(
              schema.contentEncryptedVaultGrants.recipientEndpointId,
              item.resourceId,
            ),
          ),
        );
      coordinates.push(
        ...grants.map(({ grantId }) => ({
          kind: "grant" as const,
          vaultId: item.vaultId,
          grantId,
        })),
      );
    }
    return coordinates;
  },

  markBlobDeleted: async (item, now) => {
    if (!item.leaseOwner || !item.leaseExpiresAt) return false;
    const rows = await getDb()
      .update(schema.contentEncryptedVaultRetentionQueue)
      .set({ phase: "blob_deleted" })
      .where(
        and(
          eq(schema.contentEncryptedVaultRetentionQueue.id, item.id),
          eq(
            schema.contentEncryptedVaultRetentionQueue.triggerGeneration,
            item.triggerGeneration,
          ),
          eq(
            schema.contentEncryptedVaultRetentionQueue.ownerEmail,
            item.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultRetentionQueue.orgId, item.orgId),
          eq(schema.contentEncryptedVaultRetentionQueue.vaultId, item.vaultId),
          eq(schema.contentEncryptedVaultRetentionQueue.phase, "pending"),
          eq(
            schema.contentEncryptedVaultRetentionQueue.leaseOwner,
            item.leaseOwner,
          ),
          eq(
            schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt,
            item.leaseExpiresAt,
          ),
          gt(schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt, now),
        ),
      )
      .returning({ id: schema.contentEncryptedVaultRetentionQueue.id });
    return rows.length === 1;
  },

  deleteMetadata: async (item, now) => {
    if (!item.leaseOwner || !item.leaseExpiresAt) return false;
    const leaseOwner = item.leaseOwner;
    const leaseExpiresAt = item.leaseExpiresAt;
    return getDb().transaction(async (tx) => {
      // This no-op update is the destructive-operation fence. It both proves
      // the generation/lease is still current and locks the tombstone row until
      // metadata removal and the terminal phase commit complete atomically.
      const fenced = await tx
        .update(schema.contentEncryptedVaultRetentionQueue)
        .set({ lastAttemptAt: now })
        .where(
          and(
            eq(schema.contentEncryptedVaultRetentionQueue.id, item.id),
            eq(
              schema.contentEncryptedVaultRetentionQueue.triggerGeneration,
              item.triggerGeneration,
            ),
            eq(
              schema.contentEncryptedVaultRetentionQueue.phase,
              "blob_deleted",
            ),
            eq(
              schema.contentEncryptedVaultRetentionQueue.leaseOwner,
              leaseOwner,
            ),
            eq(
              schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt,
              leaseExpiresAt,
            ),
            gt(schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt, now),
          ),
        )
        .returning({ id: schema.contentEncryptedVaultRetentionQueue.id });
      if (fenced.length !== 1) return false;
      // Descendant staging tombstones are removed only below, while this
      // generation-fenced queue row is locked. The same transaction finishes by
      // retaining the parent coordinate as `purged`, so a staging FK cascade can
      // never reopen the parent or any descendant Blob coordinate for reuse.
      if (item.resourceKind === "object") {
        await tx
          .delete(schema.contentEncryptedVaultCiphertextStaging)
          .where(
            and(
              stagingScopeWhere(item),
              eq(
                schema.contentEncryptedVaultCiphertextStaging.objectId,
                item.resourceId,
              ),
            ),
          );
        await tx
          .delete(schema.contentEncryptedVaultSyncEvents)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultSyncEvents, item),
              eq(
                schema.contentEncryptedVaultSyncEvents.objectId,
                item.resourceId,
              ),
            ),
          );
        await tx
          .delete(schema.contentEncryptedVaultObjectRevisions)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultObjectRevisions, item),
              eq(
                schema.contentEncryptedVaultObjectRevisions.objectId,
                item.resourceId,
              ),
            ),
          );
        await tx
          .delete(schema.contentEncryptedVaultObjects)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultObjects, item),
              eq(schema.contentEncryptedVaultObjects.objectId, item.resourceId),
            ),
          );
      } else if (item.resourceKind === "job") {
        await tx
          .delete(schema.contentEncryptedVaultCiphertextStaging)
          .where(
            and(
              stagingScopeWhere(item),
              eq(
                schema.contentEncryptedVaultCiphertextStaging.jobId,
                item.resourceId,
              ),
            ),
          );
        await tx
          .delete(schema.contentEncryptedVaultJobResults)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultJobResults, item),
              eq(schema.contentEncryptedVaultJobResults.jobId, item.resourceId),
            ),
          );
        await tx
          .delete(schema.contentEncryptedVaultJobs)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultJobs, item),
              eq(schema.contentEncryptedVaultJobs.jobId, item.resourceId),
            ),
          );
      } else if (item.resourceKind === "grant") {
        await tx
          .delete(schema.contentEncryptedVaultGrants)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultGrants, item),
              eq(schema.contentEncryptedVaultGrants.grantId, item.resourceId),
            ),
          );
      } else if (item.resourceKind === "key-envelope") {
        await tx
          .delete(schema.contentEncryptedVaultKeyEnvelopes)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultKeyEnvelopes, item),
              eq(
                schema.contentEncryptedVaultKeyEnvelopes.envelopeId,
                item.resourceId,
              ),
            ),
          );
      } else if (item.resourceKind === "key-epoch") {
        await tx
          .delete(schema.contentEncryptedVaultKeyEnvelopes)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultKeyEnvelopes, item),
              eq(
                schema.contentEncryptedVaultKeyEnvelopes.epoch,
                item.epoch as number,
              ),
            ),
          );
        await tx
          .delete(schema.contentEncryptedVaultKeyEpochs)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultKeyEpochs, item),
              eq(schema.contentEncryptedVaultKeyEpochs.id, item.resourceId),
              eq(
                schema.contentEncryptedVaultKeyEpochs.epoch,
                item.epoch as number,
              ),
            ),
          );
      } else if (item.resourceKind === "endpoint") {
        await tx
          .delete(schema.contentEncryptedVaultKeyEnvelopes)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultKeyEnvelopes, item),
              or(
                eq(
                  schema.contentEncryptedVaultKeyEnvelopes.senderEndpointId,
                  item.resourceId,
                ),
                eq(
                  schema.contentEncryptedVaultKeyEnvelopes.recipientEndpointId,
                  item.resourceId,
                ),
              ),
            ),
          );
        await tx
          .delete(schema.contentEncryptedVaultGrants)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultGrants, item),
              eq(
                schema.contentEncryptedVaultGrants.recipientEndpointId,
                item.resourceId,
              ),
            ),
          );
        await tx
          .delete(schema.contentEncryptedVaultEndpoints)
          .where(
            and(
              scopeWhere(schema.contentEncryptedVaultEndpoints, item),
              eq(
                schema.contentEncryptedVaultEndpoints.endpointId,
                item.resourceId,
              ),
            ),
          );
      } else {
        // A vault prefix deletion covers every protected ciphertext class. SQL
        // is then removed explicitly so non-FK evidence tables cannot linger.
        await tx
          .delete(schema.contentEncryptedVaultCiphertextStaging)
          .where(stagingScopeWhere(item));
        await tx
          .delete(schema.contentEncryptedVaultDisclosures)
          .where(scopeWhere(schema.contentEncryptedVaultDisclosures, item));
        await tx
          .delete(schema.contentEncryptedVaultAccessEvents)
          .where(scopeWhere(schema.contentEncryptedVaultAccessEvents, item));
        await tx
          .delete(schema.contentEncryptedVaultSyncEvents)
          .where(scopeWhere(schema.contentEncryptedVaultSyncEvents, item));
        await tx
          .delete(schema.contentEncryptedVaultJobResults)
          .where(scopeWhere(schema.contentEncryptedVaultJobResults, item));
        await tx
          .delete(schema.contentEncryptedVaultJobs)
          .where(scopeWhere(schema.contentEncryptedVaultJobs, item));
        await tx
          .delete(schema.contentEncryptedVaultObjectRevisions)
          .where(scopeWhere(schema.contentEncryptedVaultObjectRevisions, item));
        await tx
          .delete(schema.contentEncryptedVaultObjects)
          .where(scopeWhere(schema.contentEncryptedVaultObjects, item));
        await tx
          .delete(schema.contentEncryptedVaultGrants)
          .where(scopeWhere(schema.contentEncryptedVaultGrants, item));
        await tx
          .delete(schema.contentEncryptedVaultKeyEnvelopes)
          .where(scopeWhere(schema.contentEncryptedVaultKeyEnvelopes, item));
        await tx
          .delete(schema.contentEncryptedVaultKeyEpochs)
          .where(scopeWhere(schema.contentEncryptedVaultKeyEpochs, item));
        await tx
          .delete(schema.contentEncryptedVaultEndpoints)
          .where(scopeWhere(schema.contentEncryptedVaultEndpoints, item));
        await tx
          .delete(schema.contentEncryptedVaults)
          .where(scopeWhere(schema.contentEncryptedVaults, item));
        // Retention rows deliberately outlive the logical vault. They are
        // content-free non-reuse tombstones and must never cascade away.
      }

      const tombstoned = await tx
        .update(schema.contentEncryptedVaultRetentionQueue)
        .set({
          phase: "purged",
          purgedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(schema.contentEncryptedVaultRetentionQueue.id, item.id),
            eq(
              schema.contentEncryptedVaultRetentionQueue.triggerGeneration,
              item.triggerGeneration,
            ),
            eq(
              schema.contentEncryptedVaultRetentionQueue.ownerEmail,
              item.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultRetentionQueue.orgId, item.orgId),
            eq(
              schema.contentEncryptedVaultRetentionQueue.vaultId,
              item.vaultId,
            ),
            eq(
              schema.contentEncryptedVaultRetentionQueue.phase,
              "blob_deleted",
            ),
            eq(
              schema.contentEncryptedVaultRetentionQueue.leaseOwner,
              leaseOwner,
            ),
            eq(
              schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt,
              leaseExpiresAt,
            ),
          ),
        )
        .returning({ id: schema.contentEncryptedVaultRetentionQueue.id });
      return tombstoned.length === 1;
    });
  },

  release: async (item) => {
    if (!item.leaseOwner || !item.leaseExpiresAt) return false;
    const rows = await getDb()
      .update(schema.contentEncryptedVaultRetentionQueue)
      .set({ leaseOwner: null, leaseExpiresAt: null })
      .where(
        and(
          eq(schema.contentEncryptedVaultRetentionQueue.id, item.id),
          eq(
            schema.contentEncryptedVaultRetentionQueue.triggerGeneration,
            item.triggerGeneration,
          ),
          eq(
            schema.contentEncryptedVaultRetentionQueue.ownerEmail,
            item.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultRetentionQueue.orgId, item.orgId),
          eq(schema.contentEncryptedVaultRetentionQueue.vaultId, item.vaultId),
          eq(
            schema.contentEncryptedVaultRetentionQueue.leaseOwner,
            item.leaseOwner,
          ),
          eq(
            schema.contentEncryptedVaultRetentionQueue.leaseExpiresAt,
            item.leaseExpiresAt,
          ),
          inArray(schema.contentEncryptedVaultRetentionQueue.phase, [
            "pending",
            "blob_deleted",
          ]),
        ),
      )
      .returning({ id: schema.contentEncryptedVaultRetentionQueue.id });
    return rows.length === 1;
  },

  purgeExpiredEvidence: async (cutoff, limit) => {
    const db = getDb();
    const safeLimit = Math.max(1, Math.min(limit, 1_000));
    const accessRows = await db
      .select({ id: schema.contentEncryptedVaultAccessEvents.accessEventId })
      .from(schema.contentEncryptedVaultAccessEvents)
      .where(
        lte(schema.contentEncryptedVaultAccessEvents.serverReceivedAt, cutoff),
      )
      .limit(safeLimit);
    if (accessRows.length > 0) {
      await db.delete(schema.contentEncryptedVaultAccessEvents).where(
        and(
          inArray(
            schema.contentEncryptedVaultAccessEvents.accessEventId,
            accessRows.map((row) => row.id),
          ),
          lte(
            schema.contentEncryptedVaultAccessEvents.serverReceivedAt,
            cutoff,
          ),
        ),
      );
    }
    const remaining = safeLimit - accessRows.length;
    if (remaining <= 0) return accessRows.length;
    const disclosureRows = await db
      .select({ id: schema.contentEncryptedVaultDisclosures.disclosureId })
      .from(schema.contentEncryptedVaultDisclosures)
      .where(
        lte(schema.contentEncryptedVaultDisclosures.serverReceivedAt, cutoff),
      )
      .limit(remaining);
    if (disclosureRows.length > 0) {
      await db.delete(schema.contentEncryptedVaultDisclosures).where(
        and(
          inArray(
            schema.contentEncryptedVaultDisclosures.disclosureId,
            disclosureRows.map((row) => row.id),
          ),
          lte(schema.contentEncryptedVaultDisclosures.serverReceivedAt, cutoff),
        ),
      );
    }
    return accessRows.length + disclosureRows.length;
  },
};

export const privateVaultRetentionCiphertextStore: PrivateVaultRetentionCiphertextStore =
  {
    delete: async (item) => {
      if (item.resourceKind === "vault") {
        await deleteProtectedCiphertextPrefix({
          scope: "vault",
          vaultId: item.vaultId,
        });
        return;
      }
      if (item.resourceKind === "object") {
        await deleteProtectedCiphertextPrefix({
          scope: "object",
          vaultId: item.vaultId,
          objectId: item.resourceId,
        });
        return;
      }
      if (item.resourceKind === "job") {
        await deleteProtectedCiphertextPrefix({
          scope: "job",
          vaultId: item.vaultId,
          jobId: item.resourceId,
        });
        return;
      }
      const coordinates =
        await sqlPrivateVaultRetentionStore.listCiphertextCoordinates(item);
      for (const coordinate of coordinates) {
        try {
          await deleteProtectedCiphertextAt(coordinate);
        } catch (error) {
          // A prior attempt can delete the immutable coordinate and die before
          // writing the content-free checkpoint. Absence is therefore success;
          // every other provider error remains fail-closed.
          if (!(error instanceof ProtectedCiphertextNotFoundError)) throw error;
        }
      }
    },
  };

export function createPrivateVaultRetentionService(
  options: {
    store?: PrivateVaultRetentionStore;
    ciphertext?: PrivateVaultRetentionCiphertextStore;
    now?: () => Date;
    leaseMs?: number;
    batchSize?: number;
    reconcileStaging?: () => Promise<{
      examined: number;
      committed: number;
      orphansDeleted: number;
      failed: number;
    }>;
  } = {},
) {
  const store = options.store ?? sqlPrivateVaultRetentionStore;
  const ciphertext = options.ciphertext ?? privateVaultRetentionCiphertextStore;
  const now = options.now ?? (() => new Date());
  const leaseMs = options.leaseMs ?? 5 * 60 * 1000;
  const batchSize = options.batchSize ?? 50;
  const reconcileStaging =
    options.reconcileStaging ??
    (options.store
      ? async () => ({
          examined: 0,
          committed: 0,
          orphansDeleted: 0,
          failed: 0,
        })
      : () => privateVaultCiphertextStagingService.reconcileExpired());

  return {
    async sweep() {
      const sweepAt = now().toISOString();
      let stagingReconciliation;
      try {
        stagingReconciliation = await reconcileStaging();
      } catch {
        stagingReconciliation = {
          examined: 0,
          committed: 0,
          orphansDeleted: 0,
          failed: 1,
        };
      }
      const leaseOwner = randomUUID();
      const claimed = await store.claimDue({
        now: sweepAt,
        leaseOwner,
        leaseExpiresAt: addMs(sweepAt, leaseMs),
        limit: batchSize,
      });
      let purged = 0;
      let failed = 0;
      for (const item of claimed) {
        try {
          if (item.phase !== "blob_deleted") {
            if (!(await store.assertLease(item, now().toISOString()))) {
              throw new Error("Private Vault retention lease was lost");
            }
            await ciphertext.delete(item);
            // This content-free checkpoint makes process death after Blob
            // deletion safe. Death before it merely repeats an idempotent delete.
            if (!(await store.markBlobDeleted(item, now().toISOString()))) {
              throw new Error("Private Vault retention lease was lost");
            }
          }
          if (!(await store.deleteMetadata(item, now().toISOString()))) {
            throw new Error("Private Vault retention lease was lost");
          }
          purged += 1;
        } catch {
          // Never persist provider exceptions: paths and credentials can appear
          // in them. The retained queue coordinate is sufficient for retry.
          await store.release(item).catch(() => {
            // A stranded lease expires naturally; never let release failure
            // suppress retries for the rest of the batch.
          });
          failed += 1;
        }
      }
      const evidenceCutoff = addMs(sweepAt, -PRIVATE_VAULT_EVIDENCE_LIVE_MS);
      const evidencePurged = await store.purgeExpiredEvidence(
        evidenceCutoff,
        batchSize,
      );
      return {
        claimed: claimed.length,
        purged,
        failed,
        evidencePurged,
        stagingReconciliation,
      };
    },
  };
}

export const privateVaultRetentionService =
  createPrivateVaultRetentionService();

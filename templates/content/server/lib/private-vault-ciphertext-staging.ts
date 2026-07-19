import { createHash, randomUUID } from "node:crypto";

import { opaqueIdSchema } from "@agent-native/core/e2ee";
import {
  deleteProtectedCiphertextAt,
  protectedCiphertextCoordinateSchema,
  ProtectedCiphertextNotFoundError,
  type ProtectedCiphertextCoordinate,
} from "@agent-native/core/protected-ciphertext";
import { and, eq, lte, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";

export const PRIVATE_VAULT_CIPHERTEXT_STAGE_TTL_MS = 24 * 60 * 60 * 1000;
export const PRIVATE_VAULT_CIPHERTEXT_CLAIM_MS = 5 * 60 * 1000;
export const PRIVATE_VAULT_RECOVERY_WRAP_STAGE_PART = "recovery-wrap";
export const PRIVATE_VAULT_CONTROL_EVIDENCE_STAGE_PART = "control-evidence";
export const PRIVATE_VAULT_GRANT_STAGE_PART = "grant";

export type PrivateVaultCiphertextStagePhase =
  | "active"
  | "reconciling"
  | "committed"
  | "orphaned";

const scopeSchema = z
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
  })
  .strict();

const stageCoordinateSchema = protectedCiphertextCoordinateSchema.refine(
  (coordinate) =>
    (coordinate.kind === "object" && coordinate.part === "header") ||
    coordinate.kind === "job" ||
    coordinate.kind === "grant" ||
    coordinate.kind === "recovery-wrap" ||
    coordinate.kind === "control-evidence",
  "Only object revision headers, job request/results, recovery wraps, and control evidence may be staged",
);

export type PrivateVaultStageCoordinate = Extract<
  ProtectedCiphertextCoordinate,
  {
    kind: "object" | "job" | "grant" | "recovery-wrap" | "control-evidence";
  }
>;

export interface PrivateVaultCiphertextStage {
  stageId: string;
  ownerEmail: string;
  orgId: string;
  vaultId: string;
  coordinate: PrivateVaultStageCoordinate;
  stagedAt: string;
  expiresAt: string;
  phase: PrivateVaultCiphertextStagePhase;
  claimToken: string | null;
  claimExpiresAt: string | null;
  finalizedAt: string | null;
}

export interface PrivateVaultCiphertextStagingStore {
  requireActiveVault(scope: {
    ownerEmail: string;
    orgId: string;
    vaultId: string;
  }): Promise<boolean>;
  stage(
    entry: PrivateVaultCiphertextStage,
  ): Promise<PrivateVaultCiphertextStage>;
  commit(
    entry: PrivateVaultCiphertextStage,
    committedAt: string,
  ): Promise<boolean>;
  listClaimable(
    now: string,
    limit: number,
  ): Promise<PrivateVaultCiphertextStage[]>;
  claim(
    entry: PrivateVaultCiphertextStage,
    claimToken: string,
    claimedAt: string,
    claimExpiresAt: string,
  ): Promise<PrivateVaultCiphertextStage | null>;
  finishClaim(
    entry: PrivateVaultCiphertextStage,
    claimToken: string,
    phase: "committed" | "orphaned",
    finalizedAt: string,
  ): Promise<boolean>;
  isMetadataCommitted(entry: PrivateVaultCiphertextStage): Promise<boolean>;
}

export interface PrivateVaultStagedCiphertextStore {
  delete(coordinate: PrivateVaultStageCoordinate): Promise<void>;
}

function stageId(input: {
  ownerEmail: string;
  orgId: string;
  vaultId: string;
  coordinate: PrivateVaultStageCoordinate;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.ownerEmail,
        input.orgId,
        input.vaultId,
        input.coordinate,
      ]),
    )
    .digest("hex");
}

function parseStageInput(input: {
  scope: z.input<typeof scopeSchema>;
  coordinate: unknown;
  now: string;
  ttlMs: number;
}): PrivateVaultCiphertextStage {
  const scope = scopeSchema.parse(input.scope);
  const coordinate = stageCoordinateSchema.parse(
    input.coordinate,
  ) as PrivateVaultStageCoordinate;
  if (coordinate.vaultId !== scope.vaultId) {
    throw new Error("Private Vault staging scope mismatch");
  }
  const stagedAt = z.string().datetime({ offset: true }).parse(input.now);
  if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) {
    throw new Error("Private Vault staging TTL must be positive");
  }
  const entry = {
    ...scope,
    coordinate,
    stagedAt,
    expiresAt: new Date(Date.parse(stagedAt) + input.ttlMs).toISOString(),
  };
  return {
    stageId: stageId(entry),
    ...entry,
    phase: "active",
    claimToken: null,
    claimExpiresAt: null,
    finalizedAt: null,
  };
}

function stageValues(entry: PrivateVaultCiphertextStage) {
  return {
    stageId: entry.stageId,
    ownerEmail: entry.ownerEmail,
    orgId: entry.orgId,
    vaultId: entry.vaultId,
    coordinateKind: entry.coordinate.kind,
    objectId:
      entry.coordinate.kind === "object" ? entry.coordinate.objectId : null,
    revisionId:
      entry.coordinate.kind === "object" ? entry.coordinate.revisionId : null,
    jobId: entry.coordinate.kind === "job" ? entry.coordinate.jobId : null,
    grantId:
      entry.coordinate.kind === "grant" ? entry.coordinate.grantId : null,
    recoveryWrapHash:
      entry.coordinate.kind === "recovery-wrap"
        ? entry.coordinate.recoveryWrapHash
        : null,
    evidenceKind:
      entry.coordinate.kind === "control-evidence"
        ? entry.coordinate.evidenceKind
        : null,
    evidenceHash:
      entry.coordinate.kind === "control-evidence"
        ? entry.coordinate.evidenceHash
        : null,
    part:
      entry.coordinate.kind === "recovery-wrap"
        ? PRIVATE_VAULT_RECOVERY_WRAP_STAGE_PART
        : entry.coordinate.kind === "grant"
          ? PRIVATE_VAULT_GRANT_STAGE_PART
          : entry.coordinate.kind === "control-evidence"
            ? PRIVATE_VAULT_CONTROL_EVIDENCE_STAGE_PART
            : entry.coordinate.part,
    stagedAt: entry.stagedAt,
    expiresAt: entry.expiresAt,
    phase: entry.phase,
    claimToken: entry.claimToken,
    claimExpiresAt: entry.claimExpiresAt,
    finalizedAt: entry.finalizedAt,
  };
}

function parseRow(
  row: typeof schema.contentEncryptedVaultCiphertextStaging.$inferSelect,
): PrivateVaultCiphertextStage {
  let physicalCoordinate: unknown;
  if (
    row.coordinateKind === "object" &&
    row.objectId !== null &&
    row.revisionId !== null &&
    row.jobId === null &&
    row.grantId === null &&
    row.recoveryWrapHash === null &&
    row.evidenceKind === null &&
    row.evidenceHash === null
  ) {
    physicalCoordinate = {
      kind: "object",
      vaultId: row.vaultId,
      objectId: row.objectId,
      revisionId: row.revisionId,
      part: row.part,
    };
  } else if (
    row.coordinateKind === "job" &&
    row.objectId === null &&
    row.revisionId === null &&
    row.jobId !== null &&
    row.grantId === null &&
    row.recoveryWrapHash === null &&
    row.evidenceKind === null &&
    row.evidenceHash === null
  ) {
    physicalCoordinate = {
      kind: "job",
      vaultId: row.vaultId,
      jobId: row.jobId,
      part: row.part,
    };
  } else if (
    row.coordinateKind === "recovery-wrap" &&
    row.objectId === null &&
    row.revisionId === null &&
    row.jobId === null &&
    row.grantId === null &&
    row.recoveryWrapHash !== null &&
    row.evidenceKind === null &&
    row.evidenceHash === null &&
    row.part === PRIVATE_VAULT_RECOVERY_WRAP_STAGE_PART
  ) {
    physicalCoordinate = {
      kind: "recovery-wrap",
      vaultId: row.vaultId,
      recoveryWrapHash: row.recoveryWrapHash,
    };
  } else if (
    row.coordinateKind === "control-evidence" &&
    row.objectId === null &&
    row.revisionId === null &&
    row.jobId === null &&
    row.grantId === null &&
    row.recoveryWrapHash === null &&
    (row.evidenceKind === "genesis" || row.evidenceKind === "recovery") &&
    row.evidenceHash !== null &&
    row.part === PRIVATE_VAULT_CONTROL_EVIDENCE_STAGE_PART
  ) {
    physicalCoordinate = {
      kind: "control-evidence",
      vaultId: row.vaultId,
      evidenceKind: row.evidenceKind,
      evidenceHash: row.evidenceHash,
    };
  } else if (
    row.coordinateKind === "grant" &&
    row.objectId === null &&
    row.revisionId === null &&
    row.jobId === null &&
    row.grantId !== null &&
    row.recoveryWrapHash === null &&
    row.evidenceKind === null &&
    row.evidenceHash === null &&
    row.part === PRIVATE_VAULT_GRANT_STAGE_PART
  ) {
    physicalCoordinate = {
      kind: "grant",
      vaultId: row.vaultId,
      grantId: row.grantId,
    };
  } else {
    throw new Error(
      "Private Vault staging physical coordinate integrity failure",
    );
  }
  const coordinate = stageCoordinateSchema.parse(
    physicalCoordinate,
  ) as PrivateVaultStageCoordinate;
  const entry = {
    stageId: row.stageId,
    ownerEmail: row.ownerEmail,
    orgId: row.orgId,
    vaultId: row.vaultId,
    coordinate,
    stagedAt: row.stagedAt,
    expiresAt: row.expiresAt,
    phase: row.phase as PrivateVaultCiphertextStagePhase,
    claimToken: row.claimToken,
    claimExpiresAt: row.claimExpiresAt,
    finalizedAt: row.finalizedAt,
  };
  if (
    !(["active", "reconciling", "committed", "orphaned"] as const).includes(
      entry.phase,
    )
  ) {
    throw new Error("Private Vault staging phase integrity failure");
  }
  if (
    (entry.phase === "active" &&
      (entry.claimToken !== null ||
        entry.claimExpiresAt !== null ||
        entry.finalizedAt !== null)) ||
    (entry.phase === "reconciling" &&
      (entry.claimToken === null ||
        entry.claimExpiresAt === null ||
        entry.finalizedAt !== null)) ||
    ((entry.phase === "committed" || entry.phase === "orphaned") &&
      (entry.claimToken !== null ||
        entry.claimExpiresAt !== null ||
        entry.finalizedAt === null))
  ) {
    throw new Error("Private Vault staging fence integrity failure");
  }
  if (stageId(entry) !== entry.stageId) {
    throw new Error("Private Vault staging coordinate integrity failure");
  }
  return entry;
}

function scopedStage(entry: PrivateVaultCiphertextStage) {
  return and(
    eq(schema.contentEncryptedVaultCiphertextStaging.stageId, entry.stageId),
    eq(
      schema.contentEncryptedVaultCiphertextStaging.ownerEmail,
      entry.ownerEmail,
    ),
    eq(schema.contentEncryptedVaultCiphertextStaging.orgId, entry.orgId),
    eq(schema.contentEncryptedVaultCiphertextStaging.vaultId, entry.vaultId),
  );
}

type PrivateVaultDbTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export class PrivateVaultCiphertextStageCommitConflictError extends Error {
  constructor() {
    super("Private Vault ciphertext stage is no longer active");
    this.name = "PrivateVaultCiphertextStageCommitConflictError";
  }
}

/**
 * Finalize a ciphertext stage inside the caller's metadata transaction.
 * Throwing on a lost CAS is deliberate: it rolls back metadata rather than
 * allowing a reconciler to delete ciphertext after metadata becomes visible.
 */
export async function commitPrivateVaultCiphertextStageInTransaction(
  tx: PrivateVaultDbTransaction,
  entry: PrivateVaultCiphertextStage,
  committedAt: string,
): Promise<void> {
  const rows = await tx
    .update(schema.contentEncryptedVaultCiphertextStaging)
    .set({
      phase: "committed",
      finalizedAt: committedAt,
      claimToken: null,
      claimExpiresAt: null,
    })
    .where(
      and(
        scopedStage(entry),
        eq(schema.contentEncryptedVaultCiphertextStaging.phase, "active"),
      ),
    )
    .returning({
      stageId: schema.contentEncryptedVaultCiphertextStaging.stageId,
    });
  if (rows.length !== 1) {
    throw new PrivateVaultCiphertextStageCommitConflictError();
  }
}

export const sqlPrivateVaultCiphertextStagingStore: PrivateVaultCiphertextStagingStore =
  {
    requireActiveVault: async (scope) => {
      const [vault] = await getDb()
        .select({ vaultId: schema.contentEncryptedVaults.vaultId })
        .from(schema.contentEncryptedVaults)
        .where(
          and(
            eq(schema.contentEncryptedVaults.vaultId, scope.vaultId),
            eq(schema.contentEncryptedVaults.ownerEmail, scope.ownerEmail),
            eq(schema.contentEncryptedVaults.orgId, scope.orgId),
            eq(schema.contentEncryptedVaults.vaultState, "active"),
          ),
        )
        .limit(1);
      return Boolean(vault);
    },

    stage: async (entry) => {
      return getDb().transaction(async (tx) => {
        const resourceKind = entry.coordinate.kind;
        const resourceId =
          entry.coordinate.kind === "object"
            ? entry.coordinate.objectId
            : entry.coordinate.kind === "job"
              ? entry.coordinate.jobId
              : entry.coordinate.kind === "grant"
                ? entry.coordinate.grantId
                : entry.coordinate.kind === "recovery-wrap"
                  ? entry.coordinate.recoveryWrapHash
                  : entry.coordinate.evidenceHash;
        const [parentTombstone] = await tx
          .select({ id: schema.contentEncryptedVaultRetentionQueue.id })
          .from(schema.contentEncryptedVaultRetentionQueue)
          .where(
            and(
              eq(
                schema.contentEncryptedVaultRetentionQueue.ownerEmail,
                entry.ownerEmail,
              ),
              eq(schema.contentEncryptedVaultRetentionQueue.orgId, entry.orgId),
              eq(
                schema.contentEncryptedVaultRetentionQueue.vaultId,
                entry.vaultId,
              ),
              or(
                and(
                  eq(
                    schema.contentEncryptedVaultRetentionQueue.resourceKind,
                    "vault",
                  ),
                  eq(
                    schema.contentEncryptedVaultRetentionQueue.resourceId,
                    entry.vaultId,
                  ),
                ),
                and(
                  eq(
                    schema.contentEncryptedVaultRetentionQueue.resourceKind,
                    resourceKind,
                  ),
                  eq(
                    schema.contentEncryptedVaultRetentionQueue.resourceId,
                    resourceId,
                  ),
                ),
              ),
            ),
          )
          .limit(1);
        if (parentTombstone) {
          throw new Error(
            "Private Vault ciphertext coordinate is permanently finalized",
          );
        }
        await tx
          .insert(schema.contentEncryptedVaultCiphertextStaging)
          .values(stageValues(entry))
          .onConflictDoNothing();
        const [stored] = await tx
          .select()
          .from(schema.contentEncryptedVaultCiphertextStaging)
          .where(scopedStage(entry))
          .limit(1);
        if (!stored) throw new Error("Private Vault staging write failed");
        const parsed = parseRow(stored);
        if (
          JSON.stringify(parsed.coordinate) !== JSON.stringify(entry.coordinate)
        ) {
          throw new Error("Private Vault staging coordinate conflict");
        }
        if (parsed.phase !== "active") {
          throw new Error(
            "Private Vault ciphertext coordinate is permanently finalized",
          );
        }
        return parsed;
      });
    },

    commit: async (entry, committedAt) => {
      try {
        await getDb().transaction((tx) =>
          commitPrivateVaultCiphertextStageInTransaction(
            tx,
            entry,
            committedAt,
          ),
        );
        return true;
      } catch (error) {
        if (error instanceof PrivateVaultCiphertextStageCommitConflictError) {
          return false;
        }
        throw error;
      }
    },

    listClaimable: async (now, limit) => {
      const rows = await getDb()
        .select()
        .from(schema.contentEncryptedVaultCiphertextStaging)
        .where(
          or(
            and(
              eq(schema.contentEncryptedVaultCiphertextStaging.phase, "active"),
              lte(schema.contentEncryptedVaultCiphertextStaging.expiresAt, now),
            ),
            and(
              eq(
                schema.contentEncryptedVaultCiphertextStaging.phase,
                "reconciling",
              ),
              lte(
                schema.contentEncryptedVaultCiphertextStaging.claimExpiresAt,
                now,
              ),
            ),
          ),
        )
        .orderBy(
          schema.contentEncryptedVaultCiphertextStaging.expiresAt,
          schema.contentEncryptedVaultCiphertextStaging.stageId,
        )
        .limit(Math.max(1, Math.min(limit, 100)));
      return rows.map(parseRow);
    },

    claim: async (entry, claimToken, claimedAt, claimExpiresAt) => {
      const [row] = await getDb()
        .update(schema.contentEncryptedVaultCiphertextStaging)
        .set({
          phase: "reconciling",
          claimToken,
          claimExpiresAt,
          finalizedAt: null,
        })
        .where(
          and(
            scopedStage(entry),
            or(
              eq(schema.contentEncryptedVaultCiphertextStaging.phase, "active"),
              and(
                eq(
                  schema.contentEncryptedVaultCiphertextStaging.phase,
                  "reconciling",
                ),
                lte(
                  schema.contentEncryptedVaultCiphertextStaging.claimExpiresAt,
                  claimedAt,
                ),
              ),
            ),
          ),
        )
        .returning();
      return row ? parseRow(row) : null;
    },

    finishClaim: async (entry, claimToken, phase, finalizedAt) => {
      const rows = await getDb()
        .update(schema.contentEncryptedVaultCiphertextStaging)
        .set({ phase, finalizedAt, claimToken: null, claimExpiresAt: null })
        .where(
          and(
            scopedStage(entry),
            eq(
              schema.contentEncryptedVaultCiphertextStaging.phase,
              "reconciling",
            ),
            eq(
              schema.contentEncryptedVaultCiphertextStaging.claimToken,
              claimToken,
            ),
          ),
        )
        .returning({
          stageId: schema.contentEncryptedVaultCiphertextStaging.stageId,
        });
      return rows.length === 1;
    },

    isMetadataCommitted: async (entry) => {
      if (entry.coordinate.kind === "object") {
        const [revision] = await getDb()
          .select({
            revisionId: schema.contentEncryptedVaultObjectRevisions.revisionId,
          })
          .from(schema.contentEncryptedVaultObjectRevisions)
          .where(
            and(
              eq(
                schema.contentEncryptedVaultObjectRevisions.revisionId,
                entry.coordinate.revisionId,
              ),
              eq(
                schema.contentEncryptedVaultObjectRevisions.objectId,
                entry.coordinate.objectId,
              ),
              eq(
                schema.contentEncryptedVaultObjectRevisions.vaultId,
                entry.vaultId,
              ),
              eq(
                schema.contentEncryptedVaultObjectRevisions.ownerEmail,
                entry.ownerEmail,
              ),
              eq(
                schema.contentEncryptedVaultObjectRevisions.orgId,
                entry.orgId,
              ),
            ),
          )
          .limit(1);
        return Boolean(revision);
      }

      if (entry.coordinate.kind === "recovery-wrap") {
        const [binding] = await getDb()
          .select({
            recoveryWrapHash:
              schema.contentEncryptedVaultRecoveryWraps.recoveryWrapHash,
          })
          .from(schema.contentEncryptedVaultRecoveryWraps)
          .where(
            and(
              eq(
                schema.contentEncryptedVaultRecoveryWraps.recoveryWrapHash,
                entry.coordinate.recoveryWrapHash,
              ),
              eq(
                schema.contentEncryptedVaultRecoveryWraps.vaultId,
                entry.vaultId,
              ),
              eq(
                schema.contentEncryptedVaultRecoveryWraps.ownerEmail,
                entry.ownerEmail,
              ),
              eq(schema.contentEncryptedVaultRecoveryWraps.orgId, entry.orgId),
            ),
          )
          .limit(1);
        return Boolean(binding);
      }

      if (entry.coordinate.kind === "control-evidence") {
        const [binding] = await getDb()
          .select({
            evidenceHash:
              schema.contentEncryptedVaultControlEvidence.evidenceHash,
          })
          .from(schema.contentEncryptedVaultControlEvidence)
          .where(
            and(
              eq(
                schema.contentEncryptedVaultControlEvidence.evidenceHash,
                entry.coordinate.evidenceHash,
              ),
              eq(
                schema.contentEncryptedVaultControlEvidence.evidenceKind,
                entry.coordinate.evidenceKind,
              ),
              eq(
                schema.contentEncryptedVaultControlEvidence.vaultId,
                entry.vaultId,
              ),
              eq(
                schema.contentEncryptedVaultControlEvidence.ownerEmail,
                entry.ownerEmail,
              ),
              eq(
                schema.contentEncryptedVaultControlEvidence.orgId,
                entry.orgId,
              ),
            ),
          )
          .limit(1);
        return Boolean(binding);
      }

      if (entry.coordinate.kind === "grant") {
        const [grant] = await getDb()
          .select({ grantId: schema.contentEncryptedVaultGrants.grantId })
          .from(schema.contentEncryptedVaultGrants)
          .where(
            and(
              eq(
                schema.contentEncryptedVaultGrants.grantId,
                entry.coordinate.grantId,
              ),
              eq(schema.contentEncryptedVaultGrants.vaultId, entry.vaultId),
              eq(
                schema.contentEncryptedVaultGrants.ownerEmail,
                entry.ownerEmail,
              ),
              eq(schema.contentEncryptedVaultGrants.orgId, entry.orgId),
            ),
          )
          .limit(1);
        return Boolean(grant);
      }

      const table =
        entry.coordinate.part === "request"
          ? schema.contentEncryptedVaultJobs
          : schema.contentEncryptedVaultJobResults;
      const [job] = await getDb()
        .select({ jobId: table.jobId })
        .from(table)
        .where(
          and(
            eq(table.jobId, entry.coordinate.jobId),
            eq(table.vaultId, entry.vaultId),
            eq(table.ownerEmail, entry.ownerEmail),
            eq(table.orgId, entry.orgId),
          ),
        )
        .limit(1);
      return Boolean(job);
    },
  };

export const privateVaultStagedCiphertextStore: PrivateVaultStagedCiphertextStore =
  {
    delete: async (coordinate) => {
      try {
        await deleteProtectedCiphertextAt(coordinate);
      } catch (error) {
        if (!(error instanceof ProtectedCiphertextNotFoundError)) throw error;
      }
    },
  };

export function createPrivateVaultCiphertextStagingService(
  options: {
    store?: PrivateVaultCiphertextStagingStore;
    ciphertext?: PrivateVaultStagedCiphertextStore;
    now?: () => Date;
    ttlMs?: number;
    batchSize?: number;
    claimMs?: number;
    claimToken?: () => string;
  } = {},
) {
  const store = options.store ?? sqlPrivateVaultCiphertextStagingStore;
  const ciphertext = options.ciphertext ?? privateVaultStagedCiphertextStore;
  const now = options.now ?? (() => new Date());
  const ttlMs = options.ttlMs ?? PRIVATE_VAULT_CIPHERTEXT_STAGE_TTL_MS;
  const batchSize = options.batchSize ?? 50;
  const claimMs = options.claimMs ?? PRIVATE_VAULT_CIPHERTEXT_CLAIM_MS;
  const nextClaimToken = options.claimToken ?? randomUUID;
  if (!Number.isSafeInteger(claimMs) || claimMs <= 0) {
    throw new Error("Private Vault reconciliation claim must be positive");
  }

  return {
    async stage(
      scope: z.input<typeof scopeSchema>,
      coordinate: PrivateVaultStageCoordinate,
    ) {
      const entry = parseStageInput({
        scope,
        coordinate,
        now: now().toISOString(),
        ttlMs,
      });
      if (!(await store.requireActiveVault(entry))) {
        throw new Error("Private Vault staging scope was not found");
      }
      return store.stage(entry);
    },

    async clearAfterMetadataCommit(entry: PrivateVaultCiphertextStage) {
      if (!(await store.isMetadataCommitted(entry))) {
        throw new Error(
          "Private Vault ciphertext stage cannot commit before metadata commit",
        );
      }
      if (!(await store.commit(entry, now().toISOString()))) {
        throw new Error(
          "Private Vault ciphertext stage was claimed for reconciliation",
        );
      }
    },

    async reconcileExpired() {
      const reconciliationAt = now().toISOString();
      const expired = await store.listClaimable(reconciliationAt, batchSize);
      let committed = 0;
      let orphansDeleted = 0;
      let failed = 0;
      for (const entry of expired) {
        try {
          const token = nextClaimToken();
          const claimed = await store.claim(
            entry,
            token,
            reconciliationAt,
            new Date(Date.parse(reconciliationAt) + claimMs).toISOString(),
          );
          if (!claimed) continue;
          if (await store.isMetadataCommitted(claimed)) {
            if (
              !(await store.finishClaim(
                claimed,
                token,
                "committed",
                reconciliationAt,
              ))
            ) {
              throw new Error("Private Vault reconciliation fence was lost");
            }
            committed += 1;
            continue;
          }
          // Recheck at the destructive edge. A metadata writer that lost the
          // active->committed CAS to this claim may already have committed its
          // scoped row; that row must win over orphan deletion.
          if (await store.isMetadataCommitted(claimed)) {
            if (
              !(await store.finishClaim(
                claimed,
                token,
                "committed",
                reconciliationAt,
              ))
            ) {
              throw new Error("Private Vault reconciliation fence was lost");
            }
            committed += 1;
            continue;
          }
          await ciphertext.delete(claimed.coordinate);
          if (
            !(await store.finishClaim(
              claimed,
              token,
              "orphaned",
              reconciliationAt,
            ))
          ) {
            throw new Error("Private Vault reconciliation fence was lost");
          }
          orphansDeleted += 1;
        } catch {
          // The intact stage is the retry marker. Provider and DB exception
          // strings are neither logged nor persisted.
          failed += 1;
        }
      }
      return {
        examined: expired.length,
        committed,
        orphansDeleted,
        failed,
      };
    },
  };
}

export const privateVaultCiphertextStagingService =
  createPrivateVaultCiphertextStagingService();

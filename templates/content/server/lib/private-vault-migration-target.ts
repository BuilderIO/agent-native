import { createHash } from "node:crypto";

import { E2EE_SUITE_ID, opaqueIdSchema } from "@agent-native/core/e2ee";
import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type {
  PrivateVaultMigrationCiphertextTarget,
  PrivateVaultMigrationScope,
} from "./private-vault-migration.js";
import {
  privateVaultObjectService,
  type PrivateVaultScope,
} from "./private-vault-objects.js";

export const PRIVATE_VAULT_MIGRATION_ROLLBACK_BATCH_SIZE = 25;

interface MigrationObjectService {
  getRevision(
    scope: PrivateVaultScope,
    objectId: string,
    revisionId: string,
  ): Promise<{
    metadata: {
      vaultId: string;
      objectId: string;
      revisionId: string;
      objectType: string;
      algorithmId: string;
      ciphertextByteLength: number;
    };
    ciphertext: Uint8Array;
  }>;
  deleteObject(
    scope: PrivateVaultScope,
    objectId: string,
  ): Promise<{ deleted: boolean }>;
}

type RollbackCandidateReader = (
  scope: PrivateVaultMigrationScope,
  objectIds: readonly string[],
  limit: number,
) => Promise<readonly string[]>;

async function sqlRollbackCandidates(
  scope: PrivateVaultMigrationScope,
  objectIds: readonly string[],
  limit: number,
): Promise<string[]> {
  if (objectIds.length === 0) return [];
  return (
    await getDb()
      .select({ objectId: schema.contentEncryptedVaultObjects.objectId })
      .from(schema.contentEncryptedVaultObjects)
      .where(
        and(
          eq(schema.contentEncryptedVaultObjects.ownerEmail, scope.ownerEmail),
          eq(schema.contentEncryptedVaultObjects.orgId, scope.orgId),
          eq(schema.contentEncryptedVaultObjects.vaultId, scope.vaultId),
          inArray(schema.contentEncryptedVaultObjects.objectId, objectIds),
          ne(schema.contentEncryptedVaultObjects.objectState, "deleted"),
        ),
      )
      .orderBy(asc(schema.contentEncryptedVaultObjects.objectId))
      .limit(limit)
  ).map((row) => row.objectId);
}

function validDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function createPrivateVaultMigrationCiphertextTarget(
  options: {
    objects?: MigrationObjectService;
    rollbackCandidates?: RollbackCandidateReader;
    rollbackBatchSize?: number;
    verifyExportEvidence?: PrivateVaultMigrationCiphertextTarget["verifyExport"];
    verifyRecoveryDrillEvidence?: PrivateVaultMigrationCiphertextTarget["verifyRecoveryDrill"];
  } = {},
): PrivateVaultMigrationCiphertextTarget {
  const objects = options.objects ?? privateVaultObjectService;
  const rollbackCandidates =
    options.rollbackCandidates ?? sqlRollbackCandidates;
  const rollbackBatchSize =
    options.rollbackBatchSize ?? PRIVATE_VAULT_MIGRATION_ROLLBACK_BATCH_SIZE;
  if (!Number.isSafeInteger(rollbackBatchSize) || rollbackBatchSize < 1)
    throw new Error("Private Vault migration rollback batch is invalid");

  async function verifyObject(
    input: Parameters<PrivateVaultMigrationCiphertextTarget["verify"]>[0],
    expectedObjectType: "document" | "vault-manifest",
  ): Promise<boolean> {
    if (!validDigest(input.ciphertextHash)) return false;
    let ciphertext: Uint8Array | undefined;
    try {
      const result = await objects.getRevision(
        input.scope,
        opaqueIdSchema.parse(input.objectId),
        opaqueIdSchema.parse(input.revisionId),
      );
      ciphertext = result.ciphertext;
      return (
        result.metadata.vaultId === input.scope.vaultId &&
        result.metadata.objectId === input.objectId &&
        result.metadata.revisionId === input.revisionId &&
        result.metadata.objectType === expectedObjectType &&
        result.metadata.algorithmId === E2EE_SUITE_ID &&
        result.metadata.ciphertextByteLength === ciphertext.byteLength &&
        createHash("sha256").update(ciphertext).digest("hex") ===
          input.ciphertextHash
      );
    } catch {
      return false;
    } finally {
      ciphertext?.fill(0);
    }
  }

  return {
    verify: (input) => verifyObject(input, "document"),
    verifyCutoverManifest: (input) => verifyObject(input, "vault-manifest"),

    async rollback(input) {
      const uniqueObjectIds = [...new Set(input.objectIds)].map((objectId) =>
        opaqueIdSchema.parse(objectId),
      );
      if (uniqueObjectIds.length !== input.objectIds.length)
        throw new Error("Private Vault migration rollback IDs are invalid");
      const candidates = await rollbackCandidates(
        input.scope,
        uniqueObjectIds,
        rollbackBatchSize + 1,
      );
      const allowed = new Set(uniqueObjectIds);
      if (
        candidates.length > rollbackBatchSize + 1 ||
        new Set(candidates).size !== candidates.length ||
        candidates.some((objectId) => !allowed.has(objectId))
      )
        throw new Error("Private Vault migration rollback scope is invalid");
      for (const objectId of candidates.slice(0, rollbackBatchSize)) {
        const deleted = await objects.deleteObject(input.scope, objectId);
        if (!deleted.deleted)
          throw new Error("Private Vault migration rollback did not delete");
      }
      return { complete: candidates.length <= rollbackBatchSize };
    },

    verifyExport: options.verifyExportEvidence ?? (async () => false),
    verifyRecoveryDrill:
      options.verifyRecoveryDrillEvidence ?? (async () => false),
  };
}

export const privateVaultMigrationCiphertextTarget =
  createPrivateVaultMigrationCiphertextTarget();

import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type {
  PrivateVaultMigrationEvidenceStore,
  StoredPrivateVaultMigrationEvidence,
} from "./private-vault-migration-evidence.js";
import type { PrivateVaultMigrationScope } from "./private-vault-migration.js";

type EvidenceRow =
  typeof schema.contentEncryptedVaultMigrationEvidence.$inferSelect;

function rowEvidence(row: EvidenceRow): StoredPrivateVaultMigrationEvidence {
  return {
    scope: {
      ownerEmail: row.ownerEmail,
      orgId: row.orgId,
      vaultId: row.vaultId,
    },
    endpointId: row.endpointId,
    kind: row.evidenceKind as "export" | "recovery_drill",
    migrationId: row.migrationId,
    evidenceId: row.evidenceId,
    exportId: row.exportId,
    exportBundleHash: row.exportBundleHash,
    plaintextHash: row.plaintextHash,
    sourceSnapshotHash: row.sourceSnapshotHash,
    objectCount: row.objectCount,
    createdAt: row.createdAt,
  };
}

function evidenceId(input: StoredPrivateVaultMigrationEvidence): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.scope.ownerEmail,
        input.scope.orgId,
        input.scope.vaultId,
        input.migrationId,
        input.kind,
        input.evidenceId,
      ]),
    )
    .digest("hex");
}

function same(
  left: StoredPrivateVaultMigrationEvidence,
  right: StoredPrivateVaultMigrationEvidence,
): boolean {
  return (
    left.scope.ownerEmail === right.scope.ownerEmail &&
    left.scope.orgId === right.scope.orgId &&
    left.scope.vaultId === right.scope.vaultId &&
    left.endpointId === right.endpointId &&
    left.kind === right.kind &&
    left.migrationId === right.migrationId &&
    left.evidenceId === right.evidenceId &&
    left.exportId === right.exportId &&
    left.exportBundleHash === right.exportBundleHash &&
    left.plaintextHash === right.plaintextHash &&
    left.sourceSnapshotHash === right.sourceSnapshotHash &&
    left.objectCount === right.objectCount
  );
}

function scopeFilter(scope: PrivateVaultMigrationScope, migrationId: string) {
  return and(
    eq(
      schema.contentEncryptedVaultMigrationEvidence.ownerEmail,
      scope.ownerEmail,
    ),
    eq(schema.contentEncryptedVaultMigrationEvidence.orgId, scope.orgId),
    eq(schema.contentEncryptedVaultMigrationEvidence.vaultId, scope.vaultId),
    eq(schema.contentEncryptedVaultMigrationEvidence.migrationId, migrationId),
  );
}

export const sqlPrivateVaultMigrationEvidenceStore: PrivateVaultMigrationEvidenceStore =
  {
    async put(input) {
      const id = evidenceId(input);
      const inserted = await getDb()
        .insert(schema.contentEncryptedVaultMigrationEvidence)
        .values({
          id,
          ownerEmail: input.scope.ownerEmail,
          orgId: input.scope.orgId,
          vaultId: input.scope.vaultId,
          migrationId: input.migrationId,
          evidenceId: input.evidenceId,
          evidenceKind: input.kind,
          endpointId: input.endpointId,
          exportId: input.exportId,
          exportBundleHash: input.exportBundleHash,
          plaintextHash: input.plaintextHash,
          sourceSnapshotHash: input.sourceSnapshotHash,
          objectCount: input.objectCount,
          createdAt: input.createdAt,
        })
        .onConflictDoNothing()
        .returning({ id: schema.contentEncryptedVaultMigrationEvidence.id });
      if (inserted.length === 1) return "stored";
      const rows = await getDb()
        .select()
        .from(schema.contentEncryptedVaultMigrationEvidence)
        .where(eq(schema.contentEncryptedVaultMigrationEvidence.id, id))
        .limit(1);
      return rows[0] && same(rowEvidence(rows[0]), input)
        ? "existing"
        : "conflict";
    },

    async getExport(scope, migrationId, exportBundleHash) {
      const rows = await getDb()
        .select()
        .from(schema.contentEncryptedVaultMigrationEvidence)
        .where(
          and(
            scopeFilter(scope, migrationId),
            eq(
              schema.contentEncryptedVaultMigrationEvidence.evidenceKind,
              "export",
            ),
            eq(
              schema.contentEncryptedVaultMigrationEvidence.exportBundleHash,
              exportBundleHash,
            ),
          ),
        )
        .limit(2);
      return rows.length === 1 ? rowEvidence(rows[0]!) : null;
    },

    async getLatestExport(scope, migrationId) {
      const rows = await getDb()
        .select()
        .from(schema.contentEncryptedVaultMigrationEvidence)
        .where(
          and(
            scopeFilter(scope, migrationId),
            eq(
              schema.contentEncryptedVaultMigrationEvidence.evidenceKind,
              "export",
            ),
          ),
        )
        .orderBy(
          desc(schema.contentEncryptedVaultMigrationEvidence.createdAt),
          desc(schema.contentEncryptedVaultMigrationEvidence.evidenceId),
        )
        .limit(1);
      return rows[0] ? rowEvidence(rows[0]) : null;
    },

    async getRecoveryDrill(
      scope,
      migrationId,
      recoveryDrillId,
      exportBundleHash,
    ) {
      const rows = await getDb()
        .select()
        .from(schema.contentEncryptedVaultMigrationEvidence)
        .where(
          and(
            scopeFilter(scope, migrationId),
            eq(
              schema.contentEncryptedVaultMigrationEvidence.evidenceKind,
              "recovery_drill",
            ),
            eq(
              schema.contentEncryptedVaultMigrationEvidence.evidenceId,
              recoveryDrillId,
            ),
            eq(
              schema.contentEncryptedVaultMigrationEvidence.exportBundleHash,
              exportBundleHash,
            ),
          ),
        )
        .limit(2);
      return rows.length === 1 ? rowEvidence(rows[0]!) : null;
    },
  };

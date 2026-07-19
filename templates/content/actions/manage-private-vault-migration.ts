import { defineAction } from "@agent-native/core";
import { opaqueIdSchema } from "@agent-native/core/e2ee";
import { z } from "zod";

import {
  getPrivateVaultMigration,
  privateVaultMigrationCoordinator,
  requirePrivateVaultMigrationActionScope,
} from "../server/lib/private-vault-migration-runtime.js";
import { PRIVATE_VAULT_BACKUP_RETENTION_DISCLOSURE_VERSION } from "../server/lib/private-vault-migration.js";

const sourceDocumentIdSchema = z.string().min(1).max(256);
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const base = { vaultId: opaqueIdSchema };

export const managePrivateVaultMigrationSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        ...base,
        operation: z.literal("preflight"),
        sourceDocumentIds: z.array(sourceDocumentIdSchema).min(1).max(10_000),
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.enum([
          "status",
          "begin",
          "cutover",
          "rollback",
          "cleanup",
        ]),
        migrationId: opaqueIdSchema,
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.literal("read-source"),
        migrationId: opaqueIdSchema,
        sourceDocumentId: sourceDocumentIdSchema,
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.literal("verify-item"),
        migrationId: opaqueIdSchema,
        sourceDocumentId: sourceDocumentIdSchema,
        revisionId: opaqueIdSchema,
        ciphertextHash: digestSchema,
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.literal("record-cleanup-proof"),
        migrationId: opaqueIdSchema,
        exportBundleHash: digestSchema,
        recoveryDrillId: opaqueIdSchema,
        backupDisclosureVersion: z.literal(
          PRIVATE_VAULT_BACKUP_RETENTION_DISCLOSURE_VERSION,
        ),
      })
      .strict(),
  ],
);

export default defineAction({
  description:
    "Drive the explicit signed-Desktop-only Private Vault migration ceremony without exposing it as an agent tool.",
  schema: managePrivateVaultMigrationSchema,
  requiresAuth: true,
  agentTool: false,
  toolCallable: false,
  audit: {
    recordInputs: false,
    summary: (args) => `Private Vault migration ${args.operation}`,
  },
  run: async (args) => {
    const scope = await requirePrivateVaultMigrationActionScope(args.vaultId);
    switch (args.operation) {
      case "preflight": {
        const ledger = await privateVaultMigrationCoordinator.preflight(
          scope,
          args.sourceDocumentIds,
        );
        return { operation: args.operation, ledger };
      }
      case "status": {
        const current = await getPrivateVaultMigration(scope, args.migrationId);
        return { operation: args.operation, ...current };
      }
      case "begin":
        return {
          operation: args.operation,
          ledger: await privateVaultMigrationCoordinator.begin(
            scope,
            args.migrationId,
          ),
        };
      case "read-source":
        return {
          operation: args.operation,
          source: await privateVaultMigrationCoordinator.readSource(
            scope,
            args.migrationId,
            args.sourceDocumentId,
          ),
        };
      case "verify-item":
        return {
          operation: args.operation,
          ledger: await privateVaultMigrationCoordinator.verifyItem({
            scope,
            migrationId: args.migrationId,
            sourceDocumentId: args.sourceDocumentId,
            revisionId: args.revisionId,
            ciphertextHash: args.ciphertextHash,
          }),
        };
      case "cutover":
        return {
          operation: args.operation,
          ledger: await privateVaultMigrationCoordinator.cutover(
            scope,
            args.migrationId,
          ),
        };
      case "record-cleanup-proof":
        return {
          operation: args.operation,
          ledger: await privateVaultMigrationCoordinator.recordCleanupProof({
            scope,
            migrationId: args.migrationId,
            exportBundleHash: args.exportBundleHash,
            recoveryDrillId: args.recoveryDrillId,
            backupDisclosureVersion: args.backupDisclosureVersion,
          }),
        };
      case "rollback":
        return {
          operation: args.operation,
          ledger: await privateVaultMigrationCoordinator.rollback(
            scope,
            args.migrationId,
          ),
        };
      case "cleanup":
        return {
          operation: args.operation,
          ledger: await privateVaultMigrationCoordinator.cleanup(
            scope,
            args.migrationId,
          ),
        };
    }
  },
});

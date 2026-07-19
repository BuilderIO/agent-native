import { and, eq, inArray, ne } from "drizzle-orm";

import {
  assertPrivateVaultMigrationTransition,
  privateVaultMigrationItemSchema,
  privateVaultMigrationLedgerSchema,
  type PrivateVaultMigrationItem,
  type PrivateVaultMigrationLedger,
} from "../../shared/private-vault-migration.js";
import { getDb, schema } from "../db/index.js";
import {
  PrivateVaultMigrationError,
  type PrivateVaultMigrationScope,
  type PrivateVaultMigrationStore,
} from "./private-vault-migration.js";

type LedgerRow = typeof schema.contentEncryptedVaultMigrations.$inferSelect;
type ItemRow = typeof schema.contentEncryptedVaultMigrationItems.$inferSelect;

function ledgerFromRow(row: LedgerRow): PrivateVaultMigrationLedger {
  return privateVaultMigrationLedgerSchema.parse({
    migrationId: row.migrationId,
    vaultId: row.vaultId,
    state: row.state,
    sourceSnapshotHash: row.sourceSnapshotHash,
    sourceCount: row.sourceCount,
    verifiedCount: row.verifiedCount,
    cutoverManifestObjectId: row.cutoverManifestObjectId,
    cutoverManifestRevisionId: row.cutoverManifestRevisionId,
    cutoverManifestCiphertextHash: row.cutoverManifestCiphertextHash,
    exportBundleHash: row.exportBundleHash,
    exportVerifiedAt: row.exportVerifiedAt,
    recoveryDrillVerifiedAt: row.recoveryDrillVerifiedAt,
    backupRetentionAcknowledgedAt: row.backupRetentionAcknowledgedAt,
    cutoverAt: row.cutoverAt,
    cleanupAt: row.cleanupAt,
    rolledBackAt: row.rolledBackAt,
  });
}

function itemFromRow(row: ItemRow): PrivateVaultMigrationItem {
  return privateVaultMigrationItemSchema.parse({
    migrationId: row.migrationId,
    sourceDocumentId: row.sourceDocumentId,
    parentSourceDocumentId: row.parentSourceDocumentId,
    objectId: row.objectId,
    sourceDigest: row.sourceDigest,
    state: row.state,
    sealedRevisionId: row.sealedRevisionId,
    sealedCiphertextHash: row.sealedCiphertextHash,
    verifiedAt: row.verifiedAt,
    cleanupAt: row.cleanupAt,
  });
}

function ledgerValues(next: PrivateVaultMigrationLedger, updatedAt: string) {
  return {
    state: next.state,
    verifiedCount: next.verifiedCount,
    cutoverManifestObjectId: next.cutoverManifestObjectId,
    cutoverManifestRevisionId: next.cutoverManifestRevisionId,
    cutoverManifestCiphertextHash: next.cutoverManifestCiphertextHash,
    exportBundleHash: next.exportBundleHash,
    exportVerifiedAt: next.exportVerifiedAt,
    recoveryDrillVerifiedAt: next.recoveryDrillVerifiedAt,
    backupRetentionAcknowledgedAt: next.backupRetentionAcknowledgedAt,
    cutoverAt: next.cutoverAt,
    cleanupAt: next.cleanupAt,
    rolledBackAt: next.rolledBackAt,
    updatedAt,
  };
}

function ledgerScope(scope: PrivateVaultMigrationScope, migrationId: string) {
  return and(
    eq(schema.contentEncryptedVaultMigrations.migrationId, migrationId),
    eq(schema.contentEncryptedVaultMigrations.vaultId, scope.vaultId),
    eq(schema.contentEncryptedVaultMigrations.ownerEmail, scope.ownerEmail),
    eq(schema.contentEncryptedVaultMigrations.orgId, scope.orgId),
  );
}

function sameLedger(
  left: PrivateVaultMigrationLedger,
  right: PrivateVaultMigrationLedger,
) {
  return (
    left.migrationId === right.migrationId &&
    left.vaultId === right.vaultId &&
    left.state === right.state &&
    left.sourceSnapshotHash === right.sourceSnapshotHash &&
    left.sourceCount === right.sourceCount &&
    left.verifiedCount === right.verifiedCount &&
    left.cutoverManifestObjectId === right.cutoverManifestObjectId &&
    left.cutoverManifestRevisionId === right.cutoverManifestRevisionId &&
    left.cutoverManifestCiphertextHash ===
      right.cutoverManifestCiphertextHash &&
    left.exportBundleHash === right.exportBundleHash &&
    left.exportVerifiedAt === right.exportVerifiedAt &&
    left.recoveryDrillVerifiedAt === right.recoveryDrillVerifiedAt &&
    left.backupRetentionAcknowledgedAt ===
      right.backupRetentionAcknowledgedAt &&
    left.cutoverAt === right.cutoverAt &&
    left.cleanupAt === right.cleanupAt &&
    left.rolledBackAt === right.rolledBackAt
  );
}

const now = () => new Date().toISOString();
export const sqlPrivateVaultMigrationStore: PrivateVaultMigrationStore = {
  async create({ scope, ledger, items }) {
    const parsedLedger = privateVaultMigrationLedgerSchema.parse(ledger);
    const parsedItems = items.map((item) =>
      privateVaultMigrationItemSchema.parse(item),
    );
    if (
      parsedLedger.vaultId !== scope.vaultId ||
      parsedItems.length !== parsedLedger.sourceCount ||
      parsedItems.some(
        (item) =>
          item.migrationId !== parsedLedger.migrationId ||
          item.state !== "pending",
      )
    )
      throw new PrivateVaultMigrationError();
    return getDb().transaction(async (tx) => {
      const active = await tx
        .select({ id: schema.contentEncryptedVaultMigrations.migrationId })
        .from(schema.contentEncryptedVaultMigrations)
        .where(
          and(
            eq(
              schema.contentEncryptedVaultMigrations.ownerEmail,
              scope.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultMigrations.orgId, scope.orgId),
            eq(schema.contentEncryptedVaultMigrations.vaultId, scope.vaultId),
            ne(schema.contentEncryptedVaultMigrations.state, "cleaned"),
            ne(schema.contentEncryptedVaultMigrations.state, "rolled_back"),
          ),
        )
        .limit(1);
      if (active.length > 0) throw new PrivateVaultMigrationError();
      const timestamp = now();
      const [row] = await tx
        .insert(schema.contentEncryptedVaultMigrations)
        .values({
          ownerEmail: scope.ownerEmail,
          orgId: scope.orgId,
          version: 1,
          ...parsedLedger,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      if (!row) throw new PrivateVaultMigrationError();
      await tx.insert(schema.contentEncryptedVaultMigrationItems).values(
        parsedItems.map((item) => ({
          id: `${item.migrationId}:${item.sourceDocumentId}`,
          ownerEmail: scope.ownerEmail,
          orgId: scope.orgId,
          vaultId: scope.vaultId,
          ...item,
        })),
      );
      return ledgerFromRow(row);
    });
  },

  async get(scope, migrationId) {
    const [row] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultMigrations)
      .where(ledgerScope(scope, migrationId))
      .limit(1);
    if (!row) return null;
    const itemRows = await getDb()
      .select()
      .from(schema.contentEncryptedVaultMigrationItems)
      .where(
        and(
          eq(
            schema.contentEncryptedVaultMigrationItems.migrationId,
            migrationId,
          ),
          eq(
            schema.contentEncryptedVaultMigrationItems.ownerEmail,
            scope.ownerEmail,
          ),
          eq(schema.contentEncryptedVaultMigrationItems.orgId, scope.orgId),
          eq(schema.contentEncryptedVaultMigrationItems.vaultId, scope.vaultId),
        ),
      );
    const ledger = ledgerFromRow(row);
    const items = itemRows.map(itemFromRow);
    if (items.length !== ledger.sourceCount)
      throw new PrivateVaultMigrationError();
    return { ledger, items };
  },

  async transition({ scope, previous, next }) {
    const parsed = assertPrivateVaultMigrationTransition(previous, next);
    const [row] = await getDb()
      .update(schema.contentEncryptedVaultMigrations)
      .set(ledgerValues(parsed, now()))
      .where(
        and(
          ledgerScope(scope, previous.migrationId),
          eq(schema.contentEncryptedVaultMigrations.state, previous.state),
          eq(
            schema.contentEncryptedVaultMigrations.verifiedCount,
            previous.verifiedCount,
          ),
        ),
      )
      .returning();
    if (!row || !sameLedger(ledgerFromRow(row), parsed))
      throw new PrivateVaultMigrationError();
    return parsed;
  },

  async verifyItem({ scope, previous, item }) {
    const parsedItem = privateVaultMigrationItemSchema.parse(item);
    return getDb().transaction(async (tx) => {
      const [ledgerRow] = await tx
        .select()
        .from(schema.contentEncryptedVaultMigrations)
        .where(ledgerScope(scope, previous.migrationId))
        .limit(1);
      if (!ledgerRow || !sameLedger(ledgerFromRow(ledgerRow), previous))
        throw new PrivateVaultMigrationError();
      const [updatedItem] = await tx
        .update(schema.contentEncryptedVaultMigrationItems)
        .set({
          state: parsedItem.state,
          sealedRevisionId: parsedItem.sealedRevisionId,
          sealedCiphertextHash: parsedItem.sealedCiphertextHash,
          verifiedAt: parsedItem.verifiedAt,
        })
        .where(
          and(
            eq(
              schema.contentEncryptedVaultMigrationItems.migrationId,
              previous.migrationId,
            ),
            eq(
              schema.contentEncryptedVaultMigrationItems.sourceDocumentId,
              parsedItem.sourceDocumentId,
            ),
            eq(
              schema.contentEncryptedVaultMigrationItems.objectId,
              parsedItem.objectId,
            ),
            eq(
              schema.contentEncryptedVaultMigrationItems.sourceDigest,
              parsedItem.sourceDigest,
            ),
            inArray(schema.contentEncryptedVaultMigrationItems.state, [
              "pending",
              "sealed",
            ]),
          ),
        )
        .returning();
      if (!updatedItem) throw new PrivateVaultMigrationError();
      const verified = await tx
        .select({ id: schema.contentEncryptedVaultMigrationItems.id })
        .from(schema.contentEncryptedVaultMigrationItems)
        .where(
          and(
            eq(
              schema.contentEncryptedVaultMigrationItems.migrationId,
              previous.migrationId,
            ),
            eq(schema.contentEncryptedVaultMigrationItems.state, "verified"),
          ),
        );
      const next = privateVaultMigrationLedgerSchema.parse({
        ...previous,
        state:
          verified.length === previous.sourceCount
            ? "ready_for_cutover"
            : "verifying",
        verifiedCount: verified.length,
      });
      assertPrivateVaultMigrationTransition(previous, next);
      const [nextRow] = await tx
        .update(schema.contentEncryptedVaultMigrations)
        .set(ledgerValues(next, now()))
        .where(
          and(
            ledgerScope(scope, previous.migrationId),
            eq(schema.contentEncryptedVaultMigrations.state, previous.state),
            eq(
              schema.contentEncryptedVaultMigrations.verifiedCount,
              previous.verifiedCount,
            ),
          ),
        )
        .returning();
      if (!nextRow || !sameLedger(ledgerFromRow(nextRow), next))
        throw new PrivateVaultMigrationError();
      return next;
    });
  },

  async markCleaned({ scope, previous, itemIds, cleanedAt }) {
    return getDb().transaction(async (tx) => {
      const items = await tx
        .select()
        .from(schema.contentEncryptedVaultMigrationItems)
        .where(
          and(
            eq(
              schema.contentEncryptedVaultMigrationItems.migrationId,
              previous.migrationId,
            ),
            eq(
              schema.contentEncryptedVaultMigrationItems.ownerEmail,
              scope.ownerEmail,
            ),
            eq(schema.contentEncryptedVaultMigrationItems.orgId, scope.orgId),
            eq(
              schema.contentEncryptedVaultMigrationItems.vaultId,
              scope.vaultId,
            ),
          ),
        );
      if (
        items.length !== previous.sourceCount ||
        items.some(
          (item) =>
            item.state !== "verified" ||
            !itemIds.includes(item.sourceDocumentId),
        )
      )
        throw new PrivateVaultMigrationError();
      await tx
        .update(schema.contentEncryptedVaultMigrationItems)
        .set({ state: "cleaned", cleanupAt: cleanedAt })
        .where(
          and(
            eq(
              schema.contentEncryptedVaultMigrationItems.migrationId,
              previous.migrationId,
            ),
            eq(schema.contentEncryptedVaultMigrationItems.state, "verified"),
          ),
        );
      const next = privateVaultMigrationLedgerSchema.parse({
        ...previous,
        state: "cleaned",
        cleanupAt: cleanedAt,
      });
      assertPrivateVaultMigrationTransition(previous, next);
      const [row] = await tx
        .update(schema.contentEncryptedVaultMigrations)
        .set(ledgerValues(next, now()))
        .where(
          and(
            ledgerScope(scope, previous.migrationId),
            eq(schema.contentEncryptedVaultMigrations.state, previous.state),
            eq(
              schema.contentEncryptedVaultMigrations.verifiedCount,
              previous.verifiedCount,
            ),
          ),
        )
        .returning();
      if (!row || !sameLedger(ledgerFromRow(row), next))
        throw new PrivateVaultMigrationError();
      return next;
    });
  },
};

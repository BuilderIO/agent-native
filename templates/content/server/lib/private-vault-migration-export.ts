import { createHash } from "node:crypto";

import {
  PRIVATE_VAULT_MIGRATION_EXPORT_FORMAT,
  PRIVATE_VAULT_MIGRATION_EXPORT_VERSION,
  encodePrivateVaultMigrationExportPayload,
} from "../../shared/private-vault-migration-export.js";
import type {
  PrivateVaultMigrationItem,
  PrivateVaultMigrationLedger,
} from "../../shared/private-vault-migration.js";
import {
  PrivateVaultMigrationError,
  hashPrivateVaultMigrationSnapshot,
  hashPrivateVaultMigrationSource,
  type PrivateVaultMigrationScope,
  type PrivateVaultMigrationSourceDocument,
} from "./private-vault-migration.js";

export interface PrivateVaultMigrationExportBundle {
  readonly plaintext: Uint8Array;
  readonly plaintextSha256: string;
  readonly objectCount: number;
  readonly sourceSnapshotHash: string;
}

export function createPrivateVaultMigrationExportBundle(input: {
  scope: PrivateVaultMigrationScope;
  ledger: PrivateVaultMigrationLedger;
  items: readonly PrivateVaultMigrationItem[];
  sources: readonly PrivateVaultMigrationSourceDocument[];
  createdAt: string;
}): PrivateVaultMigrationExportBundle {
  const { scope, ledger, items, sources } = input;
  if (
    ledger.state !== "cutover" ||
    ledger.vaultId !== scope.vaultId ||
    ledger.sourceCount !== items.length ||
    ledger.verifiedCount !== items.length ||
    sources.length !== items.length ||
    !ledger.cutoverManifestObjectId ||
    !ledger.cutoverManifestRevisionId ||
    !ledger.cutoverManifestCiphertextHash ||
    hashPrivateVaultMigrationSnapshot(items) !== ledger.sourceSnapshotHash
  )
    throw new PrivateVaultMigrationError();

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  if (sourceById.size !== sources.length)
    throw new PrivateVaultMigrationError();
  const documents = items.map((item) => {
    const source = sourceById.get(item.sourceDocumentId);
    if (
      !source ||
      item.migrationId !== ledger.migrationId ||
      item.state !== "verified" ||
      !item.sealedRevisionId ||
      !item.sealedCiphertextHash ||
      source.parentId !== item.parentSourceDocumentId ||
      hashPrivateVaultMigrationSource(source) !== item.sourceDigest
    )
      throw new PrivateVaultMigrationError();
    return {
      sourceDocumentId: source.id,
      parentSourceDocumentId: source.parentId,
      objectId: item.objectId,
      sourceDigest: item.sourceDigest,
      sealedRevisionId: item.sealedRevisionId,
      sealedCiphertextHash: item.sealedCiphertextHash,
      title: source.title,
      content: source.content,
      description: source.description,
      icon: source.icon,
      position: source.position,
      isFavorite: source.isFavorite,
      hideFromSearch: source.hideFromSearch,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  });

  const plaintext = encodePrivateVaultMigrationExportPayload({
    format: PRIVATE_VAULT_MIGRATION_EXPORT_FORMAT,
    version: PRIVATE_VAULT_MIGRATION_EXPORT_VERSION,
    vaultId: scope.vaultId,
    migrationId: ledger.migrationId,
    sourceSnapshotHash: ledger.sourceSnapshotHash,
    cutoverManifestObjectId: ledger.cutoverManifestObjectId,
    cutoverManifestRevisionId: ledger.cutoverManifestRevisionId,
    cutoverManifestCiphertextHash: ledger.cutoverManifestCiphertextHash,
    createdAt: input.createdAt,
    documents,
  });
  return {
    plaintext,
    plaintextSha256: createHash("sha256").update(plaintext).digest("hex"),
    objectCount: documents.length,
    sourceSnapshotHash: ledger.sourceSnapshotHash,
  };
}

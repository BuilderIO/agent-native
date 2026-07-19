import { createHash, randomBytes } from "node:crypto";

import {
  assertPrivateVaultMigrationTransition,
  privateVaultMigrationItemSchema,
  privateVaultMigrationLedgerSchema,
  type PrivateVaultMigrationItem,
  type PrivateVaultMigrationLedger,
} from "../../shared/private-vault-migration.js";

export const PRIVATE_VAULT_MIGRATION_MAX_DOCUMENTS = 10_000;
export const PRIVATE_VAULT_MIGRATION_MAX_SOURCE_BYTES = 1024 * 1024;
export const PRIVATE_VAULT_BACKUP_RETENTION_DISCLOSURE_VERSION =
  "content-private-vault-backup-retention-v1";

export interface PrivateVaultMigrationScope {
  readonly ownerEmail: string;
  readonly orgId: string;
  readonly vaultId: string;
}

export interface PrivateVaultMigrationSourceDocument {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly content: string;
  readonly description: string;
  readonly icon: string | null;
  readonly position: number;
  readonly isFavorite: boolean;
  readonly hideFromSearch: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PrivateVaultMigrationSource {
  freeze(
    scope: PrivateVaultMigrationScope,
    sourceDocumentIds: readonly string[],
  ): Promise<readonly PrivateVaultMigrationSourceDocument[]>;
  read(
    scope: PrivateVaultMigrationScope,
    sourceDocumentId: string,
  ): Promise<PrivateVaultMigrationSourceDocument | null>;
  cleanup(
    scope: PrivateVaultMigrationScope,
    sources: readonly Pick<
      PrivateVaultMigrationItem,
      "sourceDocumentId" | "sourceDigest"
    >[],
  ): Promise<void>;
}

export interface PrivateVaultMigrationCiphertextTarget {
  verify(input: {
    scope: PrivateVaultMigrationScope;
    objectId: string;
    revisionId: string;
    ciphertextHash: string;
  }): Promise<boolean>;
  rollback(input: {
    scope: PrivateVaultMigrationScope;
    objectIds: readonly string[];
  }): Promise<{ complete: boolean }>;
  verifyExport(input: {
    scope: PrivateVaultMigrationScope;
    migrationId: string;
    exportBundleHash: string;
  }): Promise<boolean>;
  verifyRecoveryDrill(input: {
    scope: PrivateVaultMigrationScope;
    migrationId: string;
    recoveryDrillId: string;
    exportBundleHash: string;
  }): Promise<boolean>;
}

export interface PrivateVaultMigrationStore {
  create(input: {
    scope: PrivateVaultMigrationScope;
    ledger: PrivateVaultMigrationLedger;
    items: readonly PrivateVaultMigrationItem[];
  }): Promise<PrivateVaultMigrationLedger>;
  get(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
  ): Promise<{
    ledger: PrivateVaultMigrationLedger;
    items: readonly PrivateVaultMigrationItem[];
  } | null>;
  transition(input: {
    scope: PrivateVaultMigrationScope;
    previous: PrivateVaultMigrationLedger;
    next: PrivateVaultMigrationLedger;
  }): Promise<PrivateVaultMigrationLedger>;
  verifyItem(input: {
    scope: PrivateVaultMigrationScope;
    previous: PrivateVaultMigrationLedger;
    item: PrivateVaultMigrationItem;
  }): Promise<PrivateVaultMigrationLedger>;
  markCleaned(input: {
    scope: PrivateVaultMigrationScope;
    previous: PrivateVaultMigrationLedger;
    itemIds: readonly string[];
    cleanedAt: string;
  }): Promise<PrivateVaultMigrationLedger>;
}

export class PrivateVaultMigrationError extends Error {
  constructor() {
    super("Private Vault migration could not be completed");
    this.name = "PrivateVaultMigrationError";
  }
}

const fail = (): never => {
  throw new PrivateVaultMigrationError();
};

function opaqueId(): string {
  return randomBytes(16).toString("hex");
}

export function encodePrivateVaultMigrationSource(
  source: PrivateVaultMigrationSourceDocument,
): Uint8Array {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      1,
      source.id,
      source.parentId,
      source.title,
      source.content,
      source.description,
      source.icon,
      source.position,
      source.isFavorite,
      source.hideFromSearch,
      source.createdAt,
      source.updatedAt,
    ]),
  );
  if (bytes.byteLength > PRIVATE_VAULT_MIGRATION_MAX_SOURCE_BYTES) fail();
  return bytes;
}

export function hashPrivateVaultMigrationSource(
  source: PrivateVaultMigrationSourceDocument,
): string {
  const encoded = encodePrivateVaultMigrationSource(source);
  try {
    return createHash("sha256").update(encoded).digest("hex");
  } finally {
    encoded.fill(0);
  }
}

export function hashPrivateVaultMigrationSnapshot(
  items: readonly Pick<
    PrivateVaultMigrationItem,
    "sourceDocumentId" | "sourceDigest" | "objectId"
  >[],
): string {
  const canonical = [...items]
    .sort((left, right) =>
      left.sourceDocumentId < right.sourceDocumentId
        ? -1
        : left.sourceDocumentId > right.sourceDocumentId
          ? 1
          : 0,
    )
    .map((item) => [item.sourceDocumentId, item.sourceDigest, item.objectId]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export class PrivateVaultMigrationCoordinator {
  constructor(
    private readonly source: PrivateVaultMigrationSource,
    private readonly target: PrivateVaultMigrationCiphertextTarget,
    private readonly store: PrivateVaultMigrationStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async preflight(
    scope: PrivateVaultMigrationScope,
    sourceDocumentIds: readonly string[],
  ): Promise<PrivateVaultMigrationLedger> {
    if (
      sourceDocumentIds.length === 0 ||
      sourceDocumentIds.length > PRIVATE_VAULT_MIGRATION_MAX_DOCUMENTS ||
      new Set(sourceDocumentIds).size !== sourceDocumentIds.length
    )
      fail();
    const frozen = await this.source.freeze(scope, sourceDocumentIds);
    if (
      frozen.length !== sourceDocumentIds.length ||
      new Set(frozen.map((document) => document.id)).size !== frozen.length ||
      frozen.some((document) => !sourceDocumentIds.includes(document.id))
    )
      fail();
    const migrationId = opaqueId();
    const itemBySource = new Map<string, PrivateVaultMigrationItem>();
    for (const document of frozen) {
      const item = privateVaultMigrationItemSchema.parse({
        migrationId,
        sourceDocumentId: document.id,
        parentSourceDocumentId: document.parentId,
        objectId: opaqueId(),
        sourceDigest: hashPrivateVaultMigrationSource(document),
        state: "pending",
        sealedRevisionId: null,
        sealedCiphertextHash: null,
        verifiedAt: null,
        cleanupAt: null,
      });
      itemBySource.set(document.id, item);
    }
    for (const item of itemBySource.values())
      if (
        item.parentSourceDocumentId &&
        !itemBySource.has(item.parentSourceDocumentId)
      )
        fail();
    for (const item of itemBySource.values()) {
      const seen = new Set<string>();
      let cursor: PrivateVaultMigrationItem | undefined = item;
      while (cursor) {
        if (seen.has(cursor.sourceDocumentId)) fail();
        seen.add(cursor.sourceDocumentId);
        cursor = cursor.parentSourceDocumentId
          ? itemBySource.get(cursor.parentSourceDocumentId)
          : undefined;
      }
    }
    const items = [...itemBySource.values()];
    const ledger = privateVaultMigrationLedgerSchema.parse({
      migrationId,
      vaultId: scope.vaultId,
      state: "preflight",
      sourceSnapshotHash: hashPrivateVaultMigrationSnapshot(items),
      sourceCount: items.length,
      verifiedCount: 0,
      exportBundleHash: null,
      exportVerifiedAt: null,
      recoveryDrillVerifiedAt: null,
      backupRetentionAcknowledgedAt: null,
      cutoverAt: null,
      cleanupAt: null,
      rolledBackAt: null,
    });
    return this.store.create({ scope, ledger, items });
  }

  async begin(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
  ): Promise<PrivateVaultMigrationLedger> {
    const current = await this.require(scope, migrationId);
    const next = {
      ...current.ledger,
      state: "copying" as const,
    };
    assertPrivateVaultMigrationTransition(current.ledger, next);
    return this.store.transition({ scope, previous: current.ledger, next });
  }

  async readSource(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
    sourceDocumentId: string,
  ): Promise<PrivateVaultMigrationSourceDocument> {
    const current = await this.require(scope, migrationId);
    if (
      current.ledger.state !== "copying" &&
      current.ledger.state !== "verifying"
    )
      fail();
    const item = current.items.find(
      (candidate) => candidate.sourceDocumentId === sourceDocumentId,
    );
    const source = item
      ? await this.source.read(scope, sourceDocumentId)
      : null;
    if (
      !item ||
      !source ||
      hashPrivateVaultMigrationSource(source) !== item.sourceDigest
    )
      throw new PrivateVaultMigrationError();
    return source;
  }

  async verifyItem(input: {
    scope: PrivateVaultMigrationScope;
    migrationId: string;
    sourceDocumentId: string;
    revisionId: string;
    ciphertextHash: string;
  }): Promise<PrivateVaultMigrationLedger> {
    const current = await this.require(input.scope, input.migrationId);
    if (
      current.ledger.state !== "copying" &&
      current.ledger.state !== "verifying"
    )
      fail();
    const existing = current.items.find(
      (candidate) => candidate.sourceDocumentId === input.sourceDocumentId,
    );
    if (!existing) throw new PrivateVaultMigrationError();
    const source = await this.source.read(input.scope, input.sourceDocumentId);
    if (
      !source ||
      hashPrivateVaultMigrationSource(source) !== existing.sourceDigest ||
      !(await this.target.verify({
        scope: input.scope,
        objectId: existing.objectId,
        revisionId: input.revisionId,
        ciphertextHash: input.ciphertextHash,
      }))
    )
      fail();
    if (
      existing.state === "verified" &&
      existing.sealedRevisionId === input.revisionId &&
      existing.sealedCiphertextHash === input.ciphertextHash
    )
      return current.ledger;
    if (existing.state !== "pending" && existing.state !== "sealed") fail();
    const item = privateVaultMigrationItemSchema.parse({
      ...existing,
      state: "verified",
      sealedRevisionId: input.revisionId,
      sealedCiphertextHash: input.ciphertextHash,
      verifiedAt: this.now(),
    });
    return this.store.verifyItem({
      scope: input.scope,
      previous: current.ledger,
      item,
    });
  }

  async cutover(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
  ): Promise<PrivateVaultMigrationLedger> {
    const current = await this.require(scope, migrationId);
    const next = {
      ...current.ledger,
      state: "cutover" as const,
      cutoverAt: this.now(),
    };
    assertPrivateVaultMigrationTransition(current.ledger, next);
    return this.store.transition({ scope, previous: current.ledger, next });
  }

  async recordCleanupProof(input: {
    scope: PrivateVaultMigrationScope;
    migrationId: string;
    exportBundleHash: string;
    recoveryDrillId: string;
    backupDisclosureVersion: string;
  }): Promise<PrivateVaultMigrationLedger> {
    const current = await this.require(input.scope, input.migrationId);
    if (
      current.ledger.state !== "cutover" ||
      input.backupDisclosureVersion !==
        PRIVATE_VAULT_BACKUP_RETENTION_DISCLOSURE_VERSION ||
      !(await this.target.verifyExport({
        scope: input.scope,
        migrationId: input.migrationId,
        exportBundleHash: input.exportBundleHash,
      })) ||
      !(await this.target.verifyRecoveryDrill({
        scope: input.scope,
        migrationId: input.migrationId,
        recoveryDrillId: input.recoveryDrillId,
        exportBundleHash: input.exportBundleHash,
      }))
    )
      fail();
    const now = this.now();
    const next = privateVaultMigrationLedgerSchema.parse({
      ...current.ledger,
      state: "cleanup_eligible",
      exportBundleHash: input.exportBundleHash,
      exportVerifiedAt: now,
      recoveryDrillVerifiedAt: now,
      backupRetentionAcknowledgedAt: now,
    });
    assertPrivateVaultMigrationTransition(current.ledger, next);
    return this.store.transition({
      scope: input.scope,
      previous: current.ledger,
      next,
    });
  }

  async rollback(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
  ): Promise<PrivateVaultMigrationLedger> {
    const current = await this.require(scope, migrationId);
    const objectIds = current.items
      .filter((item) => item.state !== "pending")
      .map((item) => item.objectId);
    const rollback = await this.target.rollback({ scope, objectIds });
    if (!rollback.complete) return current.ledger;
    const next = {
      ...current.ledger,
      state: "rolled_back" as const,
      rolledBackAt: this.now(),
    };
    assertPrivateVaultMigrationTransition(current.ledger, next);
    return this.store.transition({ scope, previous: current.ledger, next });
  }

  async cleanup(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
  ): Promise<PrivateVaultMigrationLedger> {
    const current = await this.require(scope, migrationId);
    if (current.ledger.state !== "cleanup_eligible") fail();
    const sources = current.items.map((item) => ({
      sourceDocumentId: item.sourceDocumentId,
      sourceDigest: item.sourceDigest,
    }));
    await this.source.cleanup(scope, sources);
    return this.store.markCleaned({
      scope,
      previous: current.ledger,
      itemIds: sources.map((item) => item.sourceDocumentId),
      cleanedAt: this.now(),
    });
  }

  private async require(
    scope: PrivateVaultMigrationScope,
    migrationId: string,
  ): Promise<{
    ledger: PrivateVaultMigrationLedger;
    items: readonly PrivateVaultMigrationItem[];
  }> {
    const current = await this.store.get(scope, migrationId);
    if (!current) throw new PrivateVaultMigrationError();
    return current;
  }
}

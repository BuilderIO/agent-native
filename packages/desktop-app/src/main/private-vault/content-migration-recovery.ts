import { createHash, randomBytes } from "node:crypto";

import type { AncV1MigrationEvidence } from "@agent-native/core/e2ee";

import type { PrivateVaultMigrationArchiveReader } from "./content-migration-archive-reader.js";

export const PRIVATE_VAULT_BACKUP_RETENTION_DISCLOSURE_VERSION =
  "content-private-vault-backup-retention-v1";

export interface PrivateVaultMigrationExportEvidence {
  readonly exportId: string;
  readonly exportBundleHash: string;
  readonly plaintextHash: string;
  readonly sourceSnapshotHash: string;
  readonly objectCount: number;
}

interface RecoveryNativeService {
  openExportArchive(input: { vaultId: string; archive: Uint8Array }): Promise<{
    exportId: string;
    sourceSnapshotHash: string;
    plaintextHash: string;
    objectCount: number;
  }>;
}

interface RecoveryHostedService {
  exportEvidence(
    vaultId: string,
    migrationId: string,
  ): Promise<PrivateVaultMigrationExportEvidence>;
  recordCleanupProof(input: {
    vaultId: string;
    migrationId: string;
    exportBundleHash: string;
    recoveryDrillId: string;
    backupDisclosureVersion: string;
  }): Promise<unknown>;
}

interface RecoveryEvidenceWriter {
  append(evidence: AncV1MigrationEvidence): Promise<unknown>;
}

export class PrivateVaultMigrationRecoveryError extends Error {
  constructor() {
    super("Private Vault migration recovery drill unavailable");
    this.name = "PrivateVaultMigrationRecoveryError";
  }
}

function fail(): never {
  throw new PrivateVaultMigrationRecoveryError();
}

export class PrivateVaultMigrationRecoveryRuntime {
  readonly #hosted: RecoveryHostedService;
  readonly #evidence: RecoveryEvidenceWriter;
  readonly #native: RecoveryNativeService;
  readonly #reader: PrivateVaultMigrationArchiveReader;
  readonly #drillId: () => string;

  constructor(input: {
    hosted: RecoveryHostedService;
    evidence: RecoveryEvidenceWriter;
    native: RecoveryNativeService;
    reader: PrivateVaultMigrationArchiveReader;
    drillId?: () => string;
  }) {
    this.#hosted = input.hosted;
    this.#evidence = input.evidence;
    this.#native = input.native;
    this.#reader = input.reader;
    this.#drillId = input.drillId ?? (() => randomBytes(16).toString("hex"));
  }

  async verify(vaultId: string, migrationId: string) {
    const expected = await this.#hosted.exportEvidence(vaultId, migrationId);
    const archive = await this.#reader.read();
    try {
      const exportBundleHash = createHash("sha256")
        .update(archive)
        .digest("hex");
      if (exportBundleHash !== expected.exportBundleHash) fail();
      const opened = await this.#native.openExportArchive({ vaultId, archive });
      if (
        opened.exportId !== expected.exportId ||
        opened.sourceSnapshotHash !== expected.sourceSnapshotHash ||
        opened.plaintextHash !== expected.plaintextHash ||
        opened.objectCount !== expected.objectCount
      )
        fail();
      const recoveryDrillId = this.#drillId();
      await this.#evidence.append({
        version: 1,
        suite: "anc/v1",
        type: "migration-evidence",
        kind: "recovery_drill",
        vaultId,
        migrationId,
        exportId: expected.exportId,
        exportBundleHash,
        plaintextHash: expected.plaintextHash,
        sourceSnapshotHash: expected.sourceSnapshotHash,
        objectCount: expected.objectCount,
        recoveryDrillId,
      });
      const ledger = await this.#hosted.recordCleanupProof({
        vaultId,
        migrationId,
        exportBundleHash,
        recoveryDrillId,
        backupDisclosureVersion:
          PRIVATE_VAULT_BACKUP_RETENTION_DISCLOSURE_VERSION,
      });
      return Object.freeze({
        exportId: expected.exportId,
        exportBundleHash,
        recoveryDrillId,
        ledger,
      });
    } catch (error) {
      if (error instanceof PrivateVaultMigrationRecoveryError) throw error;
      fail();
    } finally {
      archive.fill(0);
    }
  }
}

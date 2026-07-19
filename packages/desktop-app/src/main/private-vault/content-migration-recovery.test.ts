import { describe, expect, it, vi } from "vitest";

import {
  PRIVATE_VAULT_BACKUP_RETENTION_DISCLOSURE_VERSION,
  PrivateVaultMigrationRecoveryError,
  PrivateVaultMigrationRecoveryRuntime,
} from "./content-migration-recovery.js";

const vaultId = "11".repeat(16);
const migrationId = "22".repeat(16);
const exportId = "33".repeat(16);
const archive = Uint8Array.of(0xa1, 1, 2, 3);
const exportBundleHash =
  "d7a8b070ad1abe0d2d494e9aca2f194b3c9eabf56d4d4427d354a85673c4b8b6";

function fixture(overrides: { archiveHash?: string } = {}) {
  let working: Uint8Array | undefined;
  const expected = {
    exportId,
    exportBundleHash: overrides.archiveHash ?? exportBundleHash,
    plaintextHash: "44".repeat(32),
    sourceSnapshotHash: "55".repeat(32),
    objectCount: 2,
  };
  const hosted = {
    exportEvidence: vi.fn(async () => expected),
    recordCleanupProof: vi.fn(async () => ({ state: "cleanup_eligible" })),
  };
  const evidence = { append: vi.fn(async () => ({ state: "stored" })) };
  const native = {
    openExportArchive: vi.fn(async () => ({
      exportId,
      sourceSnapshotHash: expected.sourceSnapshotHash,
      plaintextHash: expected.plaintextHash,
      objectCount: 2,
    })),
  };
  return {
    hosted,
    evidence,
    native,
    working: () => working,
    runtime: new PrivateVaultMigrationRecoveryRuntime({
      hosted,
      evidence,
      native,
      reader: {
        read: vi.fn(async () => {
          working = archive.slice();
          return working;
        }),
      },
      drillId: () => "66".repeat(16),
    }),
  };
}

describe("Private Vault migration recovery drill", () => {
  it("binds native archive recovery to export evidence before making cleanup eligible", async () => {
    const source = fixture();
    await expect(source.runtime.verify(vaultId, migrationId)).resolves.toEqual({
      exportId,
      exportBundleHash,
      recoveryDrillId: "66".repeat(16),
      ledger: { state: "cleanup_eligible" },
    });
    expect(source.evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "recovery_drill",
        vaultId,
        migrationId,
        exportBundleHash,
        recoveryDrillId: "66".repeat(16),
      }),
    );
    expect(source.hosted.recordCleanupProof).toHaveBeenCalledWith({
      vaultId,
      migrationId,
      exportBundleHash,
      recoveryDrillId: "66".repeat(16),
      backupDisclosureVersion:
        PRIVATE_VAULT_BACKUP_RETENTION_DISCLOSURE_VERSION,
    });
    expect(source.working()).toEqual(new Uint8Array(archive.byteLength));
  });

  it("rejects a different local archive before asking native code for the phrase", async () => {
    const source = fixture({ archiveHash: "77".repeat(32) });
    await expect(
      source.runtime.verify(vaultId, migrationId),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationRecoveryError);
    expect(source.native.openExportArchive).not.toHaveBeenCalled();
    expect(source.evidence.append).not.toHaveBeenCalled();
    expect(source.working()).toEqual(new Uint8Array(archive.byteLength));
  });
});

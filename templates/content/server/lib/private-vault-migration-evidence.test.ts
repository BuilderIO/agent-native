import { describe, expect, it, vi } from "vitest";

import type { PrivateVaultMigrationLedger } from "../../shared/private-vault-migration.js";
import {
  PrivateVaultMigrationEvidenceError,
  PrivateVaultMigrationEvidenceService,
  type StoredPrivateVaultMigrationEvidence,
} from "./private-vault-migration-evidence.js";

const scope = {
  ownerEmail: "owner@example.test",
  orgId: "org-test",
  vaultId: "11".repeat(16),
};
const endpointId = "22".repeat(16);
const migrationId = "33".repeat(16);
const exportId = "44".repeat(16);
const exportBundleHash = "55".repeat(32);
const plaintextHash = "66".repeat(32);
const sourceSnapshotHash = "77".repeat(32);

function fixture() {
  const ledger = {
    migrationId,
    vaultId: scope.vaultId,
    state: "cutover",
    sourceSnapshotHash,
    sourceCount: 2,
    verifiedCount: 2,
  } as PrivateVaultMigrationLedger;
  const rows: StoredPrivateVaultMigrationEvidence[] = [];
  const evidence = {
    put: vi.fn(async (next: StoredPrivateVaultMigrationEvidence) => {
      const existing = rows.find(
        (row) =>
          row.kind === next.kind &&
          row.migrationId === next.migrationId &&
          row.evidenceId === next.evidenceId,
      );
      if (existing)
        return JSON.stringify(existing) === JSON.stringify(next)
          ? ("existing" as const)
          : ("conflict" as const);
      rows.push(next);
      return "stored" as const;
    }),
    getExport: vi.fn(
      async (_scope, id, hash) =>
        rows.find(
          (row) =>
            row.kind === "export" &&
            row.migrationId === id &&
            row.exportBundleHash === hash,
        ) ?? null,
    ),
    getLatestExport: vi.fn(
      async (_scope, id) =>
        [...rows]
          .reverse()
          .find((row) => row.kind === "export" && row.migrationId === id) ??
        null,
    ),
    getRecoveryDrill: vi.fn(
      async (_scope, id, drillId, hash) =>
        rows.find(
          (row) =>
            row.kind === "recovery_drill" &&
            row.migrationId === id &&
            row.evidenceId === drillId &&
            row.exportBundleHash === hash,
        ) ?? null,
    ),
  };
  return {
    rows,
    evidence,
    service: new PrivateVaultMigrationEvidenceService({
      migrations: {
        get: vi.fn(async () => ({ ledger, items: [] })),
      },
      evidence,
      now: () => "2026-07-19T10:00:00.000Z",
    }),
  };
}

const exportEvidence = {
  version: 1 as const,
  suite: "anc/v1" as const,
  type: "migration-evidence" as const,
  kind: "export" as const,
  vaultId: scope.vaultId,
  migrationId,
  exportId,
  exportBundleHash,
  plaintextHash,
  sourceSnapshotHash,
  objectCount: 2,
};

describe("Private Vault migration evidence", () => {
  it("requires a matching cutover ledger before storing export evidence", async () => {
    const source = fixture();
    await expect(
      source.service.append({ ...scope, endpointId }, exportEvidence),
    ).resolves.toEqual({ kind: "export", migrationId, evidenceId: exportId });
    await expect(
      source.service.verifyExport({ scope, migrationId, exportBundleHash }),
    ).resolves.toBe(true);
  });

  it("binds a recovery drill to the exact previously attested export", async () => {
    const source = fixture();
    await source.service.append({ ...scope, endpointId }, exportEvidence);
    const recoveryDrillId = "88".repeat(16);
    await expect(
      source.service.append(
        { ...scope, endpointId },
        { ...exportEvidence, kind: "recovery_drill", recoveryDrillId },
      ),
    ).resolves.toEqual({
      kind: "recovery_drill",
      migrationId,
      evidenceId: recoveryDrillId,
    });
    await expect(
      source.service.verifyRecoveryDrill({
        scope,
        migrationId,
        recoveryDrillId,
        exportBundleHash,
      }),
    ).resolves.toBe(true);
  });

  it("rejects recovery evidence for a different archive or without export evidence", async () => {
    const source = fixture();
    await expect(
      source.service.append(
        { ...scope, endpointId },
        {
          ...exportEvidence,
          kind: "recovery_drill",
          recoveryDrillId: "88".repeat(16),
        },
      ),
    ).rejects.toBeInstanceOf(PrivateVaultMigrationEvidenceError);
    expect(source.rows).toEqual([]);
  });
});

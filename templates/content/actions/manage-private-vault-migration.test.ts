import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  requireScope: vi.fn(),
  get: vi.fn(),
  coordinator: {
    active: vi.fn(),
    listCandidates: vi.fn(),
    preflight: vi.fn(),
    begin: vi.fn(),
    readSource: vi.fn(),
    verifyItem: vi.fn(),
    cutover: vi.fn(),
    recordCleanupProof: vi.fn(),
    rollback: vi.fn(),
    cleanup: vi.fn(),
  },
}));
const evidence = vi.hoisted(() => ({ latestExport: vi.fn() }));

vi.mock("../server/lib/private-vault-migration-runtime.js", () => ({
  requirePrivateVaultMigrationActionScope: (...args: unknown[]) =>
    runtime.requireScope(...args),
  getPrivateVaultMigration: (...args: unknown[]) => runtime.get(...args),
  privateVaultMigrationCoordinator: runtime.coordinator,
}));
vi.mock("../server/lib/private-vault-migration-evidence-runtime.js", () => ({
  privateVaultMigrationEvidenceService: evidence,
}));

import action, {
  managePrivateVaultMigrationSchema,
} from "./manage-private-vault-migration.js";

const vaultId = "21".repeat(16);
const migrationId = "31".repeat(16);
const scope = { ownerEmail: "owner@example.test", orgId: "org:test", vaultId };
const ledger = { migrationId, vaultId, state: "copying" };

describe("manage-private-vault-migration action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    runtime.requireScope.mockResolvedValue(scope);
    for (const method of Object.values(runtime.coordinator))
      method.mockResolvedValue(ledger);
    runtime.coordinator.readSource.mockResolvedValue({
      id: "source-doc",
      content: "private sentinel",
    });
    runtime.coordinator.listCandidates.mockResolvedValue(["source-doc"]);
    runtime.coordinator.active.mockResolvedValue(null);
    runtime.get.mockResolvedValue({ ledger, items: [] });
    evidence.latestExport.mockResolvedValue({
      exportId: "61".repeat(16),
      exportBundleHash: "62".repeat(32),
      plaintextHash: "63".repeat(32),
      sourceSnapshotHash: "64".repeat(32),
      objectCount: 1,
    });
  });

  it("is not exposed to an agent and suppresses migration inputs from audit", () => {
    expect(action.agentTool).toBe(false);
    expect(action.toolCallable).toBe(false);
    expect(action.audit?.recordInputs).toBe(false);
  });

  it("dispatches every stateful operation through the scoped coordinator", async () => {
    await expect(
      action.run({ vaultId, operation: "active" }, {} as never),
    ).resolves.toEqual({ operation: "active", current: null });
    expect(runtime.coordinator.active).toHaveBeenCalledWith(scope);

    await expect(
      action.run({ vaultId, operation: "candidates" }, {} as never),
    ).resolves.toEqual({
      operation: "candidates",
      sourceCount: 1,
      sourceDocumentIds: ["source-doc"],
    });
    expect(runtime.coordinator.listCandidates).toHaveBeenCalledWith(scope);

    await action.run(
      { vaultId, operation: "evidence", migrationId },
      {} as never,
    );
    expect(evidence.latestExport).toHaveBeenCalledWith(scope, migrationId);

    await action.run(
      { vaultId, operation: "preflight", sourceDocumentIds: ["source-doc"] },
      {} as never,
    );
    expect(runtime.coordinator.preflight).toHaveBeenCalledWith(scope, [
      "source-doc",
    ]);

    await action.run(
      {
        vaultId,
        operation: "verify-item",
        migrationId,
        sourceDocumentId: "source-doc",
        revisionId: "41".repeat(32),
        ciphertextHash: "51".repeat(32),
      },
      {} as never,
    );
    expect(runtime.coordinator.verifyItem).toHaveBeenCalledWith({
      scope,
      migrationId,
      sourceDocumentId: "source-doc",
      revisionId: "41".repeat(32),
      ciphertextHash: "51".repeat(32),
    });

    for (const operation of ["begin", "rollback", "cleanup"] as const)
      await action.run({ vaultId, operation, migrationId }, {} as never);
    await action.run(
      {
        vaultId,
        operation: "cutover",
        migrationId,
        objectId: "41".repeat(16),
        revisionId: "42".repeat(32),
        ciphertextHash: "43".repeat(32),
      },
      {} as never,
    );
    expect(runtime.coordinator.begin).toHaveBeenCalledWith(scope, migrationId);
    expect(runtime.coordinator.cutover).toHaveBeenCalledWith({
      scope,
      migrationId,
      objectId: "41".repeat(16),
      revisionId: "42".repeat(32),
      ciphertextHash: "43".repeat(32),
    });
    expect(runtime.coordinator.rollback).toHaveBeenCalledWith(
      scope,
      migrationId,
    );
    expect(runtime.coordinator.cleanup).toHaveBeenCalledWith(
      scope,
      migrationId,
    );

    await action.run(
      {
        vaultId,
        operation: "record-cleanup-proof",
        migrationId,
        exportBundleHash: "71".repeat(32),
        recoveryDrillId: "72".repeat(16),
        backupDisclosureVersion: "content-private-vault-backup-retention-v1",
      },
      {} as never,
    );
    expect(runtime.coordinator.recordCleanupProof).toHaveBeenCalledWith({
      scope,
      migrationId,
      exportBundleHash: "71".repeat(32),
      recoveryDrillId: "72".repeat(16),
      backupDisclosureVersion: "content-private-vault-backup-retention-v1",
    });
  });

  it("returns source plaintext only for the explicit read-source operation", async () => {
    await expect(
      action.run(
        {
          vaultId,
          operation: "read-source",
          migrationId,
          sourceDocumentId: "source-doc",
        },
        {} as never,
      ),
    ).resolves.toEqual({
      operation: "read-source",
      source: { id: "source-doc", content: "private sentinel" },
    });
    expect(runtime.coordinator.readSource).toHaveBeenCalledWith(
      scope,
      migrationId,
      "source-doc",
    );
  });

  it("rejects phrase material and unknown ceremony fields at the schema", () => {
    expect(
      managePrivateVaultMigrationSchema.safeParse({
        vaultId,
        operation: "status",
        migrationId,
        recoveryPhrase: "never",
      }).success,
    ).toBe(false);
    expect(
      managePrivateVaultMigrationSchema.safeParse({
        vaultId,
        operation: "verify-item",
        migrationId,
        sourceDocumentId: "source-doc",
        revisionId: "41".repeat(16),
        ciphertextHash: "51".repeat(32),
      }).success,
    ).toBe(false);
  });
});

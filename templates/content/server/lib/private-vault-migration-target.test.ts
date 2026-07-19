import { createHash } from "node:crypto";

import { E2EE_SUITE_ID } from "@agent-native/core/e2ee";
import { describe, expect, it, vi } from "vitest";

import { createPrivateVaultMigrationCiphertextTarget } from "./private-vault-migration-target.js";
import type { PrivateVaultMigrationScope } from "./private-vault-migration.js";

const scope: PrivateVaultMigrationScope = {
  ownerEmail: "owner@example.test",
  orgId: "org_test",
  vaultId: "21".repeat(16),
};
const objectId = "31".repeat(16);
const revisionId = "41".repeat(32);

function objectService(ciphertext = Uint8Array.of(1, 2, 3, 4)) {
  return {
    ciphertext,
    getRevision: vi.fn(
      async (
        _scope: PrivateVaultMigrationScope,
        _objectId: string,
        _revisionId: string,
      ) => ({
        metadata: {
          vaultId: scope.vaultId,
          objectId,
          revisionId,
          objectType: "document",
          algorithmId: E2EE_SUITE_ID,
          ciphertextByteLength: ciphertext.byteLength,
        },
        ciphertext,
      }),
    ),
    deleteObject: vi.fn(
      async (_scope: PrivateVaultMigrationScope, _objectId: string) => ({
        deleted: true,
      }),
    ),
  };
}

describe("Private Vault migration ciphertext target", () => {
  it("verifies the exact stored ciphertext bytes and erases its read buffer", async () => {
    const objects = objectService();
    const target = createPrivateVaultMigrationCiphertextTarget({ objects });
    const expectedHash = createHash("sha256")
      .update(objects.ciphertext)
      .digest("hex");
    await expect(
      target.verify({
        scope,
        objectId,
        revisionId,
        ciphertextHash: expectedHash,
      }),
    ).resolves.toBe(true);
    expect(objects.getRevision).toHaveBeenCalledWith(
      scope,
      objectId,
      revisionId,
    );
    expect(Array.from(objects.ciphertext)).toEqual([0, 0, 0, 0]);
  });

  it("fails closed for a wrong hash, metadata binding, or unreadable blob", async () => {
    const wrongHashObjects = objectService();
    const wrongHashTarget = createPrivateVaultMigrationCiphertextTarget({
      objects: wrongHashObjects,
    });
    await expect(
      wrongHashTarget.verify({
        scope,
        objectId,
        revisionId,
        ciphertextHash: "ff".repeat(32),
      }),
    ).resolves.toBe(false);

    const wrongTypeObjects = objectService();
    wrongTypeObjects.getRevision.mockResolvedValueOnce({
      metadata: {
        vaultId: scope.vaultId,
        objectId,
        revisionId,
        objectType: "vault-manifest",
        algorithmId: E2EE_SUITE_ID,
        ciphertextByteLength: 4,
      },
      ciphertext: wrongTypeObjects.ciphertext,
    });
    await expect(
      createPrivateVaultMigrationCiphertextTarget({
        objects: wrongTypeObjects,
      }).verify({
        scope,
        objectId,
        revisionId,
        ciphertextHash: createHash("sha256")
          .update(wrongTypeObjects.ciphertext)
          .digest("hex"),
      }),
    ).resolves.toBe(false);

    const unreadableObjects = objectService();
    unreadableObjects.getRevision.mockRejectedValueOnce(new Error("offline"));
    await expect(
      createPrivateVaultMigrationCiphertextTarget({
        objects: unreadableObjects,
      }).verify({
        scope,
        objectId,
        revisionId,
        ciphertextHash: "ff".repeat(32),
      }),
    ).resolves.toBe(false);
  });

  it("verifies cutover only against an exact encrypted vault manifest", async () => {
    const objects = objectService();
    objects.getRevision.mockResolvedValueOnce({
      metadata: {
        vaultId: scope.vaultId,
        objectId,
        revisionId,
        objectType: "vault-manifest",
        algorithmId: E2EE_SUITE_ID,
        ciphertextByteLength: objects.ciphertext.byteLength,
      },
      ciphertext: objects.ciphertext,
    });
    const expectedHash = createHash("sha256")
      .update(objects.ciphertext)
      .digest("hex");
    await expect(
      createPrivateVaultMigrationCiphertextTarget({
        objects,
      }).verifyCutoverManifest({
        scope,
        objectId,
        revisionId,
        ciphertextHash: expectedHash,
      }),
    ).resolves.toBe(true);
    expect(Array.from(objects.ciphertext)).toEqual([0, 0, 0, 0]);

    const documentObjects = objectService();
    await expect(
      createPrivateVaultMigrationCiphertextTarget({
        objects: documentObjects,
      }).verifyCutoverManifest({
        scope,
        objectId,
        revisionId,
        ciphertextHash: createHash("sha256")
          .update(documentObjects.ciphertext)
          .digest("hex"),
      }),
    ).resolves.toBe(false);
  });

  it("deletes rollback objects in bounded, idempotently resumable batches", async () => {
    const objects = objectService();
    const first = "51".repeat(16);
    const second = "52".repeat(16);
    const third = "53".repeat(16);
    const rollbackCandidates = vi
      .fn()
      .mockResolvedValueOnce([first, second, third])
      .mockResolvedValueOnce([third])
      .mockResolvedValueOnce([]);
    const target = createPrivateVaultMigrationCiphertextTarget({
      objects,
      rollbackCandidates,
      rollbackBatchSize: 2,
    });
    const input = { scope, objectIds: [first, second, third] };

    await expect(target.rollback(input)).resolves.toEqual({ complete: false });
    expect(objects.deleteObject.mock.calls.map((call) => call[1])).toEqual([
      first,
      second,
    ]);
    await expect(target.rollback(input)).resolves.toEqual({ complete: true });
    expect(objects.deleteObject.mock.calls.map((call) => call[1])).toEqual([
      first,
      second,
      third,
    ]);
    await expect(target.rollback(input)).resolves.toEqual({ complete: true });
    expect(objects.deleteObject).toHaveBeenCalledTimes(3);
  });

  it("does not claim export or recovery evidence before evidence storage exists", async () => {
    const target = createPrivateVaultMigrationCiphertextTarget({
      objects: objectService(),
    });
    await expect(
      target.verifyExport({
        scope,
        migrationId: "61".repeat(16),
        exportBundleHash: "71".repeat(32),
      }),
    ).resolves.toBe(false);
    await expect(
      target.verifyRecoveryDrill({
        scope,
        migrationId: "61".repeat(16),
        recoveryDrillId: "81".repeat(16),
        exportBundleHash: "71".repeat(32),
      }),
    ).resolves.toBe(false);
  });
});

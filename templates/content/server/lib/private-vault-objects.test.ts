import { describe, expect, it, vi } from "vitest";

import {
  createPrivateVaultObjectService,
  PrivateVaultObjectConflictError,
  PrivateVaultObjectNotFoundError,
  type PrivateVaultObjectBlobStore,
  type PrivateVaultObjectRevisionInput,
  type PrivateVaultObjectStore,
  type PrivateVaultObjectStagingStore,
  type PrivateVaultRevisionMetadata,
  type PrivateVaultScope,
} from "./private-vault-objects.js";

const scope: PrivateVaultScope = {
  ownerEmail: "owner@example.test",
  orgId: "org:test-0001",
  vaultId: "vault:test-0001",
};

const revision: PrivateVaultObjectRevisionInput = {
  vaultId: scope.vaultId,
  objectId: "object:test-0001",
  revisionId: "revision:test-0001",
  revision: 1,
  objectType: "document",
  algorithmId: "anc/v1",
  epoch: 1,
  parentRevisionIds: [],
  ciphertextByteLength: 4,
};

function fixture(
  options: {
    vault?: boolean;
    persistError?: Error;
    deleteError?: Error;
  } = {},
) {
  const revisions = new Map<string, PrivateVaultRevisionMetadata>();
  let object: {
    objectId: string;
    objectType: string;
    objectState: string;
  } | null = null;
  const persistedMetadata: PrivateVaultRevisionMetadata[] = [];
  const store: PrivateVaultObjectStore = {
    requireActiveVault: vi.fn(async (candidate) => {
      return (
        (options.vault ?? true) &&
        candidate.ownerEmail === scope.ownerEmail &&
        candidate.orgId === scope.orgId &&
        candidate.vaultId === scope.vaultId
      );
    }),
    getObject: vi.fn(async () => object),
    getRevision: vi.fn(async (_scope, _objectId, revisionId) => {
      return revisions.get(revisionId) ?? null;
    }),
    persistRevision: vi.fn(async (_scope, metadata, _eventId, stage) => {
      if (options.persistError) throw options.persistError;
      expect(stage.coordinate).toMatchObject({
        kind: "object",
        revisionId: metadata.revisionId,
      });
      if (!object) {
        object = {
          objectId: metadata.objectId,
          objectType: metadata.objectType,
          objectState: "active",
        };
      }
      const existing = revisions.get(metadata.revisionId);
      if (existing) return existing;
      persistedMetadata.push(metadata);
      revisions.set(metadata.revisionId, metadata);
      return metadata;
    }),
    listRevisions: vi.fn(async () => [...revisions.values()]),
    listObjects: vi.fn(async () => {
      if (!object) return [];
      const values = [...revisions.values()];
      const latestRevision = values[values.length - 1];
      return latestRevision
        ? [
            {
              objectId: object.objectId,
              objectType: object.objectType,
              latestRevision,
            },
          ]
        : [];
    }),
    beginDelete: vi.fn(async () => {
      if (!object) return null;
      if (object.objectState === "active")
        object.objectState = "delete_pending";
      return { ...object };
    }),
    finishDelete: vi.fn(async () => {
      if (object) object.objectState = "deleted";
    }),
  };
  const blobBytes = new Map<string, Uint8Array>();
  const staging: PrivateVaultObjectStagingStore = {
    stage: vi.fn(async (candidateScope, candidateCoordinate) => ({
      stageId: "stage:test-0001",
      ...candidateScope,
      coordinate: candidateCoordinate,
      stagedAt: "2026-07-16T12:00:00.000Z",
      expiresAt: "2026-07-17T12:00:00.000Z",
    })),
    clearAfterMetadataCommit: vi.fn(async () => undefined),
  };
  const blobs: PrivateVaultObjectBlobStore = {
    put: vi.fn(async (input) => {
      const key = input.coordinate.revisionId;
      const existing = blobBytes.get(key);
      if (existing) {
        if (
          existing.byteLength !== input.ciphertext.byteLength ||
          existing.some((byte, index) => byte !== input.ciphertext[index])
        ) {
          throw new PrivateVaultObjectConflictError("ciphertext collision");
        }
        return {
          locator: {
            kind: "agent-native.protected-ciphertext" as const,
            version: 1 as const,
            provider: "memory-protected-v1",
            opaque: true as const,
            coordinate: input.coordinate,
          },
          byteLength: existing.byteLength,
          created: false,
        };
      }
      blobBytes.set(key, input.ciphertext);
      return {
        locator: {
          kind: "agent-native.protected-ciphertext" as const,
          version: 1 as const,
          provider: "memory-protected-v1",
          opaque: true as const,
          coordinate: input.coordinate,
        },
        byteLength: input.ciphertext.byteLength,
        created: true,
      };
    }),
    read: vi.fn(async (coordinate) => {
      const ciphertext = blobBytes.get(coordinate.revisionId);
      if (!ciphertext) throw new PrivateVaultObjectNotFoundError();
      return { ciphertext, byteLength: ciphertext.byteLength };
    }),
    delete: vi.fn(async (coordinate) => ({
      deleted: blobBytes.delete(coordinate.revisionId),
    })),
    deleteObject: vi.fn(async () => {
      if (options.deleteError) throw options.deleteError;
      const deleted = blobBytes.size;
      blobBytes.clear();
      return { deleted };
    }),
  };
  const syncEvents: unknown[] = [];
  const service = createPrivateVaultObjectService({
    store,
    blobs,
    staging,
    now: () => "2026-07-16T12:00:00.000Z",
    eventId: () => `event:test-${syncEvents.length + 1}`,
    emitSync: (...args) => syncEvents.push(args),
  });
  return {
    service,
    store,
    blobs,
    staging,
    revisions,
    persistedMetadata,
    syncEvents,
    get object() {
      return object;
    },
  };
}

describe("Private Vault object service", () => {
  it("verifies the exact parent scope before provider I/O", async () => {
    const subject = fixture({ vault: false });
    await expect(
      subject.service.putRevision(
        { ...scope, ownerEmail: "intruder@example.test" },
        { ...revision, ciphertext: new Uint8Array([1, 2, 3, 4]) },
      ),
    ).rejects.toBeInstanceOf(PrivateVaultObjectNotFoundError);
    expect(subject.blobs.put).not.toHaveBeenCalled();
  });

  it("persists only opaque metadata and emits a content-free sync event", async () => {
    const subject = fixture();
    const sentinel = new TextEncoder().encode("PINE");
    await subject.service.putRevision(scope, {
      ...revision,
      ciphertext: sentinel,
    });

    expect(subject.persistedMetadata).toHaveLength(1);
    expect(JSON.stringify(subject.persistedMetadata)).not.toContain("PINE");
    expect(JSON.stringify(subject.syncEvents)).not.toContain("PINE");
    expect(subject.blobs.put).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinate: expect.objectContaining({
          kind: "object",
          part: "header",
        }),
        ciphertext: sentinel,
        expectedByteLength: 4,
      }),
    );
    expect(subject.staging.stage).toHaveBeenCalledBefore(
      vi.mocked(subject.blobs.put),
    );
    expect(subject.store.persistRevision).toHaveBeenCalledWith(
      scope,
      expect.not.objectContaining({ ciphertext: expect.anything() }),
      expect.any(String),
      expect.objectContaining({ stageId: "stage:test-0001" }),
    );
    expect(subject.staging.clearAfterMetadataCommit).not.toHaveBeenCalled();
  });

  it("accepts an equal-byte retry and rejects a different-byte collision", async () => {
    const subject = fixture();
    const first = { ...revision, ciphertext: new Uint8Array([1, 2, 3, 4]) };
    await subject.service.putRevision(scope, first);
    await expect(
      subject.service.putRevision(scope, first),
    ).resolves.toMatchObject({
      revisionId: revision.revisionId,
    });
    expect(subject.persistedMetadata).toHaveLength(1);
    expect(subject.staging.stage).toHaveBeenCalledOnce();
    expect(subject.blobs.put).toHaveBeenCalledTimes(2);

    await expect(
      subject.service.putRevision(scope, {
        ...revision,
        ciphertext: new Uint8Array([9, 9, 9, 9]),
      }),
    ).rejects.toThrow("ciphertext collision");
    expect(subject.staging.stage).toHaveBeenCalledOnce();
  });

  it("lists only content-free active object coordinates", async () => {
    const subject = fixture();
    await subject.service.putRevision(scope, {
      ...revision,
      ciphertext: new Uint8Array([1, 2, 3, 4]),
    });
    await expect(subject.service.listObjects(scope)).resolves.toEqual([
      {
        objectId: revision.objectId,
        objectType: revision.objectType,
        latestRevision: expect.objectContaining({
          revisionId: revision.revisionId,
          ciphertextByteLength: 4,
        }),
      },
    ]);
    const serialized = JSON.stringify(await subject.service.listObjects(scope));
    expect(serialized).not.toContain('"ciphertext":');
    expect(serialized).not.toContain("title");

    await expect(
      subject.service.listObjects({ ...scope, vaultId: "vault:other-0001" }),
    ).rejects.toBeInstanceOf(PrivateVaultObjectNotFoundError);
  });

  it("compensates a newly-created blob after metadata persistence failure", async () => {
    const subject = fixture({
      persistError: new Error("database unavailable"),
    });
    await expect(
      subject.service.putRevision(scope, {
        ...revision,
        ciphertext: new Uint8Array([1, 2, 3, 4]),
      }),
    ).rejects.toThrow("database unavailable");
    expect(subject.blobs.delete).toHaveBeenCalledOnce();
    expect(subject.blobs.deleteObject).not.toHaveBeenCalled();
    expect(subject.staging.stage).toHaveBeenCalledBefore(
      vi.mocked(subject.blobs.put),
    );
    expect(subject.staging.clearAfterMetadataCommit).not.toHaveBeenCalled();
  });

  it("authorizes metadata before reading ciphertext and detects stored length drift", async () => {
    const subject = fixture();
    await subject.service.putRevision(scope, {
      ...revision,
      ciphertext: new Uint8Array([1, 2, 3, 4]),
    });
    await expect(
      subject.service.getRevision(
        { ...scope, orgId: "org:other-0001" },
        revision.objectId,
        revision.revisionId,
      ),
    ).rejects.toBeInstanceOf(PrivateVaultObjectNotFoundError);
    expect(subject.blobs.read).not.toHaveBeenCalled();

    vi.mocked(subject.blobs.read).mockResolvedValueOnce({
      ciphertext: new Uint8Array([1]),
      byteLength: 1,
    });
    await expect(
      subject.service.getRevision(
        scope,
        revision.objectId,
        revision.revisionId,
      ),
    ).rejects.toThrow("length does not match");
  });

  it("leaves a SQL tombstone pending on provider failure and completes on retry", async () => {
    const subject = fixture();
    await subject.service.putRevision(scope, {
      ...revision,
      ciphertext: new Uint8Array([1, 2, 3, 4]),
    });
    vi.mocked(subject.blobs.deleteObject)
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce({ deleted: 1 });

    await expect(
      subject.service.deleteObject(scope, revision.objectId),
    ).rejects.toThrow("provider unavailable");
    expect(subject.object?.objectState).toBe("delete_pending");
    expect(subject.store.finishDelete).not.toHaveBeenCalled();

    await expect(
      subject.service.deleteObject(scope, revision.objectId),
    ).resolves.toEqual({ deleted: true });
    expect(subject.object?.objectState).toBe("deleted");
    expect(subject.store.finishDelete).toHaveBeenCalledOnce();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteProtectedCiphertextAt = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/protected-ciphertext", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/protected-ciphertext")
  >()),
  deleteProtectedCiphertextAt,
}));

import { ProtectedCiphertextNotFoundError } from "@agent-native/core/protected-ciphertext";

import {
  createPrivateVaultCiphertextStagingService,
  privateVaultStagedCiphertextStore,
  type PrivateVaultCiphertextStage,
  type PrivateVaultCiphertextStagingStore,
} from "./private-vault-ciphertext-staging.js";

const START = "2026-07-16T12:00:00.000Z";
const AFTER_EXPIRY = "2026-07-18T12:00:00.000Z";
const coordinate = {
  kind: "object" as const,
  vaultId: "vault_opaque_0001",
  objectId: "object_opaque_0001",
  revisionId: "revision_opaque_0001",
  part: "header" as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeStore() {
  const entries: PrivateVaultCiphertextStage[] = [];
  const committed = new Set<string>();
  const parentTombstones = new Set<string>();
  const calls: string[] = [];
  const metadataKey = (entry: PrivateVaultCiphertextStage) =>
    JSON.stringify([
      entry.ownerEmail,
      entry.orgId,
      entry.vaultId,
      entry.coordinate,
    ]);
  const store: PrivateVaultCiphertextStagingStore = {
    requireActiveVault: vi.fn(async () => true),
    stage: vi.fn(async (entry) => {
      calls.push(`stage:${entry.stageId}`);
      if (parentTombstones.has(metadataKey(entry))) {
        throw new Error(
          "Private Vault ciphertext coordinate is permanently finalized",
        );
      }
      const existing = entries.find(
        (candidate) => candidate.stageId === entry.stageId,
      );
      if (existing) {
        if (existing.phase !== "active") {
          throw new Error(
            "Private Vault ciphertext coordinate is permanently finalized",
          );
        }
        return { ...existing };
      }
      entries.push({ ...entry });
      return { ...entry };
    }),
    commit: vi.fn(async (entry, committedAt) => {
      calls.push(`commit:${entry.stageId}`);
      const current = entries.find(
        (candidate) =>
          candidate.stageId === entry.stageId && candidate.phase === "active",
      );
      if (!current) return false;
      Object.assign(current, {
        phase: "committed",
        finalizedAt: committedAt,
        claimToken: null,
        claimExpiresAt: null,
      });
      return true;
    }),
    listClaimable: vi.fn(async (now) =>
      entries
        .filter(
          (entry) =>
            (entry.phase === "active" && entry.expiresAt <= now) ||
            (entry.phase === "reconciling" &&
              entry.claimExpiresAt !== null &&
              entry.claimExpiresAt <= now),
        )
        .map((entry) => ({ ...entry })),
    ),
    claim: vi.fn(async (entry, token, claimedAt, claimExpiresAt) => {
      calls.push(`claim:${entry.stageId}:${token}`);
      const current = entries.find(
        (candidate) => candidate.stageId === entry.stageId,
      );
      if (
        !current ||
        (current.phase !== "active" &&
          !(
            current.phase === "reconciling" &&
            current.claimExpiresAt !== null &&
            current.claimExpiresAt <= claimedAt
          ))
      )
        return null;
      Object.assign(current, {
        phase: "reconciling",
        claimToken: token,
        claimExpiresAt,
        finalizedAt: null,
      });
      return { ...current };
    }),
    finishClaim: vi.fn(async (entry, token, phase, finalizedAt) => {
      calls.push(`finish:${entry.stageId}:${token}:${phase}`);
      const current = entries.find(
        (candidate) =>
          candidate.stageId === entry.stageId &&
          candidate.phase === "reconciling" &&
          candidate.claimToken === token,
      );
      if (!current) return false;
      Object.assign(current, {
        phase,
        finalizedAt,
        claimToken: null,
        claimExpiresAt: null,
      });
      return true;
    }),
    isMetadataCommitted: vi.fn(async (entry) => {
      calls.push(`metadata:${entry.stageId}`);
      return committed.has(metadataKey(entry));
    }),
  };
  return {
    store,
    entries,
    committed,
    calls,
    markCommitted: (entry: PrivateVaultCiphertextStage) =>
      committed.add(metadataKey(entry)),
    purgeUnderParentTombstone: (entry: PrivateVaultCiphertextStage) => {
      const index = entries.findIndex(
        (candidate) => candidate.stageId === entry.stageId,
      );
      if (index >= 0) entries.splice(index, 1);
      parentTombstones.add(metadataKey(entry));
    },
  };
}

describe("Private Vault ciphertext staging", () => {
  beforeEach(() => vi.resetAllMocks());

  it("persists a scoped marker before callers may begin Blob I/O", async () => {
    const state = fakeStore();
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      now: () => new Date(START),
    });
    const stage = await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "org_1",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );

    expect(state.calls).toEqual([`stage:${stage.stageId}`]);
    expect(stage).not.toHaveProperty("provider");
    expect(stage).not.toHaveProperty("ciphertext");
    expect(stage.coordinate).toEqual(coordinate);
  });

  it("refuses to stage for a vault outside the authenticated tenant scope", async () => {
    const state = fakeStore();
    vi.mocked(state.store.requireActiveVault).mockResolvedValueOnce(false);
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      now: () => new Date(START),
    });

    await expect(
      service.stage(
        {
          ownerEmail: "mallory@example.com",
          orgId: "",
          vaultId: coordinate.vaultId,
        },
        coordinate,
      ),
    ).rejects.toThrow("scope was not found");
    expect(state.store.stage).not.toHaveBeenCalled();
  });

  it("clears committed metadata without deleting valid ciphertext", async () => {
    const state = fakeStore();
    let now = START;
    const ciphertext = { delete: vi.fn(async () => undefined) };
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      ciphertext,
      now: () => new Date(now),
    });
    const stage = await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );
    state.markCommitted(stage);
    now = AFTER_EXPIRY;

    await expect(service.reconcileExpired()).resolves.toMatchObject({
      committed: 1,
      orphansDeleted: 0,
      failed: 0,
    });
    expect(ciphertext.delete).not.toHaveBeenCalled();
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      phase: "committed",
      claimToken: null,
    });
  });

  it("refuses an application clear until scoped metadata is committed", async () => {
    const state = fakeStore();
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      now: () => new Date(START),
    });
    const stage = await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );

    await expect(service.clearAfterMetadataCommit(stage)).rejects.toThrow(
      "cannot commit before metadata commit",
    );
    expect(state.entries).toHaveLength(1);
    state.markCommitted(stage);
    await expect(
      service.clearAfterMetadataCommit(stage),
    ).resolves.toBeUndefined();
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.phase).toBe("committed");
    await expect(
      service.stage(
        {
          ownerEmail: "alice@example.com",
          orgId: "",
          vaultId: coordinate.vaultId,
        },
        coordinate,
      ),
    ).rejects.toThrow("permanently finalized");
    state.purgeUnderParentTombstone(stage);
    expect(state.entries).toHaveLength(0);
    await expect(
      service.stage(
        {
          ownerEmail: "alice@example.com",
          orgId: "",
          vaultId: coordinate.vaultId,
        },
        coordinate,
      ),
    ).rejects.toThrow("permanently finalized");
  });

  it.each(["request", "result"] as const)(
    "recognizes committed job %s metadata without deleting its bytes",
    async (part) => {
      const state = fakeStore();
      let now = START;
      const ciphertext = { delete: vi.fn(async () => undefined) };
      const service = createPrivateVaultCiphertextStagingService({
        store: state.store,
        ciphertext,
        now: () => new Date(now),
      });
      const stage = await service.stage(
        {
          ownerEmail: "alice@example.com",
          orgId: "org_1",
          vaultId: coordinate.vaultId,
        },
        {
          kind: "job",
          vaultId: coordinate.vaultId,
          jobId: "job_opaque_0001",
          part,
        },
      );
      state.markCommitted(stage);
      now = AFTER_EXPIRY;

      await expect(service.reconcileExpired()).resolves.toMatchObject({
        committed: 1,
        orphansDeleted: 0,
      });
      expect(ciphertext.delete).not.toHaveBeenCalled();
    },
  );

  it("deletes an orphan exact coordinate before clearing its stage", async () => {
    const state = fakeStore();
    let now = START;
    const ciphertext = {
      delete: vi.fn(async () => {
        state.calls.push("blob-delete");
      }),
    };
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      ciphertext,
      now: () => new Date(now),
    });
    const stage = await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );
    now = AFTER_EXPIRY;
    await service.reconcileExpired();

    expect(state.calls.slice(-3)).toEqual([
      `metadata:${stage.stageId}`,
      "blob-delete",
      expect.stringMatching(`^finish:${stage.stageId}:.*:orphaned$`),
    ]);
    expect(state.entries[0]?.phase).toBe("orphaned");
  });

  it("leaves the stage intact on a non-NotFound provider failure", async () => {
    const state = fakeStore();
    let now = START;
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      ciphertext: {
        delete: vi.fn(async () => {
          throw new Error("provider authentication failed");
        }),
      },
      now: () => new Date(now),
    });
    await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );
    now = AFTER_EXPIRY;

    await expect(service.reconcileExpired()).resolves.toMatchObject({
      failed: 1,
    });
    expect(state.entries).toHaveLength(1);
  });

  it("keeps an orphan tombstone after exact-coordinate deletion", async () => {
    const state = fakeStore();
    let now = START;
    const ciphertext = { delete: vi.fn(async () => undefined) };
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      ciphertext,
      now: () => new Date(now),
      claimToken: () => "claim-one",
    });
    await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );
    now = AFTER_EXPIRY;
    await service.reconcileExpired();

    expect(ciphertext.delete).toHaveBeenCalledTimes(1);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({ phase: "orphaned" });
    await expect(
      service.stage(
        {
          ownerEmail: "alice@example.com",
          orgId: "",
          vaultId: coordinate.vaultId,
        },
        coordinate,
      ),
    ).rejects.toThrow("permanently finalized");
  });

  it("lets only one concurrent reconciler own and delete an expired coordinate", async () => {
    const state = fakeStore();
    let now = START;
    const deleting = deferred<void>();
    const deleteStarted = deferred<void>();
    const ciphertext = {
      delete: vi.fn(async () => {
        deleteStarted.resolve();
        await deleting.promise;
      }),
    };
    let claimNumber = 0;
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      ciphertext,
      now: () => new Date(now),
      claimToken: () => `claim-${++claimNumber}`,
    });
    await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );
    now = AFTER_EXPIRY;

    const first = service.reconcileExpired();
    await deleteStarted.promise;
    const second = service.reconcileExpired();
    await expect(second).resolves.toMatchObject({ examined: 0 });
    deleting.resolve();
    await expect(first).resolves.toMatchObject({ orphansDeleted: 1 });
    expect(ciphertext.delete).toHaveBeenCalledTimes(1);
    expect(state.entries[0]?.phase).toBe("orphaned");
  });

  it("a reconciliation claim defeats commit CAS but a final metadata recheck prevents deletion", async () => {
    const state = fakeStore();
    let now = START;
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      ciphertext: { delete: vi.fn(async () => undefined) },
      now: () => new Date(now),
      claimToken: () => "claim-race",
    });
    const stage = await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );
    const firstCheckEntered = deferred<void>();
    const resumeFirstCheck = deferred<void>();
    const originalMetadataCheck = vi
      .mocked(state.store.isMetadataCommitted)
      .getMockImplementation()!;
    let checks = 0;
    vi.mocked(state.store.isMetadataCommitted).mockImplementation(
      async (entry) => {
        checks += 1;
        if (checks === 1) {
          firstCheckEntered.resolve();
          await resumeFirstCheck.promise;
          return false;
        }
        return originalMetadataCheck(entry);
      },
    );
    now = AFTER_EXPIRY;
    const reconciliation = service.reconcileExpired();
    await firstCheckEntered.promise;
    state.markCommitted(stage);
    await expect(service.clearAfterMetadataCommit(stage)).rejects.toThrow(
      "claimed for reconciliation",
    );
    resumeFirstCheck.resolve();
    await expect(reconciliation).resolves.toMatchObject({
      committed: 1,
      orphansDeleted: 0,
    });
    expect(state.entries[0]?.phase).toBe("committed");
  });

  it("rolls metadata back when the janitor finishes both checks before the writer CAS", async () => {
    const state = fakeStore();
    let now = START;
    const ciphertext = { delete: vi.fn(async () => undefined) };
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      ciphertext,
      now: () => new Date(now),
      claimToken: () => "janitor-wins",
    });
    const stage = await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );
    now = AFTER_EXPIRY;

    await expect(service.reconcileExpired()).resolves.toMatchObject({
      orphansDeleted: 1,
      failed: 0,
    });
    expect(state.store.isMetadataCommitted).toHaveBeenCalledTimes(2);

    const atomicWriter = async () => {
      state.markCommitted(stage);
      if (!(await state.store.commit(stage, now))) {
        state.committed.delete(
          JSON.stringify([
            stage.ownerEmail,
            stage.orgId,
            stage.vaultId,
            stage.coordinate,
          ]),
        );
        throw new Error("writer transaction rolled back");
      }
      return "success";
    };

    await expect(atomicWriter()).rejects.toThrow(
      "writer transaction rolled back",
    );
    expect(await state.store.isMetadataCommitted(stage)).toBe(false);
    expect(state.entries[0]?.phase).toBe("orphaned");
    expect(ciphertext.delete).toHaveBeenCalledTimes(1);
  });

  it("preserves ciphertext when the atomic writer wins before reconciliation", async () => {
    const state = fakeStore();
    let now = START;
    const ciphertext = { delete: vi.fn(async () => undefined) };
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      ciphertext,
      now: () => new Date(now),
    });
    const stage = await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );

    state.markCommitted(stage);
    await expect(state.store.commit(stage, START)).resolves.toBe(true);
    now = AFTER_EXPIRY;
    await expect(service.reconcileExpired()).resolves.toMatchObject({
      examined: 0,
      orphansDeleted: 0,
    });
    expect(state.entries[0]?.phase).toBe("committed");
    expect(ciphertext.delete).not.toHaveBeenCalled();
  });

  it("reclaims an expired reconciliation lease without accepting the stale token", async () => {
    const state = fakeStore();
    let now = START;
    const ciphertext = { delete: vi.fn(async () => undefined) };
    let claimNumber = 0;
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      ciphertext,
      now: () => new Date(now),
      claimMs: 60_000,
      claimToken: () => `lease-${++claimNumber}`,
    });
    await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );
    vi.mocked(state.store.finishClaim).mockResolvedValueOnce(false);
    now = AFTER_EXPIRY;
    await expect(service.reconcileExpired()).resolves.toMatchObject({
      failed: 1,
      orphansDeleted: 0,
    });
    expect(state.entries[0]).toMatchObject({
      phase: "reconciling",
      claimToken: "lease-1",
    });
    now = "2026-07-18T12:02:00.000Z";
    await expect(service.reconcileExpired()).resolves.toMatchObject({
      failed: 0,
      orphansDeleted: 1,
    });
    expect(state.entries[0]).toMatchObject({
      phase: "orphaned",
      claimToken: null,
    });
    expect(ciphertext.delete).toHaveBeenCalledTimes(2);
  });

  it("never lets one tenant's committed row bless another tenant's stage", async () => {
    const state = fakeStore();
    let now = START;
    const ciphertext = { delete: vi.fn(async () => undefined) };
    const service = createPrivateVaultCiphertextStagingService({
      store: state.store,
      ciphertext,
      now: () => new Date(now),
    });
    const alice = await service.stage(
      {
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: coordinate.vaultId,
      },
      coordinate,
    );
    const bob = await service.stage(
      {
        ownerEmail: "bob@example.com",
        orgId: "",
        vaultId: "vault_opaque_0002",
      },
      { ...coordinate, vaultId: "vault_opaque_0002" },
    );
    expect(alice.stageId).not.toBe(bob.stageId);
    state.markCommitted(alice);
    now = AFTER_EXPIRY;

    await expect(service.reconcileExpired()).resolves.toMatchObject({
      committed: 1,
      orphansDeleted: 1,
    });
    expect(ciphertext.delete).toHaveBeenCalledWith(bob.coordinate);
    expect(ciphertext.delete).toHaveBeenCalledTimes(1);
  });

  it("treats only exact-coordinate NotFound as deletion success", async () => {
    deleteProtectedCiphertextAt.mockRejectedValueOnce(
      new ProtectedCiphertextNotFoundError(),
    );
    await expect(
      privateVaultStagedCiphertextStore.delete(coordinate),
    ).resolves.toBeUndefined();

    deleteProtectedCiphertextAt.mockRejectedValueOnce(new Error("denied"));
    await expect(
      privateVaultStagedCiphertextStore.delete(coordinate),
    ).rejects.toThrow("denied");
  });
});

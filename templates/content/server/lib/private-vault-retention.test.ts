import { describe, expect, it, vi } from "vitest";

const deleteProtectedCiphertextAt = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/protected-ciphertext", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/protected-ciphertext")
  >()),
  deleteProtectedCiphertextAt,
}));

import { ProtectedCiphertextNotFoundError } from "@agent-native/core/protected-ciphertext";

import {
  buildPrivateVaultRetentionItem,
  createPrivateVaultRetentionService,
  enqueuePrivateVaultRetentionItems,
  PRIVATE_VAULT_ACTIVE_PURGE_MAX_MS,
  PRIVATE_VAULT_EVIDENCE_LIVE_MS,
  PRIVATE_VAULT_EVIDENCE_PURGE_MAX_MS,
  PRIVATE_VAULT_RETENTION_SWEEP_INTERVAL_MS,
  PrivateVaultRetentionCoordinateReusedError,
  privateVaultRetentionCiphertextStore,
  type PrivateVaultRetentionItem,
  type PrivateVaultRetentionStore,
} from "./private-vault-retention.js";

const NOW = "2026-07-16T12:00:00.000Z";

function item(
  overrides: Partial<PrivateVaultRetentionItem> = {},
): PrivateVaultRetentionItem {
  return {
    ...buildPrivateVaultRetentionItem({
      ownerEmail: "alice@example.com",
      orgId: "org_opaque",
      vaultId: "vault_opaque_0001",
      resourceKind: "object",
      resourceId: "object_opaque_0001",
      epoch: null,
      triggerAt: NOW,
    }),
    ...overrides,
  };
}

function fakeStore(initial: PrivateVaultRetentionItem[]) {
  const queue = initial.map((entry) => ({ ...entry }));
  const calls: string[] = [];
  let metadataFailures = 0;
  let markFailures = 0;
  let evidenceCutoff = "";
  let stagingClears = 0;
  const store: PrivateVaultRetentionStore = {
    enqueue: vi.fn(async (entry) => {
      calls.push(`enqueue:${entry.id}`);
      const existing = queue.find((candidate) => candidate.id === entry.id);
      if (existing && existing.triggerGeneration !== entry.triggerGeneration) {
        throw new PrivateVaultRetentionCoordinateReusedError();
      }
      if (!existing) {
        queue.push({ ...entry });
      }
    }),
    claimDue: vi.fn(async ({ now, leaseOwner, leaseExpiresAt }) =>
      queue
        .filter(
          (entry) =>
            entry.phase !== "purged" &&
            (!entry.leaseExpiresAt ||
              Date.parse(entry.leaseExpiresAt) < Date.parse(now)),
        )
        .map((entry) => {
          entry.leaseOwner = leaseOwner;
          entry.leaseExpiresAt = leaseExpiresAt;
          return { ...entry };
        }),
    ),
    listCiphertextCoordinates: vi.fn(async () => []),
    assertLease: vi.fn(async (entry, now) => {
      const queued = queue.find((candidate) => candidate.id === entry.id);
      return Boolean(
        queued &&
        queued.triggerGeneration === entry.triggerGeneration &&
        queued.leaseOwner === entry.leaseOwner &&
        queued.leaseExpiresAt === entry.leaseExpiresAt &&
        Date.parse(queued.leaseExpiresAt ?? "") > Date.parse(now) &&
        queued.phase !== "purged",
      );
    }),
    markBlobDeleted: vi.fn(async (entry, now) => {
      calls.push(`mark:${entry.id}`);
      if (markFailures > 0) {
        markFailures -= 1;
        throw new Error("simulated process death before checkpoint");
      }
      const queued = queue.find((candidate) => candidate.id === entry.id);
      if (
        !queued ||
        queued.triggerGeneration !== entry.triggerGeneration ||
        queued.leaseOwner !== entry.leaseOwner ||
        queued.leaseExpiresAt !== entry.leaseExpiresAt ||
        Date.parse(queued.leaseExpiresAt ?? "") <= Date.parse(now)
      )
        return false;
      queued.phase = "blob_deleted";
      return true;
    }),
    deleteMetadata: vi.fn(async (entry, now) => {
      calls.push(`metadata:${entry.id}`);
      if (metadataFailures > 0) {
        metadataFailures -= 1;
        throw new Error("simulated SQL outage");
      }
      const queued = queue.find((candidate) => candidate.id === entry.id);
      if (
        !queued ||
        queued.triggerGeneration !== entry.triggerGeneration ||
        queued.leaseOwner !== entry.leaseOwner ||
        queued.leaseExpiresAt !== entry.leaseExpiresAt ||
        Date.parse(queued.leaseExpiresAt ?? "") <= Date.parse(now) ||
        queued.phase !== "blob_deleted"
      )
        return false;
      queued.phase = "purged";
      queued.purgedAt = now;
      queued.leaseOwner = null;
      queued.leaseExpiresAt = null;
      stagingClears += 1;
      return true;
    }),
    release: vi.fn(async (entry) => {
      calls.push(`release:${entry.id}`);
      const queued = queue.find((candidate) => candidate.id === entry.id);
      if (
        !queued ||
        queued.triggerGeneration !== entry.triggerGeneration ||
        queued.leaseOwner !== entry.leaseOwner ||
        queued.leaseExpiresAt !== entry.leaseExpiresAt
      )
        return false;
      queued.leaseOwner = null;
      queued.leaseExpiresAt = null;
      return true;
    }),
    purgeExpiredEvidence: vi.fn(async (cutoff) => {
      evidenceCutoff = cutoff;
      return 0;
    }),
  };
  return {
    store,
    queue,
    calls,
    failMetadataOnce: () => {
      metadataFailures = 1;
    },
    failMarkOnce: () => {
      markFailures = 1;
    },
    getEvidenceCutoff: () => evidenceCutoff,
    getStagingClears: () => stagingClears,
  };
}

describe("Private Vault retention contract", () => {
  it("makes deletion eligible immediately and freezes the 30-day maximum", () => {
    const deletion = item();
    expect(deletion.dueAt).toBe(NOW);
    expect(
      Date.parse(deletion.deadlineAt) - Date.parse(deletion.triggerAt),
    ).toBe(PRIVATE_VAULT_ACTIVE_PURGE_MAX_MS);
  });

  it("requires an explicit epoch only for key-epoch deletion", () => {
    expect(() =>
      buildPrivateVaultRetentionItem({
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: "vault_opaque_0001",
        resourceKind: "key-epoch",
        resourceId: "vault_opaque_0001:7",
        epoch: null,
        triggerAt: NOW,
      }),
    ).toThrow();
    expect(
      buildPrivateVaultRetentionItem({
        ownerEmail: "alice@example.com",
        orgId: "",
        vaultId: "vault_opaque_0001",
        resourceKind: "key-epoch",
        resourceId: "vault_opaque_0001:7",
        epoch: 7,
        triggerAt: NOW,
      }).epoch,
    ).toBe(7);
  });

  it("deletes ciphertext before SQL metadata", async () => {
    const entry = item();
    const state = fakeStore([entry]);
    const ciphertext = {
      delete: vi.fn(async () => {
        state.calls.push(`blob:${entry.id}`);
      }),
    };
    const result = await createPrivateVaultRetentionService({
      store: state.store,
      ciphertext,
      now: () => new Date(NOW),
    }).sweep();

    expect(result).toMatchObject({ purged: 1, failed: 0 });
    expect(state.calls.slice(0, 3)).toEqual([
      `blob:${entry.id}`,
      `mark:${entry.id}`,
      `metadata:${entry.id}`,
    ]);
  });

  it("fails closed when Blob deletion fails", async () => {
    const entry = item();
    const state = fakeStore([entry]);
    const result = await createPrivateVaultRetentionService({
      store: state.store,
      ciphertext: {
        delete: vi.fn(async () => {
          throw new Error("provider unavailable");
        }),
      },
      now: () => new Date(NOW),
    }).sweep();

    expect(result).toMatchObject({ purged: 0, failed: 1 });
    expect(state.calls).toEqual([`release:${entry.id}`]);
    expect(state.queue).toHaveLength(1);
  });

  it("repeats an idempotent Blob delete after death before the checkpoint", async () => {
    const entry = item();
    const state = fakeStore([entry]);
    state.failMarkOnce();
    const ciphertext = { delete: vi.fn(async () => undefined) };
    const service = createPrivateVaultRetentionService({
      store: state.store,
      ciphertext,
      now: () => new Date(NOW),
    });

    expect(await service.sweep()).toMatchObject({ failed: 1, purged: 0 });
    expect(await service.sweep()).toMatchObject({ failed: 0, purged: 1 });
    expect(ciphertext.delete).toHaveBeenCalledTimes(2);
    expect(state.store.deleteMetadata).toHaveBeenCalledTimes(1);
  });

  it("does not revisit Blob after the durable checkpoint", async () => {
    const entry = item();
    const state = fakeStore([entry]);
    state.failMetadataOnce();
    const ciphertext = { delete: vi.fn(async () => undefined) };
    const service = createPrivateVaultRetentionService({
      store: state.store,
      ciphertext,
      now: () => new Date(NOW),
    });

    expect(await service.sweep()).toMatchObject({ failed: 1, purged: 0 });
    expect(state.queue[0]?.phase).toBe("blob_deleted");
    expect(await service.sweep()).toMatchObject({ failed: 0, purged: 1 });
    expect(ciphertext.delete).toHaveBeenCalledTimes(1);
    expect(state.store.deleteMetadata).toHaveBeenCalledTimes(2);
  });

  it("retains access/disclosure evidence for exactly 90 days", async () => {
    const state = fakeStore([]);
    await createPrivateVaultRetentionService({
      store: state.store,
      ciphertext: { delete: vi.fn(async () => undefined) },
      now: () => new Date(NOW),
    }).sweep();

    expect(state.getEvidenceCutoff()).toBe(
      new Date(Date.parse(NOW) - PRIVATE_VAULT_EVIDENCE_LIVE_MS).toISOString(),
    );
    expect(PRIVATE_VAULT_RETENTION_SWEEP_INTERVAL_MS).toBeLessThanOrEqual(
      PRIVATE_VAULT_EVIDENCE_PURGE_MAX_MS,
    );
  });

  it("uses a tenant-bound deterministic ledger identity", () => {
    const alice = item();
    const bob = buildPrivateVaultRetentionItem({
      ownerEmail: "bob@example.com",
      orgId: alice.orgId,
      vaultId: alice.vaultId,
      resourceKind: alice.resourceKind,
      resourceId: alice.resourceId,
      epoch: null,
      triggerAt: alice.triggerAt,
    });
    expect(bob.id).not.toBe(alice.id);
  });

  it("binds an immutable trigger generation while reserving one coordinate identity", () => {
    const first = item();
    const replay = buildPrivateVaultRetentionItem({
      ownerEmail: first.ownerEmail,
      orgId: first.orgId,
      vaultId: first.vaultId,
      resourceKind: first.resourceKind,
      resourceId: first.resourceId,
      epoch: first.epoch,
      triggerAt: "2026-07-16T13:00:00.000Z",
    });
    expect(replay.id).toBe(first.id);
    expect(replay.triggerGeneration).not.toBe(first.triggerGeneration);
  });

  it("fails closed when a new trigger encounters a legacy-generation reservation", async () => {
    const legacy = item({ triggerGeneration: "legacy-v1" });
    const state = fakeStore([legacy]);
    const replacement = buildPrivateVaultRetentionItem({
      ownerEmail: legacy.ownerEmail,
      orgId: legacy.orgId,
      vaultId: legacy.vaultId,
      resourceKind: legacy.resourceKind,
      resourceId: legacy.resourceId,
      epoch: legacy.epoch,
      triggerAt: "2026-07-16T13:00:00.000Z",
    });

    await expect(state.store.enqueue(replacement)).rejects.toBeInstanceOf(
      PrivateVaultRetentionCoordinateReusedError,
    );
    expect(state.queue).toEqual([legacy]);
  });

  it("batch-enqueues tombstones with one insert and one verification read", async () => {
    const entries = [
      item(),
      buildPrivateVaultRetentionItem({
        ownerEmail: "alice@example.com",
        orgId: "org_opaque",
        vaultId: "vault_opaque_0001",
        resourceKind: "job",
        resourceId: "job_opaque_0001",
        epoch: null,
        triggerAt: NOW,
      }),
    ];
    const persisted = new Map<
      string,
      { id: string; triggerGeneration: string }
    >();
    const insert = vi.fn(() => ({
      values: vi.fn((values: PrivateVaultRetentionItem[]) => ({
        onConflictDoNothing: vi.fn(async () => {
          for (const value of values) {
            if (!persisted.has(value.id)) {
              persisted.set(value.id, {
                id: value.id,
                triggerGeneration: value.triggerGeneration,
              });
            }
          }
        }),
      })),
    }));
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => [...persisted.values()]),
        })),
      })),
    }));

    await enqueuePrivateVaultRetentionItems(
      { insert, select } as never,
      entries,
    );
    expect(insert).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
    expect(persisted.size).toBe(2);
  });

  it.each([
    ["object", "object_opaque_0001"],
    ["job", "job_opaque_0001"],
    ["vault", "vault_opaque_0001"],
  ] as const)(
    "keeps a %s tombstone and fences a stale worker across purge and recreation",
    async (resourceKind, resourceId) => {
      let clock = NOW;
      const original = buildPrivateVaultRetentionItem({
        ownerEmail: "alice@example.com",
        orgId: "org_opaque",
        vaultId: "vault_opaque_0001",
        resourceKind,
        resourceId,
        epoch: null,
        triggerAt: NOW,
      });
      const state = fakeStore([original]);
      let resumeStaleDelete!: () => void;
      const staleDeletePaused = new Promise<void>((resolve) => {
        resumeStaleDelete = resolve;
      });
      let staleDeleteStarted!: () => void;
      const staleDeleteEntered = new Promise<void>((resolve) => {
        staleDeleteStarted = resolve;
      });
      const staleService = createPrivateVaultRetentionService({
        store: state.store,
        ciphertext: {
          delete: vi.fn(async () => {
            staleDeleteStarted();
            await staleDeletePaused;
          }),
        },
        now: () => new Date(clock),
        leaseMs: 5 * 60 * 1000,
      });

      const staleSweep = staleService.sweep();
      await staleDeleteEntered;
      clock = "2026-07-16T12:06:00.000Z";
      const currentSweep = await createPrivateVaultRetentionService({
        store: state.store,
        ciphertext: { delete: vi.fn(async () => undefined) },
        now: () => new Date(clock),
        leaseMs: 5 * 60 * 1000,
      }).sweep();
      expect(currentSweep).toMatchObject({ purged: 1, failed: 0 });
      expect(state.queue).toEqual([
        expect.objectContaining({
          id: original.id,
          triggerGeneration: original.triggerGeneration,
          phase: "purged",
          purgedAt: clock,
          leaseOwner: null,
          leaseExpiresAt: null,
        }),
      ]);

      const recreated = buildPrivateVaultRetentionItem({
        ownerEmail: original.ownerEmail,
        orgId: original.orgId,
        vaultId: original.vaultId,
        resourceKind,
        resourceId,
        epoch: null,
        triggerAt: "2026-07-16T12:07:00.000Z",
      });
      await expect(state.store.enqueue(recreated)).rejects.toBeInstanceOf(
        PrivateVaultRetentionCoordinateReusedError,
      );

      resumeStaleDelete();
      await expect(staleSweep).resolves.toMatchObject({ purged: 0, failed: 1 });
      expect(state.queue[0]).toMatchObject({
        triggerGeneration: original.triggerGeneration,
        phase: "purged",
      });
      // The current worker's fenced metadata transaction clears descendant
      // staging state exactly once. The resumed stale worker cannot clear it
      // again after the parent coordinate becomes a permanent tombstone.
      expect(state.getStagingClears()).toBe(1);
    },
  );

  it("accepts the local authenticated owner alias without weakening controls", () => {
    expect(
      buildPrivateVaultRetentionItem({
        ownerEmail: "local@localhost",
        orgId: "",
        vaultId: "vault_opaque_0001",
        resourceKind: "vault",
        resourceId: "vault_opaque_0001",
        epoch: null,
        triggerAt: NOW,
      }).ownerEmail,
    ).toBe("local@localhost");
  });

  it("treats an already-absent exact ciphertext coordinate as idempotent success", async () => {
    const grant = item({
      resourceKind: "grant",
      resourceId: "grant_opaque_0001",
    });
    deleteProtectedCiphertextAt.mockRejectedValueOnce(
      new ProtectedCiphertextNotFoundError(),
    );
    await expect(
      privateVaultRetentionCiphertextStore.delete(grant),
    ).resolves.toBeUndefined();

    deleteProtectedCiphertextAt.mockRejectedValueOnce(
      new Error("provider authentication failed"),
    );
    await expect(
      privateVaultRetentionCiphertextStore.delete(grant),
    ).rejects.toThrow("provider authentication failed");
  });
});

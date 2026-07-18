import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `private-vault-recovery-wrap-staging-${process.pid}-${Date.now()}.sqlite`,
);
const START = "2026-07-17T12:00:00.000Z";
const AFTER_EXPIRY = "2026-07-19T12:00:00.000Z";
const OWNER = "recovery-owner@example.com";
const ORG = "org:recovery-staging";
const VAULT = "vault:recovery-staging";
const FIRST_HASH = "a".repeat(64);
const SECOND_HASH = "b".repeat(64);

let getDb: (typeof import("../db/index.js"))["getDb"];
let schema: typeof import("../db/schema.js");
let stagingStore: (typeof import("./private-vault-ciphertext-staging.js"))["sqlPrivateVaultCiphertextStagingStore"];
let createStagingService: (typeof import("./private-vault-ciphertext-staging.js"))["createPrivateVaultCiphertextStagingService"];

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const staging = await import("./private-vault-ciphertext-staging.js");
  stagingStore = staging.sqlPrivateVaultCiphertextStagingStore;
  createStagingService = staging.createPrivateVaultCiphertextStagingService;
  await (await import("../plugins/db.js")).default(undefined as never);
  await getDb().insert(schema.contentEncryptedVaults).values({
    vaultId: VAULT,
    ownerEmail: OWNER,
    orgId: ORG,
    accountId: "account:recovery-staging",
    workspaceId: "workspace:recovery-staging",
    vaultState: "active",
    serverReceivedAt: START,
  });
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

const scope = { ownerEmail: OWNER, orgId: ORG, vaultId: VAULT };
const recoveryCoordinate = (recoveryWrapHash: string) => ({
  kind: "recovery-wrap" as const,
  vaultId: VAULT,
  recoveryWrapHash,
});

describe("Private Vault recovery-wrap staging with real SQLite", () => {
  it("stores the strict recovery-wrap coordinate with the physical part sentinel", async () => {
    const stage = await createStagingService({
      store: stagingStore,
      now: () => new Date(START),
    }).stage(scope, recoveryCoordinate(FIRST_HASH));

    const [stored] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultCiphertextStaging)
      .where(
        eq(
          schema.contentEncryptedVaultCiphertextStaging.stageId,
          stage.stageId,
        ),
      );
    expect(stored).toMatchObject({
      coordinateKind: "recovery-wrap",
      objectId: null,
      revisionId: null,
      jobId: null,
      recoveryWrapHash: FIRST_HASH,
      part: "recovery-wrap",
      phase: "active",
    });
  });

  it("treats an exact immutable binding as committed and never deletes its bytes", async () => {
    const [stage] = await stagingStore.listClaimable(AFTER_EXPIRY, 10);
    expect(stage?.coordinate).toEqual(recoveryCoordinate(FIRST_HASH));
    await getDb()
      .insert(schema.contentEncryptedVaultRecoveryWraps)
      .values({
        bindingId: `${VAULT}:${FIRST_HASH}`,
        ownerEmail: OWNER,
        orgId: ORG,
        vaultId: VAULT,
        recoveryWrapHash: FIRST_HASH,
        controlEntryId: "entry:recovery-first",
        ciphertextByteLength: 384,
        serverReceivedAt: START,
      });
    const ciphertext = { delete: vi.fn(async () => undefined) };

    await expect(
      createStagingService({
        store: stagingStore,
        ciphertext,
        now: () => new Date(AFTER_EXPIRY),
      }).reconcileExpired(),
    ).resolves.toMatchObject({
      committed: 1,
      orphansDeleted: 0,
      failed: 0,
    });
    expect(ciphertext.delete).not.toHaveBeenCalled();
    expect(await stagingStore.isMetadataCommitted(stage!)).toBe(true);
  });

  it("stages control evidence without confusing it for a recovery wrap", async () => {
    const coordinate = {
      kind: "control-evidence" as const,
      vaultId: VAULT,
      evidenceKind: "recovery" as const,
      evidenceHash: "e".repeat(64),
    };
    const service = createStagingService({
      store: stagingStore,
      now: () => new Date(START),
    });
    const stage = await service.stage(scope, coordinate);
    const [stored] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultCiphertextStaging)
      .where(
        eq(
          schema.contentEncryptedVaultCiphertextStaging.stageId,
          stage.stageId,
        ),
      );
    expect(stored).toMatchObject({
      coordinateKind: "control-evidence",
      recoveryWrapHash: null,
      evidenceKind: "recovery",
      evidenceHash: coordinate.evidenceHash,
      part: "control-evidence",
      phase: "active",
    });
    await getDb()
      .insert(schema.contentEncryptedVaultControlEvidence)
      .values({
        bindingId: `${VAULT}:evidence`,
        ownerEmail: OWNER,
        orgId: ORG,
        vaultId: VAULT,
        controlEntryId: "entry:recovery-evidence",
        evidenceKind: "recovery",
        evidenceHash: coordinate.evidenceHash,
        evidenceByteLength: 512,
        serverReceivedAt: START,
      });
    await expect(
      service.clearAfterMetadataCommit(stage),
    ).resolves.toBeUndefined();
    expect(await stagingStore.isMetadataCommitted(stage)).toBe(true);
  });

  it("deletes only an orphan's exact recovery-wrap coordinate and retains its tombstone", async () => {
    const stage = await createStagingService({
      store: stagingStore,
      now: () => new Date(START),
    }).stage(scope, recoveryCoordinate(SECOND_HASH));
    const ciphertext = { delete: vi.fn(async () => undefined) };

    await expect(
      createStagingService({
        store: stagingStore,
        ciphertext,
        now: () => new Date(AFTER_EXPIRY),
        claimToken: () => "claim:recovery-orphan",
      }).reconcileExpired(),
    ).resolves.toMatchObject({ orphansDeleted: 1, failed: 0 });
    expect(ciphertext.delete).toHaveBeenCalledOnce();
    expect(ciphertext.delete).toHaveBeenCalledWith(
      recoveryCoordinate(SECOND_HASH),
    );
    const [stored] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultCiphertextStaging)
      .where(
        eq(
          schema.contentEncryptedVaultCiphertextStaging.stageId,
          stage.stageId,
        ),
      );
    expect(stored).toMatchObject({ phase: "orphaned" });
    await expect(
      createStagingService({
        store: stagingStore,
        now: () => new Date(START),
      }).stage(scope, recoveryCoordinate(SECOND_HASH)),
    ).rejects.toThrow("permanently finalized");
  });

  it("never reopens a recovery-wrap coordinate beneath a vault tombstone", async () => {
    await getDb().insert(schema.contentEncryptedVaultRetentionQueue).values({
      id: "retention:vault:recovery-staging",
      ownerEmail: OWNER,
      orgId: ORG,
      vaultId: VAULT,
      resourceKind: "vault",
      resourceId: VAULT,
      triggerGeneration: "terminal:recovery-staging",
      phase: "pending",
      triggerAt: START,
      dueAt: START,
      deadlineAt: AFTER_EXPIRY,
      createdAt: START,
    });

    await expect(
      createStagingService({
        store: stagingStore,
        now: () => new Date(START),
      }).stage(scope, recoveryCoordinate("c".repeat(64))),
    ).rejects.toThrow("permanently finalized");
  });

  it("rejects malformed physical aliases instead of interpreting them as another coordinate", async () => {
    await getDb()
      .insert(schema.contentEncryptedVaultCiphertextStaging)
      .values({
        stageId: "malformed-recovery-stage",
        ownerEmail: OWNER,
        orgId: ORG,
        vaultId: VAULT,
        coordinateKind: "recovery-wrap",
        objectId: "forbidden-object-alias",
        revisionId: null,
        jobId: null,
        recoveryWrapHash: "d".repeat(64),
        part: "recovery-wrap",
        stagedAt: START,
        expiresAt: START,
        phase: "active",
        claimToken: null,
        claimExpiresAt: null,
        finalizedAt: null,
      });

    await expect(stagingStore.listClaimable(AFTER_EXPIRY, 100)).rejects.toThrow(
      "physical coordinate integrity failure",
    );
  });
});

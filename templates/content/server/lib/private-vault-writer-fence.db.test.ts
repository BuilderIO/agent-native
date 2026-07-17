import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PrivateVaultCiphertextStage } from "./private-vault-ciphertext-staging.js";
import type {
  PrivateVaultJobMetadata,
  PrivateVaultJobResultMetadata,
} from "./private-vault-jobs.js";
import type { PrivateVaultRevisionMetadata } from "./private-vault-objects.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `private-vault-writer-fence-${process.pid}-${Date.now()}.sqlite`,
);
const NOW = "2026-07-16T12:00:00.000Z";
const LATER = "2026-07-18T12:00:00.000Z";
const OWNER = "owner@example.com";
const ORG = "org:test";
const VAULT = "vault:writer-fence";
const ENDPOINT = "endpoint:writer-fence";
const GRANT = "grant:writer-fence";

let getDb: (typeof import("../db/index.js"))["getDb"];
let schema: typeof import("../db/schema.js");
let stagingStore: (typeof import("./private-vault-ciphertext-staging.js"))["sqlPrivateVaultCiphertextStagingStore"];
let createStagingService: (typeof import("./private-vault-ciphertext-staging.js"))["createPrivateVaultCiphertextStagingService"];
let StageConflict: (typeof import("./private-vault-ciphertext-staging.js"))["PrivateVaultCiphertextStageCommitConflictError"];
let objectStore: (typeof import("./private-vault-objects.js"))["sqlPrivateVaultObjectStore"];
let jobStore: (typeof import("./private-vault-jobs.js"))["sqlPrivateVaultJobStore"];

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const staging = await import("./private-vault-ciphertext-staging.js");
  stagingStore = staging.sqlPrivateVaultCiphertextStagingStore;
  createStagingService = staging.createPrivateVaultCiphertextStagingService;
  StageConflict = staging.PrivateVaultCiphertextStageCommitConflictError;
  objectStore = (await import("./private-vault-objects.js"))
    .sqlPrivateVaultObjectStore;
  jobStore = (await import("./private-vault-jobs.js")).sqlPrivateVaultJobStore;
  await (await import("../plugins/db.js")).default(undefined as never);

  await getDb().insert(schema.contentEncryptedVaults).values({
    vaultId: VAULT,
    ownerEmail: OWNER,
    orgId: ORG,
    accountId: "account:writer-fence",
    workspaceId: "workspace:writer-fence",
    vaultState: "active",
    serverReceivedAt: NOW,
  });
  await getDb()
    .insert(schema.contentEncryptedVaultEndpoints)
    .values({
      endpointId: ENDPOINT,
      vaultId: VAULT,
      ownerEmail: OWNER,
      orgId: ORG,
      endpointState: "online",
      publicIdentityJson: JSON.stringify({
        algorithmId: "ed25519",
        publicIdentity: "synthetic-public-identity",
      }),
      healthState: "healthy",
      serverReceivedAt: NOW,
    });
  await getDb()
    .insert(schema.contentEncryptedVaultKeyEpochs)
    .values({
      id: `${VAULT}:1`,
      vaultId: VAULT,
      ownerEmail: OWNER,
      orgId: ORG,
      epoch: 1,
      state: "active",
      serverReceivedAt: NOW,
    });
  await getDb().insert(schema.contentEncryptedVaultGrants).values({
    grantId: GRANT,
    vaultId: VAULT,
    ownerEmail: OWNER,
    orgId: ORG,
    recipientEndpointId: ENDPOINT,
    algorithmId: "anc/v1",
    ciphertextByteLength: 4,
    issuedAt: NOW,
    expiresAt: "2027-07-16T12:00:00.000Z",
    serverReceivedAt: NOW,
  });
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

const scope = { ownerEmail: OWNER, orgId: ORG, vaultId: VAULT };
const principal = { ...scope, endpointId: ENDPOINT };

async function stageObject(
  objectId: string,
  revisionId: string,
): Promise<PrivateVaultCiphertextStage> {
  return createStagingService({
    store: stagingStore,
    now: () => new Date(NOW),
  }).stage(scope, {
    kind: "object",
    vaultId: VAULT,
    objectId,
    revisionId,
    part: "header",
  });
}

async function stageJob(
  jobId: string,
  part: "request" | "result",
): Promise<PrivateVaultCiphertextStage> {
  return createStagingService({
    store: stagingStore,
    now: () => new Date(NOW),
  }).stage(scope, { kind: "job", vaultId: VAULT, jobId, part });
}

async function letJanitorWin(stage: PrivateVaultCiphertextStage) {
  const claimed = await stagingStore.claim(
    stage,
    `claim:${stage.stageId}`,
    LATER,
    "2026-07-18T12:05:00.000Z",
  );
  expect(claimed).not.toBeNull();
  return claimed!;
}

function objectMetadata(
  objectId: string,
  revisionId: string,
): PrivateVaultRevisionMetadata {
  return {
    vaultId: VAULT,
    objectId,
    revisionId,
    objectType: "document",
    algorithmId: "anc/v1",
    epoch: 1,
    parentRevisionIds: [],
    ciphertextByteLength: 4,
    serverReceivedAt: NOW,
  };
}

function jobMetadata(jobId: string): PrivateVaultJobMetadata {
  return {
    vaultId: VAULT,
    jobId,
    grantId: GRANT,
    recipientEndpointId: ENDPOINT,
    epoch: 1,
    algorithmId: "anc/v1",
    ciphertextByteLength: 4,
    issuedAt: NOW,
    expiresAt: "2027-07-16T12:00:00.000Z",
    state: "queued",
    retryCount: 0,
    retryAt: null,
    leaseExpiresAt: null,
    serverReceivedAt: NOW,
  };
}

describe("Private Vault atomic writer fence with real SQLite transactions", () => {
  it("rolls back the object shell, revision, and sync event when the janitor wins", async () => {
    const objectId = "object:janitor-wins";
    const revisionId = "revision:janitor-wins";
    const stage = await stageObject(objectId, revisionId);
    await letJanitorWin(stage);

    await expect(
      objectStore.persistRevision(
        scope,
        objectMetadata(objectId, revisionId),
        "event:janitor-wins",
        stage,
      ),
    ).rejects.toBeInstanceOf(StageConflict);

    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultObjects)
        .where(eq(schema.contentEncryptedVaultObjects.objectId, objectId)),
    ).toHaveLength(0);
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultObjectRevisions)
        .where(
          eq(
            schema.contentEncryptedVaultObjectRevisions.revisionId,
            revisionId,
          ),
        ),
    ).toHaveLength(0);
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultSyncEvents)
        .where(
          eq(
            schema.contentEncryptedVaultSyncEvents.eventId,
            "event:janitor-wins",
          ),
        ),
    ).toHaveLength(0);
  });

  it("commits object metadata and its stage together before reconciliation can delete", async () => {
    const objectId = "object:writer-wins";
    const revisionId = "revision:writer-wins";
    const stage = await stageObject(objectId, revisionId);
    await objectStore.persistRevision(
      scope,
      objectMetadata(objectId, revisionId),
      "event:writer-wins",
      stage,
    );

    const [storedStage] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultCiphertextStaging)
      .where(
        eq(
          schema.contentEncryptedVaultCiphertextStaging.stageId,
          stage.stageId,
        ),
      );
    expect(storedStage).toMatchObject({ phase: "committed" });
    expect(
      await objectStore.getRevision(scope, objectId, revisionId),
    ).not.toBeNull();

    const ciphertext = { delete: vi.fn(async () => undefined) };
    const reconciliation = createStagingService({
      store: stagingStore,
      ciphertext,
      now: () => new Date(LATER),
    });
    await expect(reconciliation.reconcileExpired()).resolves.toMatchObject({
      orphansDeleted: 0,
    });
    expect(ciphertext.delete).not.toHaveBeenCalled();
    await expect(
      stagingStore.claim(
        stage,
        "late-claim",
        LATER,
        "2026-07-18T12:05:00.000Z",
      ),
    ).resolves.toBeNull();
  });

  it("rolls back a job request when its stage is already owned by the janitor", async () => {
    const jobId = "job:request-janitor-wins";
    const stage = await stageJob(jobId, "request");
    await letJanitorWin(stage);

    await expect(
      jobStore.persist(scope, jobMetadata(jobId), stage),
    ).rejects.toBeInstanceOf(StageConflict);
    expect(await jobStore.get(scope, jobId)).toBeNull();
  });

  it("rolls back job result, terminal state, and retention when its stage loses", async () => {
    const jobId = "job:result-janitor-wins";
    await getDb().insert(schema.contentEncryptedVaultJobs).values({
      version: 1,
      ownerEmail: OWNER,
      orgId: ORG,
      jobId,
      vaultId: VAULT,
      grantId: GRANT,
      recipientEndpointId: ENDPOINT,
      epoch: 1,
      algorithmId: "anc/v1",
      ciphertextByteLength: 4,
      issuedAt: NOW,
      expiresAt: "2027-07-16T12:00:00.000Z",
      jobState: "acknowledged",
      retryCount: 0,
      retryAt: null,
      leaseExpiresAt: null,
      serverReceivedAt: NOW,
    });
    const stage = await stageJob(jobId, "result");
    await letJanitorWin(stage);
    const result: PrivateVaultJobResultMetadata = {
      vaultId: VAULT,
      jobId,
      endpointId: ENDPOINT,
      epoch: 1,
      jobHash: "opaque:job-hash",
      algorithmId: "anc/v1",
      ciphertextByteLength: 4,
      state: "completed",
      retryCount: 0,
      serverReceivedAt: NOW,
    };

    await expect(
      jobStore.complete(principal, result, NOW, stage),
    ).rejects.toBeInstanceOf(StageConflict);

    expect((await jobStore.get(scope, jobId))?.state).toBe("acknowledged");
    expect(await jobStore.getResult(scope, jobId)).toBeNull();
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultRetentionQueue)
        .where(
          and(
            eq(schema.contentEncryptedVaultRetentionQueue.resourceKind, "job"),
            eq(schema.contentEncryptedVaultRetentionQueue.resourceId, jobId),
          ),
        ),
    ).toHaveLength(0);
  });

  it("commits a job result, terminal state, retention, and stage as one unit", async () => {
    const jobId = "job:result-writer-wins";
    await getDb().insert(schema.contentEncryptedVaultJobs).values({
      version: 1,
      ownerEmail: OWNER,
      orgId: ORG,
      jobId,
      vaultId: VAULT,
      grantId: GRANT,
      recipientEndpointId: ENDPOINT,
      epoch: 1,
      algorithmId: "anc/v1",
      ciphertextByteLength: 4,
      issuedAt: NOW,
      expiresAt: "2027-07-16T12:00:00.000Z",
      jobState: "acknowledged",
      retryCount: 0,
      retryAt: null,
      leaseExpiresAt: null,
      serverReceivedAt: NOW,
    });
    const stage = await stageJob(jobId, "result");
    const result: PrivateVaultJobResultMetadata = {
      vaultId: VAULT,
      jobId,
      endpointId: ENDPOINT,
      epoch: 1,
      jobHash: "opaque:writer-wins",
      algorithmId: "anc/v1",
      ciphertextByteLength: 4,
      state: "completed",
      retryCount: 0,
      serverReceivedAt: NOW,
    };

    await expect(
      jobStore.complete(principal, result, NOW, stage),
    ).resolves.toMatchObject({ state: "completed" });
    expect((await jobStore.get(scope, jobId))?.state).toBe("completed");
    expect(await jobStore.getResult(scope, jobId)).toMatchObject(result);
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultRetentionQueue)
        .where(
          and(
            eq(schema.contentEncryptedVaultRetentionQueue.resourceKind, "job"),
            eq(schema.contentEncryptedVaultRetentionQueue.resourceId, jobId),
          ),
        ),
    ).toHaveLength(1);
    const [storedStage] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultCiphertextStaging)
      .where(
        eq(
          schema.contentEncryptedVaultCiphertextStaging.stageId,
          stage.stageId,
        ),
      );
    expect(storedStage).toMatchObject({ phase: "committed" });

    const ciphertext = { delete: vi.fn(async () => undefined) };
    await expect(
      createStagingService({
        store: stagingStore,
        ciphertext,
        now: () => new Date(LATER),
      }).reconcileExpired(),
    ).resolves.toMatchObject({ orphansDeleted: 0 });
    expect(ciphertext.delete).not.toHaveBeenCalled();
    await expect(
      stagingStore.claim(
        stage,
        "late-result-claim",
        LATER,
        "2026-07-18T12:05:00.000Z",
      ),
    ).resolves.toBeNull();
  });
});

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTROL_LOG_ZERO_HASH,
  ancV1Hash,
  createSignedControlLogEntry,
  createEndpointRequestProof,
  encodeAncV1BrokerClaimRequest,
  encodeSignedControlLogEntry,
  type ControlLogMember,
  type ControlLogState,
  type ControlMembershipCommit,
} from "@agent-native/core/e2ee";
import { ancV1BytesToHex } from "@agent-native/core/e2ee";
import { ancV1SigningKeypairFromSeed } from "@agent-native/core/e2ee";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `private-vault-control-log-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "control-owner@example.com";
const ORG = "org:control-log";
const AT = "2026-07-17T01:00:00.000Z";

let getDb: (typeof import("../db/index.js"))["getDb"];
let schema: typeof import("../db/schema.js");
let createService: (typeof import("./private-vault-control-log.js"))["createPrivateVaultControlLogService"];

const authorizedGenesis = new Map<string, string>();

async function identity(
  seedByte: number,
  endpointId: string,
  role: "endpoint" | "broker" = "endpoint",
) {
  const pair = await ancV1SigningKeypairFromSeed(
    new Uint8Array(32).fill(seedByte),
  );
  const member: ControlLogMember = {
    endpointId,
    role,
    unattended: role === "broker",
    signingPublicKey: ancV1BytesToHex(pair.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(
      new Uint8Array(32).fill(seedByte + 40),
    ),
    enrollmentRef: `enrollment:${endpointId}`,
  };
  return { pair, member };
}

function commit(
  vaultId: string,
  patch: Partial<ControlMembershipCommit> &
    Pick<ControlMembershipCommit, "ceremonyKind" | "activeMembers">,
): ControlMembershipCommit {
  const { ceremonyKind, activeMembers, ...overrides } = patch;
  return {
    suite: "anc/v1",
    type: "membership_commit",
    vaultId,
    ceremonyId: `ceremony:${ceremonyKind}:${vaultId}`,
    ceremonyKind,
    epoch: 1,
    previousMembershipHash: null,
    activeMembers,
    removedEndpointIds: [],
    rotationCompleted: false,
    outstandingJobsResolved: false,
    recoverySnapshotHash: null,
    recoveryAuthorizationHash: null,
    recoveryGeneration: 1,
    recoveryId: `recovery:${vaultId}`,
    recoverySigningPublicKey: "a1".repeat(32),
    recoveryKeyAgreementPublicKey: "b2".repeat(32),
    recoveryWrapHash: "c3".repeat(32),
    ...overrides,
  };
}

async function entry(input: {
  vaultId: string;
  state: ControlLogState | null;
  signer: Awaited<ReturnType<typeof identity>>;
  inner:
    | ControlMembershipCommit
    | {
        suite: "anc/v1";
        type: "continuity_checkpoint";
        vaultId: string;
        membershipHash: string;
      };
  suffix?: string;
  envelopeId?: string;
  createdAt?: string;
}) {
  return createSignedControlLogEntry({
    vaultId: input.vaultId,
    createdAt: input.createdAt ?? AT,
    envelopeId:
      input.envelopeId ??
      `log:${input.vaultId}:${(input.state?.sequence ?? -1) + 1}${input.suffix ?? ""}`,
    sequence: (input.state?.sequence ?? -1) + 1,
    previousHash: input.state?.headHash ?? CONTROL_LOG_ZERO_HASH,
    innerEnvelope: input.inner,
    signerEndpointId: input.signer.member.endpointId,
    signingPrivateKey: input.signer.pair.privateKey,
  });
}

function scope(vaultId: string, ownerEmail = OWNER) {
  return { ownerEmail, orgId: ORG, vaultId };
}

async function createVault(vaultId: string) {
  await getDb()
    .insert(schema.contentEncryptedVaults)
    .values({
      vaultId,
      ownerEmail: OWNER,
      orgId: ORG,
      accountId: `account:${vaultId}`,
      workspaceId: `workspace:${vaultId}`,
      vaultState: "active",
      serverReceivedAt: AT,
    });
}

function service(
  recoveryAuthorized = false,
  clock = AT,
  recoveryWrapAuthorized = false,
) {
  return createService({
    authorizeGenesis: async ({ scope: candidateScope, entry: candidate }) => {
      const expectedEndpoint = authorizedGenesis.get(candidateScope.vaultId);
      return (
        expectedEndpoint !== undefined &&
        candidate.signerEndpointId === expectedEndpoint
      );
    },
    verifyRecoveryAuthorization: recoveryAuthorized
      ? async () => true
      : undefined,
    verifyRecoveryWrapRotation: recoveryWrapAuthorized
      ? async () => true
      : undefined,
    now: () => new Date(clock),
  });
}

async function initialize(vaultId: string, seedByte = 1) {
  await createVault(vaultId);
  const owner = await identity(
    seedByte,
    `endpoint:${vaultId}:owner`,
    "endpoint",
  );
  authorizedGenesis.set(vaultId, owner.member.endpointId);
  const genesis = await entry({
    vaultId,
    state: null,
    signer: owner,
    inner: commit(vaultId, {
      ceremonyKind: "first_device",
      activeMembers: [owner.member],
    }),
  });
  const appended = await service().append(scope(vaultId), {
    entryBytes: encodeSignedControlLogEntry(genesis),
    expectedHead: { sequence: null, hash: null },
  });
  return { owner, genesis, state: appended.state };
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createService = (await import("./private-vault-control-log.js"))
    .createPrivateVaultControlLogService;
  await (await import("../plugins/db.js")).default(undefined as never);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("Private Vault signed control-log persistence", () => {
  it("requires an external genesis authority and refuses a server-minted vault root", async () => {
    const vaultId = "vault:server-minted";
    await createVault(vaultId);
    const attacker = await identity(20, "endpoint:server-attacker");
    const forged = await entry({
      vaultId,
      state: null,
      signer: attacker,
      inner: commit(vaultId, {
        ceremonyKind: "first_device",
        activeMembers: [attacker.member],
      }),
    });
    await expect(
      service().append(scope(vaultId), {
        entryBytes: encodeSignedControlLogEntry(forged),
        expectedHead: { sequence: null, hash: null },
      }),
    ).rejects.toMatchObject({ code: "unauthorized_genesis" });
  });

  it("replays canonical entries after restart and resolves only a fresh signed broker", async () => {
    const vaultId = "vault:restart-broker";
    const initialized = await initialize(vaultId, 2);
    const broker = await identity(3, "broker:restart-primary", "broker");
    const addBroker = await entry({
      vaultId,
      state: initialized.state,
      signer: initialized.owner,
      inner: commit(vaultId, {
        ceremonyKind: "add_broker",
        previousMembershipHash: initialized.state.membershipHash,
        activeMembers: [broker.member, initialized.owner.member].sort((a, b) =>
          a.endpointId.localeCompare(b.endpointId),
        ),
      }),
    });
    const appended = await service().append(scope(vaultId), {
      entryBytes: encodeSignedControlLogEntry(addBroker),
      expectedHead: {
        sequence: initialized.state.sequence,
        hash: initialized.state.headHash,
      },
    });

    const restarted = service();
    await expect(restarted.loadVerifiedState(scope(vaultId))).resolves.toEqual(
      appended.state,
    );
    const snapshot = await restarted.loadVerifiedSnapshot(scope(vaultId));
    expect(snapshot.state).toEqual(appended.state);
    expect(snapshot.entries).toEqual([
      {
        entryId: initialized.genesis.envelopeId,
        sequence: 0,
        entryHash: initialized.state.headHash,
        entryBytes: encodeSignedControlLogEntry(initialized.genesis),
      },
      {
        entryId: addBroker.envelopeId,
        sequence: 1,
        entryHash: appended.state.headHash,
        entryBytes: encodeSignedControlLogEntry(addBroker),
      },
    ]);
    await expect(
      restarted.resolveBrokerAuthorization(
        scope(vaultId),
        broker.member.endpointId,
      ),
    ).resolves.toMatchObject({
      ownerEmail: OWNER,
      orgId: ORG,
      vaultId,
      endpointId: broker.member.endpointId,
      authenticatedControlHead: {
        signedAt: AT,
        freshnessMode: "endpoint_witnessed",
      },
    });
  });

  it("authenticates a cookie-free broker request only from replayed signed authority", async () => {
    const vaultId = "vault:broker-request-auth";
    const initialized = await initialize(vaultId, 31);
    const broker = await identity(32, "broker:request-primary", "broker");
    const freshAt = new Date().toISOString();
    const addBroker = await entry({
      vaultId,
      state: initialized.state,
      signer: initialized.owner,
      createdAt: freshAt,
      inner: commit(vaultId, {
        ceremonyKind: "add_broker",
        previousMembershipHash: initialized.state.membershipHash,
        activeMembers: [broker.member, initialized.owner.member].sort((a, b) =>
          a.endpointId.localeCompare(b.endpointId),
        ),
      }),
    });
    await service(false, freshAt).append(scope(vaultId), {
      entryBytes: encodeSignedControlLogEntry(addBroker),
      expectedHead: {
        sequence: initialized.state.sequence,
        hash: initialized.state.headHash,
      },
    });

    const genesisBytes = encodeSignedControlLogEntry(initialized.genesis);
    await getDb()
      .insert(schema.contentEncryptedVaultGenesisAdmissions)
      .values({
        vaultId,
        ownerEmail: OWNER,
        orgId: ORG,
        controlEntryId: initialized.genesis.envelopeId,
        controlEntryHash: ancV1BytesToHex(
          await ancV1Hash("log-entry", genesisBytes),
        ),
        signerEndpointId: initialized.genesis.signerEndpointId,
        candidateHash: "11".repeat(32),
        bootstrapTranscriptHash: "22".repeat(32),
        authorizedAt: freshAt,
      });

    const body = encodeAncV1BrokerClaimRequest({
      version: 1,
      suite: "anc/v1",
      type: "broker-job-claim-request",
    });
    const proof = await createEndpointRequestProof({
      vaultId,
      endpointId: broker.member.endpointId,
      method: "POST",
      path: "/api/private-vault/jobs/broker/claim",
      body,
      issuedAt: freshAt,
      nonce: "ab".repeat(16),
      signingPrivateKey: broker.pair.privateKey,
    });
    const { authenticatePrivateVaultBrokerRequest } =
      await import("./private-vault-broker-auth.js");
    const request = {
      proof,
      method: "POST" as const,
      path: "/api/private-vault/jobs/broker/claim",
      body,
      now: new Date(freshAt),
    };
    await expect(
      authenticatePrivateVaultBrokerRequest(request),
    ).resolves.toEqual({
      ...scope(vaultId),
      endpointId: broker.member.endpointId,
    });
    await expect(
      authenticatePrivateVaultBrokerRequest(request),
    ).rejects.toThrow("Private Vault broker authentication failed");
  });

  it("accepts concurrent identical CAS retries idempotently", async () => {
    const vaultId = "vault:concurrent-same";
    const initialized = await initialize(vaultId, 4);
    const checkpoint = await entry({
      vaultId,
      state: initialized.state,
      signer: initialized.owner,
      inner: {
        suite: "anc/v1",
        type: "continuity_checkpoint",
        vaultId,
        membershipHash: initialized.state.membershipHash,
      },
    });
    const input = {
      entryBytes: encodeSignedControlLogEntry(checkpoint),
      expectedHead: {
        sequence: initialized.state.sequence,
        hash: initialized.state.headHash,
      },
    };
    const results = await Promise.all([
      service().append(scope(vaultId), input),
      service().append(scope(vaultId), input),
    ]);
    expect(results.filter((result) => result.idempotent)).toHaveLength(1);
    expect(results[0]!.state.headHash).toBe(results[1]!.state.headHash);
  });

  it("permits exactly one of two competing next heads and detects the fork", async () => {
    const vaultId = "vault:concurrent-fork";
    const initialized = await initialize(vaultId, 5);
    const inner = {
      suite: "anc/v1" as const,
      type: "continuity_checkpoint" as const,
      vaultId,
      membershipHash: initialized.state.membershipHash,
    };
    const [left, right] = await Promise.all([
      entry({
        vaultId,
        state: initialized.state,
        signer: initialized.owner,
        inner,
        suffix: ":left",
      }),
      entry({
        vaultId,
        state: initialized.state,
        signer: initialized.owner,
        inner,
        suffix: ":right",
      }),
    ]);
    const expectedHead = {
      sequence: initialized.state.sequence,
      hash: initialized.state.headHash,
    };
    const results = await Promise.allSettled([
      service().append(scope(vaultId), {
        entryBytes: encodeSignedControlLogEntry(left),
        expectedHead,
      }),
      service().append(scope(vaultId), {
        entryBytes: encodeSignedControlLogEntry(right),
        expectedHead,
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(
      service().loadVerifiedState(scope(vaultId)),
    ).resolves.toMatchObject({
      sequence: 1,
    });
  });

  it("rejects tenant-scope substitution without revealing another scope's head", async () => {
    const vaultId = "vault:tenant-scope";
    const initialized = await initialize(vaultId, 6);
    await expect(
      service().loadVerifiedState(scope(vaultId, "other@example.com")),
    ).resolves.toBeNull();
    const checkpoint = await entry({
      vaultId,
      state: initialized.state,
      signer: initialized.owner,
      inner: {
        suite: "anc/v1",
        type: "continuity_checkpoint",
        vaultId,
        membershipHash: initialized.state.membershipHash,
      },
    });
    await expect(
      service().append(scope(vaultId, "other@example.com"), {
        entryBytes: encodeSignedControlLogEntry(checkpoint),
        expectedHead: {
          sequence: initialized.state.sequence,
          hash: initialized.state.headHash,
        },
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("detects a tampered cached head and tampered persisted canonical bytes", async () => {
    const headVault = "vault:tampered-head";
    await initialize(headVault, 7);
    await getDb()
      .update(schema.contentEncryptedVaultControlHeads)
      .set({ headHash: "ff".repeat(32) })
      .where(
        and(
          eq(schema.contentEncryptedVaultControlHeads.vaultId, headVault),
          eq(schema.contentEncryptedVaultControlHeads.ownerEmail, OWNER),
          eq(schema.contentEncryptedVaultControlHeads.orgId, ORG),
        ),
      );
    await expect(
      service().loadVerifiedState(scope(headVault)),
    ).rejects.toMatchObject({ code: "persisted_state_tampered" });

    const entryVault = "vault:tampered-entry";
    await initialize(entryVault, 8);
    await getDb()
      .update(schema.contentEncryptedVaultControlLogEntries)
      .set({ entryBytesBase64url: "AAAA" })
      .where(
        and(
          eq(schema.contentEncryptedVaultControlLogEntries.vaultId, entryVault),
          eq(schema.contentEncryptedVaultControlLogEntries.sequence, 0),
        ),
      );
    await expect(
      service().loadVerifiedState(scope(entryVault)),
    ).rejects.toMatchObject({ code: "persisted_state_tampered" });
  });

  it("requires the external recovery verifier before replacing the endpoint snapshot", async () => {
    const vaultId = "vault:recovery-check";
    const initialized = await initialize(vaultId, 9);
    const recovered = await identity(10, "endpoint:recovery-new");
    const recovery = await entry({
      vaultId,
      state: initialized.state,
      signer: recovered,
      inner: commit(vaultId, {
        ceremonyKind: "recovery",
        epoch: 2,
        previousMembershipHash: initialized.state.membershipHash,
        activeMembers: [recovered.member],
        removedEndpointIds: [initialized.owner.member.endpointId],
        rotationCompleted: true,
        recoverySnapshotHash: "aa".repeat(32),
        recoveryAuthorizationHash: "bb".repeat(32),
        recoveryGeneration: initialized.state.recoveryGeneration + 1,
        recoveryId: "recovery:replacement",
        recoverySigningPublicKey: "d4".repeat(32),
        recoveryKeyAgreementPublicKey: "e5".repeat(32),
        recoveryWrapHash: "f6".repeat(32),
      }),
    });
    const input = {
      entryBytes: encodeSignedControlLogEntry(recovery),
      expectedHead: {
        sequence: initialized.state.sequence,
        hash: initialized.state.headHash,
      },
    };
    await expect(service().append(scope(vaultId), input)).rejects.toMatchObject(
      {
        code: "recovery_authorization_required",
      },
    );
    await expect(
      service(true).append(scope(vaultId), input),
    ).resolves.toMatchObject({
      state: { activeMembers: [recovered.member], epoch: 2 },
    });
  });

  it("requires and replays the exact external recovery-wrap verifier for ordinary rotation", async () => {
    const vaultId = "vault:ordinary-rotation-wrap";
    const initialized = await initialize(vaultId, 21);
    const secondary = await identity(22, "endpoint:rotation-secondary");
    const enrollment = await entry({
      vaultId,
      state: initialized.state,
      signer: initialized.owner,
      inner: commit(vaultId, {
        ceremonyKind: "add_device",
        previousMembershipHash: initialized.state.membershipHash,
        activeMembers: [initialized.owner.member, secondary.member].sort(
          (left, right) => left.endpointId.localeCompare(right.endpointId),
        ),
      }),
    });
    const enrolled = await service().append(scope(vaultId), {
      entryBytes: encodeSignedControlLogEntry(enrollment),
      expectedHead: {
        sequence: initialized.state.sequence,
        hash: initialized.state.headHash,
      },
    });
    const rotation = await entry({
      vaultId,
      state: enrolled.state,
      signer: initialized.owner,
      inner: commit(vaultId, {
        ceremonyKind: "remove_device",
        epoch: 2,
        previousMembershipHash: enrolled.state.membershipHash,
        activeMembers: [initialized.owner.member],
        removedEndpointIds: [secondary.member.endpointId],
        rotationCompleted: true,
        recoveryWrapHash: "d7".repeat(32),
      }),
    });
    const input = {
      entryBytes: encodeSignedControlLogEntry(rotation),
      expectedHead: {
        sequence: enrolled.state.sequence,
        hash: enrolled.state.headHash,
      },
    };

    await expect(service().append(scope(vaultId), input)).rejects.toMatchObject(
      { code: "invalid_entry" },
    );
    await expect(
      service(false, AT, true).append(scope(vaultId), input),
    ).resolves.toMatchObject({ state: { epoch: 2 } });
    await expect(
      service(false, AT, true).loadVerifiedState(scope(vaultId)),
    ).resolves.toMatchObject({ epoch: 2 });
    await expect(
      service().loadVerifiedState(scope(vaultId)),
    ).rejects.toMatchObject({ code: "persisted_state_tampered" });
  });

  it("verifies a genesis signature before invoking external authorization", async () => {
    const vaultId = "vault:invalid-genesis-signature";
    await createVault(vaultId);
    const owner = await identity(11, "endpoint:invalid-genesis-owner");
    const candidate = await entry({
      vaultId,
      state: null,
      signer: owner,
      inner: commit(vaultId, {
        ceremonyKind: "first_device",
        activeMembers: [owner.member],
      }),
    });
    const authorizeGenesis = vi.fn(async () => true);
    const verifier = createService({
      authorizeGenesis,
      now: () => new Date(AT),
    });
    await expect(
      verifier.append(scope(vaultId), {
        entryBytes: encodeSignedControlLogEntry({
          ...candidate,
          signature: "00".repeat(64),
        }),
        expectedHead: { sequence: null, hash: null },
      }),
    ).rejects.toMatchObject({ code: "invalid_entry" });
    expect(authorizeGenesis).not.toHaveBeenCalled();
  });

  it("collapses external genesis callback failures into a stable error", async () => {
    const vaultId = "vault:genesis-callback-failure";
    await createVault(vaultId);
    const owner = await identity(12, "endpoint:callback-owner");
    const candidate = await entry({
      vaultId,
      state: null,
      signer: owner,
      inner: commit(vaultId, {
        ceremonyKind: "first_device",
        activeMembers: [owner.member],
      }),
    });
    const verifier = createService({
      authorizeGenesis: async () => {
        throw new Error("sensitive ceremony diagnostic");
      },
    });
    const error = await verifier
      .append(scope(vaultId), {
        entryBytes: encodeSignedControlLogEntry(candidate),
        expectedHead: { sequence: null, hash: null },
      })
      .catch((value) => value);
    expect(error).toMatchObject({
      code: "unauthorized_genesis",
      message: "Private Vault control log verification failed",
    });
    expect(error.message).not.toContain("sensitive ceremony diagnostic");
  });

  it("scopes envelope identity by vault", async () => {
    const envelopeId = "log:shared-envelope-id";
    for (const [vaultId, seedByte] of [
      ["vault:shared-envelope-left", 13],
      ["vault:shared-envelope-right", 14],
    ] as const) {
      await createVault(vaultId);
      const owner = await identity(seedByte, `endpoint:${vaultId}:owner`);
      authorizedGenesis.set(vaultId, owner.member.endpointId);
      const genesis = await entry({
        vaultId,
        state: null,
        signer: owner,
        envelopeId,
        inner: commit(vaultId, {
          ceremonyKind: "first_device",
          activeMembers: [owner.member],
        }),
      });
      await expect(
        service().append(scope(vaultId), {
          entryBytes: encodeSignedControlLogEntry(genesis),
          expectedHead: { sequence: null, hash: null },
        }),
      ).resolves.toMatchObject({ state: { vaultId } });
    }
  });

  it("uses the service clock for stale and future broker-head checks", async () => {
    const vaultId = "vault:server-owned-freshness-clock";
    const initialized = await initialize(vaultId, 15);
    const broker = await identity(16, "broker:clock-check", "broker");
    const addBroker = await entry({
      vaultId,
      state: initialized.state,
      signer: initialized.owner,
      inner: commit(vaultId, {
        ceremonyKind: "add_broker",
        previousMembershipHash: initialized.state.membershipHash,
        activeMembers: [broker.member, initialized.owner.member].sort((a, b) =>
          a.endpointId.localeCompare(b.endpointId),
        ),
      }),
    });
    await service().append(scope(vaultId), {
      entryBytes: encodeSignedControlLogEntry(addBroker),
      expectedHead: {
        sequence: initialized.state.sequence,
        hash: initialized.state.headHash,
      },
    });
    await expect(
      service(false, "2026-07-17T01:16:00.000Z").resolveBrokerAuthorization(
        scope(vaultId),
        broker.member.endpointId,
      ),
    ).rejects.toMatchObject({ code: "stale_head" });
    await expect(
      service(false, "2026-07-17T00:59:29.000Z").resolveBrokerAuthorization(
        scope(vaultId),
        broker.member.endpointId,
      ),
    ).rejects.toMatchObject({ code: "future_head" });
  });
});

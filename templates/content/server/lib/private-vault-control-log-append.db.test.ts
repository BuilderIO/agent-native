import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ancV1BoxKeypairFromSeed,
  ancV1BytesToHex,
  ancV1Hash,
  ancV1HexToBytes,
  ancV1SigningKeypairFromSeed,
  CONTROL_LOG_ZERO_HASH,
  createAncV1RecoveryWrap,
  createEndpointRequestProof,
  createSignedControlLogEntry,
  decodeAncV1ControlLogRotationAppendReceipt,
  encodeAncV1ControlLogRotationAppendRequest,
  encodeAncV1RecoveryWrap,
  encodeSignedControlLogEntry,
  hashAncV1RecoveryWrap,
  type ControlLogMember,
  type ControlLogState,
  type ControlMembershipCommit,
} from "@agent-native/core/e2ee";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `private-vault-control-append-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "rotation-owner@example.com";
const ORG = "org:rotation-append";
const VAULT_ID = "11".repeat(16);
const OWNER_ID = "22".repeat(16);
const SECONDARY_ID = "33".repeat(16);
const THIRD_ID = "34".repeat(16);
const RECOVERY_ID = "44".repeat(16);
const CEREMONY_ID = "55".repeat(16);
const WRAP_ID = "66".repeat(16);
const blobs = new Map<string, Uint8Array>();
let beforeNextPut: (() => Promise<void>) | null = null;

vi.mock("@agent-native/core/protected-ciphertext", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/protected-ciphertext")
    >();
  return {
    ...actual,
    putProtectedCiphertext: vi.fn(async (input) => {
      const hook = beforeNextPut;
      beforeNextPut = null;
      await hook?.();
      const key = JSON.stringify(input.coordinate);
      const existing = blobs.get(key);
      if (
        existing &&
        !Buffer.from(existing).equals(Buffer.from(input.ciphertext))
      ) {
        throw new Error("collision");
      }
      blobs.set(key, input.ciphertext.slice());
      return {
        locator: {
          kind: "agent-native.protected-ciphertext" as const,
          version: 1 as const,
          provider: "test",
          opaque: true as const,
          coordinate: input.coordinate,
        },
        byteLength: input.ciphertext.byteLength,
        created: !existing,
      };
    }),
    readProtectedCiphertextAt: vi.fn(async (coordinate) => {
      const ciphertext = blobs.get(JSON.stringify(coordinate));
      if (!ciphertext) throw new Error("not found");
      return {
        locator: {
          kind: "agent-native.protected-ciphertext" as const,
          version: 1 as const,
          provider: "test",
          opaque: true as const,
          coordinate,
        },
        ciphertext: ciphertext.slice(),
        byteLength: ciphertext.byteLength,
      };
    }),
  };
});

let getDb: (typeof import("../db/index.js"))["getDb"];
let schema: typeof import("../db/schema.js");
let controlLog: typeof import("./private-vault-control-log-runtime.js");
let appendRotation: (typeof import("./private-vault-control-log-append.js"))["appendPrivateVaultControlLogRotation"];

function member(
  endpointId: string,
  signingPublicKey: Uint8Array,
  agreementPublicKey: Uint8Array,
): ControlLogMember {
  return {
    endpointId,
    role: "endpoint",
    unattended: false,
    signingPublicKey: ancV1BytesToHex(signingPublicKey),
    keyAgreementPublicKey: ancV1BytesToHex(agreementPublicKey),
    enrollmentRef: `enrollment:${endpointId}`,
  };
}

function commit(input: {
  ceremonyKind: "first_device" | "add_device" | "remove_device";
  activeMembers: ControlLogMember[];
  previousMembershipHash: string | null;
  removedEndpointIds?: string[];
  epoch?: number;
  recoveryWrapHash: string;
  recoveryKeyAgreementPublicKey: string;
  ceremonyId?: string;
}): ControlMembershipCommit {
  return {
    suite: "anc/v1",
    type: "membership_commit",
    vaultId: VAULT_ID,
    ceremonyId: input.ceremonyId ?? CEREMONY_ID,
    ceremonyKind: input.ceremonyKind,
    epoch: input.epoch ?? 1,
    previousMembershipHash: input.previousMembershipHash,
    activeMembers: input.activeMembers.sort((left, right) =>
      left.endpointId.localeCompare(right.endpointId),
    ),
    removedEndpointIds: input.removedEndpointIds ?? [],
    rotationCompleted: input.ceremonyKind === "remove_device",
    outstandingJobsResolved: false,
    recoverySnapshotHash: null,
    recoveryAuthorizationHash: null,
    recoveryGeneration: 1,
    recoveryId: RECOVERY_ID,
    recoverySigningPublicKey: "77".repeat(32),
    recoveryKeyAgreementPublicKey: input.recoveryKeyAgreementPublicKey,
    recoveryWrapHash: input.recoveryWrapHash,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  await (await import("../plugins/db.js")).default(undefined as never);
  controlLog = await import("./private-vault-control-log-runtime.js");
  appendRotation = (await import("./private-vault-control-log-append.js"))
    .appendPrivateVaultControlLogRotation;
}, 60_000);

afterAll(() => {
  blobs.clear();
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("Private Vault authenticated rotation append", () => {
  it("atomically binds the exact recovery wrap and returns byte-stable retry receipts", async () => {
    const ownerSigning = await ancV1SigningKeypairFromSeed(
      new Uint8Array(32).fill(1),
    );
    const ownerAgreement = await ancV1BoxKeypairFromSeed(
      new Uint8Array(32).fill(2),
    );
    const secondarySigning = await ancV1SigningKeypairFromSeed(
      new Uint8Array(32).fill(3),
    );
    const secondaryAgreement = await ancV1BoxKeypairFromSeed(
      new Uint8Array(32).fill(4),
    );
    const thirdSigning = await ancV1SigningKeypairFromSeed(
      new Uint8Array(32).fill(8),
    );
    const thirdAgreement = await ancV1BoxKeypairFromSeed(
      new Uint8Array(32).fill(9),
    );
    const recoveryAgreement = await ancV1BoxKeypairFromSeed(
      new Uint8Array(32).fill(5),
    );
    const owner = member(
      OWNER_ID,
      ownerSigning.publicKey,
      ownerAgreement.publicKey,
    );
    const secondary = member(
      SECONDARY_ID,
      secondarySigning.publicKey,
      secondaryAgreement.publicKey,
    );
    const third = member(
      THIRD_ID,
      thirdSigning.publicKey,
      thirdAgreement.publicKey,
    );
    const initialWrapHash = "99".repeat(32);

    await getDb().insert(schema.contentEncryptedVaults).values({
      vaultId: VAULT_ID,
      ownerEmail: OWNER,
      orgId: ORG,
      accountId: "account:rotation",
      workspaceId: "workspace:rotation",
      vaultState: "active",
    });
    const genesis = await createSignedControlLogEntry({
      vaultId: VAULT_ID,
      createdAt: "2026-07-17T01:00:00.000Z",
      envelopeId: "aa".repeat(16),
      sequence: 0,
      previousHash: CONTROL_LOG_ZERO_HASH,
      innerEnvelope: commit({
        ceremonyKind: "first_device",
        activeMembers: [owner],
        previousMembershipHash: null,
        recoveryWrapHash: initialWrapHash,
        recoveryKeyAgreementPublicKey: ancV1BytesToHex(
          recoveryAgreement.publicKey,
        ),
      }),
      signerEndpointId: OWNER_ID,
      signingPrivateKey: ownerSigning.privateKey,
    });
    const genesisBytes = encodeSignedControlLogEntry(genesis);
    await getDb()
      .insert(schema.contentEncryptedVaultGenesisAdmissions)
      .values({
        vaultId: VAULT_ID,
        ownerEmail: OWNER,
        orgId: ORG,
        controlEntryId: genesis.envelopeId,
        controlEntryHash: ancV1BytesToHex(
          await ancV1Hash("log-entry", genesisBytes),
        ),
        signerEndpointId: OWNER_ID,
        bootstrapTranscriptHash: "ab".repeat(32),
      });
    const scope = { ownerEmail: OWNER, orgId: ORG, vaultId: VAULT_ID };
    const genesisState = await controlLog.privateVaultControlLogService.append(
      scope,
      {
        entryBytes: genesisBytes,
        expectedHead: { sequence: null, hash: null },
      },
    );
    const enrollment = await createSignedControlLogEntry({
      vaultId: VAULT_ID,
      createdAt: "2026-07-17T01:01:00.000Z",
      envelopeId: "bb".repeat(16),
      sequence: 1,
      previousHash: genesisState.state.headHash,
      innerEnvelope: commit({
        ceremonyKind: "add_device",
        activeMembers: [owner, secondary],
        previousMembershipHash: genesisState.state.membershipHash,
        recoveryWrapHash: initialWrapHash,
        recoveryKeyAgreementPublicKey: ancV1BytesToHex(
          recoveryAgreement.publicKey,
        ),
      }),
      signerEndpointId: OWNER_ID,
      signingPrivateKey: ownerSigning.privateKey,
    });
    const enrolledSecondary =
      await controlLog.privateVaultControlLogService.append(scope, {
        entryBytes: encodeSignedControlLogEntry(enrollment),
        expectedHead: {
          sequence: genesisState.state.sequence,
          hash: genesisState.state.headHash,
        },
      });
    const thirdEnrollment = await createSignedControlLogEntry({
      vaultId: VAULT_ID,
      createdAt: "2026-07-17T01:01:20.000Z",
      envelopeId: "bc".repeat(16),
      sequence: 2,
      previousHash: enrolledSecondary.state.headHash,
      innerEnvelope: commit({
        ceremonyKind: "add_device",
        activeMembers: [owner, secondary, third],
        previousMembershipHash: enrolledSecondary.state.membershipHash,
        recoveryWrapHash: initialWrapHash,
        recoveryKeyAgreementPublicKey: ancV1BytesToHex(
          recoveryAgreement.publicKey,
        ),
      }),
      signerEndpointId: OWNER_ID,
      signingPrivateKey: ownerSigning.privateKey,
    });
    const enrolled = await controlLog.privateVaultControlLogService.append(
      scope,
      {
        entryBytes: encodeSignedControlLogEntry(thirdEnrollment),
        expectedHead: {
          sequence: enrolledSecondary.state.sequence,
          hash: enrolledSecondary.state.headHash,
        },
      },
    );

    const wrap = await createAncV1RecoveryWrap(
      {
        suite: "anc/v1",
        vaultId: ancV1HexToBytes(VAULT_ID),
        type: "recovery-wrap",
        createdAt: Date.parse("2026-07-17T01:01:30.000Z") / 1000,
        envelopeId: ancV1HexToBytes(WRAP_ID),
        ceremonyId: ancV1HexToBytes(CEREMONY_ID),
        recoveryGeneration: 1,
        recoveryId: ancV1HexToBytes(RECOVERY_ID),
        recoveryKeyAgreementPublicKey: recoveryAgreement.publicKey,
        epoch: 2,
        issuerEndpointId: ancV1HexToBytes(OWNER_ID),
        activationControlSequence: 3,
        activationPreviousHead: ancV1HexToBytes(enrolled.state.headHash),
        activationPreviousMembershipHash: ancV1HexToBytes(
          enrolled.state.membershipHash,
        ),
        nonce: new Uint8Array(24).fill(6),
        eek: new Uint8Array(32).fill(7),
      },
      {
        issuerKeyAgreementPrivateKey: ownerAgreement.privateKey,
        issuerSigningPrivateKey: ownerSigning.privateKey,
      },
    );
    const recoveryWrap = encodeAncV1RecoveryWrap(wrap);
    const recoveryWrapHash = ancV1BytesToHex(
      await hashAncV1RecoveryWrap(recoveryWrap, ancV1HexToBytes(VAULT_ID)),
    );
    const rotation = await createSignedControlLogEntry({
      vaultId: VAULT_ID,
      createdAt: "2026-07-17T01:02:00.000Z",
      envelopeId: "cc".repeat(16),
      sequence: 3,
      previousHash: enrolled.state.headHash,
      innerEnvelope: commit({
        ceremonyKind: "remove_device",
        activeMembers: [owner, secondary],
        previousMembershipHash: enrolled.state.membershipHash,
        removedEndpointIds: [THIRD_ID],
        epoch: 2,
        recoveryWrapHash,
        recoveryKeyAgreementPublicKey: ancV1BytesToHex(
          recoveryAgreement.publicKey,
        ),
      }),
      signerEndpointId: OWNER_ID,
      signingPrivateKey: ownerSigning.privateKey,
    });
    const body = encodeAncV1ControlLogRotationAppendRequest({
      version: 1,
      suite: "anc/v1",
      type: "control-log-rotation-append-request",
      signedEntry: Uint8Array.from(encodeSignedControlLogEntry(rotation)),
      recoveryWrap: Uint8Array.from(recoveryWrap),
    });
    const requestTime = new Date();
    const proof = await createEndpointRequestProof({
      vaultId: VAULT_ID,
      endpointId: OWNER_ID,
      method: "POST",
      path: "/api/private-vault/control-log/append",
      body,
      issuedAt: requestTime.toISOString(),
      nonce: "dd".repeat(16),
      signingPrivateKey: ownerSigning.privateKey,
    });
    beforeNextPut = async () => {
      await getDb()
        .update(schema.contentEncryptedVaults)
        .set({ vaultState: "disabled" })
        .where(eq(schema.contentEncryptedVaults.vaultId, VAULT_ID));
    };
    await expect(
      appendRotation({
        body,
        proof,
        now: new Date(requestTime.getTime() + 1_000),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await controlLog.privateVaultControlLogService.loadVerifiedState(scope),
    ).toMatchObject({ sequence: 2, epoch: 1 });
    expect(
      await getDb().select().from(schema.contentEncryptedVaultRecoveryWraps),
    ).toHaveLength(0);
    await getDb()
      .update(schema.contentEncryptedVaults)
      .set({ vaultState: "active" })
      .where(eq(schema.contentEncryptedVaults.vaultId, VAULT_ID));
    const committedProof = await createEndpointRequestProof({
      vaultId: VAULT_ID,
      endpointId: OWNER_ID,
      method: "POST",
      path: "/api/private-vault/control-log/append",
      body,
      issuedAt: new Date(requestTime.getTime() + 2_000).toISOString(),
      nonce: "de".repeat(16),
      signingPrivateKey: ownerSigning.privateKey,
    });
    const receiptBytes = await appendRotation({
      body,
      proof: committedProof,
      now: new Date(requestTime.getTime() + 3_000),
    });
    const receipt = decodeAncV1ControlLogRotationAppendReceipt(receiptBytes);
    expect(receipt).toMatchObject({
      vaultId: VAULT_ID,
      entryId: rotation.envelopeId,
      sequence: 3,
      recoveryWrapHash,
      recoveryWrapByteLength: recoveryWrap.byteLength,
    });

    const committedN =
      await controlLog.privateVaultControlLogService.loadVerifiedState(scope);
    expect(committedN).not.toBeNull();
    const nextCeremonyId = "12".repeat(16);
    const nextWrap = await createAncV1RecoveryWrap(
      {
        suite: "anc/v1",
        vaultId: ancV1HexToBytes(VAULT_ID),
        type: "recovery-wrap",
        createdAt: Date.parse("2026-07-17T01:02:30.000Z") / 1000,
        envelopeId: ancV1HexToBytes("13".repeat(16)),
        ceremonyId: ancV1HexToBytes(nextCeremonyId),
        recoveryGeneration: 1,
        recoveryId: ancV1HexToBytes(RECOVERY_ID),
        recoveryKeyAgreementPublicKey: recoveryAgreement.publicKey,
        epoch: 3,
        issuerEndpointId: ancV1HexToBytes(SECONDARY_ID),
        activationControlSequence: 4,
        activationPreviousHead: ancV1HexToBytes(committedN!.headHash),
        activationPreviousMembershipHash: ancV1HexToBytes(
          committedN!.membershipHash,
        ),
        nonce: new Uint8Array(24).fill(10),
        eek: new Uint8Array(32).fill(11),
      },
      {
        issuerKeyAgreementPrivateKey: secondaryAgreement.privateKey,
        issuerSigningPrivateKey: secondarySigning.privateKey,
      },
    );
    const nextRecoveryWrap = encodeAncV1RecoveryWrap(nextWrap);
    const nextRecoveryWrapHash = ancV1BytesToHex(
      await hashAncV1RecoveryWrap(nextRecoveryWrap, ancV1HexToBytes(VAULT_ID)),
    );
    const nextRotation = await createSignedControlLogEntry({
      vaultId: VAULT_ID,
      createdAt: "2026-07-17T01:03:00.000Z",
      envelopeId: "14".repeat(16),
      sequence: 4,
      previousHash: committedN!.headHash,
      innerEnvelope: commit({
        ceremonyKind: "remove_device",
        ceremonyId: nextCeremonyId,
        activeMembers: [secondary],
        previousMembershipHash: committedN!.membershipHash,
        removedEndpointIds: [OWNER_ID],
        epoch: 3,
        recoveryWrapHash: nextRecoveryWrapHash,
        recoveryKeyAgreementPublicKey: ancV1BytesToHex(
          recoveryAgreement.publicKey,
        ),
      }),
      signerEndpointId: SECONDARY_ID,
      signingPrivateKey: secondarySigning.privateKey,
    });
    const nextBody = encodeAncV1ControlLogRotationAppendRequest({
      version: 1,
      suite: "anc/v1",
      type: "control-log-rotation-append-request",
      signedEntry: Uint8Array.from(encodeSignedControlLogEntry(nextRotation)),
      recoveryWrap: Uint8Array.from(nextRecoveryWrap),
    });
    const nextProof = await createEndpointRequestProof({
      vaultId: VAULT_ID,
      endpointId: SECONDARY_ID,
      method: "POST",
      path: "/api/private-vault/control-log/append",
      body: nextBody,
      issuedAt: new Date(requestTime.getTime() + 4_000).toISOString(),
      nonce: "ef".repeat(16),
      signingPrivateKey: secondarySigning.privateKey,
    });
    await appendRotation({
      body: nextBody,
      proof: nextProof,
      now: new Date(requestTime.getTime() + 5_000),
    });
    expect(
      (await controlLog.privateVaultControlLogService.loadVerifiedState(scope))
        ?.activeMembers,
    ).toEqual([secondary]);

    const retryProof = await createEndpointRequestProof({
      vaultId: VAULT_ID,
      endpointId: OWNER_ID,
      method: "POST",
      path: "/api/private-vault/control-log/append",
      body,
      issuedAt: new Date(requestTime.getTime() + 6_000).toISOString(),
      nonce: "ee".repeat(16),
      signingPrivateKey: ownerSigning.privateKey,
    });
    await expect(
      appendRotation({
        body,
        proof: retryProof,
        now: new Date(requestTime.getTime() + 7_000),
      }),
    ).resolves.toEqual(receiptBytes);

    const [binding] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultRecoveryWraps)
      .where(
        eq(
          schema.contentEncryptedVaultRecoveryWraps.recoveryWrapHash,
          recoveryWrapHash,
        ),
      );
    expect(binding).toMatchObject({
      vaultId: VAULT_ID,
      controlEntryId: rotation.envelopeId,
      recoveryWrapHash,
      ciphertextByteLength: recoveryWrap.byteLength,
    });
  });
});

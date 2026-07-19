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
  decodeAncV1ControlLogGenesisAppendReceipt,
  decodeAncV1ControlLogGrantRevocationAppendReceipt,
  decodeAncV1ControlLogRotationAppendReceipt,
  encodeAncV1ControlLogGenesisAppendRequest,
  encodeAncV1ControlLogGrantRevocationAppendRequest,
  encodeAncV1ControlLogRotationAppendRequest,
  encodeAncV1RecoveryWrap,
  encodeSignedControlLogEntry,
  hashAncV1RecoveryWrap,
  type ControlLogMember,
  type ControlLogState,
  type ControlMembershipCommit,
} from "@agent-native/core/e2ee";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { validatePrivateVaultEndpointRow } from "../../shared/private-vault-hosted-records.js";

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
let appendGenesis: (typeof import("./private-vault-control-log-append.js"))["appendPrivateVaultControlLogGenesis"];
let appendGrantRevocation: (typeof import("./private-vault-control-log-append.js"))["appendPrivateVaultControlLogGrantRevocation"];
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
  const append = await import("./private-vault-control-log-append.js");
  appendGenesis = append.appendPrivateVaultControlLogGenesis;
  appendGrantRevocation = append.appendPrivateVaultControlLogGrantRevocation;
  appendRotation = append.appendPrivateVaultControlLogRotation;
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

    const beforeRevocation =
      await controlLog.privateVaultControlLogService.loadVerifiedState(scope);
    expect(beforeRevocation).not.toBeNull();
    const revocation = await createSignedControlLogEntry({
      vaultId: VAULT_ID,
      createdAt: "2026-07-17T01:04:00.000Z",
      envelopeId: "15".repeat(16),
      sequence: 5,
      previousHash: beforeRevocation!.headHash,
      innerEnvelope: {
        suite: "anc/v1",
        type: "grant_revocation",
        vaultId: VAULT_ID,
        revocationEnvelope: "ab".repeat(64),
      },
      signerEndpointId: SECONDARY_ID,
      signingPrivateKey: secondarySigning.privateKey,
    });
    const revocationBody = encodeAncV1ControlLogGrantRevocationAppendRequest({
      version: 1,
      suite: "anc/v1",
      type: "control-log-grant-revocation-append-request",
      signedEntry: Uint8Array.from(encodeSignedControlLogEntry(revocation)),
    });
    const revocationProof = await createEndpointRequestProof({
      vaultId: VAULT_ID,
      endpointId: SECONDARY_ID,
      method: "POST",
      path: "/api/private-vault/control-log/append",
      body: revocationBody,
      issuedAt: new Date(requestTime.getTime() + 8_000).toISOString(),
      nonce: "f1".repeat(16),
      signingPrivateKey: secondarySigning.privateKey,
    });
    const revocationReceipt = decodeAncV1ControlLogGrantRevocationAppendReceipt(
      await appendGrantRevocation({
        body: revocationBody,
        proof: revocationProof,
        now: new Date(requestTime.getTime() + 9_000),
      }),
    );
    expect(revocationReceipt).toMatchObject({
      vaultId: VAULT_ID,
      entryId: revocation.envelopeId,
      sequence: 5,
    });
    expect(
      await controlLog.privateVaultControlLogService.loadVerifiedState(scope),
    ).toMatchObject({ sequence: 5, epoch: 3 });
  });
});

const GENESIS_OWNER = "genesis-owner@example.com";
const GENESIS_ORG = "org:genesis-append";
const GENESIS_VAULT_ID = "81".repeat(16);
const GENESIS_ENDPOINT_ID = "82".repeat(16);
const GENESIS_RECOVERY_ID = "83".repeat(16);
const GENESIS_CEREMONY_ID = "84".repeat(16);

async function buildGenesisFixture(input?: {
  admissionOwner?: string;
  includeAdmission?: boolean;
}) {
  const signing = await ancV1SigningKeypairFromSeed(
    new Uint8Array(32).fill(21),
  );
  const agreement = await ancV1BoxKeypairFromSeed(new Uint8Array(32).fill(22));
  const recovery = await ancV1BoxKeypairFromSeed(new Uint8Array(32).fill(23));
  const recoverySigning = await ancV1SigningKeypairFromSeed(
    new Uint8Array(32).fill(24),
  );
  const createdAt = "2026-07-18T02:00:00.000Z";
  const recoveryWrap = encodeAncV1RecoveryWrap(
    await createAncV1RecoveryWrap(
      {
        suite: "anc/v1",
        vaultId: ancV1HexToBytes(GENESIS_VAULT_ID),
        type: "recovery-wrap",
        createdAt: Date.parse("2026-07-18T01:59:00.000Z") / 1_000,
        envelopeId: ancV1HexToBytes("85".repeat(16)),
        ceremonyId: ancV1HexToBytes(GENESIS_CEREMONY_ID),
        recoveryGeneration: 1,
        recoveryId: ancV1HexToBytes(GENESIS_RECOVERY_ID),
        recoveryKeyAgreementPublicKey: recovery.publicKey,
        epoch: 1,
        issuerEndpointId: ancV1HexToBytes(GENESIS_ENDPOINT_ID),
        activationControlSequence: 0,
        activationPreviousHead: new Uint8Array(32),
        activationPreviousMembershipHash: new Uint8Array(32),
        nonce: new Uint8Array(24).fill(25),
        eek: new Uint8Array(32).fill(26),
      },
      {
        issuerKeyAgreementPrivateKey: agreement.privateKey,
        issuerSigningPrivateKey: signing.privateKey,
      },
    ),
  );
  const recoveryWrapHash = ancV1BytesToHex(
    await hashAncV1RecoveryWrap(
      recoveryWrap,
      ancV1HexToBytes(GENESIS_VAULT_ID),
    ),
  );
  const initialMember = member(
    GENESIS_ENDPOINT_ID,
    signing.publicKey,
    agreement.publicKey,
  );
  const genesisCommit: ControlMembershipCommit = {
    suite: "anc/v1",
    type: "membership_commit",
    vaultId: GENESIS_VAULT_ID,
    ceremonyId: GENESIS_CEREMONY_ID,
    ceremonyKind: "first_device",
    epoch: 1,
    previousMembershipHash: null,
    activeMembers: [initialMember],
    removedEndpointIds: [],
    rotationCompleted: false,
    outstandingJobsResolved: false,
    recoverySnapshotHash: null,
    recoveryAuthorizationHash: null,
    recoveryGeneration: 1,
    recoveryId: GENESIS_RECOVERY_ID,
    recoverySigningPublicKey: ancV1BytesToHex(recoverySigning.publicKey),
    recoveryKeyAgreementPublicKey: ancV1BytesToHex(recovery.publicKey),
    recoveryWrapHash,
  };
  const entry = await createSignedControlLogEntry({
    vaultId: GENESIS_VAULT_ID,
    createdAt,
    envelopeId: "86".repeat(16),
    sequence: 0,
    previousHash: CONTROL_LOG_ZERO_HASH,
    innerEnvelope: genesisCommit,
    signerEndpointId: GENESIS_ENDPOINT_ID,
    signingPrivateKey: signing.privateKey,
  });
  const signedEntry = encodeSignedControlLogEntry(entry);
  const body = encodeAncV1ControlLogGenesisAppendRequest({
    version: 1,
    suite: "anc/v1",
    type: "control-log-genesis-append-request",
    signedEntry: Uint8Array.from(signedEntry),
    recoveryWrap: Uint8Array.from(recoveryWrap),
  });
  await getDb().insert(schema.contentEncryptedVaults).values({
    vaultId: GENESIS_VAULT_ID,
    ownerEmail: GENESIS_OWNER,
    orgId: GENESIS_ORG,
    accountId: "account:genesis-append",
    workspaceId: "workspace:genesis-append",
    vaultState: "active",
  });
  if (input?.includeAdmission !== false) {
    await getDb()
      .insert(schema.contentEncryptedVaultGenesisAdmissions)
      .values({
        vaultId: GENESIS_VAULT_ID,
        ownerEmail: input?.admissionOwner ?? GENESIS_OWNER,
        orgId: GENESIS_ORG,
        controlEntryId: entry.envelopeId,
        controlEntryHash: ancV1BytesToHex(
          await ancV1Hash("log-entry", signedEntry),
        ),
        signerEndpointId: GENESIS_ENDPOINT_ID,
        bootstrapTranscriptHash: "87".repeat(32),
      });
  }
  const requestTime = new Date();
  const makeProof = (nonceByte: number, privateKey = signing.privateKey) => {
    return Promise.all([
      createEndpointRequestProof({
        vaultId: GENESIS_VAULT_ID,
        endpointId: GENESIS_ENDPOINT_ID,
        method: "POST",
        path: "/api/private-vault/control-log/append",
        body,
        issuedAt: requestTime.toISOString(),
        nonce: nonceByte.toString(16).padStart(2, "0").repeat(16),
        signingPrivateKey: privateKey,
      }),
      Promise.resolve(new Date(requestTime.getTime() + 500)),
    ]).then(([proof, now]) => ({ proof, now }));
  };
  return {
    body,
    entry,
    initialMember,
    recoveryWrap,
    recoveryWrapHash,
    signing,
    makeProof,
  };
}

describe("Private Vault account-admitted genesis append", () => {
  beforeEach(async () => {
    beforeNextPut = null;
    blobs.clear();
    await getDb().delete(schema.contentEncryptedVaultEndpointRequestNonces);
    await getDb().delete(
      schema.contentEncryptedVaultEndpointRequestNoncesLegacy,
    );
    await getDb().delete(schema.contentEncryptedVaultEndpoints);
    await getDb().delete(schema.contentEncryptedVaultRecoveryWraps);
    await getDb().delete(schema.contentEncryptedVaultCiphertextStaging);
    await getDb().delete(schema.contentEncryptedVaultControlHeads);
    await getDb().delete(schema.contentEncryptedVaultControlLogEntries);
    await getDb().delete(schema.contentEncryptedVaultGenesisAdmissions);
    await getDb().delete(schema.contentEncryptedVaultRetentionQueue);
    await getDb().delete(schema.contentEncryptedVaults);
  });

  it("commits the exact sequence-zero edge, wrap binding, stage, and endpoint projection once", async () => {
    const fixture = await buildGenesisFixture();
    const first = await fixture.makeProof(1);
    const receiptBytes = await appendGenesis({
      body: fixture.body,
      ...first,
    });
    expect(
      decodeAncV1ControlLogGenesisAppendReceipt(receiptBytes),
    ).toMatchObject({
      type: "control-log-genesis-append-receipt",
      vaultId: GENESIS_VAULT_ID,
      entryId: fixture.entry.envelopeId,
      sequence: 0,
      recoveryWrapHash: fixture.recoveryWrapHash,
      recoveryWrapByteLength: fixture.recoveryWrap.byteLength,
    });
    const scope = {
      ownerEmail: GENESIS_OWNER,
      orgId: GENESIS_ORG,
      vaultId: GENESIS_VAULT_ID,
    };
    const genesisState =
      await controlLog.privateVaultControlLogService.loadVerifiedState(scope);
    expect(genesisState).toMatchObject({ sequence: 0, epoch: 1 });
    const [binding] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultRecoveryWraps);
    expect(binding).toMatchObject({
      vaultId: GENESIS_VAULT_ID,
      controlEntryId: fixture.entry.envelopeId,
      recoveryWrapHash: fixture.recoveryWrapHash,
      ciphertextByteLength: fixture.recoveryWrap.byteLength,
    });
    const [stage] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultCiphertextStaging);
    expect(stage).toMatchObject({
      vaultId: GENESIS_VAULT_ID,
      recoveryWrapHash: fixture.recoveryWrapHash,
      phase: "committed",
    });
    const [endpoint] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultEndpoints);
    expect(endpoint).toMatchObject({
      endpointId: GENESIS_ENDPOINT_ID,
      vaultId: GENESIS_VAULT_ID,
      ownerEmail: GENESIS_OWNER,
      orgId: GENESIS_ORG,
      endpointState: "online",
      healthState: "healthy",
    });
    expect(JSON.parse(endpoint!.publicIdentityJson)).toMatchObject({
      algorithmId: "anc/v1-control-log-member",
    });
    expect(() => validatePrivateVaultEndpointRow(endpoint)).not.toThrow();

    const laterCheckpoint = await createSignedControlLogEntry({
      vaultId: GENESIS_VAULT_ID,
      createdAt: "2026-07-18T02:02:00.000Z",
      envelopeId: "89".repeat(16),
      sequence: 1,
      previousHash: genesisState!.headHash,
      innerEnvelope: {
        suite: "anc/v1",
        type: "continuity_checkpoint",
        vaultId: GENESIS_VAULT_ID,
        membershipHash: genesisState!.membershipHash,
      },
      signerEndpointId: GENESIS_ENDPOINT_ID,
      signingPrivateKey: fixture.signing.privateKey,
    });
    await controlLog.privateVaultControlLogService.append(scope, {
      entryBytes: encodeSignedControlLogEntry(laterCheckpoint),
      expectedHead: {
        sequence: genesisState!.sequence,
        hash: genesisState!.headHash,
      },
    });
    await getDb()
      .update(schema.contentEncryptedVaultEndpoints)
      .set({ endpointState: "removed", healthState: "offline" })
      .where(
        eq(
          schema.contentEncryptedVaultEndpoints.endpointId,
          GENESIS_ENDPOINT_ID,
        ),
      );
    const lostResponseRetry = await fixture.makeProof(2);
    await expect(
      appendGenesis({ body: fixture.body, ...lostResponseRetry }),
    ).resolves.toEqual(receiptBytes);
    await expect(
      appendGenesis({ body: fixture.body, ...first }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultControlLogEntries),
    ).toHaveLength(2);
    expect(
      await getDb().select().from(schema.contentEncryptedVaultEndpoints),
    ).toHaveLength(1);
  });

  it("coalesces concurrent exact requests into one commit and one canonical receipt", async () => {
    const fixture = await buildGenesisFixture();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) => fixture.makeProof(index + 10)),
    );
    const receipts = await Promise.all(
      attempts.map((attempt) =>
        appendGenesis({ body: fixture.body, ...attempt }),
      ),
    );
    for (const receipt of receipts.slice(1)) {
      expect(receipt).toEqual(receipts[0]);
    }
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultControlLogEntries),
    ).toHaveLength(1);
    expect(
      await getDb().select().from(schema.contentEncryptedVaultRecoveryWraps),
    ).toHaveLength(1);
    expect(
      await getDb().select().from(schema.contentEncryptedVaultEndpoints),
    ).toHaveLength(1);
  });

  it("fails closed for missing or cross-account admission and request type confusion", async () => {
    const fixture = await buildGenesisFixture({ includeAdmission: false });
    const missing = await fixture.makeProof(30);
    await expect(
      appendGenesis({ body: fixture.body, ...missing }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await getDb()
      .insert(schema.contentEncryptedVaultGenesisAdmissions)
      .values({
        vaultId: GENESIS_VAULT_ID,
        ownerEmail: GENESIS_OWNER,
        orgId: GENESIS_ORG,
        controlEntryId: fixture.entry.envelopeId,
        controlEntryHash: ancV1BytesToHex(
          await ancV1Hash(
            "log-entry",
            encodeSignedControlLogEntry(fixture.entry),
          ),
        ),
        signerEndpointId: GENESIS_ENDPOINT_ID,
        bootstrapTranscriptHash: "88".repeat(32),
      });
    await getDb()
      .insert(schema.contentEncryptedVaults)
      .values({
        vaultId: "92".repeat(16),
        ownerEmail: "other-account@example.com",
        orgId: "org:other-account",
        accountId: "account:other-account",
        workspaceId: "workspace:other-account",
        vaultState: "active",
      });
    const otherAccountTime = new Date();
    const otherAccount = await createEndpointRequestProof({
      vaultId: "92".repeat(16),
      endpointId: GENESIS_ENDPOINT_ID,
      method: "POST",
      path: "/api/private-vault/control-log/append",
      body: fixture.body,
      issuedAt: otherAccountTime.toISOString(),
      nonce: "31".repeat(16),
      signingPrivateKey: fixture.signing.privateKey,
    });
    await expect(
      appendGenesis({
        body: fixture.body,
        proof: otherAccount,
        now: new Date(otherAccountTime.getTime() + 500),
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });

    const rotationTypeBody = encodeAncV1ControlLogRotationAppendRequest({
      version: 1,
      suite: "anc/v1",
      type: "control-log-rotation-append-request",
      signedEntry: Uint8Array.from(encodeSignedControlLogEntry(fixture.entry)),
      recoveryWrap: Uint8Array.from(fixture.recoveryWrap),
    });
    await expect(
      appendGenesis({
        body: rotationTypeBody,
        proof: missing.proof,
        now: missing.now,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultControlLogEntries),
    ).toHaveLength(0);
  });

  it("rejects a recovery wrap whose signed bytes no longer match the admitted genesis", async () => {
    const fixture = await buildGenesisFixture();
    const tamperedWrap = Uint8Array.from(fixture.recoveryWrap);
    tamperedWrap[tamperedWrap.length - 1] ^= 0x80;
    const body = encodeAncV1ControlLogGenesisAppendRequest({
      version: 1,
      suite: "anc/v1",
      type: "control-log-genesis-append-request",
      signedEntry: Uint8Array.from(encodeSignedControlLogEntry(fixture.entry)),
      recoveryWrap: tamperedWrap,
    });
    const requestTime = new Date();
    const proof = await createEndpointRequestProof({
      vaultId: GENESIS_VAULT_ID,
      endpointId: GENESIS_ENDPOINT_ID,
      method: "POST",
      path: "/api/private-vault/control-log/append",
      body,
      issuedAt: requestTime.toISOString(),
      nonce: "71".repeat(16),
      signingPrivateKey: fixture.signing.privateKey,
    });
    await expect(
      appendGenesis({
        body,
        proof,
        now: new Date(requestTime.getTime() + 500),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultControlLogEntries),
    ).toHaveLength(0);
  });

  it("rolls back every SQL projection when the admitted endpoint coordinate conflicts", async () => {
    const fixture = await buildGenesisFixture();
    await getDb()
      .insert(schema.contentEncryptedVaults)
      .values({
        vaultId: "91".repeat(16),
        ownerEmail: "other-endpoint-owner@example.com",
        orgId: "org:other-endpoint",
        accountId: "account:other-endpoint",
        workspaceId: "workspace:other-endpoint",
        vaultState: "active",
      });
    await getDb()
      .insert(schema.contentEncryptedVaultEndpoints)
      .values({
        endpointId: GENESIS_ENDPOINT_ID,
        vaultId: "91".repeat(16),
        ownerEmail: "other-endpoint-owner@example.com",
        orgId: "org:other-endpoint",
        endpointState: "online",
        publicIdentityJson: JSON.stringify({
          algorithmId: "anc/v1",
          publicIdentity: "conflicting-public-identity",
        }),
        healthState: "healthy",
      });
    const attempt = await fixture.makeProof(40);
    await expect(
      appendGenesis({ body: fixture.body, ...attempt }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultControlLogEntries),
    ).toHaveLength(0);
    expect(
      await getDb().select().from(schema.contentEncryptedVaultControlHeads),
    ).toHaveLength(0);
    expect(
      await getDb().select().from(schema.contentEncryptedVaultRecoveryWraps),
    ).toHaveLength(0);
    expect(
      await getDb()
        .select()
        .from(schema.contentEncryptedVaultCiphertextStaging),
    ).toHaveLength(0);
  });

  it("refuses to acknowledge a committed edge after exact blob readback diverges", async () => {
    const fixture = await buildGenesisFixture();
    const first = await fixture.makeProof(50);
    await appendGenesis({ body: fixture.body, ...first });
    const coordinate = JSON.stringify({
      kind: "recovery-wrap",
      vaultId: GENESIS_VAULT_ID,
      recoveryWrapHash: fixture.recoveryWrapHash,
    });
    blobs.set(
      coordinate,
      new Uint8Array(fixture.recoveryWrap.byteLength).fill(9),
    );
    const retry = await fixture.makeProof(51);
    await expect(
      appendGenesis({ body: fixture.body, ...retry }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

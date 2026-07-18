import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPublicEvidence = vi.hoisted(() => vi.fn());
const verifyEndpointProof = vi.hoisted(() => vi.fn());
const putCiphertext = vi.hoisted(() => vi.fn());
const readCiphertext = vi.hoisted(() => vi.fn());
const stage = vi.hoisted(() => vi.fn());
const commitStage = vi.hoisted(() => vi.fn());
const append = vi.hoisted(() => vi.fn());
const loadState = vi.hoisted(() => vi.fn());
const loadEntry = vi.hoisted(() => vi.fn());
const claimRequestNonce = vi.hoisted(() => vi.fn());
const wrapBindings = vi.hoisted(() => [] as Record<string, unknown>[]);
const evidenceBindings = vi.hoisted(() => [] as Record<string, unknown>[]);
const nonceClaims = vi.hoisted(() => [] as Record<string, unknown>[]);
const storedBytes = vi.hoisted(() => new Map<string, Uint8Array>());

vi.mock("@agent-native/core/e2ee", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/e2ee")>();
  return {
    ...original,
    hashAncV1RecoveryWrap: async () =>
      Uint8Array.from({ length: 32 }, () => 0xaa),
    verifyAncV1RecoveryAuthorizationPublicEvidence: (...args: unknown[]) =>
      verifyPublicEvidence(...args),
    verifyEndpointRequestProofWithIdentity: (...args: unknown[]) =>
      verifyEndpointProof(...args),
  };
});

vi.mock("@agent-native/core/protected-ciphertext", () => ({
  putProtectedCiphertext: (...args: unknown[]) => putCiphertext(...args),
  readProtectedCiphertextAt: (...args: unknown[]) => readCiphertext(...args),
}));

vi.mock("./private-vault-ciphertext-staging.js", () => ({
  privateVaultCiphertextStagingService: { stage },
  commitPrivateVaultCiphertextStageInTransaction: (...args: unknown[]) =>
    commitStage(...args),
}));

vi.mock("./private-vault-control-log-runtime.js", () => ({
  resolveActivePrivateVaultControlScope: async () => ({
    ownerEmail: "owner@example.test",
    orgId: "org-recovery",
    vaultId: "11".repeat(16),
  }),
  authorizePrivateVaultGenesisCandidate: vi.fn(),
  privateVaultControlLogService: {
    append,
    loadVerifiedState: loadState,
    loadVerifiedEntry: loadEntry,
  },
}));

vi.mock("./private-vault-endpoint-request-nonces.js", () => ({
  sqlPrivateVaultEndpointRequestNonceStore: {
    claimAuthorizedControlRequest: (...args: unknown[]) =>
      claimRequestNonce(...args),
  },
}));

vi.mock("../db/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/index.js")>();
  const rowsFor = (table: unknown) =>
    table === original.schema.contentEncryptedVaultRecoveryWraps
      ? wrapBindings
      : table === original.schema.contentEncryptedVaultControlEvidence
        ? evidenceBindings
        : table === original.schema.contentEncryptedVaultRecoveryNonceClaims
          ? nonceClaims
          : [];
  return {
    ...original,
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({ limit: async () => rowsFor(table) }),
        }),
      }),
    }),
  };
});

import {
  ancV1BytesToHex,
  ancV1SigningKeypairFromSeed,
  createSignedControlLogEntry,
  decodeAncV1RecoveryControlEvidence,
  encodeAncV1ControlLogRecoveryAppendRequest,
  encodeSignedControlLogEntry,
} from "@agent-native/core/e2ee";

import { schema } from "../db/index.js";
import { appendPrivateVaultControlLogRecovery } from "./private-vault-control-log-append.js";

const vaultId = "11".repeat(16);
const oldEndpointId = "22".repeat(16);
const newEndpointId = "33".repeat(16);
const oldHead = "44".repeat(32);
const oldMembership = "55".repeat(32);
const replacementWrapHash = "aa".repeat(32);
const state = {
  vaultId,
  sequence: 0,
  headHash: oldHead,
  membershipHash: oldMembership,
  signedAt: "2026-07-18T12:00:00.000Z",
  activeMembers: [
    {
      endpointId: oldEndpointId,
      role: "endpoint" as const,
      unattended: false,
      signingPublicKey: "66".repeat(32),
      keyAgreementPublicKey: "77".repeat(32),
      enrollmentRef: "88".repeat(16),
    },
  ],
  removedEndpointIds: [],
  epoch: 1,
  recoveryGeneration: 1,
  recoveryId: "99".repeat(16),
  recoverySigningPublicKey: "ab".repeat(32),
  recoveryKeyAgreementPublicKey: "bc".repeat(32),
  recoveryWrapHash: "cd".repeat(32),
  freshnessMode: "endpoint_witnessed" as const,
};

async function recoveryRequest() {
  const signing = await ancV1SigningKeypairFromSeed(
    Uint8Array.from({ length: 32 }, () => 0x31),
  );
  const member = {
    endpointId: newEndpointId,
    role: "endpoint" as const,
    unattended: false,
    signingPublicKey: ancV1BytesToHex(signing.publicKey),
    keyAgreementPublicKey: "de".repeat(32),
    enrollmentRef: "ef".repeat(16),
  };
  const entry = await createSignedControlLogEntry({
    vaultId,
    createdAt: "2026-07-18T12:01:00.000Z",
    envelopeId: "12".repeat(16),
    sequence: 1,
    previousHash: oldHead,
    signerEndpointId: newEndpointId,
    signingPrivateKey: signing.privateKey,
    innerEnvelope: {
      suite: "anc/v1",
      type: "membership_commit",
      vaultId,
      ceremonyId: "13".repeat(16),
      ceremonyKind: "recovery",
      epoch: 2,
      previousMembershipHash: oldMembership,
      activeMembers: [member],
      removedEndpointIds: [oldEndpointId],
      rotationCompleted: true,
      outstandingJobsResolved: false,
      recoverySnapshotHash: "14".repeat(32),
      recoveryAuthorizationHash: "15".repeat(32),
      recoveryGeneration: 2,
      recoveryId: "16".repeat(16),
      recoverySigningPublicKey: "17".repeat(32),
      recoveryKeyAgreementPublicKey: "18".repeat(32),
      recoveryWrapHash: replacementWrapHash,
    },
  });
  const recoveryWrap = Uint8Array.of(1, 2, 3);
  const currentSnapshot = Uint8Array.of(4, 5);
  const recoveryAuthorization = Uint8Array.of(6, 7, 8);
  return {
    entry,
    member,
    recoveryWrap,
    currentSnapshot,
    recoveryAuthorization,
    body: encodeAncV1ControlLogRecoveryAppendRequest({
      version: 1,
      suite: "anc/v1",
      type: "control-log-recovery-append-request",
      signedEntry: Uint8Array.from(encodeSignedControlLogEntry(entry)),
      recoveryWrap,
      currentSnapshot,
      recoveryAuthorization,
    }),
  };
}

describe("Private Vault recovery append orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wrapBindings.splice(0);
    evidenceBindings.splice(0);
    nonceClaims.splice(0);
    storedBytes.clear();
    loadState.mockResolvedValue(state);
    claimRequestNonce.mockResolvedValue(true);
    stage
      .mockResolvedValueOnce({ stageId: "wrap-stage" })
      .mockResolvedValueOnce({ stageId: "evidence-stage" });
    putCiphertext.mockImplementation(async ({ coordinate, ciphertext }) => {
      storedBytes.set(JSON.stringify(coordinate), Uint8Array.from(ciphertext));
      return { created: true, byteLength: ciphertext.byteLength };
    });
    readCiphertext.mockImplementation(async (coordinate) => {
      if (
        coordinate.kind === "recovery-wrap" &&
        coordinate.recoveryWrapHash === state.recoveryWrapHash
      ) {
        return { ciphertext: Uint8Array.of(9), byteLength: 1 };
      }
      const ciphertext = storedBytes.get(JSON.stringify(coordinate));
      if (!ciphertext) throw new Error("missing bytes");
      return { ciphertext, byteLength: ciphertext.byteLength };
    });
  });

  it("authenticates, stages, and atomically binds both recovery artifacts", async () => {
    const request = await recoveryRequest();
    verifyPublicEvidence.mockImplementation(async (_authorization, options) => {
      await options.isConfirmationNonceAvailable({
        vaultId,
        ceremonyId: "13".repeat(16),
        confirmationEnvelopeId: "19".repeat(16),
        confirmationNonce: Uint8Array.from({ length: 32 }, () => 0x20),
        priorRecoveryGeneration: 1,
        replacementRecoveryGeneration: 2,
      });
      return {
        expectedCurrent: {
          vaultId,
          sequence: 0,
          headHash: oldHead,
          membershipHash: oldMembership,
          epoch: 1,
          recoveryGeneration: 1,
          recoveryId: state.recoveryId,
          recoveryWrapHash: state.recoveryWrapHash,
        },
        next: {
          epoch: 2,
          recoveryGeneration: 2,
          recoveryId: "16".repeat(16),
          recoverySigningPublicKey: "17".repeat(32),
          recoveryKeyAgreementPublicKey: "18".repeat(32),
          recoveryWrapHash: replacementWrapHash,
          soleEndpointId: newEndpointId,
          soleEndpointSigningPublicKey: request.member.signingPublicKey,
          soleEndpointKeyAgreementPublicKey:
            request.member.keyAgreementPublicKey,
          removedEndpointIds: [oldEndpointId],
        },
        consumedAuthority: {
          recoveryGeneration: 1,
          recoveryId: state.recoveryId,
        },
      };
    });
    verifyEndpointProof.mockResolvedValue({ endpointId: newEndpointId });
    append.mockImplementation(async (_scope, options) => {
      expect(
        await options.verifyRecoveryAuthorization({ current: state }),
      ).toBe(true);
      const tx = {
        insert: (table: unknown) => ({
          values: async (values: Record<string, unknown>) => {
            if (table === schema.contentEncryptedVaultRecoveryWraps) {
              wrapBindings.push(values);
            } else if (table === schema.contentEncryptedVaultControlEvidence) {
              evidenceBindings.push(values);
            } else if (
              table === schema.contentEncryptedVaultRecoveryNonceClaims
            ) {
              nonceClaims.push(values);
            }
          },
        }),
        update: () => ({
          set: () => ({ where: async () => undefined }),
        }),
      };
      await options.onVerifiedAppend({
        tx,
        serverReceivedAt: "2026-07-18T12:01:01.000Z",
      });
    });
    loadEntry.mockImplementation(async () => ({
      entry: request.entry,
      state: {
        ...state,
        sequence: 1,
        headHash: "21".repeat(32),
        recoveryWrapHash: replacementWrapHash,
      },
      entryHash: "21".repeat(32),
    }));

    const receipt = await appendPrivateVaultControlLogRecovery({
      body: request.body,
      proof: {} as never,
      now: new Date("2026-07-18T12:01:01.000Z"),
    });
    expect(receipt).toBeInstanceOf(Uint8Array);
    expect(putCiphertext).toHaveBeenCalledTimes(2);
    expect(commitStage).toHaveBeenCalledTimes(2);
    expect(wrapBindings).toHaveLength(1);
    expect(evidenceBindings).toHaveLength(1);
    expect(nonceClaims).toHaveLength(1);
    expect(evidenceBindings[0]).toMatchObject({
      evidenceKind: "recovery",
      evidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const evidenceEntry = [...storedBytes.entries()].find(([key]) =>
      key.includes('"kind":"control-evidence"'),
    );
    expect(evidenceEntry).toBeDefined();
    expect(decodeAncV1RecoveryControlEvidence(evidenceEntry![1])).toEqual({
      suite: "anc/v1",
      version: 1,
      type: "recovery-control-evidence",
      currentSnapshot: request.currentSnapshot,
      recoveryAuthorization: request.recoveryAuthorization,
    });
  });
});

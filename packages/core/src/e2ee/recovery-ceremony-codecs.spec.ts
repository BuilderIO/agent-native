import { describe, expect, it } from "vitest";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  createSignedControlLogEntry,
  verifyAndReduceControlLogEntry,
} from "./control-log.js";
import {
  encodeAncV1RecoverySnapshotCommitment,
  hashAncV1RecoverySnapshotCommitment,
} from "./lifecycle-codecs.js";
import {
  ancV1BoxKeypairFromSeed,
  ancV1Hash,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import {
  createAncV1RecoveryAuthorizationVerifier,
  createAncV1RecoveryWrapRotationVerifier,
  createAncV1RecoveryWrap,
  decodeAncV1RecoveryAuthorization,
  decodeAncV1RecoveryReplacementConfirmation,
  decodeAncV1RecoveryWrap,
  deriveAncV1RecoveryAuthority,
  encodeAncV1RecoveryAuthorization,
  encodeAncV1RecoveryReplacementConfirmation,
  encodeAncV1RecoveryWrap,
  hashAncV1RecoveryCandidateTranscript,
  hashAncV1RecoveryWrap,
  signAncV1RecoveryAuthorization,
  signAncV1RecoveryReplacementConfirmation,
  unsealAncV1RecoveryWrap,
  verifyAncV1RecoveryAuthorization,
  verifyAncV1RecoveryAuthorizationPublicEvidence,
  verifyAncV1RecoveryWrapRotation,
} from "./recovery-ceremony-codecs.js";
import { setAncV1RecoveryDerivationTestHook } from "./recovery-ceremony-test-hooks.js";
import { E2EE_ENVELOPE_FIELDS, E2EE_SUITE_ID } from "./suite.js";

const p = (byte: number, length: number) => new Uint8Array(length).fill(byte);
const vaultId = p(0x01, 16);
const ceremonyId = p(0x02, 16);
const candidateId = p(0x03, 16);
const authorizationId = p(0x04, 16);
const issuerId = p(0x11, 16);
const brokerId = p(0x12, 16);
const headHash = p(0x31, 32);
const membershipHash = p(0x32, 32);

async function endpointEnvelope(input: {
  transcriptHash: Uint8Array;
  recoveryId: Uint8Array;
  candidateSigningPublicKey: Uint8Array;
  candidateKeyAgreementPublicKey: Uint8Array;
  recoverySigningPrivateKey: Uint8Array;
}): Promise<Uint8Array> {
  const map = new Map<number, AncV1CanonicalValue>([
    [E2EE_ENVELOPE_FIELDS.common.suite, E2EE_SUITE_ID],
    [E2EE_ENVELOPE_FIELDS.common.vaultId, vaultId],
    [E2EE_ENVELOPE_FIELDS.common.type, "endpoint"],
    [E2EE_ENVELOPE_FIELDS.common.createdAt, 1_721_200_020],
    [E2EE_ENVELOPE_FIELDS.common.envelopeId, p(0x05, 16)],
    [E2EE_ENVELOPE_FIELDS.endpoint.endpointId, candidateId],
    [E2EE_ENVELOPE_FIELDS.endpoint.role, "desktop"],
    [E2EE_ENVELOPE_FIELDS.endpoint.unattended, false],
    [
      E2EE_ENVELOPE_FIELDS.endpoint.signingPublicKey,
      input.candidateSigningPublicKey,
    ],
    [
      E2EE_ENVELOPE_FIELDS.endpoint.keyAgreementPublicKey,
      input.candidateKeyAgreementPublicKey,
    ],
    [E2EE_ENVELOPE_FIELDS.endpoint.addedByEndpointId, input.recoveryId],
    [E2EE_ENVELOPE_FIELDS.endpoint.sasTranscriptHash, input.transcriptHash],
  ]);
  return encodeAncV1Canonical(
    new Map([
      ...map,
      [
        E2EE_ENVELOPE_FIELDS.endpoint.signature,
        await ancV1SignDetached(
          "endpoint",
          encodeAncV1Canonical(map),
          input.recoverySigningPrivateKey,
        ),
      ],
    ]),
  );
}

async function fixture(
  options: {
    currentWrapCreatedAt?: number;
    stateSignedAt?: string;
  } = {},
) {
  const currentAuthority = await deriveAncV1RecoveryAuthority({
    vaultId,
    recoveryGeneration: 1,
    argon2Root: p(0x21, 32),
  });
  const replacementAuthority = await deriveAncV1RecoveryAuthority({
    vaultId,
    recoveryGeneration: 2,
    argon2Root: p(0x22, 32),
  });
  const issuerSigning = await ancV1SigningKeypairFromSeed(p(0x23, 32));
  const issuerAgreement = await ancV1BoxKeypairFromSeed(p(0x24, 32));
  const brokerSigning = await ancV1SigningKeypairFromSeed(p(0x25, 32));
  const brokerAgreement = await ancV1BoxKeypairFromSeed(p(0x26, 32));
  const candidateSigning = await ancV1SigningKeypairFromSeed(p(0x27, 32));
  const candidateAgreement = await ancV1BoxKeypairFromSeed(p(0x28, 32));
  const eek = p(0x29, 32);
  const currentWrap = await createAncV1RecoveryWrap(
    {
      suite: E2EE_SUITE_ID,
      vaultId,
      type: "recovery-wrap",
      createdAt: options.currentWrapCreatedAt ?? 1_721_200_000,
      envelopeId: p(0x41, 16),
      ceremonyId: p(0x42, 16),
      recoveryGeneration: 1,
      recoveryId: currentAuthority.recoveryId,
      recoveryKeyAgreementPublicKey: currentAuthority.keyAgreementPublicKey,
      epoch: 2,
      issuerEndpointId: issuerId,
      activationControlSequence: 3,
      activationPreviousHead: p(0x43, 32),
      activationPreviousMembershipHash: p(0x44, 32),
      nonce: p(0x45, 24),
      eek,
    },
    {
      issuerKeyAgreementPrivateKey: issuerAgreement.privateKey,
      issuerSigningPrivateKey: issuerSigning.privateKey,
    },
  );
  const encodedCurrentWrap = encodeAncV1RecoveryWrap(currentWrap);
  const currentWrapHash = await hashAncV1RecoveryWrap(
    encodedCurrentWrap,
    vaultId,
  );
  const issuer = {
    endpointId: ancV1BytesToHex(issuerId),
    role: "endpoint" as const,
    unattended: false,
    signingPublicKey: ancV1BytesToHex(issuerSigning.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(issuerAgreement.publicKey),
    enrollmentRef: ancV1BytesToHex(p(0x51, 16)),
  };
  const broker = {
    endpointId: ancV1BytesToHex(brokerId),
    role: "broker" as const,
    unattended: true,
    signingPublicKey: ancV1BytesToHex(brokerSigning.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(brokerAgreement.publicKey),
    enrollmentRef: ancV1BytesToHex(p(0x52, 16)),
  };
  const state = {
    vaultId: ancV1BytesToHex(vaultId),
    sequence: 4,
    headHash: ancV1BytesToHex(headHash),
    membershipHash: ancV1BytesToHex(membershipHash),
    signedAt: options.stateSignedAt ?? "2024-07-17T07:06:40.000Z",
    activeMembers: [issuer, broker].sort((a, b) =>
      a.endpointId.localeCompare(b.endpointId),
    ),
    removedEndpointIds: [] as string[],
    epoch: 2,
    recoveryGeneration: 1,
    recoveryId: ancV1BytesToHex(currentAuthority.recoveryId),
    recoverySigningPublicKey: ancV1BytesToHex(
      currentAuthority.signingPublicKey,
    ),
    recoveryKeyAgreementPublicKey: ancV1BytesToHex(
      currentAuthority.keyAgreementPublicKey,
    ),
    recoveryWrapHash: ancV1BytesToHex(currentWrapHash),
    freshnessMode: "endpoint_witnessed" as const,
  };
  const snapshot = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "recovery-snapshot" as const,
    sequence: state.sequence,
    controlHeadHash: headHash,
    membershipHash,
    priorEndpointIds: [issuerId, brokerId].sort((a, b) => a[0]! - b[0]!),
  };
  const encodedSnapshot = encodeAncV1RecoverySnapshotCommitment(snapshot);
  const snapshotHash = await hashAncV1RecoverySnapshotCommitment(snapshot);
  const transcriptHash = await hashAncV1RecoveryCandidateTranscript({
    vaultId,
    ceremonyId,
    snapshotHash,
    consumedRecoveryId: currentAuthority.recoveryId,
    candidateEndpointId: candidateId,
    candidateSigningPublicKey: candidateSigning.publicKey,
    candidateKeyAgreementPublicKey: candidateAgreement.publicKey,
    targetEpoch: 3,
  });
  const candidate = await endpointEnvelope({
    transcriptHash,
    recoveryId: currentAuthority.recoveryId,
    candidateSigningPublicKey: candidateSigning.publicKey,
    candidateKeyAgreementPublicKey: candidateAgreement.publicKey,
    recoverySigningPrivateKey: currentAuthority.signingPrivateKey,
  });
  const replacementWrap = await createAncV1RecoveryWrap(
    {
      suite: E2EE_SUITE_ID,
      vaultId,
      type: "recovery-wrap",
      createdAt: 1_721_200_030,
      envelopeId: p(0x61, 16),
      ceremonyId,
      recoveryGeneration: 2,
      recoveryId: replacementAuthority.recoveryId,
      recoveryKeyAgreementPublicKey: replacementAuthority.keyAgreementPublicKey,
      epoch: 3,
      issuerEndpointId: candidateId,
      activationControlSequence: 5,
      activationPreviousHead: headHash,
      activationPreviousMembershipHash: membershipHash,
      nonce: p(0x62, 24),
      eek,
    },
    {
      issuerKeyAgreementPrivateKey: candidateAgreement.privateKey,
      issuerSigningPrivateKey: candidateSigning.privateKey,
    },
  );
  const encodedReplacementWrap = encodeAncV1RecoveryWrap(replacementWrap);
  const replacementWrapHash = await hashAncV1RecoveryWrap(
    encodedReplacementWrap,
    vaultId,
  );
  const confirmation = await signAncV1RecoveryReplacementConfirmation(
    {
      suite: E2EE_SUITE_ID,
      vaultId,
      type: "recovery-replacement-confirmation",
      createdAt: 1_721_200_040,
      envelopeId: p(0x63, 16),
      ceremonyId,
      priorRecoveryGeneration: 1,
      priorRecoveryId: currentAuthority.recoveryId,
      replacementRecoveryGeneration: 2,
      replacementRecoveryId: replacementAuthority.recoveryId,
      replacementRecoverySigningPublicKey:
        replacementAuthority.signingPublicKey,
      replacementRecoveryKeyAgreementPublicKey:
        replacementAuthority.keyAgreementPublicKey,
      replacementRecoveryWrapHash: replacementWrapHash,
      candidateEndpointId: candidateId,
      newEpoch: 3,
      confirmationNonce: p(0x64, 32),
    },
    replacementAuthority.signingPrivateKey,
  );
  const encodedConfirmation =
    encodeAncV1RecoveryReplacementConfirmation(confirmation);
  const authorization = await signAncV1RecoveryAuthorization(
    {
      suite: E2EE_SUITE_ID,
      vaultId,
      type: "recovery-authorization",
      createdAt: 1_721_200_050,
      envelopeId: authorizationId,
      ceremonyId,
      consumedRecoveryGeneration: 1,
      consumedRecoveryId: currentAuthority.recoveryId,
      consumedRecoverySigningPublicKey: currentAuthority.signingPublicKey,
      consumedRecoveryKeyAgreementPublicKey:
        currentAuthority.keyAgreementPublicKey,
      currentSnapshotHash: snapshotHash,
      consumedRecoveryWrapHash: currentWrapHash,
      candidateEndpointEnvelope: candidate,
      replacementConfirmation: encodedConfirmation,
      replacementRecoveryWrap: encodedReplacementWrap,
      newEpoch: 3,
      expiresAt: 1_721_200_650,
    },
    currentAuthority.signingPrivateKey,
  );
  const encodedAuthorization = encodeAncV1RecoveryAuthorization(authorization);
  const authorizationHash = await ancV1Hash(
    "recovery-authorization",
    encodedAuthorization,
  );
  const member = {
    endpointId: ancV1BytesToHex(candidateId),
    role: "endpoint" as const,
    unattended: false,
    signingPublicKey: ancV1BytesToHex(candidateSigning.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(candidateAgreement.publicKey),
    enrollmentRef: ancV1BytesToHex(authorizationId),
  };
  const commit = {
    suite: E2EE_SUITE_ID,
    type: "membership_commit" as const,
    vaultId: state.vaultId,
    ceremonyId: ancV1BytesToHex(ceremonyId),
    ceremonyKind: "recovery" as const,
    epoch: 3,
    previousMembershipHash: state.membershipHash,
    activeMembers: [member],
    removedEndpointIds: state.activeMembers
      .map((value) => value.endpointId)
      .sort(),
    rotationCompleted: true,
    outstandingJobsResolved: true,
    recoverySnapshotHash: ancV1BytesToHex(snapshotHash),
    recoveryAuthorizationHash: ancV1BytesToHex(authorizationHash),
    recoveryGeneration: 2,
    recoveryId: ancV1BytesToHex(replacementAuthority.recoveryId),
    recoverySigningPublicKey: ancV1BytesToHex(
      replacementAuthority.signingPublicKey,
    ),
    recoveryKeyAgreementPublicKey: ancV1BytesToHex(
      replacementAuthority.keyAgreementPublicKey,
    ),
    recoveryWrapHash: ancV1BytesToHex(replacementWrapHash),
  };
  const entry = await createSignedControlLogEntry({
    vaultId: state.vaultId,
    createdAt: "2024-07-17T07:08:00.000Z",
    envelopeId: ancV1BytesToHex(p(0x71, 16)),
    sequence: 5,
    previousHash: state.headHash,
    innerEnvelope: commit,
    signerEndpointId: member.endpointId,
    signingPrivateKey: candidateSigning.privateKey,
  });
  const verifyConsumedWrapUnseals = async ({
    issuer: verifiedIssuer,
  }: {
    issuer: { signingPublicKey: string; keyAgreementPublicKey: string };
  }) =>
    (
      await unsealAncV1RecoveryWrap(encodedCurrentWrap, {
        expectedVaultId: vaultId,
        issuerSigningPublicKey: Uint8Array.from(
          verifiedIssuer.signingPublicKey
            .match(/.{2}/g)!
            .map((value) => Number.parseInt(value, 16)),
        ),
        issuerKeyAgreementPublicKey: Uint8Array.from(
          verifiedIssuer.keyAgreementPublicKey
            .match(/.{2}/g)!
            .map((value) => Number.parseInt(value, 16)),
        ),
        recoveryKeyAgreementPrivateKey: currentAuthority.keyAgreementPrivateKey,
      })
    ).every((value, index) => value === eek[index]);
  const isConfirmationNonceAvailable = async () => true;
  return {
    currentAuthority,
    replacementAuthority,
    issuerSigning,
    issuerAgreement,
    eek,
    state,
    encodedSnapshot,
    encodedCurrentWrap,
    encodedReplacementWrap,
    encodedConfirmation,
    encodedAuthorization,
    authorization,
    commit,
    entry,
    isConfirmationNonceAvailable,
    verifyConsumedWrapUnseals,
  };
}

function mutate(
  encoded: Uint8Array,
  key: number,
  value: AncV1CanonicalValue,
): Uint8Array {
  const map = decodeAncV1Canonical(encoded) as Map<number, AncV1CanonicalValue>;
  map.set(key, value);
  return encodeAncV1Canonical(map);
}

describe("anc/v1 public-key recovery ceremony", () => {
  it("wipes temporary derived private keys on success and failure", async () => {
    const success: string[] = [];
    try {
      setAncV1RecoveryDerivationTestHook({
        observeWipedPrivateKey: (kind, bytes) => {
          expect(bytes.every((byte) => byte === 0)).toBe(true);
          success.push(kind);
        },
      });
      await deriveAncV1RecoveryAuthority({
        vaultId,
        recoveryGeneration: 7,
        argon2Root: p(0x77, 32),
      });
    } finally {
      setAncV1RecoveryDerivationTestHook(undefined);
    }
    expect(success).toEqual(["signing", "key-agreement"]);

    const failure: string[] = [];
    try {
      setAncV1RecoveryDerivationTestHook({
        afterSigningKeypair: () => {
          throw new Error("synthetic derivation cutoff");
        },
        observeWipedPrivateKey: (kind, bytes) => {
          expect(bytes.every((byte) => byte === 0)).toBe(true);
          failure.push(kind);
        },
      });
      await expect(
        deriveAncV1RecoveryAuthority({
          vaultId,
          recoveryGeneration: 8,
          argon2Root: p(0x78, 32),
        }),
      ).rejects.toThrow(/synthetic derivation cutoff/);
    } finally {
      setAncV1RecoveryDerivationTestHook(undefined);
    }
    expect(failure).toEqual(["signing"]);
  });

  it("pins authority derivation and canonical recovery artifacts", async () => {
    const value = await fixture();
    expect({
      recoveryId: ancV1BytesToHex(value.currentAuthority.recoveryId),
      signingPublicKey: ancV1BytesToHex(
        value.currentAuthority.signingPublicKey,
      ),
      keyAgreementPublicKey: ancV1BytesToHex(
        value.currentAuthority.keyAgreementPublicKey,
      ),
    }).toEqual({
      recoveryId: "ef2e47d9b92e5280f713fc9fd21a8e06",
      signingPublicKey:
        "1fb4bcac68b3b8194bb1616c604c72f21ef5f7cba5a865885c6a1ae03d3c1c9e",
      keyAgreementPublicKey:
        "5a13734fa03943f15affde19338d68d53ec88f9002723fcbe7194d1a5b573550",
    });
    expect({
      recoveryId: ancV1BytesToHex(value.replacementAuthority.recoveryId),
      signingPublicKey: ancV1BytesToHex(
        value.replacementAuthority.signingPublicKey,
      ),
      keyAgreementPublicKey: ancV1BytesToHex(
        value.replacementAuthority.keyAgreementPublicKey,
      ),
    }).toEqual({
      recoveryId: "254b6dc2de258fc18ec76cdae5b115f5",
      signingPublicKey:
        "f6fc553280bb60627925baddb606fedb5524d2b21d1fc6e90a223a452a54d0d0",
      keyAgreementPublicKey:
        "e7d54d86454273b6933d373ca045feefec4dbd01c770bb9efc69d9cec34c8a3c",
    });
    expect(
      ancV1BytesToHex(
        await ancV1Hash("recovery-wrap", value.encodedCurrentWrap),
      ),
    ).toBe("ed75c461955851d642f12fadf17eb2409105c465475ddbb6371affe0b58c23b2");
    expect(
      ancV1BytesToHex(
        await ancV1Hash(
          "recovery-replacement-confirmation",
          value.encodedConfirmation,
        ),
      ),
    ).toBe("f9e57135d175ed653bebe3156cd91fd3049670306ef0566a448ca5b78a1ac4c2");
    expect(
      ancV1BytesToHex(
        await ancV1Hash("recovery-authorization", value.encodedAuthorization),
      ),
    ).toBe("c80c5cf45de7700ee630d5405be42d5b29250b2213560623905518b21da84612");
    expect(
      decodeAncV1RecoveryWrap(value.encodedCurrentWrap, {
        expectedVaultId: vaultId,
      }),
    ).toBeDefined();
    expect(
      decodeAncV1RecoveryReplacementConfirmation(value.encodedConfirmation, {
        expectedVaultId: vaultId,
      }),
    ).toBeDefined();
    const decodedAuthorization = decodeAncV1RecoveryAuthorization(
      value.encodedAuthorization,
      { expectedVaultId: vaultId },
    );
    expect(decodedAuthorization).toEqual(value.authorization);
    expect(decodedAuthorization.consumedRecoverySigningPublicKey).toEqual(
      value.currentAuthority.signingPublicKey,
    );
    expect(decodedAuthorization.consumedRecoveryKeyAgreementPublicKey).toEqual(
      value.currentAuthority.keyAgreementPublicKey,
    );
  });

  it("verifies the projection and plugs directly into the control reducer", async () => {
    const value = await fixture();
    const projection = await verifyAncV1RecoveryAuthorization(
      value.encodedAuthorization,
      {
        currentRecoveryWrap: value.encodedCurrentWrap,
        currentSnapshot: value.encodedSnapshot,
        verifiedControlState: value.state,
        commit: value.commit,
        entry: value.entry,
        now: 1_721_200_060,
        isConfirmationNonceAvailable: value.isConfirmationNonceAvailable,
        verifyConsumedWrapUnseals: value.verifyConsumedWrapUnseals,
      },
    );
    expect(projection).toMatchObject({
      expectedCurrent: { sequence: 4, recoveryGeneration: 1 },
      next: {
        epoch: 3,
        recoveryGeneration: 2,
        soleEndpointId: ancV1BytesToHex(candidateId),
      },
    });
    await expect(
      verifyAncV1RecoveryAuthorizationPublicEvidence(
        value.encodedAuthorization,
        {
          currentRecoveryWrap: value.encodedCurrentWrap,
          currentSnapshot: value.encodedSnapshot,
          verifiedControlState: value.state,
          commit: value.commit,
          entry: value.entry,
          now: 1_721_200_060,
          isConfirmationNonceAvailable: value.isConfirmationNonceAvailable,
        },
      ),
    ).resolves.toEqual(projection);
    let preparedNonceChecks = 0;
    let preparedUnsealChecks = 0;
    const prepared = createAncV1RecoveryAuthorizationVerifier({
      encodedAuthorization: value.encodedAuthorization,
      currentRecoveryWrap: value.encodedCurrentWrap,
      currentSnapshot: value.encodedSnapshot,
      now: 1_721_200_060,
      isConfirmationNonceAvailable: async (claim) => {
        preparedNonceChecks += 1;
        return value.isConfirmationNonceAvailable(claim);
      },
      verifyConsumedWrapUnseals: async (claim) => {
        preparedUnsealChecks += 1;
        return value.verifyConsumedWrapUnseals(claim);
      },
    });
    const reduced = await verifyAndReduceControlLogEntry({
      current: value.state,
      entry: value.entry,
      verifyRecoveryAuthorization: prepared,
    });
    expect(reduced.state).toMatchObject({
      epoch: 3,
      recoveryGeneration: 2,
      activeMembers: value.commit.activeMembers,
    });
    const durable = prepared.projectNextState(reduced);
    expect(durable).toMatchObject({
      expectedCurrentState: value.state,
      nextState: reduced.state,
      entryHash: reduced.entryHash,
      recovery: { confirmationNonce: "64".repeat(32) },
    });
    expect(preparedNonceChecks).toBe(1);
    expect(preparedUnsealChecks).toBe(1);
    expect(() => prepared.projectNextState(reduced)).toThrow(/one successful/);
    await expect(
      verifyAndReduceControlLogEntry({
        current: reduced.state,
        entry: value.entry,
        verifyRecoveryAuthorization: createAncV1RecoveryAuthorizationVerifier({
          encodedAuthorization: value.encodedAuthorization,
          currentRecoveryWrap: value.encodedCurrentWrap,
          currentSnapshot: value.encodedSnapshot,
          now: 1_721_200_060,
          isConfirmationNonceAvailable: value.isConfirmationNonceAvailable,
          verifyConsumedWrapUnseals: value.verifyConsumedWrapUnseals,
        }),
      }),
    ).resolves.toMatchObject({ idempotent: true });
  });

  it("requires the exact signed recovery wrap on every ordinary epoch rotation", async () => {
    const value = await fixture();
    const rotationCeremonyId = p(0x72, 16);
    const rotationWrap = await createAncV1RecoveryWrap(
      {
        suite: E2EE_SUITE_ID,
        vaultId,
        type: "recovery-wrap",
        createdAt: 1_721_200_050,
        envelopeId: p(0x73, 16),
        ceremonyId: rotationCeremonyId,
        recoveryGeneration: value.state.recoveryGeneration,
        recoveryId: value.currentAuthority.recoveryId,
        recoveryKeyAgreementPublicKey:
          value.currentAuthority.keyAgreementPublicKey,
        epoch: value.state.epoch + 1,
        issuerEndpointId: issuerId,
        activationControlSequence: value.state.sequence + 1,
        activationPreviousHead: headHash,
        activationPreviousMembershipHash: membershipHash,
        nonce: p(0x74, 24),
        eek: value.eek,
      },
      {
        issuerKeyAgreementPrivateKey: value.issuerAgreement.privateKey,
        issuerSigningPrivateKey: value.issuerSigning.privateKey,
      },
    );
    const encodedRotationWrap = encodeAncV1RecoveryWrap(rotationWrap);
    const rotationWrapHash = await hashAncV1RecoveryWrap(
      encodedRotationWrap,
      vaultId,
    );
    const issuer = value.state.activeMembers.find(
      (member) => member.endpointId === ancV1BytesToHex(issuerId),
    )!;
    const rotationCommit = {
      suite: E2EE_SUITE_ID,
      type: "membership_commit" as const,
      vaultId: value.state.vaultId,
      ceremonyId: ancV1BytesToHex(rotationCeremonyId),
      ceremonyKind: "remove_broker" as const,
      epoch: value.state.epoch + 1,
      previousMembershipHash: value.state.membershipHash,
      activeMembers: [issuer],
      removedEndpointIds: [ancV1BytesToHex(brokerId)],
      rotationCompleted: true,
      outstandingJobsResolved: true,
      recoverySnapshotHash: null,
      recoveryAuthorizationHash: null,
      recoveryGeneration: value.state.recoveryGeneration,
      recoveryId: value.state.recoveryId,
      recoverySigningPublicKey: value.state.recoverySigningPublicKey,
      recoveryKeyAgreementPublicKey: value.state.recoveryKeyAgreementPublicKey,
      recoveryWrapHash: ancV1BytesToHex(rotationWrapHash),
    };
    const rotationEntry = await createSignedControlLogEntry({
      vaultId: value.state.vaultId,
      createdAt: new Date(1_721_200_060 * 1000).toISOString(),
      envelopeId: ancV1BytesToHex(p(0x75, 16)),
      sequence: value.state.sequence + 1,
      previousHash: value.state.headHash,
      innerEnvelope: rotationCommit,
      signerEndpointId: issuer.endpointId,
      signingPrivateKey: value.issuerSigning.privateKey,
    });
    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry: rotationEntry,
      }),
    ).rejects.toMatchObject({ code: "recovery_wrap_rotation_required" });
    await expect(
      verifyAndReduceControlLogEntry({
        current: value.state,
        entry: rotationEntry,
        verifyRecoveryWrapRotation:
          createAncV1RecoveryWrapRotationVerifier(encodedRotationWrap),
      }),
    ).resolves.toMatchObject({ state: { epoch: 3 } });
    await expect(
      verifyAncV1RecoveryWrapRotation(encodedRotationWrap, {
        current: value.state,
        commit: rotationCommit,
        entry: rotationEntry,
      }),
    ).resolves.toEqual(rotationWrap);
    await expect(
      verifyAncV1RecoveryWrapRotation(
        mutate(
          encodedRotationWrap,
          E2EE_ENVELOPE_FIELDS.recoveryWrap.nonce,
          p(0x76, 24),
        ),
        {
          current: value.state,
          commit: rotationCommit,
          entry: rotationEntry,
        },
      ),
    ).rejects.toThrow(/hash/);
  });

  it("accepts an ancient standing wrap when the authenticated head still binds it", async () => {
    const value = await fixture({ currentWrapCreatedAt: 1_700_000_000 });
    await expect(
      verifyAncV1RecoveryAuthorization(value.encodedAuthorization, {
        currentRecoveryWrap: value.encodedCurrentWrap,
        currentSnapshot: value.encodedSnapshot,
        verifiedControlState: value.state,
        commit: value.commit,
        entry: value.entry,
        now: 1_721_200_060,
        isConfirmationNonceAvailable: value.isConfirmationNonceAvailable,
        verifyConsumedWrapUnseals: value.verifyConsumedWrapUnseals,
      }),
    ).resolves.toMatchObject({ expectedCurrent: { sequence: 4 } });
  });

  it("fails closed on substitution, expiry, stale snapshots, and unseal failure", async () => {
    const value = await fixture();
    const run = (
      overrides: Partial<
        Parameters<typeof verifyAncV1RecoveryAuthorization>[1]
      > = {},
      authorization = value.encodedAuthorization,
    ) =>
      verifyAncV1RecoveryAuthorization(authorization, {
        currentRecoveryWrap: value.encodedCurrentWrap,
        currentSnapshot: value.encodedSnapshot,
        verifiedControlState: value.state,
        commit: value.commit,
        entry: value.entry,
        now: 1_721_200_060,
        isConfirmationNonceAvailable: value.isConfirmationNonceAvailable,
        verifyConsumedWrapUnseals: value.verifyConsumedWrapUnseals,
        ...overrides,
      });
    await expect(run({ now: 1_721_200_651 })).rejects.toThrow(/expired/);
    await expect(
      run({ verifyConsumedWrapUnseals: async () => false }),
    ).rejects.toThrow(/unsealed/);
    await expect(
      run({ isConfirmationNonceAvailable: async () => false }),
    ).rejects.toThrow(/nonce was already consumed/);
    await expect(
      run({
        verifiedControlState: {
          ...value.state,
          removedEndpointIds: [ancV1BytesToHex(candidateId)],
        },
      }),
    ).rejects.toThrow(/alias an active member or tombstone/);
    await expect(
      run({
        verifiedControlState: {
          ...value.state,
          signedAt: "2024-07-17T07:07:10.000Z",
        },
      }),
    ).rejects.toThrow(/timestamps are out of order/);
    await expect(
      run({
        verifiedControlState: {
          ...value.state,
          signedAt: "2024-07-17T07:06:39.000Z",
        },
      }),
    ).rejects.toThrow(/Consumed recovery wrap binding is invalid/);
    await expect(
      run({ entry: { ...value.entry, signature: "00".repeat(64) } }),
    ).rejects.toThrow(/commit signature is invalid/);
    let nonceChecks = 0;
    await expect(
      run({
        entry: { ...value.entry, signature: "00".repeat(64) },
        isConfirmationNonceAvailable: async () => {
          nonceChecks += 1;
          return true;
        },
      }),
    ).rejects.toThrow(/commit signature is invalid/);
    expect(nonceChecks).toBe(0);
    await expect(
      run({
        verifiedControlState: { ...value.state, headHash: "ff".repeat(32) },
      }),
    ).rejects.toThrow(/snapshot|wrap/i);
    await expect(
      run(
        {},
        mutate(
          value.encodedAuthorization,
          E2EE_ENVELOPE_FIELDS.recoveryAuthorization.newEpoch,
          4,
        ),
      ),
    ).rejects.toThrow();
    const replacement = mutate(
      value.encodedReplacementWrap,
      E2EE_ENVELOPE_FIELDS.recoveryWrap.recoveryId,
      p(0x99, 16),
    );
    const substituted = {
      ...value.authorization,
      replacementRecoveryWrap: replacement,
    };
    await expect(
      run({}, encodeAncV1RecoveryAuthorization(substituted)),
    ).rejects.toThrow();
  });

  it("snapshots all caller and callback values before asynchronous verification", async () => {
    const value = await fixture();
    const authorization = value.encodedAuthorization.slice();
    const currentWrap = value.encodedCurrentWrap.slice();
    const snapshot = value.encodedSnapshot.slice();
    const state = structuredClone(value.state);
    const commit = structuredClone(value.commit);
    const entry = structuredClone(value.entry);
    const pending = verifyAncV1RecoveryAuthorization(authorization, {
      currentRecoveryWrap: currentWrap,
      currentSnapshot: snapshot,
      verifiedControlState: state,
      commit,
      entry,
      now: 1_721_200_060,
      verifyConsumedWrapUnseals: async (claim) => {
        const verified = await value.verifyConsumedWrapUnseals(claim);
        claim.wrap.recoveryId.fill(0xff);
        claim.encodedWrap.fill(0xff);
        claim.issuer.endpointId = "ff".repeat(16);
        return verified;
      },
      isConfirmationNonceAvailable: async (claim) => {
        claim.confirmationNonce.fill(0xff);
        return true;
      },
    });
    authorization.fill(0);
    currentWrap.fill(0);
    snapshot.fill(0);
    state.headHash = "ff".repeat(32);
    commit.recoveryId = "ff".repeat(16);
    entry.signature = "00".repeat(64);
    await expect(pending).resolves.toMatchObject({
      expectedCurrent: { headHash: value.state.headHash },
      next: { recoveryId: value.commit.recoveryId },
    });
  });

  it("rejects unknown fields, aliases inputs by copy, and enforces exact sizes", async () => {
    const value = await fixture();
    const unknown = decodeAncV1Canonical(value.encodedCurrentWrap) as Map<
      number,
      AncV1CanonicalValue
    >;
    unknown.set(999, true);
    expect(() =>
      decodeAncV1RecoveryWrap(encodeAncV1Canonical(unknown), {
        expectedVaultId: vaultId,
      }),
    ).toThrow(/field|allowed|unknown/i);
    expect(() =>
      decodeAncV1RecoveryWrap(
        mutate(
          value.encodedCurrentWrap,
          E2EE_ENVELOPE_FIELDS.recoveryWrap.nonce,
          p(1, 23),
        ),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/24 bytes/);
    const decoded = decodeAncV1RecoveryAuthorization(
      value.encodedAuthorization,
      { expectedVaultId: vaultId },
    );
    const before = decoded.ceremonyId[0];
    value.encodedAuthorization.fill(0);
    expect(decoded.ceremonyId[0]).toBe(before);
  });
});

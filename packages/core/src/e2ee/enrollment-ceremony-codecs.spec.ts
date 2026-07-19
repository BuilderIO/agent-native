import { describe, expect, it } from "vitest";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  type ControlLogState,
  createSignedControlLogEntry,
  encodeSignedControlLogEntry,
  verifyAndReduceControlLogEntry,
} from "./control-log.js";
import {
  AncV1EnrollmentCeremonyError,
  type AncV1EnrollmentChallenge,
  type AncV1UnsignedEnrollmentSasDecision,
  type AncV1EnrollmentSasTranscript,
  type AncV1UnsignedEnrollmentAuthorization,
  type AncV1UnsignedEnrollmentChallenge,
  ancV1EnrollmentChallengeConsumptionKey,
  ancV1EnrollmentOfferLiveChallengeKey,
  assertAncV1AuthorizationRetryIsByteIdentical,
  createAncV1CandidateKeyProof,
  decodeAncV1EnrollmentAuthorization,
  decodeAncV1EnrollmentChallenge,
  decodeAncV1EnrollmentSasTranscript,
  decodeAncV1EnrollmentSasDecision,
  deriveAncV1EnrollmentSasCode,
  encodeAncV1EnrollmentAuthorization,
  encodeAncV1EnrollmentChallenge,
  encodeAncV1EnrollmentSasTranscript,
  encodeAncV1EnrollmentSasDecision,
  encodeAncV1UnsignedEnrollmentAuthorization,
  encodeAncV1UnsignedEnrollmentChallenge,
  enrollmentSasComparisonOutcome,
  hashAncV1EnrollmentChallenge,
  hashAncV1EnrollmentSasTranscript,
  signAncV1EnrollmentAuthorization,
  signAncV1EnrollmentChallenge,
  signAncV1EnrollmentSasDecision,
  verifyAncV1CandidateKeyProof,
  verifyAncV1EnrollmentAuthorization,
  verifyAncV1EnrollmentAuthorizationSignature,
  verifyAncV1EnrollmentChallenge,
  verifyAncV1EnrollmentSasDecision,
  verifyPersistedAncV1EnrollmentActivation,
} from "./enrollment-ceremony-codecs.js";
import {
  ancV1PatternBytes,
  ANC_V1_EXPECTED_VECTOR_HEX,
  buildAncV1InteroperabilityVectors,
} from "./interoperability-vectors.js";
import {
  ancV1LifecycleIdToHex,
  encodeAncV1EekWrapEnvelope,
  encodeAncV1EndpointEnrollmentOffer,
  encodeAncV1UnsignedEekWrapPreimage,
  hashAncV1EndpointEnrollmentOffer,
} from "./lifecycle-codecs.js";
import {
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import { E2EE_ENVELOPE_FIELDS, E2EE_SUITE_ID } from "./suite.js";

const p = ancV1PatternBytes;
const vaultId = p(0x01, 16);
const candidateId = p(0x03, 16);
const authorizerId = p(0x02, 16);

function map(encoded: Uint8Array): Map<number, AncV1CanonicalValue> {
  return decodeAncV1Canonical(encoded) as Map<number, AncV1CanonicalValue>;
}

function mutate(
  encoded: Uint8Array,
  key: number,
  value: AncV1CanonicalValue,
): Uint8Array {
  const decoded = map(encoded);
  decoded.set(key, value);
  return encodeAncV1Canonical(decoded);
}

async function fixture() {
  const candidate = await ancV1SigningKeypairFromSeed(p(0x12, 32));
  const authorizer = await ancV1SigningKeypairFromSeed(p(0x11, 32));
  const offer = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "enrollment-offer" as const,
    createdAt: 1_721_111_111,
    envelopeId: p(0x0e, 16),
    endpointId: candidateId,
    ceremonyId: p(0x0c, 16),
    membershipRole: "endpoint" as const,
    unattended: false,
    signingPublicKey: candidate.publicKey,
    keyAgreementPublicKey: p(0x33, 32),
    enrollmentNonce: p(0xa5, 32),
    expiresAt: 1_721_111_711,
  };
  const encodedOffer = encodeAncV1EndpointEnrollmentOffer(offer);
  const offerHash = await hashAncV1EndpointEnrollmentOffer(encodedOffer, {
    expectedVaultId: vaultId,
  });
  const candidateKeyProof = await createAncV1CandidateKeyProof(
    offerHash,
    candidate.privateKey,
  );
  const challengeBase = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "enrollment-challenge" as const,
    createdAt: 1_721_111_120,
    envelopeId: p(0x0f, 16),
    offerHash,
    candidateKeyProof,
    authorizerEndpointId: authorizerId,
    authorizerSigningPublicKey: authorizer.publicKey,
    authorizerKeyAgreementPublicKey: p(0x22, 32),
    controlSequence: 9,
    controlHeadHash: p(0x71, 32),
    membershipHash: p(0x72, 32),
    targetMembershipRole: "endpoint" as const,
    challengeNonce: p(0xa7, 32),
    expiresAt: 1_721_111_720,
  };
  const transcript: AncV1EnrollmentSasTranscript = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "enrollment-sas",
    ceremonyId: offer.ceremonyId,
    offerHash,
    candidateEndpointId: offer.endpointId,
    candidateSigningPublicKey: offer.signingPublicKey,
    candidateKeyAgreementPublicKey: offer.keyAgreementPublicKey,
    candidateKeyProof,
    authorizerEndpointId: challengeBase.authorizerEndpointId,
    authorizerSigningPublicKey: challengeBase.authorizerSigningPublicKey,
    authorizerKeyAgreementPublicKey:
      challengeBase.authorizerKeyAgreementPublicKey,
    controlSequence: challengeBase.controlSequence,
    controlHeadHash: challengeBase.controlHeadHash,
    membershipHash: challengeBase.membershipHash,
    targetMembershipRole: challengeBase.targetMembershipRole,
    challengeNonce: challengeBase.challengeNonce,
    challengeEnvelopeId: challengeBase.envelopeId,
    challengeCreatedAt: challengeBase.createdAt,
    challengeExpiresAt: challengeBase.expiresAt,
  };
  const sasTranscriptHash = await hashAncV1EnrollmentSasTranscript(transcript);
  const unsignedChallenge: AncV1UnsignedEnrollmentChallenge = {
    ...challengeBase,
    sasTranscriptHash,
  };
  const challenge = await signAncV1EnrollmentChallenge(
    unsignedChallenge,
    authorizer.privateKey,
  );
  const encodedChallenge = encodeAncV1EnrollmentChallenge(challenge);
  const state: ControlLogState = {
    vaultId: ancV1LifecycleIdToHex(vaultId),
    sequence: 9,
    headHash: "71".repeat(32),
    membershipHash: "72".repeat(32),
    signedAt: new Date(1_721_111_100 * 1000).toISOString(),
    activeMembers: [
      {
        endpointId: ancV1LifecycleIdToHex(authorizerId),
        role: "endpoint",
        unattended: false,
        signingPublicKey: ancV1BytesToHex(authorizer.publicKey),
        keyAgreementPublicKey: "22".repeat(32),
        enrollmentRef: "10".repeat(16),
      },
    ],
    removedEndpointIds: [],
    epoch: 7,
    recoveryGeneration: 1,
    recoveryId: "73".repeat(16),
    recoverySigningPublicKey: "74".repeat(32),
    recoveryKeyAgreementPublicKey: "75".repeat(32),
    recoveryWrapHash: "76".repeat(32),
    freshnessMode: "endpoint_witnessed",
  };
  const challengeHash = await hashAncV1EnrollmentChallenge(
    encodedChallenge,
    vaultId,
  );
  const component = (key: number) =>
    encodeAncV1Canonical(new Map([[key, p(key, 16)]]));
  const unsignedAuthorization: AncV1UnsignedEnrollmentAuthorization = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "enrollment-authorization",
    createdAt: 1_721_111_150,
    envelopeId: p(0x10, 16),
    offerHash,
    challengeHash,
    authorizerEndpointId: authorizerId,
    targetMembershipRole: "endpoint",
    previousControlSequence: 9,
    previousControlHeadHash: p(0x71, 32),
    previousMembershipHash: p(0x72, 32),
    endpointEnvelope: component(1),
    eekWrapEnvelope: component(2),
    signedMembershipCommit: component(3),
    expiresAt: 1_721_111_750,
  };
  const authorization = await signAncV1EnrollmentAuthorization(
    unsignedAuthorization,
    authorizer.privateKey,
  );
  return {
    candidate,
    authorizer,
    offer,
    encodedOffer,
    offerHash,
    candidateKeyProof,
    transcript,
    sasTranscriptHash,
    challenge,
    encodedChallenge,
    state,
    unsignedAuthorization,
    authorization,
    encodedAuthorization: encodeAncV1EnrollmentAuthorization(authorization),
  };
}

async function fullFixture() {
  const value = await fixture();
  const common = E2EE_ENVELOPE_FIELDS.common;
  const endpoint = E2EE_ENVELOPE_FIELDS.endpoint;
  const endpointUnsigned = new Map<number, AncV1CanonicalValue>([
    [common.suite, E2EE_SUITE_ID],
    [common.vaultId, vaultId],
    [common.type, "endpoint"],
    [common.createdAt, value.unsignedAuthorization.createdAt],
    [common.envelopeId, p(0x20, 16)],
    [endpoint.endpointId, candidateId],
    [endpoint.role, "desktop"],
    [endpoint.unattended, false],
    [endpoint.signingPublicKey, value.candidate.publicKey],
    [endpoint.keyAgreementPublicKey, value.offer.keyAgreementPublicKey],
    [endpoint.addedByEndpointId, authorizerId],
    [endpoint.sasTranscriptHash, value.sasTranscriptHash],
  ]);
  const endpointSignature = await ancV1SignDetached(
    "endpoint",
    encodeAncV1Canonical(endpointUnsigned),
    value.authorizer.privateKey,
  );
  const endpointEnvelope = encodeAncV1Canonical(
    new Map([...endpointUnsigned, [endpoint.signature, endpointSignature]]),
  );
  const unsignedEek = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "eek-wrap" as const,
    createdAt: value.unsignedAuthorization.createdAt,
    envelopeId: p(0x21, 16),
    epoch: value.state.epoch,
    recipientEndpointId: candidateId,
    issuerEndpointId: authorizerId,
    nonce: p(0x31, 24),
    ciphertext: p(0x32, 64),
  };
  const eekWrapEnvelope = encodeAncV1EekWrapEnvelope({
    ...unsignedEek,
    signature: await ancV1SignDetached(
      "eek-wrap",
      encodeAncV1UnsignedEekWrapPreimage(unsignedEek),
      value.authorizer.privateKey,
    ),
  });
  const candidateMember = {
    endpointId: ancV1LifecycleIdToHex(candidateId),
    role: "endpoint" as const,
    unattended: false,
    signingPublicKey: ancV1BytesToHex(value.candidate.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(value.offer.keyAgreementPublicKey),
    enrollmentRef: ancV1LifecycleIdToHex(
      value.unsignedAuthorization.envelopeId,
    ),
  };
  const membershipCommit = {
    suite: E2EE_SUITE_ID,
    type: "membership_commit" as const,
    vaultId: value.state.vaultId,
    ceremonyId: ancV1LifecycleIdToHex(value.offer.ceremonyId),
    ceremonyKind: "add_device" as const,
    epoch: value.state.epoch,
    previousMembershipHash: value.state.membershipHash,
    activeMembers: [...value.state.activeMembers, candidateMember],
    removedEndpointIds: [],
    rotationCompleted: false,
    outstandingJobsResolved: false,
    recoverySnapshotHash: null,
    recoveryAuthorizationHash: null,
    recoveryGeneration: value.state.recoveryGeneration,
    recoveryId: value.state.recoveryId,
    recoverySigningPublicKey: value.state.recoverySigningPublicKey,
    recoveryKeyAgreementPublicKey: value.state.recoveryKeyAgreementPublicKey,
    recoveryWrapHash: value.state.recoveryWrapHash,
  };
  const signedCommit = await createSignedControlLogEntry({
    vaultId: value.state.vaultId,
    createdAt: new Date(1_721_111_160 * 1000).toISOString(),
    envelopeId: "30".repeat(16),
    sequence: 10,
    previousHash: value.state.headHash,
    innerEnvelope: membershipCommit,
    signerEndpointId: value.state.activeMembers[0]!.endpointId,
    signingPrivateKey: value.authorizer.privateKey,
  });
  const signedMembershipCommit = encodeSignedControlLogEntry(signedCommit);
  const authorization = await signAncV1EnrollmentAuthorization(
    {
      ...value.unsignedAuthorization,
      endpointEnvelope,
      eekWrapEnvelope,
      signedMembershipCommit,
    },
    value.authorizer.privateKey,
  );
  const encodedAuthorization =
    encodeAncV1EnrollmentAuthorization(authorization);
  const commitState = (
    await verifyAndReduceControlLogEntry({
      current: value.state,
      entry: signedCommit,
    })
  ).state;
  return {
    ...value,
    endpointEnvelope,
    eekWrapEnvelope,
    signedCommit,
    signedMembershipCommit,
    authorization,
    encodedAuthorization,
    commitState,
    candidateMember,
  };
}

describe("anc/v1 enrollment ceremony canonical contracts", () => {
  it("preserves the original fourteen vectors and pins deterministic challenge/SAS/authorization bytes", async () => {
    const original = await buildAncV1InteroperabilityVectors();
    expect(Object.keys(original.vectors)).toHaveLength(14);
    expect(ancV1BytesToHex(original.vectors.recovery)).toBe(
      ANC_V1_EXPECTED_VECTOR_HEX.recovery,
    );
    const value = await fixture();
    expect(ancV1BytesToHex(value.encodedChallenge)).toBe(
      "b20166616e632f76310250010101010101010101010101010101010374656e726f6c6c6d656e742d6368616c6c656e6765041a6696125005500f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f18aa58204f4737a03a92baf7a57d46e2bc5c6a29b817daeb163c28841969d012a436f53518ab5840e26ba35d10a11dcccc1b9a36fa9fd4e191e9bdc727f7f0f5427ad2bdc447a66456c00cbdf93e22e403ef9ec2aeba492b5ec6822185f26b071dd2dc98798cd10218ac500202020202020202020202020202020218ad5820d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c977873718ae5820222222222222222222222222222222222222222222222222222222222222222218af0918b05820717171717171717171717171717171717171717171717171717171717171717118b15820727272727272727272727272727272727272727272727272727272727272727218b268656e64706f696e7418b358203efd1f28bab187e425633368ef8f649f5d6b4ab07df6aa5f23a42493f9e3ba1b18b45820a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a718b51a669614a818b65840b6690aa7a62dc3041f88c597586a9943d165f62b511567a630e5309d9494bdd22e84bbd3b296748b98083e5080ea08dd1dbef3ae00508099b6306b783a9a3500",
    );
    expect(
      ancV1BytesToHex(encodeAncV1EnrollmentSasTranscript(value.transcript)),
    ).toBe(
      "b40166616e632f7631025001010101010101010101010101010101036e656e726f6c6c6d656e742d736173190140500c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c19014158204f4737a03a92baf7a57d46e2bc5c6a29b817daeb163c28841969d012a436f53519014250030303030303030303030303030303031901435820204040e364c10f2bec9c1fe500a1cd4c247c89d650a01ed7e82caba867877c21190144582033333333333333333333333333333333333333333333333333333333333333331901455840e26ba35d10a11dcccc1b9a36fa9fd4e191e9bdc727f7f0f5427ad2bdc447a66456c00cbdf93e22e403ef9ec2aeba492b5ec6822185f26b071dd2dc98798cd10219014650020202020202020202020202020202021901475820d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737190148582022222222222222222222222222222222222222222222222222222222222222221901490919014a5820717171717171717171717171717171717171717171717171717171717171717119014b5820727272727272727272727272727272727272727272727272727272727272727219014c68656e64706f696e7419014d5820a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a719014e500f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f19014f1a669612501901501a669614a8",
    );
    expect(ancV1BytesToHex(value.encodedAuthorization)).toBe(
      "b10166616e632f7631025001010101010101010101010101010101037818656e726f6c6c6d656e742d617574686f72697a6174696f6e041a6696126e05501010101010101010101010101010101019012c58204f4737a03a92baf7a57d46e2bc5c6a29b817daeb163c28841969d012a436f53519012d582018c08a5bb9ce83b936ae78290dcaeb8dbb70101aa2a62fa6f7ca525ec8f300b619012e500202020202020202020202020202020219012f68656e64706f696e7419013009190131582071717171717171717171717171717171717171717171717171717171717171711901325820727272727272727272727272727272727272727272727272727272727272727219013353a101500101010101010101010101010101010119013453a102500202020202020202020202020202020219013553a10350030303030303030303030303030303031901361a669614c61901375840e8cf887535e53e64e4108174164224ae92b09e607ae8572c7b4e9f63b3623e4ba86f6142c01a691f6528dfbcc07e3aace5c6588e1b160e999a63d5a1e43cbc07",
    );
    expect(
      encodeAncV1EnrollmentChallenge(
        decodeAncV1EnrollmentChallenge(value.encodedChallenge, {
          expectedVaultId: vaultId,
        }),
      ),
    ).toEqual(value.encodedChallenge);
  });

  it("verifies candidate proof, active endpoint challenge signer, exact state and SAS", async () => {
    const value = await fixture();
    await expect(
      verifyAncV1CandidateKeyProof(
        value.offerHash,
        value.candidateKeyProof,
        value.candidate.publicKey,
      ),
    ).resolves.toBe(true);
    const verified = await verifyAncV1EnrollmentChallenge(
      value.encodedChallenge,
      {
        encodedOffer: value.encodedOffer,
        verifiedControlState: value.state,
        now: value.challenge.createdAt + 1,
      },
    );
    expect(verified.transcript).toEqual(value.transcript);
    expect(verified.transcriptHash).toEqual(value.sasTranscriptHash);
    expect(verified.sasCode).toMatch(/^\d{3}-\d{3}-\d{3}$/);
  });

  it("carries a candidate-signed SAS decision between devices without trusting the rendezvous", async () => {
    const value = await fixture();
    const unsigned: AncV1UnsignedEnrollmentSasDecision = {
      suite: E2EE_SUITE_ID,
      vaultId,
      type: "enrollment-sas-decision",
      createdAt: value.challenge.createdAt + 2,
      envelopeId: p(0x44, 16),
      offerHash: value.offerHash,
      challengeHash: await hashAncV1EnrollmentChallenge(
        value.encodedChallenge,
        vaultId,
      ),
      sasTranscriptHash: value.sasTranscriptHash,
      candidateEndpointId: value.offer.endpointId,
      ceremonyId: value.offer.ceremonyId,
      decision: "confirmed",
    };
    const receipt = await signAncV1EnrollmentSasDecision(
      unsigned,
      value.candidate.privateKey,
    );
    const encoded = encodeAncV1EnrollmentSasDecision(receipt);

    expect(
      encodeAncV1EnrollmentSasDecision(
        decodeAncV1EnrollmentSasDecision(encoded, {
          expectedVaultId: vaultId,
        }),
      ),
    ).toEqual(encoded);
    await expect(
      verifyAncV1EnrollmentSasDecision(encoded, {
        encodedOffer: value.encodedOffer,
        encodedChallenge: value.encodedChallenge,
        verifiedControlState: value.state,
        now: unsigned.createdAt,
      }),
    ).resolves.toMatchObject({
      receipt: { decision: "confirmed" },
    });

    const substituted = mutate(
      encoded,
      E2EE_ENVELOPE_FIELDS.enrollmentSasDecision.decision,
      "mismatch",
    );
    await expect(
      verifyAncV1EnrollmentSasDecision(substituted, {
        encodedOffer: value.encodedOffer,
        encodedChallenge: value.encodedChallenge,
        verifiedControlState: value.state,
        now: unsigned.createdAt,
      }),
    ).rejects.toThrow(/signature/);
  });

  it("rejects wrong candidate proof, offer, role, broker/removed authorizer, keys and stale state", async () => {
    const value = await fixture();
    const verify = (encoded: Uint8Array, state = value.state) =>
      verifyAncV1EnrollmentChallenge(encoded, {
        encodedOffer: value.encodedOffer,
        verifiedControlState: state,
        now: value.challenge.createdAt + 1,
      });
    await expect(
      verify(
        mutate(
          value.encodedChallenge,
          E2EE_ENVELOPE_FIELDS.enrollmentChallenge.candidateKeyProof,
          p(0xfe, 64),
        ),
      ),
    ).rejects.toThrow(/key proof/);
    await expect(
      verify(
        mutate(
          value.encodedChallenge,
          E2EE_ENVELOPE_FIELDS.enrollmentChallenge.offerHash,
          p(0xfe, 32),
        ),
      ),
    ).rejects.toThrow(/offer hash/);
    await expect(
      verify(
        mutate(
          value.encodedChallenge,
          E2EE_ENVELOPE_FIELDS.enrollmentChallenge.targetMembershipRole,
          "broker",
        ),
      ),
    ).rejects.toThrow(/role/);
    await expect(
      verify(value.encodedChallenge, {
        ...value.state,
        activeMembers: [
          {
            ...value.state.activeMembers[0]!,
            role: "broker",
            unattended: true,
          },
        ],
      }),
    ).rejects.toThrow(/active attended endpoint/);
    await expect(
      verify(value.encodedChallenge, {
        ...value.state,
        activeMembers: [],
      } as never),
    ).rejects.toThrow();
    await expect(
      verify(value.encodedChallenge, {
        ...value.state,
        activeMembers: [
          {
            ...value.state.activeMembers[0]!,
            signingPublicKey: "fe".repeat(32),
          },
        ],
      }),
    ).rejects.toThrow(/keys/);
    await expect(
      verify(value.encodedChallenge, {
        ...value.state,
        sequence: 8,
      }),
    ).rejects.toThrow(/stale/);
  });

  it("rejects invalid time, future/expired ceremonies, stale freshness and active/tombstoned candidates", async () => {
    const value = await fixture();
    const verify = (now: number, state = value.state) =>
      verifyAncV1EnrollmentChallenge(value.encodedChallenge, {
        encodedOffer: value.encodedOffer,
        verifiedControlState: state,
        now,
      });
    await expect(verify(Number.NaN)).rejects.toThrow(/now/);
    await expect(verify(value.challenge.createdAt - 1)).rejects.toThrow(
      /future-dated/,
    );
    await expect(verify(value.offer.expiresAt + 1)).rejects.toThrow(/expired/);
    await expect(
      verify(value.challenge.createdAt + 1, {
        ...value.state,
        signedAt: new Date(
          (value.challenge.createdAt - 320) * 1000,
        ).toISOString(),
      }),
    ).rejects.toThrow(/freshness/);
    const candidateMember = {
      ...value.state.activeMembers[0]!,
      endpointId: ancV1LifecycleIdToHex(candidateId),
    };
    await expect(
      verify(value.challenge.createdAt + 1, {
        ...value.state,
        activeMembers: [value.state.activeMembers[0]!, candidateMember],
      }),
    ).rejects.toThrow(/already active/);
    await expect(
      verify(value.challenge.createdAt + 1, {
        ...value.state,
        removedEndpointIds: [ancV1LifecycleIdToHex(candidateId)],
      }),
    ).rejects.toThrow(/tombstoned/);
  });

  it("uses the exact SAS transcript, unbiased display and terminal mismatch result", async () => {
    const value = await fixture();
    const encoded = encodeAncV1EnrollmentSasTranscript(value.transcript);
    expect(
      decodeAncV1EnrollmentSasTranscript(encoded, { expectedVaultId: vaultId }),
    ).toEqual(value.transcript);
    await expect(
      deriveAncV1EnrollmentSasCode(new Uint8Array(32)),
    ).resolves.toBe("000-000-000");
    const rejectionCode = await deriveAncV1EnrollmentSasCode(p(0xff, 32));
    expect(rejectionCode).toMatch(/^\d{3}-\d{3}-\d{3}$/);
    expect(enrollmentSasComparisonOutcome(false)).toBe(
      "terminally_consumed_mismatch",
    );
    expect(enrollmentSasComparisonOutcome(true)).toBe("confirmed");
  });

  it("round-trips exact signed authorization bytes and rejects signature/component/role swaps", async () => {
    const value = await fixture();
    const decoded = await verifyAncV1EnrollmentAuthorizationSignature(
      value.encodedAuthorization,
      {
        expectedVaultId: vaultId,
        expectedAuthorizerSigningPublicKey: value.authorizer.publicKey,
      },
    );
    expect(encodeAncV1EnrollmentAuthorization(decoded)).toEqual(
      value.encodedAuthorization,
    );
    await expect(
      verifyAncV1EnrollmentAuthorizationSignature(
        mutate(
          value.encodedAuthorization,
          E2EE_ENVELOPE_FIELDS.enrollmentAuthorization.endpointEnvelope,
          encodeAncV1Canonical(new Map([[1, p(0xfe, 16)]])),
        ),
        {
          expectedVaultId: vaultId,
          expectedAuthorizerSigningPublicKey: value.authorizer.publicKey,
        },
      ),
    ).rejects.toThrow(/signature/);
    expect(() =>
      decodeAncV1EnrollmentAuthorization(
        mutate(
          value.encodedAuthorization,
          E2EE_ENVELOPE_FIELDS.enrollmentAuthorization.targetMembershipRole,
          "owner",
        ),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/endpoint or broker/);
  });

  it("enforces canonical unknown/missing/oversized/copy bounds", async () => {
    const value = await fixture();
    const unknown = map(value.encodedChallenge);
    unknown.set(999, "privateKey");
    expect(() =>
      decodeAncV1EnrollmentChallenge(encodeAncV1Canonical(unknown), {
        expectedVaultId: vaultId,
      }),
    ).toThrow(/unknown key/);
    const missing = map(value.encodedChallenge);
    missing.delete(E2EE_ENVELOPE_FIELDS.enrollmentChallenge.offerHash);
    expect(() =>
      decodeAncV1EnrollmentChallenge(encodeAncV1Canonical(missing), {
        expectedVaultId: vaultId,
      }),
    ).toThrow(/missing required/);
    expect(() =>
      decodeAncV1EnrollmentChallenge(
        Uint8Array.of(0xa2, 0x01, 0x01, 0x01, 0x02),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/duplicate|canonical/i);
    expect(() =>
      encodeAncV1UnsignedEnrollmentAuthorization({
        ...value.unsignedAuthorization,
        endpointEnvelope: new Uint8Array(65_537),
      }),
    ).toThrow(/65536/);
    const decoded = decodeAncV1EnrollmentChallenge(value.encodedChallenge, {
      expectedVaultId: vaultId,
    });
    const encoded = encodeAncV1EnrollmentChallenge(decoded);
    decoded.offerHash.fill(0);
    expect(encoded).toEqual(value.encodedChallenge);
  });

  it("freezes replay keys, byte-identical retries and conflicting retry rejection", async () => {
    const value = await fixture();
    expect(
      ancV1EnrollmentOfferLiveChallengeKey(vaultId, value.offerHash),
    ).toContain(":");
    expect(
      ancV1EnrollmentChallengeConsumptionKey(
        value.challenge.envelopeId,
        value.challenge.challengeNonce,
      ),
    ).toContain(":");
    expect(() =>
      assertAncV1AuthorizationRetryIsByteIdentical(
        value.encodedAuthorization,
        value.encodedAuthorization.slice(),
      ),
    ).not.toThrow();
    const conflict = value.encodedAuthorization.slice();
    conflict[conflict.length - 1] ^= 1;
    expect(() =>
      assertAncV1AuthorizationRetryIsByteIdentical(
        value.encodedAuthorization,
        conflict,
      ),
    ).toThrow(/never re-sign/);
  });

  it("binds live authorization to the offer ceremony ID", async () => {
    const value = await fullFixture();
    await expect(
      verifyAncV1EnrollmentAuthorization(value.encodedAuthorization, {
        encodedOffer: value.encodedOffer,
        encodedChallenge: value.encodedChallenge,
        verifiedControlState: value.state,
        now: 1_721_111_170,
      }),
    ).resolves.toMatchObject({ state: value.commitState });
    const originalCommit = value.signedCommit.innerEnvelope;
    if (originalCommit.type !== "membership_commit") {
      throw new Error("fixture must contain a membership commit");
    }
    const crossCeremonyCommit = await createSignedControlLogEntry({
      vaultId: value.state.vaultId,
      createdAt: value.signedCommit.createdAt,
      envelopeId: value.signedCommit.envelopeId,
      sequence: value.signedCommit.sequence,
      previousHash: value.signedCommit.previousHash,
      innerEnvelope: {
        ...originalCommit,
        ceremonyId: "fe".repeat(16),
      },
      signerEndpointId: value.signedCommit.signerEndpointId,
      signingPrivateKey: value.authorizer.privateKey,
    });
    const { signature: _signature, ...unsigned } = value.authorization;
    const crossCeremonyAuthorization = await signAncV1EnrollmentAuthorization(
      {
        ...unsigned,
        signedMembershipCommit:
          encodeSignedControlLogEntry(crossCeremonyCommit),
      },
      value.authorizer.privateKey,
    );
    await expect(
      verifyAncV1EnrollmentAuthorization(
        encodeAncV1EnrollmentAuthorization(crossCeremonyAuthorization),
        {
          encodedOffer: value.encodedOffer,
          encodedChallenge: value.encodedChallenge,
          verifiedControlState: value.state,
          now: 1_721_111_170,
        },
      ),
    ).rejects.toThrow(/ceremony/);
  });

  it("revalidates every persisted activation component and permits later replay heads", async () => {
    const value = await fullFixture();
    const activate = (
      encodedAuthorization = value.encodedAuthorization,
      encodedChallenge = value.encodedChallenge,
      currentControlState = value.commitState,
      descendantControlEntries = [value.signedMembershipCommit],
    ) =>
      verifyPersistedAncV1EnrollmentActivation(encodedAuthorization, {
        encodedOffer: value.encodedOffer,
        encodedChallenge,
        persistedCommitControlState: value.commitState,
        currentControlState,
        descendantControlEntries,
        verifyRecoveryWrapRotation: async () => true,
        now: 1_721_111_170,
      });
    await expect(activate()).resolves.toEqual(value.authorization);
    await expect(
      activate(
        value.encodedAuthorization,
        value.encodedChallenge,
        value.commitState,
        [],
      ),
    ).rejects.toThrow(/replay/);

    const continuity = await createSignedControlLogEntry({
      vaultId: value.commitState.vaultId,
      createdAt: new Date(1_721_111_165 * 1000).toISOString(),
      envelopeId: "40".repeat(16),
      sequence: value.commitState.sequence + 1,
      previousHash: value.commitState.headHash,
      innerEnvelope: {
        suite: E2EE_SUITE_ID,
        type: "continuity_checkpoint",
        vaultId: value.commitState.vaultId,
        membershipHash: value.commitState.membershipHash,
      },
      signerEndpointId: value.state.activeMembers[0]!.endpointId,
      signingPrivateKey: value.authorizer.privateKey,
    });
    const laterState = (
      await verifyAndReduceControlLogEntry({
        current: value.commitState,
        entry: continuity,
      })
    ).state;
    await expect(
      activate(value.encodedAuthorization, value.encodedChallenge, laterState, [
        value.signedMembershipCommit,
        encodeSignedControlLogEntry(continuity),
      ]),
    ).resolves.toEqual(value.authorization);

    const laterPair = await ancV1SigningKeypairFromSeed(p(0x44, 32));
    const laterMember = {
      endpointId: "04".repeat(16),
      role: "endpoint" as const,
      unattended: false,
      signingPublicKey: ancV1BytesToHex(laterPair.publicKey),
      keyAgreementPublicKey: "45".repeat(32),
      enrollmentRef: "46".repeat(16),
    };
    const addLaterDevice = await createSignedControlLogEntry({
      vaultId: value.commitState.vaultId,
      createdAt: new Date(1_721_111_167 * 1000).toISOString(),
      envelopeId: "47".repeat(16),
      sequence: value.commitState.sequence + 1,
      previousHash: value.commitState.headHash,
      innerEnvelope: {
        suite: E2EE_SUITE_ID,
        type: "membership_commit",
        vaultId: value.commitState.vaultId,
        ceremonyId: "48".repeat(16),
        ceremonyKind: "add_device",
        epoch: value.commitState.epoch,
        previousMembershipHash: value.commitState.membershipHash,
        activeMembers: [...value.commitState.activeMembers, laterMember],
        removedEndpointIds: [],
        rotationCompleted: false,
        outstandingJobsResolved: false,
        recoverySnapshotHash: null,
        recoveryAuthorizationHash: null,
        recoveryGeneration: value.commitState.recoveryGeneration,
        recoveryId: value.commitState.recoveryId,
        recoverySigningPublicKey: value.commitState.recoverySigningPublicKey,
        recoveryKeyAgreementPublicKey:
          value.commitState.recoveryKeyAgreementPublicKey,
        recoveryWrapHash: value.commitState.recoveryWrapHash,
      },
      signerEndpointId: value.state.activeMembers[0]!.endpointId,
      signingPrivateKey: value.authorizer.privateKey,
    });
    const laterAddState = (
      await verifyAndReduceControlLogEntry({
        current: value.commitState,
        entry: addLaterDevice,
      })
    ).state;
    await expect(
      activate(
        value.encodedAuthorization,
        value.encodedChallenge,
        laterAddState,
        [
          value.signedMembershipCommit,
          encodeSignedControlLogEntry(addLaterDevice),
        ],
      ),
    ).resolves.toEqual(value.authorization);

    const divergent = await createSignedControlLogEntry({
      vaultId: value.commitState.vaultId,
      createdAt: new Date(1_721_111_166 * 1000).toISOString(),
      envelopeId: "43".repeat(16),
      sequence: value.commitState.sequence + 1,
      previousHash: value.commitState.headHash,
      innerEnvelope: {
        suite: E2EE_SUITE_ID,
        type: "continuity_checkpoint",
        vaultId: value.commitState.vaultId,
        membershipHash: value.commitState.membershipHash,
      },
      signerEndpointId: value.state.activeMembers[0]!.endpointId,
      signingPrivateKey: value.authorizer.privateKey,
    });
    await expect(
      activate(value.encodedAuthorization, value.encodedChallenge, laterState, [
        value.signedMembershipCommit,
        encodeSignedControlLogEntry(divergent),
      ]),
    ).rejects.toThrow(/exact current state/);

    const { signature: _authorizationSignature, ...unsignedAuthorization } =
      value.authorization;
    const endpointWith = async (
      field: number,
      fieldValue: AncV1CanonicalValue,
    ) => {
      const changed = map(value.endpointEnvelope);
      changed.set(field, fieldValue);
      changed.delete(E2EE_ENVELOPE_FIELDS.endpoint.signature);
      changed.set(
        E2EE_ENVELOPE_FIELDS.endpoint.signature,
        await ancV1SignDetached(
          "endpoint",
          encodeAncV1Canonical(changed),
          value.authorizer.privateKey,
        ),
      );
      const changedAuthorization = await signAncV1EnrollmentAuthorization(
        {
          ...unsignedAuthorization,
          endpointEnvelope: encodeAncV1Canonical(changed),
        },
        value.authorizer.privateKey,
      );
      return encodeAncV1EnrollmentAuthorization(changedAuthorization);
    };
    // Field 11 is only the endpoint's software kind. It cannot grant broker
    // authority; authority remains bound by offer/challenge/auth/commit role.
    await expect(
      activate(
        await endpointWith(E2EE_ENVELOPE_FIELDS.endpoint.role, "broker"),
      ),
    ).resolves.toMatchObject({ targetMembershipRole: "endpoint" });
    await expect(
      activate(
        await endpointWith(E2EE_ENVELOPE_FIELDS.endpoint.unattended, true),
      ),
    ).rejects.toThrow(/endpoint envelope/);

    const swappedEekAuthorization = await signAncV1EnrollmentAuthorization(
      {
        ...unsignedAuthorization,
        eekWrapEnvelope: mutate(
          value.eekWrapEnvelope,
          E2EE_ENVELOPE_FIELDS.eekWrap.ciphertext,
          p(0xfe, 64),
        ),
      },
      value.authorizer.privateKey,
    );
    await expect(
      activate(encodeAncV1EnrollmentAuthorization(swappedEekAuthorization)),
    ).rejects.toThrow(/EEK wrap signature/);

    const attacker = await ancV1SigningKeypairFromSeed(p(0xee, 32));
    const { signature: _challengeSignature, ...unsignedChallenge } =
      value.challenge;
    const forgedChallenge = await signAncV1EnrollmentChallenge(
      {
        ...unsignedChallenge,
        authorizerSigningPublicKey: attacker.publicKey,
      },
      attacker.privateKey,
    );
    await expect(
      activate(
        value.encodedAuthorization,
        encodeAncV1EnrollmentChallenge(forgedChallenge),
      ),
    ).rejects.toThrow(/authorizer keys/);
  });

  it("rejects late activation after removal and authorization issuance outside the challenge", async () => {
    const value = await fullFixture();
    const activate = (
      encodedAuthorization: Uint8Array,
      currentControlState = value.commitState,
      descendantControlEntries = [value.signedMembershipCommit],
    ) =>
      verifyPersistedAncV1EnrollmentActivation(encodedAuthorization, {
        encodedOffer: value.encodedOffer,
        encodedChallenge: value.encodedChallenge,
        persistedCommitControlState: value.commitState,
        currentControlState,
        descendantControlEntries,
        verifyRecoveryWrapRotation: async () => true,
        now: 1_721_111_190,
      });
    const removal = await createSignedControlLogEntry({
      vaultId: value.commitState.vaultId,
      createdAt: new Date(1_721_111_180 * 1000).toISOString(),
      envelopeId: "41".repeat(16),
      sequence: value.commitState.sequence + 1,
      previousHash: value.commitState.headHash,
      innerEnvelope: {
        suite: E2EE_SUITE_ID,
        type: "membership_commit",
        vaultId: value.commitState.vaultId,
        ceremonyId: "42".repeat(16),
        ceremonyKind: "remove_device",
        epoch: value.commitState.epoch + 1,
        previousMembershipHash: value.commitState.membershipHash,
        activeMembers: value.state.activeMembers,
        removedEndpointIds: [value.candidateMember.endpointId],
        rotationCompleted: true,
        outstandingJobsResolved: false,
        recoverySnapshotHash: null,
        recoveryAuthorizationHash: null,
        recoveryGeneration: value.commitState.recoveryGeneration,
        recoveryId: value.commitState.recoveryId,
        recoverySigningPublicKey: value.commitState.recoverySigningPublicKey,
        recoveryKeyAgreementPublicKey:
          value.commitState.recoveryKeyAgreementPublicKey,
        recoveryWrapHash: "49".repeat(32),
      },
      signerEndpointId: value.state.activeMembers[0]!.endpointId,
      signingPrivateKey: value.authorizer.privateKey,
    });
    const removedState = (
      await verifyAndReduceControlLogEntry({
        current: value.commitState,
        entry: removal,
        verifyRecoveryWrapRotation: async () => true,
      })
    ).state;
    await expect(
      activate(value.encodedAuthorization, removedState, [
        value.signedMembershipCommit,
        encodeSignedControlLogEntry(removal),
      ]),
    ).rejects.toThrow(/no longer active/);

    for (const createdAt of [
      value.challenge.createdAt - 1,
      value.challenge.expiresAt + 1,
    ]) {
      const outside = await signAncV1EnrollmentAuthorization(
        {
          ...value.unsignedAuthorization,
          createdAt,
          expiresAt: createdAt + 100,
          endpointEnvelope: value.endpointEnvelope,
          eekWrapEnvelope: value.eekWrapEnvelope,
          signedMembershipCommit: value.signedMembershipCommit,
        },
        value.authorizer.privateKey,
      );
      await expect(
        activate(encodeAncV1EnrollmentAuthorization(outside)),
      ).rejects.toThrow(/outside the ceremony lifetime/);
    }
  });
});

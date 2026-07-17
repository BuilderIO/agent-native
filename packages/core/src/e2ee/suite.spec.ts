import { describe, expect, it } from "vitest";

import {
  E2EE_CANONICAL_ENCODING,
  E2EE_DOMAIN_TAGS,
  E2EE_ENVELOPE_FIELDS,
  E2EE_LIFETIME_LIMITS_SECONDS,
  E2EE_PRIMITIVES,
  E2EE_RECOVERY_KDF,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
  e2eeDomainSeparationPrefix,
} from "./suite.js";

describe("anc/v1 suite freeze", () => {
  it("pins one non-negotiated suite and standard primitive set", () => {
    expect(E2EE_SUITE_ID).toBe("anc/v1");
    expect(E2EE_CANONICAL_ENCODING).toBe("cbor-rfc8949-deterministic");
    expect(E2EE_PRIMITIVES).toEqual({
      contentAead: "xchacha20-poly1305-ietf",
      streamAead: "secretstream-xchacha20-poly1305",
      signatures: "ed25519",
      endpointKeyAgreement: "x25519-xsalsa20-poly1305",
      hash: "blake2b-256",
      passwordHash: "argon2id",
    });
  });

  it("freezes domain separation and integer field tables", () => {
    expect(E2EE_DOMAIN_TAGS).toContain("disclosure");
    expect(E2EE_DOMAIN_TAGS).toContain("manifest");
    expect(E2EE_DOMAIN_TAGS).toContain("endpoint-request-body");
    expect(E2EE_DOMAIN_TAGS).toContain("endpoint-request");
    expect(E2EE_DOMAIN_TAGS).toContain("enrollment-key-proof");
    expect(E2EE_DOMAIN_TAGS).toContain("enrollment-challenge");
    expect(E2EE_DOMAIN_TAGS).toContain("enrollment-sas");
    expect(E2EE_DOMAIN_TAGS).toContain("enrollment-authorization");
    expect(E2EE_DOMAIN_TAGS).toContain("ceremony-abort");
    expect(E2EE_ENVELOPE_FIELDS.common).toEqual({
      suite: 1,
      vaultId: 2,
      type: 3,
      createdAt: 4,
      envelopeId: 5,
    });
    expect(E2EE_ENVELOPE_FIELDS.controlMembership).toEqual({
      ceremonyId: 140,
      ceremonyKind: 141,
      epoch: 142,
      previousMembershipHash: 143,
      activeMembers: 144,
      removedEndpointIds: 145,
      rotationCompleted: 146,
      outstandingJobsResolved: 147,
      recoverySnapshotHash: 148,
      recoveryAuthorizationHash: 149,
    });
    expect(E2EE_ENVELOPE_FIELDS.controlContinuity).toEqual({
      membershipHash: 150,
    });
    expect(E2EE_ENVELOPE_FIELDS.controlCeremonyAbort).toEqual({
      ceremonyId: 151,
      ceremonyKind: 152,
      ceremonyStateHash: 153,
      reasonCode: 154,
    });
    expect(E2EE_ENVELOPE_FIELDS.enrollmentOffer).toEqual({
      endpointId: 160,
      ceremonyId: 161,
      membershipRole: 162,
      unattended: 163,
      signingPublicKey: 164,
      keyAgreementPublicKey: 165,
      enrollmentNonce: 166,
      expiresAt: 168,
    });
    expect(E2EE_ENVELOPE_FIELDS.enrollmentChallenge).toEqual({
      offerHash: 170,
      candidateKeyProof: 171,
      authorizerEndpointId: 172,
      authorizerSigningPublicKey: 173,
      authorizerKeyAgreementPublicKey: 174,
      controlSequence: 175,
      controlHeadHash: 176,
      membershipHash: 177,
      targetMembershipRole: 178,
      sasTranscriptHash: 179,
      challengeNonce: 180,
      expiresAt: 181,
      signature: 182,
    });
    expect(E2EE_ENVELOPE_FIELDS.enrollmentAuthorization).toEqual({
      offerHash: 300,
      challengeHash: 301,
      authorizerEndpointId: 302,
      targetMembershipRole: 303,
      previousControlSequence: 304,
      previousControlHeadHash: 305,
      previousMembershipHash: 306,
      endpointEnvelope: 307,
      eekWrapEnvelope: 308,
      signedMembershipCommit: 309,
      expiresAt: 310,
      signature: 311,
    });
    expect(E2EE_ENVELOPE_FIELDS.enrollmentSas).toEqual({
      ceremonyId: 320,
      offerHash: 321,
      candidateEndpointId: 322,
      candidateSigningPublicKey: 323,
      candidateKeyAgreementPublicKey: 324,
      candidateKeyProof: 325,
      authorizerEndpointId: 326,
      authorizerSigningPublicKey: 327,
      authorizerKeyAgreementPublicKey: 328,
      controlSequence: 329,
      controlHeadHash: 330,
      membershipHash: 331,
      targetMembershipRole: 332,
      challengeNonce: 333,
      challengeEnvelopeId: 334,
      challengeCreatedAt: 335,
      challengeExpiresAt: 336,
    });
    expect(E2EE_ENVELOPE_FIELDS.ceremonyAbortState).toEqual({
      ceremonyId: 340,
      ceremonyKind: 341,
      epoch: 342,
      expectedControlSequence: 343,
      expectedControlHeadHash: 344,
      completedSteps: 345,
      alertCode: 346,
      incompleteReason: 347,
      plaintextOutstanding: 348,
      abortReason: 349,
      signerEndpointId: 350,
    });
    expect(E2EE_ENVELOPE_FIELDS.recovery).toEqual({
      salt: 200,
      opsLimit: 201,
      memLimitBytes: 202,
      nonce: 203,
      ciphertext: 204,
      recoveryGeneration: 205,
      recoveryId: 206,
      snapshotHash: 207,
      authorizationHash: 208,
    });
    expect(E2EE_ENVELOPE_FIELDS.recoverySnapshot).toEqual({
      sequence: 220,
      controlHeadHash: 221,
      membershipHash: 222,
      priorEndpointIds: 223,
    });
    expect(E2EE_RECOVERY_KDF).toEqual({
      algorithm: "argon2id",
      opsLimit: 2,
      memLimitBytes: 67_108_864,
      saltBytes: 16,
      outputBytes: 32,
    });
    expect("title" in E2EE_ENVELOPE_FIELDS.objectHeader).toBe(false);
    expect(Array.from(e2eeDomainSeparationPrefix("job"))).toEqual(
      Array.from(new TextEncoder().encode("anc/v1/job\0")),
    );
  });

  it("pins bounded payload and authorization lifetimes", () => {
    expect(E2EE_SIZE_LIMITS.chunkPlaintextBytes).toBe(1024 * 1024);
    expect(E2EE_SIZE_LIMITS.objectPlaintextBytes).toBe(256 * 1024 * 1024);
    expect(E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes).toBe(256 * 1024);
    expect(E2EE_LIFETIME_LIMITS_SECONDS).toEqual({
      internalGrantMaximum: 2_592_000,
      disclosureDefault: 86_400,
      disclosureMaximum: 604_800,
      brokerAuthorizationFreshness: 900,
    });
  });
});

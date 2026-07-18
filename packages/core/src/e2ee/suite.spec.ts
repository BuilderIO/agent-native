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
    expect(E2EE_DOMAIN_TAGS).toEqual([
      "endpoint",
      "enrollment-offer",
      "endpoint-request-body",
      "endpoint-request",
      "epoch",
      "eek-wrap",
      "dek-wrap",
      "object-header",
      "chunk",
      "grant",
      "grant-revoke",
      "disclosure",
      "job",
      "result",
      "log-entry",
      "manifest",
      "recovery",
      "tombstone",
      "enrollment-key-proof",
      "enrollment-challenge",
      "enrollment-sas",
      "enrollment-authorization",
      "genesis-recovery-confirmation",
      "genesis-authorization",
      "genesis-bootstrap-transcript",
      "genesis-hosted-append-receipt",
      "recovery-wrap",
      "recovery-replacement-confirmation",
      "recovery-authorization",
      "recovery-authority",
      "ceremony-abort",
    ]);
    expect(new Set(E2EE_DOMAIN_TAGS).size).toBe(E2EE_DOMAIN_TAGS.length);
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
      recoveryGeneration: 155,
      recoveryId: 156,
      recoverySigningPublicKey: 157,
      recoveryKeyAgreementPublicKey: 158,
      recoveryWrapHash: 159,
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
    expect(E2EE_ENVELOPE_FIELDS.genesisRecoveryConfirmation).toEqual({
      ceremonyId: 360,
      endpointId: 361,
      recoveryId: 362,
      recoverySigningPublicKey: 363,
      recoveryKeyAgreementPublicKey: 364,
      recoveryWrapHash: 365,
      confirmedAt: 366,
      recoveryGeneration: 367,
    });
    expect(E2EE_ENVELOPE_FIELDS.genesisAuthorization).toEqual({
      ceremonyId: 370,
      endpointId: 371,
      epoch: 372,
      endpointEnvelope: 373,
      recoveryConfirmation: 374,
      signedGenesisCommit: 375,
      signature: 376,
    });
    expect(E2EE_ENVELOPE_FIELDS.genesisBootstrapTranscript).toEqual({
      ceremonyId: 380,
      endpointId: 381,
      endpointSigningPublicKey: 382,
      endpointKeyAgreementPublicKey: 383,
      enrollmentRef: 384,
      recoveryId: 385,
      recoverySigningPublicKey: 386,
      recoveryKeyAgreementPublicKey: 387,
      recoveryGeneration: 388,
      epoch: 389,
      recoveryWrapHash: 390,
      recoveryConfirmationHash: 391,
    });
    expect(E2EE_ENVELOPE_FIELDS.recoveryWrap).toEqual({
      ceremonyId: 400,
      recoveryGeneration: 401,
      recoveryId: 402,
      recoveryKeyAgreementPublicKey: 403,
      epoch: 404,
      issuerEndpointId: 405,
      activationControlSequence: 406,
      activationPreviousHead: 407,
      activationPreviousMembershipHash: 408,
      nonce: 409,
      ciphertext: 410,
      signature: 411,
    });
    expect(E2EE_ENVELOPE_FIELDS.recoveryReplacementConfirmation).toEqual({
      ceremonyId: 420,
      priorRecoveryGeneration: 421,
      priorRecoveryId: 422,
      replacementRecoveryGeneration: 423,
      replacementRecoveryId: 424,
      replacementRecoverySigningPublicKey: 425,
      replacementRecoveryKeyAgreementPublicKey: 426,
      replacementRecoveryWrapHash: 427,
      candidateEndpointId: 428,
      newEpoch: 429,
      confirmationNonce: 430,
      signature: 431,
    });
    expect(E2EE_ENVELOPE_FIELDS.recoveryAuthorization).toEqual({
      ceremonyId: 440,
      consumedRecoveryGeneration: 441,
      consumedRecoveryId: 442,
      consumedRecoverySigningPublicKey: 443,
      consumedRecoveryKeyAgreementPublicKey: 444,
      currentSnapshotHash: 445,
      consumedRecoveryWrapHash: 446,
      candidateEndpointEnvelope: 447,
      replacementConfirmation: 448,
      replacementRecoveryWrap: 449,
      newEpoch: 450,
      expiresAt: 451,
      signature: 452,
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
    expect(E2EE_ENVELOPE_FIELDS.result).toEqual({
      jobId: 100,
      jobHash: 101,
      recipientEndpointId: 102,
      ciphertext: 103,
      signature: 104,
      state: 105,
    });
    expect(E2EE_RECOVERY_KDF).toEqual({
      algorithm: "argon2id",
      inputForm: "bip39-24-word-entropy",
      inputBytes: 32,
      saltSource: "vaultId",
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
    expect(E2EE_SIZE_LIMITS.jobPayloadBytes).toBe(16 * 1024 * 1024);
    expect(E2EE_SIZE_LIMITS.resultPayloadBytes).toBe(16 * 1024 * 1024);
    expect(E2EE_SIZE_LIMITS.jobEnvelopeBytes).toBe(
      E2EE_SIZE_LIMITS.jobPayloadBytes + 64 * 1024,
    );
    expect(E2EE_SIZE_LIMITS.resultEnvelopeBytes).toBe(
      E2EE_SIZE_LIMITS.resultPayloadBytes + 64 * 1024,
    );
    expect(E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes).toBe(256 * 1024);
    expect(E2EE_SIZE_LIMITS.genesisBootstrapTranscriptBytes).toBe(4 * 1024);
    expect(E2EE_LIFETIME_LIMITS_SECONDS).toEqual({
      internalGrantMaximum: 2_592_000,
      disclosureDefault: 86_400,
      disclosureMaximum: 604_800,
      brokerAuthorizationFreshness: 900,
    });
  });
});

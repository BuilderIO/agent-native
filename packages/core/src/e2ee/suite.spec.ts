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
    expect(E2EE_LIFETIME_LIMITS_SECONDS).toEqual({
      internalGrantMaximum: 2_592_000,
      disclosureDefault: 86_400,
      disclosureMaximum: 604_800,
      brokerAuthorizationFreshness: 900,
    });
  });
});

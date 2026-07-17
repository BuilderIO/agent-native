import { describe, expect, it } from "vitest";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import type { ControlLogMember } from "./control-log.js";
import {
  ANC_V1_EXPECTED_ENROLLMENT_OFFER_HEX,
  ANC_V1_EXPECTED_LIFECYCLE_RECOVERY_HEX,
  ANC_V1_EXPECTED_VECTOR_HEX,
  ancV1PatternBytes,
  buildAncV1InteroperabilityVectors,
} from "./interoperability-vectors.js";
import {
  ANC_V1_ENROLLMENT_OFFER_AUTHORIZATION,
  AncV1LifecycleEnvelopeError,
  ancV1EnrollmentOfferToControlLogMember,
  ancV1LifecycleIdFromHex,
  ancV1LifecycleIdToHex,
  assertAncV1RecoverySnapshotAuthority,
  decodeAncV1EekWrapEnvelope,
  decodeAncV1EndpointEnrollmentOffer,
  decodeAncV1RecoveryEnvelope,
  decodeAncV1RecoverySnapshotCommitment,
  encodeAncV1EekWrapEnvelope,
  encodeAncV1EndpointEnrollmentOffer,
  encodeAncV1RecoveryEnvelope,
  encodeAncV1RecoverySnapshotCommitment,
  encodeAncV1UnsignedEekWrapPreimage,
  hashAncV1EndpointEnrollmentOffer,
  hashAncV1RecoverySnapshotCommitment,
  verifyAncV1EekWrapEnvelope,
} from "./lifecycle-codecs.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_RECOVERY_KDF,
  E2EE_SUITE_ID,
} from "./suite.js";

const pattern = ancV1PatternBytes;
const vaultId = pattern(0x01, 16);
const issuerId = pattern(0x02, 16);
const recipientId = pattern(0x03, 16);
const recoveryId = pattern(0x0b, 16);
const snapshotHash = pattern(0xa3, 32);
const authorizationHash = pattern(0xa4, 32);

function asMap(encoded: Uint8Array): Map<number, AncV1CanonicalValue> {
  return decodeAncV1Canonical(encoded) as Map<number, AncV1CanonicalValue>;
}

function mutate(
  encoded: Uint8Array,
  key: number,
  value: AncV1CanonicalValue,
): Uint8Array {
  const map = asMap(encoded);
  map.set(key, value);
  return encodeAncV1Canonical(map);
}

const eekBinding = {
  expectedVaultId: vaultId,
  expectedRecipientEndpointId: recipientId,
  expectedIssuerEndpointId: issuerId,
  expectedEpoch: 7,
};

const recoveryBinding = {
  expectedVaultId: vaultId,
  expectedRecoveryId: recoveryId,
  expectedRecoveryGeneration: 2,
  expectedSnapshotHash: snapshotHash,
  expectedAuthorizationHash: authorizationHash,
};

function member(idByte: number, role: "endpoint" | "broker"): ControlLogMember {
  return {
    endpointId: ancV1LifecycleIdToHex(pattern(idByte, 16)),
    role,
    unattended: role === "broker",
    signingPublicKey: "11".repeat(32),
    keyAgreementPublicKey: "22".repeat(32),
    enrollmentRef: "33".repeat(32),
  };
}

describe("anc/v1 lifecycle canonical codecs", () => {
  it("preserves the original fourteen-vector recovery bytes exactly and pins separate lifecycle vectors", async () => {
    const { vectors, lifecycleVectors } =
      await buildAncV1InteroperabilityVectors();
    expect(Object.keys(ANC_V1_EXPECTED_VECTOR_HEX)).toHaveLength(14);
    expect(ancV1BytesToHex(vectors.recovery)).toBe(
      "aa0166616e632f763102500101010101010101010101010101010103687265636f76657279041a6696124705501c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c18c850a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a118c90218ca1a0400000018cb5818a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a218cc58305ce632d2360829235eb57c373940cebcb1e29b3b32beedabe10c3f3e7097ae61b634d5bcc16a27e5361a258bccce62df",
    );
    expect(ancV1BytesToHex(vectors.recovery)).toBe(
      ANC_V1_EXPECTED_VECTOR_HEX.recovery,
    );
    expect(ancV1BytesToHex(lifecycleVectors.enrollmentOffer)).toBe(
      ANC_V1_EXPECTED_ENROLLMENT_OFFER_HEX,
    );
    expect(ancV1BytesToHex(lifecycleVectors.recovery)).toBe(
      ANC_V1_EXPECTED_LIFECYCLE_RECOVERY_HEX,
    );
    expect(() =>
      decodeAncV1RecoveryEnvelope(vectors.recovery, recoveryBinding),
    ).toThrow(/missing required/);
  });

  it("round-trips and hashes the unsigned public enrollment offer without an enrollmentRef", async () => {
    const { lifecycleVectors } = await buildAncV1InteroperabilityVectors();
    const offer = decodeAncV1EndpointEnrollmentOffer(
      lifecycleVectors.enrollmentOffer,
      {
        expectedVaultId: vaultId,
      },
    );
    expect(offer.membershipRole).toBe("endpoint");
    expect("enrollmentRef" in offer).toBe(false);
    expect(encodeAncV1EndpointEnrollmentOffer(offer)).toEqual(
      lifecycleVectors.enrollmentOffer,
    );
    await expect(
      hashAncV1EndpointEnrollmentOffer(lifecycleVectors.enrollmentOffer, {
        expectedVaultId: vaultId,
      }),
    ).resolves.toHaveLength(32);
    expect(ANC_V1_ENROLLMENT_OFFER_AUTHORIZATION.signed).toBe(false);
  });

  it("converts a validated offer to ControlLogMember with a separate authoritative authorization ref", async () => {
    const { lifecycleVectors } = await buildAncV1InteroperabilityVectors();
    const offer = decodeAncV1EndpointEnrollmentOffer(
      lifecycleVectors.enrollmentOffer,
      {
        expectedVaultId: vaultId,
      },
    );
    const converted = ancV1EnrollmentOfferToControlLogMember(
      offer,
      pattern(0xa6, 16),
    );
    expect(converted).toEqual({
      endpointId: "03".repeat(16),
      role: "endpoint",
      unattended: false,
      signingPublicKey: ancV1BytesToHex(offer.signingPublicKey),
      keyAgreementPublicKey: ancV1BytesToHex(offer.keyAgreementPublicKey),
      enrollmentRef: "a6".repeat(16),
    });
    expect(() =>
      ancV1EnrollmentOfferToControlLogMember(offer, pattern(1, 15)),
    ).toThrow(/16 bytes/);
  });

  it("exports the exact unsigned EEK preimage and verifies all authority bindings", async () => {
    const { vectors, materials } = await buildAncV1InteroperabilityVectors();
    const decoded = await verifyAncV1EekWrapEnvelope(vectors["eek-wrap"], {
      ...eekBinding,
      expectedIssuerSigningPublicKey: materials.signingPublicKey,
    });
    const { signature: _signature, ...unsigned } = decoded;
    expect(encodeAncV1UnsignedEekWrapPreimage(unsigned)).toEqual(
      encodeAncV1Canonical(
        new Map(
          [...asMap(vectors["eek-wrap"])].filter(
            ([key]) => key !== E2EE_ENVELOPE_FIELDS.eekWrap.signature,
          ),
        ),
      ),
    );
    expect(encodeAncV1EekWrapEnvelope(decoded)).toEqual(vectors["eek-wrap"]);
  });

  it("rejects wrong EEK issuer, epoch, ciphertext, recipient, and swapped signature", async () => {
    const { vectors, materials } = await buildAncV1InteroperabilityVectors();
    expect(() =>
      decodeAncV1EekWrapEnvelope(vectors["eek-wrap"], {
        ...eekBinding,
        expectedIssuerEndpointId: pattern(0xfe, 16),
      }),
    ).toThrow(/issuer binding/);
    expect(() =>
      decodeAncV1EekWrapEnvelope(vectors["eek-wrap"], {
        ...eekBinding,
        expectedEpoch: 8,
      }),
    ).toThrow(/epoch binding/);
    expect(() =>
      decodeAncV1EekWrapEnvelope(vectors["eek-wrap"], {
        ...eekBinding,
        expectedRecipientEndpointId: pattern(0xfe, 16),
      }),
    ).toThrow(/recipient binding/);
    const ciphertext = asMap(vectors["eek-wrap"]).get(
      E2EE_ENVELOPE_FIELDS.eekWrap.ciphertext,
    ) as Uint8Array;
    await expect(
      verifyAncV1EekWrapEnvelope(
        mutate(
          vectors["eek-wrap"],
          E2EE_ENVELOPE_FIELDS.eekWrap.ciphertext,
          Uint8Array.from(ciphertext, (byte, index) =>
            index === 0 ? byte ^ 1 : byte,
          ),
        ),
        {
          ...eekBinding,
          expectedIssuerSigningPublicKey: materials.signingPublicKey,
        },
      ),
    ).rejects.toThrow(/signature/);
    await expect(
      verifyAncV1EekWrapEnvelope(vectors["eek-wrap"], {
        ...eekBinding,
        expectedIssuerSigningPublicKey: pattern(0xfe, 32),
      }),
    ).rejects.toThrow(/signature/);
    const endpointSignature = asMap(vectors.endpoint).get(
      E2EE_ENVELOPE_FIELDS.endpoint.signature,
    )!;
    await expect(
      verifyAncV1EekWrapEnvelope(
        mutate(
          vectors["eek-wrap"],
          E2EE_ENVELOPE_FIELDS.eekWrap.signature,
          endpointSignature,
        ),
        {
          ...eekBinding,
          expectedIssuerSigningPublicKey: materials.signingPublicKey,
        },
      ),
    ).rejects.toThrow(/signature/);
  });

  it("round-trips extended recovery only with fixed KDF and full local authority bindings", async () => {
    const { lifecycleVectors } = await buildAncV1InteroperabilityVectors();
    const decoded = decodeAncV1RecoveryEnvelope(
      lifecycleVectors.recovery,
      recoveryBinding,
    );
    expect(decoded.opsLimit).toBe(E2EE_RECOVERY_KDF.opsLimit);
    expect(decoded.memLimitBytes).toBe(E2EE_RECOVERY_KDF.memLimitBytes);
    expect(encodeAncV1RecoveryEnvelope(decoded)).toEqual(
      lifecycleVectors.recovery,
    );
    for (const [binding, message] of [
      [
        { ...recoveryBinding, expectedVaultId: pattern(0xfe, 16) },
        /vault binding/,
      ],
      [
        { ...recoveryBinding, expectedRecoveryId: pattern(0xfe, 16) },
        /identity binding/,
      ],
      [
        { ...recoveryBinding, expectedRecoveryGeneration: 3 },
        /stale or already consumed/,
      ],
      [
        { ...recoveryBinding, expectedSnapshotHash: pattern(0xfe, 32) },
        /snapshot authority/,
      ],
      [
        { ...recoveryBinding, expectedAuthorizationHash: pattern(0xfe, 32) },
        /authorization binding/,
      ],
    ] as const) {
      expect(() =>
        decodeAncV1RecoveryEnvelope(lifecycleVectors.recovery, binding),
      ).toThrow(message);
    }
    expect(() =>
      decodeAncV1RecoveryEnvelope(
        mutate(
          lifecycleVectors.recovery,
          E2EE_ENVELOPE_FIELDS.recovery.opsLimit,
          3,
        ),
        recoveryBinding,
      ),
    ).toThrow(/KDF parameters/);
    expect(() =>
      decodeAncV1RecoveryEnvelope(
        mutate(
          lifecycleVectors.recovery,
          E2EE_ENVELOPE_FIELDS.recovery.memLimitBytes,
          1,
        ),
        recoveryBinding,
      ),
    ).toThrow(/KDF parameters/);
  });

  it("proves recovery snapshot equality with the complete current member set", () => {
    const snapshot = {
      suite: E2EE_SUITE_ID,
      vaultId,
      type: "recovery-snapshot" as const,
      sequence: 12,
      controlHeadHash: pattern(0x71, 32),
      membershipHash: pattern(0x72, 32),
      priorEndpointIds: [pattern(0x02, 16), pattern(0x03, 16)],
    };
    const verifiedState = {
      vaultId: "01".repeat(16),
      sequence: 12,
      headHash: "71".repeat(32),
      membershipHash: "72".repeat(32),
      signedAt: "2026-07-17T00:00:00.000Z",
      activeMembers: [member(0x02, "endpoint"), member(0x03, "broker")],
      removedEndpointIds: [],
      epoch: 7,
      freshnessMode: "endpoint_witnessed" as const,
    };
    expect(() =>
      assertAncV1RecoverySnapshotAuthority(snapshot, verifiedState),
    ).not.toThrow();
    expect(() =>
      assertAncV1RecoverySnapshotAuthority(
        { ...snapshot, priorEndpointIds: [pattern(0x02, 16)] },
        verifiedState,
      ),
    ).toThrow(/complete active membership/);
    expect(() =>
      assertAncV1RecoverySnapshotAuthority(
        {
          ...snapshot,
          priorEndpointIds: [...snapshot.priorEndpointIds, pattern(0x04, 16)],
        },
        verifiedState,
      ),
    ).toThrow(/complete active membership/);
    expect(() =>
      assertAncV1RecoverySnapshotAuthority(snapshot, {
        ...verifiedState,
        activeMembers: [member(0x02, "endpoint"), member(0x04, "broker")],
      }),
    ).toThrow(/complete active membership/);
    expect(() =>
      assertAncV1RecoverySnapshotAuthority(snapshot, {
        ...verifiedState,
        sequence: 13,
      }),
    ).toThrow(/stale/);
    expect(() =>
      assertAncV1RecoverySnapshotAuthority(snapshot, {
        ...verifiedState,
        headHash: "fe".repeat(32),
      }),
    ).toThrow(/control head/);
    expect(() =>
      assertAncV1RecoverySnapshotAuthority(snapshot, {
        ...verifiedState,
        membershipHash: "fe".repeat(32),
      }),
    ).toThrow(/membership/);
    expect(() =>
      assertAncV1RecoverySnapshotAuthority(snapshot, {
        ...verifiedState,
        vaultId: "fe".repeat(16),
      }),
    ).toThrow(/vault/);
    expect(() =>
      assertAncV1RecoverySnapshotAuthority(snapshot, {
        ...verifiedState,
        activeMembers: [member(0x02, "endpoint")],
      }),
    ).toThrow(/complete active membership/);
    expect(() =>
      assertAncV1RecoverySnapshotAuthority(snapshot, {
        ...verifiedState,
        expectedMembershipHash: pattern(0x72, 32),
      } as never),
    ).toThrow(/one exact verified control-log state/);
  });

  it("keeps strict canonical, bounds, role, copy, and forbidden-field behavior", async () => {
    const { lifecycleVectors } = await buildAncV1InteroperabilityVectors();
    const offer = lifecycleVectors.enrollmentOffer;
    expect(() =>
      decodeAncV1EndpointEnrollmentOffer(offer.slice(0, -1), {
        expectedVaultId: vaultId,
      }),
    ).toThrow(AncV1LifecycleEnvelopeError);
    expect(() =>
      decodeAncV1EndpointEnrollmentOffer(new Uint8Array(64 * 1024 + 1), {
        expectedVaultId: vaultId,
      }),
    ).toThrow(/exceeds/);
    const noncanonical = Uint8Array.from([
      offer[0]!,
      0x18,
      0x01,
      ...offer.slice(2),
    ]);
    expect(() =>
      decodeAncV1EndpointEnrollmentOffer(noncanonical, {
        expectedVaultId: vaultId,
      }),
    ).toThrow(/integer encoded|not the unique/);
    const unknown = asMap(offer);
    unknown.set(999, "privateKey");
    expect(() =>
      decodeAncV1EndpointEnrollmentOffer(encodeAncV1Canonical(unknown), {
        expectedVaultId: vaultId,
      }),
    ).toThrow(/unknown key/);
    const missing = asMap(offer);
    missing.delete(E2EE_ENVELOPE_FIELDS.enrollmentOffer.ceremonyId);
    expect(() =>
      decodeAncV1EndpointEnrollmentOffer(encodeAncV1Canonical(missing), {
        expectedVaultId: vaultId,
      }),
    ).toThrow(/missing required/);
    expect(() =>
      decodeAncV1EndpointEnrollmentOffer(
        mutate(offer, E2EE_ENVELOPE_FIELDS.enrollmentOffer.unattended, true),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/Broker enrollment/);
    expect(() =>
      decodeAncV1EndpointEnrollmentOffer(
        mutate(offer, E2EE_ENVELOPE_FIELDS.common.suite, "anc/v2"),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/suite/);
    expect(() =>
      decodeAncV1EndpointEnrollmentOffer(
        mutate(offer, E2EE_ENVELOPE_FIELDS.common.type, "endpoint"),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/type/);
    expect(() =>
      decodeAncV1EndpointEnrollmentOffer(offer, {
        expectedVaultId: pattern(0xfe, 16),
      }),
    ).toThrow(/vault binding/);
    const decoded = decodeAncV1EndpointEnrollmentOffer(offer, {
      expectedVaultId: vaultId,
    });
    expect(() =>
      encodeAncV1EndpointEnrollmentOffer({
        ...decoded,
        privateKey: pattern(0xee, 32),
      } as never),
    ).toThrow(/exactly the frozen/);
    const encoded = encodeAncV1EndpointEnrollmentOffer(decoded);
    decoded.signingPublicKey[0] ^= 0xff;
    expect(encoded).toEqual(offer);
    const source = offer.slice();
    const copied = decodeAncV1EndpointEnrollmentOffer(source, {
      expectedVaultId: vaultId,
    });
    source.fill(0);
    expect(copied.signingPublicKey).not.toEqual(new Uint8Array(32));
  });

  it("defines strict ID conversion and canonical snapshot commitment with a 64-member cap", async () => {
    expect(ancV1LifecycleIdToHex(pattern(0xab, 16))).toBe("ab".repeat(16));
    expect(ancV1LifecycleIdFromHex("ab".repeat(16))).toEqual(pattern(0xab, 16));
    expect(() => ancV1LifecycleIdFromHex("AB".repeat(16))).toThrow(/lowercase/);
    const snapshot = {
      suite: E2EE_SUITE_ID,
      vaultId,
      type: "recovery-snapshot" as const,
      sequence: 12,
      controlHeadHash: pattern(0x71, 32),
      membershipHash: pattern(0x72, 32),
      priorEndpointIds: [pattern(0x02, 16), pattern(0x03, 16)],
    };
    const encoded = encodeAncV1RecoverySnapshotCommitment(snapshot);
    expect(
      decodeAncV1RecoverySnapshotCommitment(encoded, {
        expectedVaultId: vaultId,
      }),
    ).toEqual(snapshot);
    await expect(
      hashAncV1RecoverySnapshotCommitment(snapshot),
    ).resolves.toHaveLength(32);
    expect(() =>
      encodeAncV1RecoverySnapshotCommitment({
        ...snapshot,
        priorEndpointIds: Array.from({ length: 65 }, (_, index) => {
          const id = new Uint8Array(16);
          id[14] = Math.floor(index / 256);
          id[15] = index % 256;
          return id;
        }),
      }),
    ).toThrow(/1 to 64/);
  });
});

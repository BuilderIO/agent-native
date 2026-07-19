import {
  decodeAncV1Canonical,
  encodeAncV1Canonical,
  type AncV1CanonicalValue,
} from "@agent-native/core/e2ee";
import { describe, expect, it } from "vitest";

import {
  decodePrivateVaultContentEnrollmentInvitation,
  encodePrivateVaultContentEnrollmentInvitation,
  PrivateVaultContentEnrollmentInvitationError,
} from "./content-enrollment-invitation.js";

const input = {
  vaultId: "00".repeat(16),
  offerHash: "11".repeat(32),
  offer: Uint8Array.of(1, 2, 3),
  candidateKeyProof: new Uint8Array(64).fill(4),
} as const;

describe("Private Vault Content enrollment invitation", () => {
  it("round-trips one bounded canonical public invitation", () => {
    const encoded = encodePrivateVaultContentEnrollmentInvitation(input);
    expect(encoded.byteLength).toBeLessThanOrEqual(2048);
    expect(decodePrivateVaultContentEnrollmentInvitation(encoded)).toEqual({
      version: 1,
      suite: "anc/v1",
      ...input,
    });
  });

  it("rejects alternate encodings, unknown fields, and malformed bounds", () => {
    const encoded = encodePrivateVaultContentEnrollmentInvitation(input);
    const withTrailingByte = Uint8Array.from([...encoded, 0]);
    expect(() =>
      decodePrivateVaultContentEnrollmentInvitation(withTrailingByte),
    ).toThrow(PrivateVaultContentEnrollmentInvitationError);

    const decoded = decodeAncV1Canonical(encoded) as Map<
      number,
      AncV1CanonicalValue
    >;
    decoded.set(99, "surprise");
    expect(() =>
      decodePrivateVaultContentEnrollmentInvitation(
        encodeAncV1Canonical(decoded),
      ),
    ).toThrow(PrivateVaultContentEnrollmentInvitationError);
    expect(() =>
      encodePrivateVaultContentEnrollmentInvitation({
        ...input,
        candidateKeyProof: new Uint8Array(63),
      }),
    ).toThrow(PrivateVaultContentEnrollmentInvitationError);
  });

  it("returns copies rather than aliases to caller-owned public buffers", () => {
    const offer = input.offer.slice();
    const proof = input.candidateKeyProof.slice();
    const encoded = encodePrivateVaultContentEnrollmentInvitation({
      ...input,
      offer,
      candidateKeyProof: proof,
    });
    offer.fill(0);
    proof.fill(0);
    const decoded = decodePrivateVaultContentEnrollmentInvitation(encoded);
    expect(decoded.offer).toEqual(input.offer);
    expect(decoded.candidateKeyProof).toEqual(input.candidateKeyProof);
  });
});

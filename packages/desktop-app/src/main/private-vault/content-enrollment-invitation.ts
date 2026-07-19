import {
  decodeAncV1Envelope,
  encodeAncV1Canonical,
  type AncV1CanonicalValue,
} from "@agent-native/core/e2ee";

const INVITATION_MAX_BYTES = 2 * 1024;
const OFFER_MAX_BYTES = 1024;
const CANDIDATE_KEY_PROOF_BYTES = 64;
const KEYS = [1, 2, 3, 4, 5, 6] as const;

export interface PrivateVaultContentEnrollmentInvitation {
  readonly version: 1;
  readonly suite: "anc/v1";
  readonly vaultId: string;
  readonly offerHash: string;
  readonly offer: Uint8Array;
  readonly candidateKeyProof: Uint8Array;
}

export class PrivateVaultContentEnrollmentInvitationError extends Error {
  constructor() {
    super("Private Vault enrollment invitation is invalid");
    this.name = "PrivateVaultContentEnrollmentInvitationError";
  }
}

function fail(): never {
  throw new PrivateVaultContentEnrollmentInvitationError();
}

function text(value: AncV1CanonicalValue | undefined, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) fail();
  return value;
}

function bytes(
  value: AncV1CanonicalValue | undefined,
  minimum: number,
  maximum: number,
): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < minimum ||
    value.byteLength > maximum
  ) {
    fail();
  }
  return value.slice();
}

export function encodePrivateVaultContentEnrollmentInvitation(input: {
  readonly vaultId: string;
  readonly offerHash: string;
  readonly offer: Uint8Array;
  readonly candidateKeyProof: Uint8Array;
}): Uint8Array {
  try {
    const vaultId = text(input.vaultId, /^[0-9a-f]{32}$/u);
    const offerHash = text(input.offerHash, /^[0-9a-f]{64}$/u);
    const offer = bytes(input.offer, 1, OFFER_MAX_BYTES);
    const candidateKeyProof = bytes(
      input.candidateKeyProof,
      CANDIDATE_KEY_PROOF_BYTES,
      CANDIDATE_KEY_PROOF_BYTES,
    );
    const encoded = encodeAncV1Canonical(
      new Map<number, AncV1CanonicalValue>([
        [1, 1],
        [2, "anc/v1"],
        [3, vaultId],
        [4, offerHash],
        [5, offer],
        [6, candidateKeyProof],
      ]),
    );
    if (encoded.byteLength > INVITATION_MAX_BYTES) fail();
    return encoded;
  } catch (error) {
    if (error instanceof PrivateVaultContentEnrollmentInvitationError) {
      throw error;
    }
    fail();
  }
}

export function decodePrivateVaultContentEnrollmentInvitation(
  encoded: Uint8Array,
): PrivateVaultContentEnrollmentInvitation {
  try {
    const map = decodeAncV1Envelope(encoded, KEYS, {
      maxBytes: INVITATION_MAX_BYTES,
    });
    if (
      map.size !== KEYS.length ||
      map.get(1) !== 1 ||
      map.get(2) !== "anc/v1"
    ) {
      fail();
    }
    return Object.freeze({
      version: 1,
      suite: "anc/v1",
      vaultId: text(map.get(3), /^[0-9a-f]{32}$/u),
      offerHash: text(map.get(4), /^[0-9a-f]{64}$/u),
      offer: bytes(map.get(5), 1, OFFER_MAX_BYTES),
      candidateKeyProof: bytes(
        map.get(6),
        CANDIDATE_KEY_PROOF_BYTES,
        CANDIDATE_KEY_PROOF_BYTES,
      ),
    });
  } catch (error) {
    if (error instanceof PrivateVaultContentEnrollmentInvitationError) {
      throw error;
    }
    fail();
  }
}

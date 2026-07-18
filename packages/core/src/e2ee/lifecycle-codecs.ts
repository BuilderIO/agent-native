import {
  type AncV1CanonicalValue,
  AncV1CanonicalEncodingError,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  type ControlLogMember,
  type ControlLogState,
  controlLogStateSchema,
} from "./control-log.js";
import { ancV1Hash, ancV1VerifyDetached } from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_RECOVERY_KDF,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
} from "./suite.js";

const COMMON = E2EE_ENVELOPE_FIELDS.common;
const OFFER = E2EE_ENVELOPE_FIELDS.enrollmentOffer;
const EEK = E2EE_ENVELOPE_FIELDS.eekWrap;
const RECOVERY = E2EE_ENVELOPE_FIELDS.recovery;
const RECOVERY_SNAPSHOT = E2EE_ENVELOPE_FIELDS.recoverySnapshot;

const ID_BYTES = 16;
const HASH_BYTES = 32;
const SIGNATURE_BYTES = 64;
const BOX_NONCE_BYTES = 24;
// crypto_box_easy(domain("eek-wrap") || 32-byte EEK) plus its 16-byte MAC.
const EEK_WRAP_CIPHERTEXT_BYTES = 64;
const RECOVERY_CIPHERTEXT_BYTES = 48;
const ENROLLMENT_NONCE_BYTES = 32;
const MAX_ENROLLMENT_LIFETIME_SECONDS = 10 * 60;

export class AncV1LifecycleEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1LifecycleEnvelopeError";
  }
}

type CommonEnvelope = {
  suite: typeof E2EE_SUITE_ID;
  vaultId: Uint8Array;
  type: string;
  createdAt: number;
  envelopeId: Uint8Array;
};

export interface AncV1EndpointEnrollmentOffer extends CommonEnvelope {
  type: "enrollment-offer";
  endpointId: Uint8Array;
  ceremonyId: Uint8Array;
  membershipRole: "endpoint" | "broker";
  unattended: boolean;
  signingPublicKey: Uint8Array;
  keyAgreementPublicKey: Uint8Array;
  enrollmentNonce: Uint8Array;
  expiresAt: number;
}

export interface AncV1EekWrapEnvelope extends CommonEnvelope {
  type: "eek-wrap";
  epoch: number;
  recipientEndpointId: Uint8Array;
  issuerEndpointId: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  signature: Uint8Array;
}

export type AncV1UnsignedEekWrapEnvelope = Omit<
  AncV1EekWrapEnvelope,
  "signature"
>;

/**
 * @deprecated Compatibility-only parallel sealed-EEK envelope retained for
 * the frozen anc/v1 interoperability corpus. It is not the signed recovery
 * authority/recovery-wrap path, must not be used by PREPARE or new vaults, and
 * retains its caller-supplied salt solely to preserve existing vector bytes.
 */
export interface AncV1RecoveryEnvelope extends CommonEnvelope {
  type: "recovery";
  salt: Uint8Array;
  opsLimit: typeof E2EE_RECOVERY_KDF.opsLimit;
  memLimitBytes: typeof E2EE_RECOVERY_KDF.memLimitBytes;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  recoveryGeneration: number;
  /** Local/derived recovery identity; hosted state is never authoritative. */
  recoveryId: Uint8Array;
  /** Hash of the exact recovery snapshot commitment encoded below. */
  snapshotHash: Uint8Array;
  /**
   * Hash of the one-use signed ceremony authorization. Consumption and replay
   * rejection belong to the signed control-log transition, not this codec.
   */
  authorizationHash: Uint8Array;
}

export interface AncV1RecoverySnapshotCommitment {
  suite: typeof E2EE_SUITE_ID;
  vaultId: Uint8Array;
  type: "recovery-snapshot";
  sequence: number;
  controlHeadHash: Uint8Array;
  membershipHash: Uint8Array;
  priorEndpointIds: Uint8Array[];
}

/**
 * Enrollment offers intentionally contain public material and no signature.
 * They are not authority. Candidate activation must hash the exact canonical
 * offer with the enrollment-offer domain, prove possession of its keys, and
 * include that hash in the later signed challenge/authorization. A relay edit
 * therefore causes a binding mismatch (availability loss), never activation.
 */
export const ANC_V1_ENROLLMENT_OFFER_AUTHORIZATION = Object.freeze({
  signed: false,
  activationOfferHashDomain: "enrollment-offer",
  candidateActivationMustBindExactOfferHash: true,
});

const commonKeys = Object.values(COMMON);
const offerKeys = [...commonKeys, ...Object.values(OFFER)];
const eekKeys = [...commonKeys, ...Object.values(EEK)];
const recoveryKeys = [...commonKeys, ...Object.values(RECOVERY)];
const recoverySnapshotKeys = [
  COMMON.suite,
  COMMON.vaultId,
  COMMON.type,
  ...Object.values(RECOVERY_SNAPSHOT),
];

function fail(message: string): never {
  throw new AncV1LifecycleEnvelopeError(message);
}

function exactObject(value: object, expected: readonly string[], name: string) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(`${name} must contain exactly the frozen anc/v1 fields`);
  }
}

function bytes(value: unknown, length: number, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    fail(`${name} must be exactly ${length} bytes`);
  }
  return value.slice();
}

function integer(value: unknown, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function textLiteral<T extends string>(
  value: unknown,
  expected: T,
  name: string,
): T {
  if (value !== expected) fail(`${name} must be ${expected}`);
  return expected;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") fail(`${name} must be a boolean`);
  return value;
}

function field(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
  name: string,
): AncV1CanonicalValue {
  if (!map.has(key)) fail(`Envelope is missing ${name}`);
  return map.get(key)!;
}

function assertExactMap(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  keys: readonly number[],
) {
  if (map.size !== keys.length) fail("Envelope is missing required fields");
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * Canonical bridge to existing string IDs in control logs and opaque schemas.
 * Lifecycle CBOR always carries the decoded 16 bytes; JSON/SQL carries exactly
 * 32 lowercase hexadecimal characters. No prefixed or case-folded variant is
 * accepted, so native and TypeScript identities cannot silently diverge.
 */
function bytesToLowerHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function lowerHexBytes(
  value: string,
  length: number,
  name: string,
): Uint8Array {
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`).test(value)) {
    fail(
      `${name} must be exactly ${length * 2} lowercase hexadecimal characters`,
    );
  }
  return Uint8Array.from(
    value.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)),
  );
}

export function ancV1LifecycleIdToHex(id: Uint8Array): string {
  return bytesToLowerHex(bytes(id, ID_BYTES, "lifecycleId"));
}

export function ancV1LifecycleIdFromHex(id: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/.test(id)) {
    fail(
      "Lifecycle string IDs must be exactly 32 lowercase hexadecimal characters",
    );
  }
  return Uint8Array.from(
    id.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)),
  );
}

function commonFromMap<T extends string>(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  type: T,
  expectedVaultId: Uint8Array,
): CommonEnvelope & { type: T } {
  const vaultId = bytes(
    field(map, COMMON.vaultId, "vaultId"),
    ID_BYTES,
    "vaultId",
  );
  if (
    !sameBytes(vaultId, bytes(expectedVaultId, ID_BYTES, "expectedVaultId"))
  ) {
    fail("Envelope vault binding does not match the expected vault");
  }
  return {
    suite: textLiteral(
      field(map, COMMON.suite, "suite"),
      E2EE_SUITE_ID,
      "suite",
    ),
    vaultId,
    type: textLiteral(field(map, COMMON.type, "type"), type, "type"),
    createdAt: integer(
      field(map, COMMON.createdAt, "createdAt"),
      0,
      "createdAt",
    ),
    envelopeId: bytes(
      field(map, COMMON.envelopeId, "envelopeId"),
      ID_BYTES,
      "envelopeId",
    ),
  };
}

function commonMap<T extends string>(
  value: CommonEnvelope,
  expectedType: T,
): Map<number, AncV1CanonicalValue> {
  return new Map<number, AncV1CanonicalValue>([
    [COMMON.suite, textLiteral(value.suite, E2EE_SUITE_ID, "suite")],
    [COMMON.vaultId, bytes(value.vaultId, ID_BYTES, "vaultId")],
    [COMMON.type, textLiteral(value.type, expectedType, "type")],
    [COMMON.createdAt, integer(value.createdAt, 0, "createdAt")],
    [COMMON.envelopeId, bytes(value.envelopeId, ID_BYTES, "envelopeId")],
  ]);
}

function canonicalEnvelope(bytesValue: Uint8Array, keys: readonly number[]) {
  try {
    const map = decodeAncV1Envelope(bytesValue, keys, {
      maxBytes: E2EE_SIZE_LIMITS.controlEnvelopeBytes,
    });
    assertExactMap(map, keys);
    return map;
  } catch (error) {
    if (error instanceof AncV1LifecycleEnvelopeError) throw error;
    if (error instanceof AncV1CanonicalEncodingError) {
      throw new AncV1LifecycleEnvelopeError(error.message);
    }
    throw error;
  }
}

const OFFER_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "endpointId",
  "ceremonyId",
  "membershipRole",
  "unattended",
  "signingPublicKey",
  "keyAgreementPublicKey",
  "enrollmentNonce",
  "expiresAt",
] as const;

function validateOffer(value: AncV1EndpointEnrollmentOffer) {
  exactObject(value, OFFER_FIELDS, "Enrollment offer");
  if ((value.membershipRole === "broker") !== value.unattended) {
    fail(
      "Broker enrollment must be unattended and endpoint enrollment must be attended",
    );
  }
  if (
    value.expiresAt <= value.createdAt ||
    value.expiresAt - value.createdAt > MAX_ENROLLMENT_LIFETIME_SECONDS
  ) {
    fail("Enrollment offer expiry is outside the frozen anc/v1 lifetime");
  }
}

export function encodeAncV1EndpointEnrollmentOffer(
  value: AncV1EndpointEnrollmentOffer,
): Uint8Array {
  validateOffer(value);
  return encodeAncV1Canonical(
    new Map([
      ...commonMap(value, "enrollment-offer"),
      [OFFER.endpointId, bytes(value.endpointId, ID_BYTES, "endpointId")],
      [OFFER.ceremonyId, bytes(value.ceremonyId, ID_BYTES, "ceremonyId")],
      [OFFER.membershipRole, value.membershipRole],
      [OFFER.unattended, boolean(value.unattended, "unattended")],
      [
        OFFER.signingPublicKey,
        bytes(value.signingPublicKey, 32, "signingPublicKey"),
      ],
      [
        OFFER.keyAgreementPublicKey,
        bytes(value.keyAgreementPublicKey, 32, "keyAgreementPublicKey"),
      ],
      [
        OFFER.enrollmentNonce,
        bytes(value.enrollmentNonce, ENROLLMENT_NONCE_BYTES, "enrollmentNonce"),
      ],
      [OFFER.expiresAt, integer(value.expiresAt, 1, "expiresAt")],
    ]),
  );
}

export function decodeAncV1EndpointEnrollmentOffer(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1EndpointEnrollmentOffer {
  exactObject(binding, ["expectedVaultId"], "Enrollment offer binding");
  const map = canonicalEnvelope(encoded, offerKeys);
  const common = commonFromMap(
    map,
    "enrollment-offer",
    binding.expectedVaultId,
  );
  const roleValue = field(map, OFFER.membershipRole, "membershipRole");
  if (roleValue !== "endpoint" && roleValue !== "broker")
    fail("membershipRole must be endpoint or broker");
  const result: AncV1EndpointEnrollmentOffer = {
    ...common,
    endpointId: bytes(
      field(map, OFFER.endpointId, "endpointId"),
      ID_BYTES,
      "endpointId",
    ),
    ceremonyId: bytes(
      field(map, OFFER.ceremonyId, "ceremonyId"),
      ID_BYTES,
      "ceremonyId",
    ),
    membershipRole: roleValue,
    unattended: boolean(
      field(map, OFFER.unattended, "unattended"),
      "unattended",
    ),
    signingPublicKey: bytes(
      field(map, OFFER.signingPublicKey, "signingPublicKey"),
      32,
      "signingPublicKey",
    ),
    keyAgreementPublicKey: bytes(
      field(map, OFFER.keyAgreementPublicKey, "keyAgreementPublicKey"),
      32,
      "keyAgreementPublicKey",
    ),
    enrollmentNonce: bytes(
      field(map, OFFER.enrollmentNonce, "enrollmentNonce"),
      ENROLLMENT_NONCE_BYTES,
      "enrollmentNonce",
    ),
    expiresAt: integer(
      field(map, OFFER.expiresAt, "expiresAt"),
      1,
      "expiresAt",
    ),
  };
  validateOffer(result);
  return result;
}

/** Hash the exact canonical public offer that later signed authorization binds. */
export async function hashAncV1EndpointEnrollmentOffer(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): Promise<Uint8Array> {
  decodeAncV1EndpointEnrollmentOffer(encoded, binding);
  return ancV1Hash("enrollment-offer", encoded.slice());
}

/**
 * Convert a canonically validated offer into signed control-log membership. The
 * enrollmentRef is supplied separately because it is the authoritative signed
 * enrollment-authorization envelopeId, never a claim made by the unsigned
 * offer.
 *
 * This byte/hex bridge is for newly generated Private Vault identifiers only;
 * it does not reinterpret legacy human-readable opaque IDs.
 */
export function ancV1EnrollmentOfferToControlLogMember(
  offer: AncV1EndpointEnrollmentOffer,
  enrollmentAuthorizationEnvelopeId: Uint8Array,
): ControlLogMember {
  // Encoding is also the strict runtime validation for callers bypassing TS.
  encodeAncV1EndpointEnrollmentOffer(offer);
  return {
    endpointId: ancV1LifecycleIdToHex(offer.endpointId),
    role: offer.membershipRole,
    unattended: offer.unattended,
    signingPublicKey: bytesToLowerHex(
      bytes(offer.signingPublicKey, 32, "signingPublicKey"),
    ),
    keyAgreementPublicKey: bytesToLowerHex(
      bytes(offer.keyAgreementPublicKey, 32, "keyAgreementPublicKey"),
    ),
    enrollmentRef: bytesToLowerHex(
      bytes(
        enrollmentAuthorizationEnvelopeId,
        ID_BYTES,
        "enrollmentAuthorizationEnvelopeId",
      ),
    ),
  };
}

const EEK_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "epoch",
  "recipientEndpointId",
  "issuerEndpointId",
  "nonce",
  "ciphertext",
  "signature",
] as const;
const UNSIGNED_EEK_FIELDS = EEK_FIELDS.filter(
  (name): name is Exclude<(typeof EEK_FIELDS)[number], "signature"> =>
    name !== "signature",
);

function unsignedEekMap(
  value: AncV1UnsignedEekWrapEnvelope,
): Map<number, AncV1CanonicalValue> {
  exactObject(value, UNSIGNED_EEK_FIELDS, "Unsigned EEK wrap");
  return new Map([
    ...commonMap(value, "eek-wrap"),
    [EEK.epoch, integer(value.epoch, 1, "epoch")],
    [
      EEK.recipientEndpointId,
      bytes(value.recipientEndpointId, ID_BYTES, "recipientEndpointId"),
    ],
    [
      EEK.issuerEndpointId,
      bytes(value.issuerEndpointId, ID_BYTES, "issuerEndpointId"),
    ],
    [EEK.nonce, bytes(value.nonce, BOX_NONCE_BYTES, "nonce")],
    [
      EEK.ciphertext,
      bytes(value.ciphertext, EEK_WRAP_CIPHERTEXT_BYTES, "ciphertext"),
    ],
  ]);
}

/** Exact bytes signed with the anc/v1 eek-wrap domain. */
export function encodeAncV1UnsignedEekWrapPreimage(
  value: AncV1UnsignedEekWrapEnvelope,
): Uint8Array {
  return encodeAncV1Canonical(unsignedEekMap(value));
}

export function encodeAncV1EekWrapEnvelope(
  value: AncV1EekWrapEnvelope,
): Uint8Array {
  exactObject(value, EEK_FIELDS, "EEK wrap");
  const { signature, ...unsigned } = value;
  return encodeAncV1Canonical(
    new Map([
      ...unsignedEekMap(unsigned),
      [EEK.signature, bytes(signature, SIGNATURE_BYTES, "signature")],
    ]),
  );
}

export function decodeAncV1EekWrapEnvelope(
  encoded: Uint8Array,
  binding: {
    expectedVaultId: Uint8Array;
    expectedRecipientEndpointId: Uint8Array;
    expectedIssuerEndpointId: Uint8Array;
    expectedEpoch: number;
  },
): AncV1EekWrapEnvelope {
  exactObject(
    binding,
    [
      "expectedVaultId",
      "expectedRecipientEndpointId",
      "expectedIssuerEndpointId",
      "expectedEpoch",
    ],
    "EEK wrap binding",
  );
  const map = canonicalEnvelope(encoded, eekKeys);
  const result: AncV1EekWrapEnvelope = {
    ...commonFromMap(map, "eek-wrap", binding.expectedVaultId),
    epoch: integer(field(map, EEK.epoch, "epoch"), 1, "epoch"),
    recipientEndpointId: bytes(
      field(map, EEK.recipientEndpointId, "recipientEndpointId"),
      ID_BYTES,
      "recipientEndpointId",
    ),
    issuerEndpointId: bytes(
      field(map, EEK.issuerEndpointId, "issuerEndpointId"),
      ID_BYTES,
      "issuerEndpointId",
    ),
    nonce: bytes(field(map, EEK.nonce, "nonce"), BOX_NONCE_BYTES, "nonce"),
    ciphertext: bytes(
      field(map, EEK.ciphertext, "ciphertext"),
      EEK_WRAP_CIPHERTEXT_BYTES,
      "ciphertext",
    ),
    signature: bytes(
      field(map, EEK.signature, "signature"),
      SIGNATURE_BYTES,
      "signature",
    ),
  };
  if (
    !sameBytes(
      result.recipientEndpointId,
      bytes(
        binding.expectedRecipientEndpointId,
        ID_BYTES,
        "expectedRecipientEndpointId",
      ),
    )
  ) {
    fail("EEK wrap recipient binding does not match the expected endpoint");
  }
  if (
    !sameBytes(
      result.issuerEndpointId,
      bytes(
        binding.expectedIssuerEndpointId,
        ID_BYTES,
        "expectedIssuerEndpointId",
      ),
    )
  ) {
    fail("EEK wrap issuer binding does not match the expected endpoint");
  }
  if (result.epoch !== integer(binding.expectedEpoch, 1, "expectedEpoch")) {
    fail("EEK wrap epoch binding does not match the expected epoch");
  }
  return result;
}

export async function verifyAncV1EekWrapEnvelope(
  encoded: Uint8Array,
  binding: {
    expectedVaultId: Uint8Array;
    expectedRecipientEndpointId: Uint8Array;
    expectedIssuerEndpointId: Uint8Array;
    expectedEpoch: number;
    expectedIssuerSigningPublicKey: Uint8Array;
  },
): Promise<AncV1EekWrapEnvelope> {
  exactObject(
    binding,
    [
      "expectedVaultId",
      "expectedRecipientEndpointId",
      "expectedIssuerEndpointId",
      "expectedEpoch",
      "expectedIssuerSigningPublicKey",
    ],
    "EEK verification binding",
  );
  const { expectedIssuerSigningPublicKey, ...decodeBinding } = binding;
  const envelope = decodeAncV1EekWrapEnvelope(encoded, decodeBinding);
  const { signature, ...unsigned } = envelope;
  const verified = await ancV1VerifyDetached(
    "eek-wrap",
    encodeAncV1UnsignedEekWrapPreimage(unsigned),
    signature,
    bytes(expectedIssuerSigningPublicKey, 32, "expectedIssuerSigningPublicKey"),
  );
  if (!verified) fail("EEK wrap signature verification failed");
  return envelope;
}

const RECOVERY_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "salt",
  "opsLimit",
  "memLimitBytes",
  "nonce",
  "ciphertext",
  "recoveryGeneration",
  "recoveryId",
  "snapshotHash",
  "authorizationHash",
] as const;

/**
 * @deprecated Encodes only the frozen compatibility sealed-EEK envelope. New
 * vaults and PREPARE must derive authority with
 * `deriveAncV1RecoveryAuthorityFromEntropy` and use signed recovery wraps.
 */
export function encodeAncV1RecoveryEnvelope(
  value: AncV1RecoveryEnvelope,
): Uint8Array {
  exactObject(value, RECOVERY_FIELDS, "Recovery envelope");
  if (
    value.opsLimit !== E2EE_RECOVERY_KDF.opsLimit ||
    value.memLimitBytes !== E2EE_RECOVERY_KDF.memLimitBytes
  ) {
    fail("Recovery KDF parameters do not match the frozen anc/v1 suite");
  }
  return encodeAncV1Canonical(
    new Map([
      ...commonMap(value, "recovery"),
      [RECOVERY.salt, bytes(value.salt, E2EE_RECOVERY_KDF.saltBytes, "salt")],
      [
        RECOVERY.opsLimit,
        integer(value.opsLimit, E2EE_RECOVERY_KDF.opsLimit, "opsLimit"),
      ],
      [
        RECOVERY.memLimitBytes,
        integer(
          value.memLimitBytes,
          E2EE_RECOVERY_KDF.memLimitBytes,
          "memLimitBytes",
        ),
      ],
      [RECOVERY.nonce, bytes(value.nonce, BOX_NONCE_BYTES, "nonce")],
      [
        RECOVERY.ciphertext,
        bytes(value.ciphertext, RECOVERY_CIPHERTEXT_BYTES, "ciphertext"),
      ],
      [
        RECOVERY.recoveryGeneration,
        integer(value.recoveryGeneration, 1, "recoveryGeneration"),
      ],
      [RECOVERY.recoveryId, bytes(value.recoveryId, ID_BYTES, "recoveryId")],
      [
        RECOVERY.snapshotHash,
        bytes(value.snapshotHash, HASH_BYTES, "snapshotHash"),
      ],
      [
        RECOVERY.authorizationHash,
        bytes(value.authorizationHash, HASH_BYTES, "authorizationHash"),
      ],
    ]),
  );
}

/**
 * @deprecated Decodes only the frozen compatibility sealed-EEK envelope. Its
 * salt is intentionally caller-bound legacy data, not the normative anc/v1
 * recovery-authority salt, which is always the exact vault ID.
 */
export function decodeAncV1RecoveryEnvelope(
  encoded: Uint8Array,
  binding: {
    expectedVaultId: Uint8Array;
    expectedRecoveryId: Uint8Array;
    expectedRecoveryGeneration: number;
    expectedSnapshotHash: Uint8Array;
    expectedAuthorizationHash: Uint8Array;
  },
): AncV1RecoveryEnvelope {
  exactObject(
    binding,
    [
      "expectedVaultId",
      "expectedRecoveryId",
      "expectedRecoveryGeneration",
      "expectedSnapshotHash",
      "expectedAuthorizationHash",
    ],
    "Recovery binding",
  );
  const map = canonicalEnvelope(encoded, recoveryKeys);
  const result: AncV1RecoveryEnvelope = {
    ...commonFromMap(map, "recovery", binding.expectedVaultId),
    salt: bytes(
      field(map, RECOVERY.salt, "salt"),
      E2EE_RECOVERY_KDF.saltBytes,
      "salt",
    ),
    opsLimit: integer(
      field(map, RECOVERY.opsLimit, "opsLimit"),
      1,
      "opsLimit",
    ) as typeof E2EE_RECOVERY_KDF.opsLimit,
    memLimitBytes: integer(
      field(map, RECOVERY.memLimitBytes, "memLimitBytes"),
      1,
      "memLimitBytes",
    ) as typeof E2EE_RECOVERY_KDF.memLimitBytes,
    nonce: bytes(field(map, RECOVERY.nonce, "nonce"), BOX_NONCE_BYTES, "nonce"),
    ciphertext: bytes(
      field(map, RECOVERY.ciphertext, "ciphertext"),
      RECOVERY_CIPHERTEXT_BYTES,
      "ciphertext",
    ),
    recoveryGeneration: integer(
      field(map, RECOVERY.recoveryGeneration, "recoveryGeneration"),
      1,
      "recoveryGeneration",
    ),
    recoveryId: bytes(
      field(map, RECOVERY.recoveryId, "recoveryId"),
      ID_BYTES,
      "recoveryId",
    ),
    snapshotHash: bytes(
      field(map, RECOVERY.snapshotHash, "snapshotHash"),
      HASH_BYTES,
      "snapshotHash",
    ),
    authorizationHash: bytes(
      field(map, RECOVERY.authorizationHash, "authorizationHash"),
      HASH_BYTES,
      "authorizationHash",
    ),
  };
  if (
    result.opsLimit !== E2EE_RECOVERY_KDF.opsLimit ||
    result.memLimitBytes !== E2EE_RECOVERY_KDF.memLimitBytes
  ) {
    fail("Recovery KDF parameters do not match the frozen anc/v1 suite");
  }
  if (
    !sameBytes(
      result.recoveryId,
      bytes(binding.expectedRecoveryId, ID_BYTES, "expectedRecoveryId"),
    )
  ) {
    fail(
      "Recovery identity binding does not match the expected recovery secret",
    );
  }
  if (
    result.recoveryGeneration !==
    integer(binding.expectedRecoveryGeneration, 1, "expectedRecoveryGeneration")
  ) {
    fail("Recovery generation is stale or already consumed");
  }
  if (
    !sameBytes(
      result.snapshotHash,
      bytes(binding.expectedSnapshotHash, HASH_BYTES, "expectedSnapshotHash"),
    )
  ) {
    fail("Recovery snapshot authority binding does not match");
  }
  if (
    !sameBytes(
      result.authorizationHash,
      bytes(
        binding.expectedAuthorizationHash,
        HASH_BYTES,
        "expectedAuthorizationHash",
      ),
    )
  ) {
    fail("Recovery authorization binding does not match");
  }
  return result;
}

const RECOVERY_SNAPSHOT_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "sequence",
  "controlHeadHash",
  "membershipHash",
  "priorEndpointIds",
] as const;

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < left.byteLength; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function priorEndpointIds(value: unknown): Uint8Array[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    fail("priorEndpointIds must contain 1 to 64 endpoint IDs");
  }
  const result = value.map((id) => bytes(id, ID_BYTES, "priorEndpointId"));
  for (let index = 1; index < result.length; index += 1) {
    if (compareBytes(result[index - 1]!, result[index]!) >= 0) {
      fail("priorEndpointIds must be unique and sorted by raw ID bytes");
    }
  }
  return result;
}

/**
 * Exact recovery snapshot preimage. snapshotHash is:
 * ancV1Hash("recovery", encodeAncV1RecoverySnapshotCommitment(snapshot)).
 * This commits to the vault, control-log sequence and head, membership hash,
 * and the complete sorted pre-recovery endpoint set that must be removed.
 */
export function encodeAncV1RecoverySnapshotCommitment(
  value: AncV1RecoverySnapshotCommitment,
): Uint8Array {
  exactObject(value, RECOVERY_SNAPSHOT_FIELDS, "Recovery snapshot");
  const ids = priorEndpointIds(value.priorEndpointIds);
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [COMMON.suite, textLiteral(value.suite, E2EE_SUITE_ID, "suite")],
      [COMMON.vaultId, bytes(value.vaultId, ID_BYTES, "vaultId")],
      [COMMON.type, textLiteral(value.type, "recovery-snapshot", "type")],
      [RECOVERY_SNAPSHOT.sequence, integer(value.sequence, 0, "sequence")],
      [
        RECOVERY_SNAPSHOT.controlHeadHash,
        bytes(value.controlHeadHash, HASH_BYTES, "controlHeadHash"),
      ],
      [
        RECOVERY_SNAPSHOT.membershipHash,
        bytes(value.membershipHash, HASH_BYTES, "membershipHash"),
      ],
      [RECOVERY_SNAPSHOT.priorEndpointIds, ids],
    ]),
  );
}

export function decodeAncV1RecoverySnapshotCommitment(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1RecoverySnapshotCommitment {
  exactObject(binding, ["expectedVaultId"], "Recovery snapshot binding");
  const map = canonicalEnvelope(encoded, recoverySnapshotKeys);
  const decodedVaultId = bytes(
    field(map, COMMON.vaultId, "vaultId"),
    ID_BYTES,
    "vaultId",
  );
  if (
    !sameBytes(
      decodedVaultId,
      bytes(binding.expectedVaultId, ID_BYTES, "expectedVaultId"),
    )
  ) {
    fail("Envelope vault binding does not match the expected vault");
  }
  return {
    suite: textLiteral(
      field(map, COMMON.suite, "suite"),
      E2EE_SUITE_ID,
      "suite",
    ),
    vaultId: decodedVaultId,
    type: textLiteral(
      field(map, COMMON.type, "type"),
      "recovery-snapshot",
      "type",
    ),
    sequence: integer(
      field(map, RECOVERY_SNAPSHOT.sequence, "sequence"),
      0,
      "sequence",
    ),
    controlHeadHash: bytes(
      field(map, RECOVERY_SNAPSHOT.controlHeadHash, "controlHeadHash"),
      HASH_BYTES,
      "controlHeadHash",
    ),
    membershipHash: bytes(
      field(map, RECOVERY_SNAPSHOT.membershipHash, "membershipHash"),
      HASH_BYTES,
      "membershipHash",
    ),
    priorEndpointIds: priorEndpointIds(
      field(map, RECOVERY_SNAPSHOT.priorEndpointIds, "priorEndpointIds"),
    ),
  };
}

export async function hashAncV1RecoverySnapshotCommitment(
  value: AncV1RecoverySnapshotCommitment,
): Promise<Uint8Array> {
  return ancV1Hash("recovery", encodeAncV1RecoverySnapshotCommitment(value));
}

/**
 * Prove that a recovery snapshot is current and names every verified active
 * member, including the broker. The second argument must be the one state
 * returned by authenticated signed control-log replay. It is intentionally not
 * decomposed into independently swappable hashes and member arrays. Schema
 * parsing below checks exact shape; replay is what establishes provenance.
 */
export function assertAncV1RecoverySnapshotAuthority(
  snapshot: AncV1RecoverySnapshotCommitment,
  verifiedStateInput: ControlLogState,
): void {
  encodeAncV1RecoverySnapshotCommitment(snapshot);
  let verifiedState: ControlLogState;
  try {
    verifiedState = controlLogStateSchema.parse(verifiedStateInput);
  } catch {
    fail("Recovery authority must be one exact verified control-log state");
  }
  if (ancV1LifecycleIdToHex(snapshot.vaultId) !== verifiedState.vaultId) {
    fail("Recovery snapshot vault does not match verified replay");
  }
  if (snapshot.sequence !== verifiedState.sequence) {
    fail("Recovery snapshot sequence is stale");
  }
  if (
    !sameBytes(
      snapshot.controlHeadHash,
      lowerHexBytes(verifiedState.headHash, HASH_BYTES, "headHash"),
    )
  ) {
    fail("Recovery snapshot control head does not match verified replay");
  }
  if (
    !sameBytes(
      snapshot.membershipHash,
      lowerHexBytes(verifiedState.membershipHash, HASH_BYTES, "membershipHash"),
    )
  ) {
    fail("Recovery snapshot membership does not match verified replay");
  }
  const expectedIds = verifiedState.activeMembers
    .map((member) => ancV1LifecycleIdFromHex(member.endpointId))
    .sort(compareBytes);
  if (
    expectedIds.some(
      (id, index) =>
        index > 0 && compareBytes(expectedIds[index - 1]!, id) === 0,
    )
  ) {
    fail("Verified active membership contains duplicate endpoint IDs");
  }
  if (
    snapshot.priorEndpointIds.length !== expectedIds.length ||
    snapshot.priorEndpointIds.some(
      (id, index) => !sameBytes(id, expectedIds[index]!),
    )
  ) {
    fail(
      "Recovery snapshot endpoint set is not the complete active membership",
    );
  }
}

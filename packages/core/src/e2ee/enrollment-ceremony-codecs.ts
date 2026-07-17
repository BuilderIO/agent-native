import {
  type AncV1CanonicalValue,
  AncV1CanonicalEncodingError,
  ancV1BytesToHex,
  decodeAncV1Canonical,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  type ControlLogMember,
  type ControlLogState,
  assertFreshControlLogHead,
  controlLogStateSchema,
  decodeSignedControlLogEntry,
  verifyAndReduceControlLogEntry,
} from "./control-log.js";
import {
  type AncV1EndpointEnrollmentOffer,
  ancV1LifecycleIdToHex,
  decodeAncV1EndpointEnrollmentOffer,
  hashAncV1EndpointEnrollmentOffer,
  verifyAncV1EekWrapEnvelope,
} from "./lifecycle-codecs.js";
import {
  ancV1Hash,
  ancV1SignDetached,
  ancV1VerifyDetached,
} from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
} from "./suite.js";

const COMMON = E2EE_ENVELOPE_FIELDS.common;
const CHALLENGE = E2EE_ENVELOPE_FIELDS.enrollmentChallenge;
const SAS = E2EE_ENVELOPE_FIELDS.enrollmentSas;
const AUTHORIZATION = E2EE_ENVELOPE_FIELDS.enrollmentAuthorization;
const ID_BYTES = 16;
const HASH_BYTES = 32;
const PUBLIC_KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;
const NONCE_BYTES = 32;
const MAX_LIFETIME_SECONDS = 600;
const MAX_DESCENDANT_CONTROL_ENTRIES = 1_024;
const MAX_DESCENDANT_CONTROL_BYTES = 64 * 1024 * 1024;

export class AncV1EnrollmentCeremonyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1EnrollmentCeremonyError";
  }
}

type CommonEnvelope = {
  suite: typeof E2EE_SUITE_ID;
  vaultId: Uint8Array;
  type: string;
  createdAt: number;
  envelopeId: Uint8Array;
};

export interface AncV1UnsignedEnrollmentChallenge extends CommonEnvelope {
  type: "enrollment-challenge";
  offerHash: Uint8Array;
  candidateKeyProof: Uint8Array;
  authorizerEndpointId: Uint8Array;
  authorizerSigningPublicKey: Uint8Array;
  authorizerKeyAgreementPublicKey: Uint8Array;
  controlSequence: number;
  controlHeadHash: Uint8Array;
  membershipHash: Uint8Array;
  targetMembershipRole: "endpoint" | "broker";
  sasTranscriptHash: Uint8Array;
  challengeNonce: Uint8Array;
  expiresAt: number;
}

export interface AncV1EnrollmentChallenge extends AncV1UnsignedEnrollmentChallenge {
  signature: Uint8Array;
}

export interface AncV1EnrollmentSasTranscript {
  suite: typeof E2EE_SUITE_ID;
  vaultId: Uint8Array;
  type: "enrollment-sas";
  ceremonyId: Uint8Array;
  offerHash: Uint8Array;
  candidateEndpointId: Uint8Array;
  candidateSigningPublicKey: Uint8Array;
  candidateKeyAgreementPublicKey: Uint8Array;
  candidateKeyProof: Uint8Array;
  authorizerEndpointId: Uint8Array;
  authorizerSigningPublicKey: Uint8Array;
  authorizerKeyAgreementPublicKey: Uint8Array;
  controlSequence: number;
  controlHeadHash: Uint8Array;
  membershipHash: Uint8Array;
  targetMembershipRole: "endpoint" | "broker";
  challengeNonce: Uint8Array;
  challengeEnvelopeId: Uint8Array;
  challengeCreatedAt: number;
  challengeExpiresAt: number;
}

export interface AncV1UnsignedEnrollmentAuthorization extends CommonEnvelope {
  type: "enrollment-authorization";
  offerHash: Uint8Array;
  challengeHash: Uint8Array;
  authorizerEndpointId: Uint8Array;
  targetMembershipRole: "endpoint" | "broker";
  previousControlSequence: number;
  previousControlHeadHash: Uint8Array;
  previousMembershipHash: Uint8Array;
  endpointEnvelope: Uint8Array;
  eekWrapEnvelope: Uint8Array;
  signedMembershipCommit: Uint8Array;
  expiresAt: number;
}

export interface AncV1EnrollmentAuthorization extends AncV1UnsignedEnrollmentAuthorization {
  signature: Uint8Array;
}

function fail(message: string): never {
  throw new AncV1EnrollmentCeremonyError(message);
}

function exact(value: object, fields: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
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

function boundedBytes(
  value: unknown,
  maximum: number,
  name: string,
): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 1 ||
    value.byteLength > maximum
  ) {
    fail(`${name} must contain 1 to ${maximum} bytes`);
  }
  return value.slice();
}

function canonicalEnvelopeBytes(
  value: unknown,
  maximum: number,
  name: string,
): Uint8Array {
  const encoded = boundedBytes(value, maximum, name);
  const decoded = decodeAncV1Canonical(encoded, { maxBytes: maximum });
  if (!(decoded instanceof Map)) {
    fail(`${name} must be a canonical envelope map`);
  }
  return encoded;
}

function integer(value: unknown, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(`${name} must be a safe integer >= ${minimum}`);
  }
  return value as number;
}

function role(value: unknown, name: string): "endpoint" | "broker" {
  if (value !== "endpoint" && value !== "broker") {
    fail(`${name} must be endpoint or broker`);
  }
  return value;
}

function boundedText(value: unknown, maximum: number, name: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    fail(`${name} must contain 1 to ${maximum} characters`);
  }
  return value;
}

function literal<T extends string>(
  value: unknown,
  expected: T,
  name: string,
): T {
  if (value !== expected) fail(`${name} must be ${expected}`);
  return expected;
}

function field(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
  name: string,
): AncV1CanonicalValue {
  if (!map.has(key)) fail(`Envelope is missing ${name}`);
  return map.get(key)!;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function lowerHexBytes(
  value: string,
  length: number,
  name: string,
): Uint8Array {
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`).test(value)) {
    fail(`${name} must be frozen lowercase hexadecimal bytes`);
  }
  return Uint8Array.from(
    value.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)),
  );
}

function commonMap<T extends string>(
  value: CommonEnvelope,
  type: T,
): Map<number, AncV1CanonicalValue> {
  return new Map<number, AncV1CanonicalValue>([
    [COMMON.suite, literal(value.suite, E2EE_SUITE_ID, "suite")],
    [COMMON.vaultId, bytes(value.vaultId, ID_BYTES, "vaultId")],
    [COMMON.type, literal(value.type, type, "type")],
    [COMMON.createdAt, integer(value.createdAt, 1, "createdAt")],
    [COMMON.envelopeId, bytes(value.envelopeId, ID_BYTES, "envelopeId")],
  ]);
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
    !equalBytes(vaultId, bytes(expectedVaultId, ID_BYTES, "expectedVaultId"))
  ) {
    fail("Envelope vault binding does not match");
  }
  return {
    suite: literal(field(map, COMMON.suite, "suite"), E2EE_SUITE_ID, "suite"),
    vaultId,
    type: literal(field(map, COMMON.type, "type"), type, "type"),
    createdAt: integer(
      field(map, COMMON.createdAt, "createdAt"),
      1,
      "createdAt",
    ),
    envelopeId: bytes(
      field(map, COMMON.envelopeId, "envelopeId"),
      ID_BYTES,
      "envelopeId",
    ),
  };
}

function decodeMap(
  encoded: Uint8Array,
  allowed: readonly number[],
  maxBytes: number,
): ReadonlyMap<number, AncV1CanonicalValue> {
  try {
    const map = decodeAncV1Envelope(encoded, allowed, { maxBytes });
    if (map.size !== allowed.length)
      fail("Envelope is missing required fields");
    return map;
  } catch (error) {
    if (error instanceof AncV1EnrollmentCeremonyError) throw error;
    if (error instanceof AncV1CanonicalEncodingError) {
      throw new AncV1EnrollmentCeremonyError(error.message);
    }
    throw error;
  }
}

function assertLifetime(createdAt: number, expiresAt: number, name: string) {
  if (expiresAt <= createdAt || expiresAt - createdAt > MAX_LIFETIME_SECONDS) {
    fail(`${name} expiry must be after creation and within 600 seconds`);
  }
}

const CHALLENGE_UNSIGNED_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "offerHash",
  "candidateKeyProof",
  "authorizerEndpointId",
  "authorizerSigningPublicKey",
  "authorizerKeyAgreementPublicKey",
  "controlSequence",
  "controlHeadHash",
  "membershipHash",
  "targetMembershipRole",
  "sasTranscriptHash",
  "challengeNonce",
  "expiresAt",
] as const;
const CHALLENGE_FIELDS = [...CHALLENGE_UNSIGNED_FIELDS, "signature"] as const;
const challengeKeys = [...Object.values(COMMON), ...Object.values(CHALLENGE)];

function unsignedChallengeMap(
  value: AncV1UnsignedEnrollmentChallenge,
): Map<number, AncV1CanonicalValue> {
  exact(value, CHALLENGE_UNSIGNED_FIELDS, "Unsigned enrollment challenge");
  assertLifetime(value.createdAt, value.expiresAt, "Challenge");
  return new Map<number, AncV1CanonicalValue>([
    ...commonMap(value, "enrollment-challenge"),
    [CHALLENGE.offerHash, bytes(value.offerHash, HASH_BYTES, "offerHash")],
    [
      CHALLENGE.candidateKeyProof,
      bytes(value.candidateKeyProof, SIGNATURE_BYTES, "candidateKeyProof"),
    ],
    [
      CHALLENGE.authorizerEndpointId,
      bytes(value.authorizerEndpointId, ID_BYTES, "authorizerEndpointId"),
    ],
    [
      CHALLENGE.authorizerSigningPublicKey,
      bytes(
        value.authorizerSigningPublicKey,
        PUBLIC_KEY_BYTES,
        "authorizerSigningPublicKey",
      ),
    ],
    [
      CHALLENGE.authorizerKeyAgreementPublicKey,
      bytes(
        value.authorizerKeyAgreementPublicKey,
        PUBLIC_KEY_BYTES,
        "authorizerKeyAgreementPublicKey",
      ),
    ],
    [
      CHALLENGE.controlSequence,
      integer(value.controlSequence, 0, "controlSequence"),
    ],
    [
      CHALLENGE.controlHeadHash,
      bytes(value.controlHeadHash, HASH_BYTES, "controlHeadHash"),
    ],
    [
      CHALLENGE.membershipHash,
      bytes(value.membershipHash, HASH_BYTES, "membershipHash"),
    ],
    [
      CHALLENGE.targetMembershipRole,
      role(value.targetMembershipRole, "targetMembershipRole"),
    ],
    [
      CHALLENGE.sasTranscriptHash,
      bytes(value.sasTranscriptHash, HASH_BYTES, "sasTranscriptHash"),
    ],
    [
      CHALLENGE.challengeNonce,
      bytes(value.challengeNonce, NONCE_BYTES, "challengeNonce"),
    ],
    [CHALLENGE.expiresAt, integer(value.expiresAt, 1, "expiresAt")],
  ]);
}

export function encodeAncV1UnsignedEnrollmentChallenge(
  value: AncV1UnsignedEnrollmentChallenge,
): Uint8Array {
  return encodeAncV1Canonical(unsignedChallengeMap(value));
}

export function encodeAncV1EnrollmentChallenge(
  value: AncV1EnrollmentChallenge,
): Uint8Array {
  exact(value, CHALLENGE_FIELDS, "Enrollment challenge");
  const { signature, ...unsigned } = value;
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      ...unsignedChallengeMap(unsigned),
      [CHALLENGE.signature, bytes(signature, SIGNATURE_BYTES, "signature")],
    ]),
  );
}

export async function signAncV1EnrollmentChallenge(
  value: AncV1UnsignedEnrollmentChallenge,
  authorizerSigningPrivateKey: Uint8Array,
): Promise<AncV1EnrollmentChallenge> {
  const preimage = encodeAncV1UnsignedEnrollmentChallenge(value);
  return {
    ...value,
    signature: await ancV1SignDetached(
      "enrollment-challenge",
      preimage,
      authorizerSigningPrivateKey,
    ),
  };
}

export function decodeAncV1EnrollmentChallenge(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1EnrollmentChallenge {
  exact(binding, ["expectedVaultId"], "Challenge binding");
  const map = decodeMap(
    encoded,
    challengeKeys,
    E2EE_SIZE_LIMITS.controlEnvelopeBytes,
  );
  const result: AncV1EnrollmentChallenge = {
    ...commonFromMap(map, "enrollment-challenge", binding.expectedVaultId),
    offerHash: bytes(
      field(map, CHALLENGE.offerHash, "offerHash"),
      HASH_BYTES,
      "offerHash",
    ),
    candidateKeyProof: bytes(
      field(map, CHALLENGE.candidateKeyProof, "candidateKeyProof"),
      SIGNATURE_BYTES,
      "candidateKeyProof",
    ),
    authorizerEndpointId: bytes(
      field(map, CHALLENGE.authorizerEndpointId, "authorizerEndpointId"),
      ID_BYTES,
      "authorizerEndpointId",
    ),
    authorizerSigningPublicKey: bytes(
      field(
        map,
        CHALLENGE.authorizerSigningPublicKey,
        "authorizerSigningPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "authorizerSigningPublicKey",
    ),
    authorizerKeyAgreementPublicKey: bytes(
      field(
        map,
        CHALLENGE.authorizerKeyAgreementPublicKey,
        "authorizerKeyAgreementPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "authorizerKeyAgreementPublicKey",
    ),
    controlSequence: integer(
      field(map, CHALLENGE.controlSequence, "controlSequence"),
      0,
      "controlSequence",
    ),
    controlHeadHash: bytes(
      field(map, CHALLENGE.controlHeadHash, "controlHeadHash"),
      HASH_BYTES,
      "controlHeadHash",
    ),
    membershipHash: bytes(
      field(map, CHALLENGE.membershipHash, "membershipHash"),
      HASH_BYTES,
      "membershipHash",
    ),
    targetMembershipRole: role(
      field(map, CHALLENGE.targetMembershipRole, "targetMembershipRole"),
      "targetMembershipRole",
    ),
    sasTranscriptHash: bytes(
      field(map, CHALLENGE.sasTranscriptHash, "sasTranscriptHash"),
      HASH_BYTES,
      "sasTranscriptHash",
    ),
    challengeNonce: bytes(
      field(map, CHALLENGE.challengeNonce, "challengeNonce"),
      NONCE_BYTES,
      "challengeNonce",
    ),
    expiresAt: integer(
      field(map, CHALLENGE.expiresAt, "expiresAt"),
      1,
      "expiresAt",
    ),
    signature: bytes(
      field(map, CHALLENGE.signature, "signature"),
      SIGNATURE_BYTES,
      "signature",
    ),
  };
  assertLifetime(result.createdAt, result.expiresAt, "Challenge");
  return result;
}

export async function createAncV1CandidateKeyProof(
  offerHash: Uint8Array,
  candidateSigningPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  return ancV1SignDetached(
    "enrollment-key-proof",
    bytes(offerHash, HASH_BYTES, "offerHash"),
    candidateSigningPrivateKey,
  );
}

export async function verifyAncV1CandidateKeyProof(
  offerHash: Uint8Array,
  proof: Uint8Array,
  candidateSigningPublicKey: Uint8Array,
): Promise<boolean> {
  return ancV1VerifyDetached(
    "enrollment-key-proof",
    bytes(offerHash, HASH_BYTES, "offerHash"),
    bytes(proof, SIGNATURE_BYTES, "candidateKeyProof"),
    bytes(
      candidateSigningPublicKey,
      PUBLIC_KEY_BYTES,
      "candidateSigningPublicKey",
    ),
  );
}

const SAS_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "ceremonyId",
  "offerHash",
  "candidateEndpointId",
  "candidateSigningPublicKey",
  "candidateKeyAgreementPublicKey",
  "candidateKeyProof",
  "authorizerEndpointId",
  "authorizerSigningPublicKey",
  "authorizerKeyAgreementPublicKey",
  "controlSequence",
  "controlHeadHash",
  "membershipHash",
  "targetMembershipRole",
  "challengeNonce",
  "challengeEnvelopeId",
  "challengeCreatedAt",
  "challengeExpiresAt",
] as const;
const sasKeys = [
  COMMON.suite,
  COMMON.vaultId,
  COMMON.type,
  ...Object.values(SAS),
];

export function encodeAncV1EnrollmentSasTranscript(
  value: AncV1EnrollmentSasTranscript,
): Uint8Array {
  exact(value, SAS_FIELDS, "Enrollment SAS transcript");
  assertLifetime(
    value.challengeCreatedAt,
    value.challengeExpiresAt,
    "Challenge",
  );
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [COMMON.suite, literal(value.suite, E2EE_SUITE_ID, "suite")],
      [COMMON.vaultId, bytes(value.vaultId, ID_BYTES, "vaultId")],
      [COMMON.type, literal(value.type, "enrollment-sas", "type")],
      [SAS.ceremonyId, bytes(value.ceremonyId, ID_BYTES, "ceremonyId")],
      [SAS.offerHash, bytes(value.offerHash, HASH_BYTES, "offerHash")],
      [
        SAS.candidateEndpointId,
        bytes(value.candidateEndpointId, ID_BYTES, "candidateEndpointId"),
      ],
      [
        SAS.candidateSigningPublicKey,
        bytes(
          value.candidateSigningPublicKey,
          PUBLIC_KEY_BYTES,
          "candidateSigningPublicKey",
        ),
      ],
      [
        SAS.candidateKeyAgreementPublicKey,
        bytes(
          value.candidateKeyAgreementPublicKey,
          PUBLIC_KEY_BYTES,
          "candidateKeyAgreementPublicKey",
        ),
      ],
      [
        SAS.candidateKeyProof,
        bytes(value.candidateKeyProof, SIGNATURE_BYTES, "candidateKeyProof"),
      ],
      [
        SAS.authorizerEndpointId,
        bytes(value.authorizerEndpointId, ID_BYTES, "authorizerEndpointId"),
      ],
      [
        SAS.authorizerSigningPublicKey,
        bytes(
          value.authorizerSigningPublicKey,
          PUBLIC_KEY_BYTES,
          "authorizerSigningPublicKey",
        ),
      ],
      [
        SAS.authorizerKeyAgreementPublicKey,
        bytes(
          value.authorizerKeyAgreementPublicKey,
          PUBLIC_KEY_BYTES,
          "authorizerKeyAgreementPublicKey",
        ),
      ],
      [
        SAS.controlSequence,
        integer(value.controlSequence, 0, "controlSequence"),
      ],
      [
        SAS.controlHeadHash,
        bytes(value.controlHeadHash, HASH_BYTES, "controlHeadHash"),
      ],
      [
        SAS.membershipHash,
        bytes(value.membershipHash, HASH_BYTES, "membershipHash"),
      ],
      [
        SAS.targetMembershipRole,
        role(value.targetMembershipRole, "targetMembershipRole"),
      ],
      [
        SAS.challengeNonce,
        bytes(value.challengeNonce, NONCE_BYTES, "challengeNonce"),
      ],
      [
        SAS.challengeEnvelopeId,
        bytes(value.challengeEnvelopeId, ID_BYTES, "challengeEnvelopeId"),
      ],
      [
        SAS.challengeCreatedAt,
        integer(value.challengeCreatedAt, 1, "challengeCreatedAt"),
      ],
      [
        SAS.challengeExpiresAt,
        integer(value.challengeExpiresAt, 1, "challengeExpiresAt"),
      ],
    ]),
  );
}

export function decodeAncV1EnrollmentSasTranscript(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1EnrollmentSasTranscript {
  exact(binding, ["expectedVaultId"], "SAS transcript binding");
  const map = decodeMap(
    encoded,
    sasKeys,
    E2EE_SIZE_LIMITS.controlEnvelopeBytes,
  );
  const vaultId = bytes(
    field(map, COMMON.vaultId, "vaultId"),
    ID_BYTES,
    "vaultId",
  );
  if (
    !equalBytes(
      vaultId,
      bytes(binding.expectedVaultId, ID_BYTES, "expectedVaultId"),
    )
  )
    fail("SAS vault binding does not match");
  const result: AncV1EnrollmentSasTranscript = {
    suite: literal(field(map, COMMON.suite, "suite"), E2EE_SUITE_ID, "suite"),
    vaultId,
    type: literal(field(map, COMMON.type, "type"), "enrollment-sas", "type"),
    ceremonyId: bytes(
      field(map, SAS.ceremonyId, "ceremonyId"),
      ID_BYTES,
      "ceremonyId",
    ),
    offerHash: bytes(
      field(map, SAS.offerHash, "offerHash"),
      HASH_BYTES,
      "offerHash",
    ),
    candidateEndpointId: bytes(
      field(map, SAS.candidateEndpointId, "candidateEndpointId"),
      ID_BYTES,
      "candidateEndpointId",
    ),
    candidateSigningPublicKey: bytes(
      field(map, SAS.candidateSigningPublicKey, "candidateSigningPublicKey"),
      PUBLIC_KEY_BYTES,
      "candidateSigningPublicKey",
    ),
    candidateKeyAgreementPublicKey: bytes(
      field(
        map,
        SAS.candidateKeyAgreementPublicKey,
        "candidateKeyAgreementPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "candidateKeyAgreementPublicKey",
    ),
    candidateKeyProof: bytes(
      field(map, SAS.candidateKeyProof, "candidateKeyProof"),
      SIGNATURE_BYTES,
      "candidateKeyProof",
    ),
    authorizerEndpointId: bytes(
      field(map, SAS.authorizerEndpointId, "authorizerEndpointId"),
      ID_BYTES,
      "authorizerEndpointId",
    ),
    authorizerSigningPublicKey: bytes(
      field(map, SAS.authorizerSigningPublicKey, "authorizerSigningPublicKey"),
      PUBLIC_KEY_BYTES,
      "authorizerSigningPublicKey",
    ),
    authorizerKeyAgreementPublicKey: bytes(
      field(
        map,
        SAS.authorizerKeyAgreementPublicKey,
        "authorizerKeyAgreementPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "authorizerKeyAgreementPublicKey",
    ),
    controlSequence: integer(
      field(map, SAS.controlSequence, "controlSequence"),
      0,
      "controlSequence",
    ),
    controlHeadHash: bytes(
      field(map, SAS.controlHeadHash, "controlHeadHash"),
      HASH_BYTES,
      "controlHeadHash",
    ),
    membershipHash: bytes(
      field(map, SAS.membershipHash, "membershipHash"),
      HASH_BYTES,
      "membershipHash",
    ),
    targetMembershipRole: role(
      field(map, SAS.targetMembershipRole, "targetMembershipRole"),
      "targetMembershipRole",
    ),
    challengeNonce: bytes(
      field(map, SAS.challengeNonce, "challengeNonce"),
      NONCE_BYTES,
      "challengeNonce",
    ),
    challengeEnvelopeId: bytes(
      field(map, SAS.challengeEnvelopeId, "challengeEnvelopeId"),
      ID_BYTES,
      "challengeEnvelopeId",
    ),
    challengeCreatedAt: integer(
      field(map, SAS.challengeCreatedAt, "challengeCreatedAt"),
      1,
      "challengeCreatedAt",
    ),
    challengeExpiresAt: integer(
      field(map, SAS.challengeExpiresAt, "challengeExpiresAt"),
      1,
      "challengeExpiresAt",
    ),
  };
  assertLifetime(
    result.challengeCreatedAt,
    result.challengeExpiresAt,
    "Challenge",
  );
  return result;
}

export async function hashAncV1EnrollmentSasTranscript(
  transcript: AncV1EnrollmentSasTranscript,
): Promise<Uint8Array> {
  return ancV1Hash(
    "enrollment-sas",
    encodeAncV1EnrollmentSasTranscript(transcript),
  );
}

function uint32be(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

/** Unbiased 9-digit SAS with rejection sampling and fixed DDD-DDD-DDD display. */
export async function deriveAncV1EnrollmentSasCode(
  transcriptHash: Uint8Array,
): Promise<string> {
  const digest = bytes(transcriptHash, HASH_BYTES, "sasTranscriptHash");
  let block = digest;
  let counter = 0;
  while (true) {
    const candidate = new DataView(
      block.buffer,
      block.byteOffset,
      block.byteLength,
    ).getUint32(0, false);
    if (candidate < 4_000_000_000) {
      const digits = String(candidate % 1_000_000_000).padStart(9, "0");
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    block = await ancV1Hash(
      "enrollment-sas",
      concat(digest, uint32be(counter)),
    );
    counter += 1;
  }
}

export function enrollmentSasComparisonOutcome(
  matches: boolean,
): "confirmed" | "terminally_consumed_mismatch" {
  return matches ? "confirmed" : "terminally_consumed_mismatch";
}

function sasFromOfferAndChallenge(
  offer: AncV1EndpointEnrollmentOffer,
  challenge: AncV1EnrollmentChallenge,
): AncV1EnrollmentSasTranscript {
  return {
    suite: E2EE_SUITE_ID,
    vaultId: offer.vaultId,
    type: "enrollment-sas",
    ceremonyId: offer.ceremonyId,
    offerHash: challenge.offerHash,
    candidateEndpointId: offer.endpointId,
    candidateSigningPublicKey: offer.signingPublicKey,
    candidateKeyAgreementPublicKey: offer.keyAgreementPublicKey,
    candidateKeyProof: challenge.candidateKeyProof,
    authorizerEndpointId: challenge.authorizerEndpointId,
    authorizerSigningPublicKey: challenge.authorizerSigningPublicKey,
    authorizerKeyAgreementPublicKey: challenge.authorizerKeyAgreementPublicKey,
    controlSequence: challenge.controlSequence,
    controlHeadHash: challenge.controlHeadHash,
    membershipHash: challenge.membershipHash,
    targetMembershipRole: challenge.targetMembershipRole,
    challengeNonce: challenge.challengeNonce,
    challengeEnvelopeId: challenge.envelopeId,
    challengeCreatedAt: challenge.createdAt,
    challengeExpiresAt: challenge.expiresAt,
  };
}

function activeAuthorizer(
  state: ControlLogState,
  endpointId: Uint8Array,
): ControlLogMember {
  const id = ancV1LifecycleIdToHex(endpointId);
  const member = state.activeMembers.find(
    (candidate) => candidate.endpointId === id,
  );
  if (!member || member.role !== "endpoint") {
    fail("Enrollment authorizer must be an active attended endpoint");
  }
  return member;
}

export async function verifyAncV1EnrollmentChallenge(
  encodedChallenge: Uint8Array,
  input: {
    encodedOffer: Uint8Array;
    verifiedControlState: ControlLogState;
    now: number;
  },
): Promise<{
  offer: AncV1EndpointEnrollmentOffer;
  challenge: AncV1EnrollmentChallenge;
  transcript: AncV1EnrollmentSasTranscript;
  transcriptHash: Uint8Array;
  sasCode: string;
}> {
  exact(
    input,
    ["encodedOffer", "verifiedControlState", "now"],
    "Challenge verification input",
  );
  const now = integer(input.now, 1, "now");
  const state = assertFreshControlLogHead(
    input.verifiedControlState,
    new Date(now * 1000),
  );
  const vaultId = lowerHexBytes(state.vaultId, ID_BYTES, "state.vaultId");
  const offer = decodeAncV1EndpointEnrollmentOffer(input.encodedOffer, {
    expectedVaultId: vaultId,
  });
  const challenge = decodeAncV1EnrollmentChallenge(encodedChallenge, {
    expectedVaultId: vaultId,
  });
  if (
    offer.createdAt > now ||
    offer.expiresAt < now ||
    challenge.createdAt > now ||
    challenge.expiresAt < now ||
    challenge.createdAt < offer.createdAt ||
    challenge.createdAt > offer.expiresAt
  ) {
    fail("Offer or challenge is future-dated, expired, and consumed");
  }
  const freshnessDeadline =
    Math.floor(Date.parse(state.signedAt) / 1000) + 15 * 60;
  if (challenge.expiresAt > freshnessDeadline) {
    fail("Challenge expiry exceeds the authenticated control-head freshness");
  }
  const candidateId = ancV1LifecycleIdToHex(offer.endpointId);
  if (
    state.activeMembers.some((member) => member.endpointId === candidateId) ||
    state.removedEndpointIds.includes(candidateId)
  ) {
    fail("Candidate endpoint is already active or tombstoned");
  }
  const expectedOfferHash = await hashAncV1EndpointEnrollmentOffer(
    input.encodedOffer,
    { expectedVaultId: vaultId },
  );
  if (!equalBytes(challenge.offerHash, expectedOfferHash))
    fail("Challenge offer hash does not match");
  if (offer.membershipRole !== challenge.targetMembershipRole)
    fail("Challenge role does not match offer");
  if (
    challenge.targetMembershipRole === "broker" &&
    state.activeMembers.some((member) => member.role === "broker")
  ) {
    fail("A broker is already active");
  }
  if (
    !(await verifyAncV1CandidateKeyProof(
      challenge.offerHash,
      challenge.candidateKeyProof,
      offer.signingPublicKey,
    ))
  ) {
    fail("Candidate key proof verification failed");
  }
  const authorizer = activeAuthorizer(state, challenge.authorizerEndpointId);
  if (
    authorizer.signingPublicKey !==
      ancV1BytesToHex(challenge.authorizerSigningPublicKey) ||
    authorizer.keyAgreementPublicKey !==
      ancV1BytesToHex(challenge.authorizerKeyAgreementPublicKey)
  )
    fail("Challenge authorizer keys do not match verified membership");
  if (
    challenge.controlSequence !== state.sequence ||
    !equalBytes(
      challenge.controlHeadHash,
      lowerHexBytes(state.headHash, HASH_BYTES, "headHash"),
    ) ||
    !equalBytes(
      challenge.membershipHash,
      lowerHexBytes(state.membershipHash, HASH_BYTES, "membershipHash"),
    )
  )
    fail("Challenge control state is stale or mismatched");
  const { signature, ...unsigned } = challenge;
  if (
    !(await ancV1VerifyDetached(
      "enrollment-challenge",
      encodeAncV1UnsignedEnrollmentChallenge(unsigned),
      signature,
      challenge.authorizerSigningPublicKey,
    ))
  )
    fail("Challenge signature verification failed");
  const transcript = sasFromOfferAndChallenge(offer, challenge);
  const transcriptHash = await hashAncV1EnrollmentSasTranscript(transcript);
  if (!equalBytes(transcriptHash, challenge.sasTranscriptHash))
    fail("Challenge SAS transcript hash does not match");
  return {
    offer,
    challenge,
    transcript,
    transcriptHash,
    sasCode: await deriveAncV1EnrollmentSasCode(transcriptHash),
  };
}

const AUTHORIZATION_UNSIGNED_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "offerHash",
  "challengeHash",
  "authorizerEndpointId",
  "targetMembershipRole",
  "previousControlSequence",
  "previousControlHeadHash",
  "previousMembershipHash",
  "endpointEnvelope",
  "eekWrapEnvelope",
  "signedMembershipCommit",
  "expiresAt",
] as const;
const AUTHORIZATION_FIELDS = [
  ...AUTHORIZATION_UNSIGNED_FIELDS,
  "signature",
] as const;
const authorizationKeys = [
  ...Object.values(COMMON),
  ...Object.values(AUTHORIZATION),
];

function unsignedAuthorizationMap(
  value: AncV1UnsignedEnrollmentAuthorization,
): Map<number, AncV1CanonicalValue> {
  exact(
    value,
    AUTHORIZATION_UNSIGNED_FIELDS,
    "Unsigned enrollment authorization",
  );
  assertLifetime(value.createdAt, value.expiresAt, "Authorization");
  return new Map<number, AncV1CanonicalValue>([
    ...commonMap(value, "enrollment-authorization"),
    [AUTHORIZATION.offerHash, bytes(value.offerHash, HASH_BYTES, "offerHash")],
    [
      AUTHORIZATION.challengeHash,
      bytes(value.challengeHash, HASH_BYTES, "challengeHash"),
    ],
    [
      AUTHORIZATION.authorizerEndpointId,
      bytes(value.authorizerEndpointId, ID_BYTES, "authorizerEndpointId"),
    ],
    [
      AUTHORIZATION.targetMembershipRole,
      role(value.targetMembershipRole, "targetMembershipRole"),
    ],
    [
      AUTHORIZATION.previousControlSequence,
      integer(value.previousControlSequence, 0, "previousControlSequence"),
    ],
    [
      AUTHORIZATION.previousControlHeadHash,
      bytes(
        value.previousControlHeadHash,
        HASH_BYTES,
        "previousControlHeadHash",
      ),
    ],
    [
      AUTHORIZATION.previousMembershipHash,
      bytes(value.previousMembershipHash, HASH_BYTES, "previousMembershipHash"),
    ],
    [
      AUTHORIZATION.endpointEnvelope,
      canonicalEnvelopeBytes(
        value.endpointEnvelope,
        65_536,
        "endpointEnvelope",
      ),
    ],
    [
      AUTHORIZATION.eekWrapEnvelope,
      canonicalEnvelopeBytes(value.eekWrapEnvelope, 65_536, "eekWrapEnvelope"),
    ],
    [
      AUTHORIZATION.signedMembershipCommit,
      canonicalEnvelopeBytes(
        value.signedMembershipCommit,
        65_536,
        "signedMembershipCommit",
      ),
    ],
    [AUTHORIZATION.expiresAt, integer(value.expiresAt, 1, "expiresAt")],
  ]);
}

export function encodeAncV1UnsignedEnrollmentAuthorization(
  value: AncV1UnsignedEnrollmentAuthorization,
): Uint8Array {
  return encodeAncV1Canonical(unsignedAuthorizationMap(value));
}

export function encodeAncV1EnrollmentAuthorization(
  value: AncV1EnrollmentAuthorization,
): Uint8Array {
  exact(value, AUTHORIZATION_FIELDS, "Enrollment authorization");
  const { signature, ...unsigned } = value;
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      ...unsignedAuthorizationMap(unsigned),
      [AUTHORIZATION.signature, bytes(signature, SIGNATURE_BYTES, "signature")],
    ]),
  );
  if (encoded.byteLength > E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes) {
    fail("Enrollment authorization exceeds 262144 bytes");
  }
  return encoded;
}

export async function signAncV1EnrollmentAuthorization(
  value: AncV1UnsignedEnrollmentAuthorization,
  authorizerSigningPrivateKey: Uint8Array,
): Promise<AncV1EnrollmentAuthorization> {
  return {
    ...value,
    signature: await ancV1SignDetached(
      "enrollment-authorization",
      encodeAncV1UnsignedEnrollmentAuthorization(value),
      authorizerSigningPrivateKey,
    ),
  };
}

export function decodeAncV1EnrollmentAuthorization(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1EnrollmentAuthorization {
  exact(binding, ["expectedVaultId"], "Authorization binding");
  const map = decodeMap(
    encoded,
    authorizationKeys,
    E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes,
  );
  const result: AncV1EnrollmentAuthorization = {
    ...commonFromMap(map, "enrollment-authorization", binding.expectedVaultId),
    offerHash: bytes(
      field(map, AUTHORIZATION.offerHash, "offerHash"),
      HASH_BYTES,
      "offerHash",
    ),
    challengeHash: bytes(
      field(map, AUTHORIZATION.challengeHash, "challengeHash"),
      HASH_BYTES,
      "challengeHash",
    ),
    authorizerEndpointId: bytes(
      field(map, AUTHORIZATION.authorizerEndpointId, "authorizerEndpointId"),
      ID_BYTES,
      "authorizerEndpointId",
    ),
    targetMembershipRole: role(
      field(map, AUTHORIZATION.targetMembershipRole, "targetMembershipRole"),
      "targetMembershipRole",
    ),
    previousControlSequence: integer(
      field(
        map,
        AUTHORIZATION.previousControlSequence,
        "previousControlSequence",
      ),
      0,
      "previousControlSequence",
    ),
    previousControlHeadHash: bytes(
      field(
        map,
        AUTHORIZATION.previousControlHeadHash,
        "previousControlHeadHash",
      ),
      HASH_BYTES,
      "previousControlHeadHash",
    ),
    previousMembershipHash: bytes(
      field(
        map,
        AUTHORIZATION.previousMembershipHash,
        "previousMembershipHash",
      ),
      HASH_BYTES,
      "previousMembershipHash",
    ),
    endpointEnvelope: canonicalEnvelopeBytes(
      field(map, AUTHORIZATION.endpointEnvelope, "endpointEnvelope"),
      65_536,
      "endpointEnvelope",
    ),
    eekWrapEnvelope: canonicalEnvelopeBytes(
      field(map, AUTHORIZATION.eekWrapEnvelope, "eekWrapEnvelope"),
      65_536,
      "eekWrapEnvelope",
    ),
    signedMembershipCommit: canonicalEnvelopeBytes(
      field(
        map,
        AUTHORIZATION.signedMembershipCommit,
        "signedMembershipCommit",
      ),
      65_536,
      "signedMembershipCommit",
    ),
    expiresAt: integer(
      field(map, AUTHORIZATION.expiresAt, "expiresAt"),
      1,
      "expiresAt",
    ),
    signature: bytes(
      field(map, AUTHORIZATION.signature, "signature"),
      SIGNATURE_BYTES,
      "signature",
    ),
  };
  assertLifetime(result.createdAt, result.expiresAt, "Authorization");
  return result;
}

export async function hashAncV1EnrollmentChallenge(
  encodedChallenge: Uint8Array,
  expectedVaultId: Uint8Array,
): Promise<Uint8Array> {
  decodeAncV1EnrollmentChallenge(encodedChallenge, { expectedVaultId });
  return ancV1Hash("enrollment-challenge", encodedChallenge.slice());
}

export async function verifyAncV1EnrollmentAuthorizationSignature(
  encoded: Uint8Array,
  binding: {
    expectedVaultId: Uint8Array;
    expectedAuthorizerSigningPublicKey: Uint8Array;
  },
): Promise<AncV1EnrollmentAuthorization> {
  exact(
    binding,
    ["expectedVaultId", "expectedAuthorizerSigningPublicKey"],
    "Authorization verification binding",
  );
  const authorization = decodeAncV1EnrollmentAuthorization(encoded, {
    expectedVaultId: binding.expectedVaultId,
  });
  const { signature, ...unsigned } = authorization;
  if (
    !(await ancV1VerifyDetached(
      "enrollment-authorization",
      encodeAncV1UnsignedEnrollmentAuthorization(unsigned),
      signature,
      bytes(
        binding.expectedAuthorizerSigningPublicKey,
        PUBLIC_KEY_BYTES,
        "expectedAuthorizerSigningPublicKey",
      ),
    ))
  )
    fail("Enrollment authorization signature verification failed");
  return authorization;
}

type CandidateEndpointEnvelope = {
  softwareKind: string;
  unattended: boolean;
  endpointId: Uint8Array;
  signingPublicKey: Uint8Array;
  keyAgreementPublicKey: Uint8Array;
  addedByEndpointId: Uint8Array;
  sasTranscriptHash: Uint8Array;
  signature: Uint8Array;
};

function decodeCandidateEndpointEnvelope(
  encoded: Uint8Array,
  expectedVaultId: Uint8Array,
): CandidateEndpointEnvelope {
  const endpoint = E2EE_ENVELOPE_FIELDS.endpoint;
  const allowed = [...Object.values(COMMON), ...Object.values(endpoint)];
  const map = decodeMap(
    encoded,
    allowed,
    E2EE_SIZE_LIMITS.controlEnvelopeBytes,
  );
  commonFromMap(map, "endpoint", expectedVaultId);
  const softwareKind = boundedText(
    field(map, endpoint.role, "endpoint.role"),
    64,
    "endpoint.role",
  );
  const unattended = field(map, endpoint.unattended, "endpoint.unattended");
  if (typeof unattended !== "boolean") {
    fail("endpoint.unattended must be boolean");
  }
  return {
    softwareKind,
    unattended,
    endpointId: bytes(
      field(map, endpoint.endpointId, "endpointId"),
      ID_BYTES,
      "endpointId",
    ),
    signingPublicKey: bytes(
      field(map, endpoint.signingPublicKey, "signingPublicKey"),
      PUBLIC_KEY_BYTES,
      "signingPublicKey",
    ),
    keyAgreementPublicKey: bytes(
      field(map, endpoint.keyAgreementPublicKey, "keyAgreementPublicKey"),
      PUBLIC_KEY_BYTES,
      "keyAgreementPublicKey",
    ),
    addedByEndpointId: bytes(
      field(map, endpoint.addedByEndpointId, "addedByEndpointId"),
      ID_BYTES,
      "addedByEndpointId",
    ),
    sasTranscriptHash: bytes(
      field(map, endpoint.sasTranscriptHash, "sasTranscriptHash"),
      HASH_BYTES,
      "sasTranscriptHash",
    ),
    signature: bytes(
      field(map, endpoint.signature, "signature"),
      SIGNATURE_BYTES,
      "signature",
    ),
  };
}

/**
 * Verify the complete authorization bundle against one authenticated control
 * state. The returned state is the exact signed membership commit result.
 */
export async function verifyAncV1EnrollmentAuthorization(
  encodedAuthorization: Uint8Array,
  input: {
    encodedOffer: Uint8Array;
    encodedChallenge: Uint8Array;
    verifiedControlState: ControlLogState;
    now: number;
  },
): Promise<{
  authorization: AncV1EnrollmentAuthorization;
  state: ControlLogState;
}> {
  exact(
    input,
    ["encodedOffer", "encodedChallenge", "verifiedControlState", "now"],
    "Authorization verification input",
  );
  const state = controlLogStateSchema.parse(input.verifiedControlState);
  const vaultId = lowerHexBytes(state.vaultId, ID_BYTES, "state.vaultId");
  const challengeResult = await verifyAncV1EnrollmentChallenge(
    input.encodedChallenge,
    {
      encodedOffer: input.encodedOffer,
      verifiedControlState: state,
      now: Math.min(input.now, Number.MAX_SAFE_INTEGER),
    },
  );
  const authorizer = activeAuthorizer(
    state,
    challengeResult.challenge.authorizerEndpointId,
  );
  const authorization = await verifyAncV1EnrollmentAuthorizationSignature(
    encodedAuthorization,
    {
      expectedVaultId: vaultId,
      expectedAuthorizerSigningPublicKey:
        challengeResult.challenge.authorizerSigningPublicKey,
    },
  );
  const expectedChallengeHash = await hashAncV1EnrollmentChallenge(
    input.encodedChallenge,
    vaultId,
  );
  if (
    !equalBytes(authorization.offerHash, challengeResult.challenge.offerHash) ||
    !equalBytes(authorization.challengeHash, expectedChallengeHash)
  )
    fail("Authorization offer or challenge hash does not match");
  if (
    authorization.targetMembershipRole !==
      challengeResult.offer.membershipRole ||
    authorization.targetMembershipRole !==
      challengeResult.challenge.targetMembershipRole
  )
    fail("Authorization membership role does not match");
  if (
    authorization.previousControlSequence !== state.sequence ||
    !equalBytes(
      authorization.previousControlHeadHash,
      lowerHexBytes(state.headHash, HASH_BYTES, "headHash"),
    ) ||
    !equalBytes(
      authorization.previousMembershipHash,
      lowerHexBytes(state.membershipHash, HASH_BYTES, "membershipHash"),
    )
  )
    fail("Authorization previous control state does not match");
  if (
    !equalBytes(
      authorization.authorizerEndpointId,
      challengeResult.challenge.authorizerEndpointId,
    ) ||
    authorizer.endpointId !==
      ancV1LifecycleIdToHex(authorization.authorizerEndpointId)
  )
    fail("Authorization authorizer does not match");
  if (
    authorization.createdAt < challengeResult.challenge.createdAt ||
    authorization.createdAt > challengeResult.challenge.expiresAt ||
    input.now > authorization.expiresAt
  )
    fail("Authorization issuance is expired or outside the challenge lifetime");

  const candidateEndpoint = decodeCandidateEndpointEnvelope(
    authorization.endpointEnvelope,
    vaultId,
  );
  if (
    !equalBytes(
      candidateEndpoint.endpointId,
      challengeResult.offer.endpointId,
    ) ||
    !equalBytes(
      candidateEndpoint.signingPublicKey,
      challengeResult.offer.signingPublicKey,
    ) ||
    !equalBytes(
      candidateEndpoint.keyAgreementPublicKey,
      challengeResult.offer.keyAgreementPublicKey,
    ) ||
    !equalBytes(
      candidateEndpoint.addedByEndpointId,
      authorization.authorizerEndpointId,
    ) ||
    !equalBytes(
      candidateEndpoint.sasTranscriptHash,
      challengeResult.transcriptHash,
    ) ||
    candidateEndpoint.unattended !==
      (authorization.targetMembershipRole === "broker")
  )
    fail("Authorization candidate endpoint envelope does not match ceremony");
  const endpointMap = decodeMap(
    authorization.endpointEnvelope,
    [...Object.values(COMMON), ...Object.values(E2EE_ENVELOPE_FIELDS.endpoint)],
    E2EE_SIZE_LIMITS.controlEnvelopeBytes,
  );
  const endpointUnsigned = new Map(endpointMap);
  endpointUnsigned.delete(E2EE_ENVELOPE_FIELDS.endpoint.signature);
  if (
    !(await ancV1VerifyDetached(
      "endpoint",
      encodeAncV1Canonical(endpointUnsigned),
      candidateEndpoint.signature,
      challengeResult.challenge.authorizerSigningPublicKey,
    ))
  )
    fail("Candidate endpoint envelope signature verification failed");

  await verifyAncV1EekWrapEnvelope(authorization.eekWrapEnvelope, {
    expectedVaultId: vaultId,
    expectedRecipientEndpointId: challengeResult.offer.endpointId,
    expectedIssuerEndpointId: authorization.authorizerEndpointId,
    expectedEpoch: state.epoch,
    expectedIssuerSigningPublicKey:
      challengeResult.challenge.authorizerSigningPublicKey,
  });

  const signedCommit = decodeSignedControlLogEntry(
    authorization.signedMembershipCommit,
  );
  if (signedCommit.signerEndpointId !== authorizer.endpointId) {
    fail("Membership commit signer is not the authorizer");
  }
  if (signedCommit.innerEnvelope.type !== "membership_commit") {
    fail("Authorization component is not a membership commit");
  }
  const commit = signedCommit.innerEnvelope;
  const expectedKind =
    authorization.targetMembershipRole === "broker"
      ? "add_broker"
      : "add_device";
  if (
    commit.ceremonyId !==
    ancV1LifecycleIdToHex(challengeResult.offer.ceremonyId)
  ) {
    fail("Membership commit ceremony does not match enrollment offer");
  }
  if (
    commit.ceremonyKind !== expectedKind ||
    commit.removedEndpointIds.length !== 0 ||
    commit.rotationCompleted
  )
    fail("Membership commit transition does not match enrollment role");
  const previousIds = new Set(
    state.activeMembers.map((member) => member.endpointId),
  );
  const added = commit.activeMembers.filter(
    (member) => !previousIds.has(member.endpointId),
  );
  const expectedEnrollmentRef = ancV1LifecycleIdToHex(authorization.envelopeId);
  if (
    added.length !== 1 ||
    added[0]!.endpointId !==
      ancV1LifecycleIdToHex(challengeResult.offer.endpointId) ||
    added[0]!.role !== authorization.targetMembershipRole ||
    added[0]!.enrollmentRef !== expectedEnrollmentRef ||
    added[0]!.signingPublicKey !==
      ancV1BytesToHex(challengeResult.offer.signingPublicKey) ||
    added[0]!.keyAgreementPublicKey !==
      ancV1BytesToHex(challengeResult.offer.keyAgreementPublicKey)
  )
    fail("Membership commit does not add exactly the authorized member");
  const reduced = await verifyAndReduceControlLogEntry({
    current: state,
    entry: signedCommit,
  });
  return { authorization, state: reduced.state };
}

/**
 * Late activation path for an authorization whose exact membership commit is
 * already the authenticated control head. UX expiry is intentionally ignored
 * only after idempotent commit proof and active-candidate equality succeed.
 */
export async function verifyPersistedAncV1EnrollmentActivation(
  encodedAuthorization: Uint8Array,
  input: {
    encodedOffer: Uint8Array;
    encodedChallenge: Uint8Array;
    /** Authenticated replay state captured at the enrollment commit. */
    persistedCommitControlState: ControlLogState;
    /**
     * Fresh authenticated replay of the same transcript, including the
     * persisted commit anchor. This may have advanced beyond that anchor.
     */
    currentControlState: ControlLogState;
    /** Exact canonical signed entries, beginning with the enrollment commit. */
    descendantControlEntries: Uint8Array[];
    verifyRecoveryWrapRotation: NonNullable<
      Parameters<
        typeof verifyAndReduceControlLogEntry
      >[0]["verifyRecoveryWrapRotation"]
    >;
    now: number;
  },
): Promise<AncV1EnrollmentAuthorization> {
  exact(
    input,
    [
      "encodedOffer",
      "encodedChallenge",
      "persistedCommitControlState",
      "currentControlState",
      "descendantControlEntries",
      "verifyRecoveryWrapRotation",
      "now",
    ],
    "Persisted activation input",
  );
  const now = integer(input.now, 1, "now");
  const currentState = assertFreshControlLogHead(
    input.currentControlState,
    new Date(now * 1000),
  );
  const commitState = controlLogStateSchema.parse(
    input.persistedCommitControlState,
  );
  if (commitState.vaultId !== currentState.vaultId) {
    fail("Persisted commit anchor vault does not match current replay");
  }
  if (
    !Array.isArray(input.descendantControlEntries) ||
    input.descendantControlEntries.length < 1 ||
    input.descendantControlEntries.length > MAX_DESCENDANT_CONTROL_ENTRIES ||
    input.descendantControlEntries.some(
      (entry) => !(entry instanceof Uint8Array),
    ) ||
    input.descendantControlEntries.reduce(
      (total, entry) => total + entry.byteLength,
      0,
    ) > MAX_DESCENDANT_CONTROL_BYTES
  ) {
    fail("Descendant control replay is missing, oversized, or malformed");
  }
  const vaultId = lowerHexBytes(
    currentState.vaultId,
    ID_BYTES,
    "state.vaultId",
  );

  // Establish the signed commit as an authenticated historical anchor before
  // trusting any keys supplied by the surrounding ceremony bundle.
  const decodedAuthorization = decodeAncV1EnrollmentAuthorization(
    encodedAuthorization,
    { expectedVaultId: vaultId },
  );
  const signedCommit = decodeSignedControlLogEntry(
    decodedAuthorization.signedMembershipCommit,
  );
  if (
    !equalBytes(
      input.descendantControlEntries[0]!,
      decodedAuthorization.signedMembershipCommit,
    )
  ) {
    fail("Descendant control replay does not begin at the enrollment commit");
  }
  const anchored = await verifyAndReduceControlLogEntry({
    current: commitState,
    entry: signedCommit,
  });
  if (!anchored.idempotent || anchored.entryHash !== commitState.headHash) {
    fail("Authorization commit is not the exact persisted control anchor");
  }
  if (signedCommit.innerEnvelope.type !== "membership_commit") {
    fail("Persisted authorization component is not a membership commit");
  }
  const commit = signedCommit.innerEnvelope;
  if (
    commitState.epoch !== commit.epoch ||
    JSON.stringify(commitState.activeMembers) !==
      JSON.stringify(commit.activeMembers)
  ) {
    fail("Persisted commit anchor state does not match its signed membership");
  }
  let replayedState = commitState;
  for (const encodedEntry of input.descendantControlEntries.slice(1)) {
    const replayed = await verifyAndReduceControlLogEntry({
      current: replayedState,
      entry: decodeSignedControlLogEntry(encodedEntry),
      verifyRecoveryWrapRotation: input.verifyRecoveryWrapRotation,
    });
    if (replayed.idempotent) {
      fail("Descendant control replay repeats an already-applied entry");
    }
    replayedState = replayed.state;
  }
  if (JSON.stringify(replayedState) !== JSON.stringify(currentState)) {
    fail("Descendant control replay does not produce the exact current state");
  }

  const offer = decodeAncV1EndpointEnrollmentOffer(input.encodedOffer, {
    expectedVaultId: vaultId,
  });
  const challenge = decodeAncV1EnrollmentChallenge(input.encodedChallenge, {
    expectedVaultId: vaultId,
  });
  const offerHash = await hashAncV1EndpointEnrollmentOffer(input.encodedOffer, {
    expectedVaultId: vaultId,
  });
  if (
    !equalBytes(challenge.offerHash, offerHash) ||
    !(await verifyAncV1CandidateKeyProof(
      offerHash,
      challenge.candidateKeyProof,
      offer.signingPublicKey,
    ))
  )
    fail("Persisted activation offer or candidate proof does not match");
  const authorizer = activeAuthorizer(
    commitState,
    challenge.authorizerEndpointId,
  );
  if (
    authorizer.signingPublicKey !==
      ancV1BytesToHex(challenge.authorizerSigningPublicKey) ||
    authorizer.keyAgreementPublicKey !==
      ancV1BytesToHex(challenge.authorizerKeyAgreementPublicKey)
  ) {
    fail("Persisted challenge authorizer keys do not match active membership");
  }
  const { signature: challengeSignature, ...unsignedChallenge } = challenge;
  if (
    !(await ancV1VerifyDetached(
      "enrollment-challenge",
      encodeAncV1UnsignedEnrollmentChallenge(unsignedChallenge),
      challengeSignature,
      challenge.authorizerSigningPublicKey,
    ))
  )
    fail("Persisted challenge signature verification failed");
  const transcriptHash = await hashAncV1EnrollmentSasTranscript(
    sasFromOfferAndChallenge(offer, challenge),
  );
  if (!equalBytes(transcriptHash, challenge.sasTranscriptHash)) {
    fail("Persisted challenge SAS transcript does not match");
  }
  const authorization = await verifyAncV1EnrollmentAuthorizationSignature(
    encodedAuthorization,
    {
      expectedVaultId: vaultId,
      expectedAuthorizerSigningPublicKey: lowerHexBytes(
        authorizer.signingPublicKey,
        PUBLIC_KEY_BYTES,
        "authorizer.signingPublicKey",
      ),
    },
  );
  const challengeHash = await hashAncV1EnrollmentChallenge(
    input.encodedChallenge,
    vaultId,
  );
  if (
    !equalBytes(authorization.offerHash, offerHash) ||
    !equalBytes(authorization.challengeHash, challengeHash) ||
    !equalBytes(
      authorization.authorizerEndpointId,
      challenge.authorizerEndpointId,
    ) ||
    authorization.targetMembershipRole !== offer.membershipRole ||
    authorization.targetMembershipRole !== challenge.targetMembershipRole
  )
    fail("Persisted authorization ceremony binding does not match");
  if (
    challenge.createdAt < offer.createdAt ||
    challenge.createdAt > offer.expiresAt ||
    authorization.createdAt < challenge.createdAt ||
    authorization.createdAt > challenge.expiresAt
  ) {
    fail("Persisted authorization issuance is outside the ceremony lifetime");
  }
  if (
    signedCommit.sequence !== challenge.controlSequence + 1 ||
    authorization.previousControlSequence !== challenge.controlSequence ||
    signedCommit.previousHash !== ancV1BytesToHex(challenge.controlHeadHash) ||
    !equalBytes(
      authorization.previousControlHeadHash,
      challenge.controlHeadHash,
    ) ||
    commit.previousMembershipHash !==
      ancV1BytesToHex(challenge.membershipHash) ||
    !equalBytes(
      authorization.previousMembershipHash,
      challenge.membershipHash,
    ) ||
    signedCommit.signerEndpointId !== authorizer.endpointId ||
    commit.ceremonyId !== ancV1LifecycleIdToHex(offer.ceremonyId)
  ) {
    fail("Persisted ceremony does not bind the signed commit predecessor");
  }
  const expectedKind =
    authorization.targetMembershipRole === "broker"
      ? "add_broker"
      : "add_device";
  if (
    commit.ceremonyKind !== expectedKind ||
    commit.removedEndpointIds.length !== 0 ||
    commit.rotationCompleted ||
    commit.outstandingJobsResolved
  ) {
    fail("Persisted membership commit does not match the enrollment role");
  }

  const endpoint = decodeCandidateEndpointEnvelope(
    authorization.endpointEnvelope,
    vaultId,
  );
  if (
    !equalBytes(endpoint.endpointId, offer.endpointId) ||
    !equalBytes(endpoint.signingPublicKey, offer.signingPublicKey) ||
    !equalBytes(endpoint.keyAgreementPublicKey, offer.keyAgreementPublicKey) ||
    !equalBytes(endpoint.addedByEndpointId, challenge.authorizerEndpointId) ||
    !equalBytes(endpoint.sasTranscriptHash, transcriptHash) ||
    endpoint.unattended !== (authorization.targetMembershipRole === "broker")
  ) {
    fail("Persisted endpoint envelope does not match the ceremony");
  }
  const endpointMap = decodeMap(
    authorization.endpointEnvelope,
    [...Object.values(COMMON), ...Object.values(E2EE_ENVELOPE_FIELDS.endpoint)],
    E2EE_SIZE_LIMITS.controlEnvelopeBytes,
  );
  const endpointUnsigned = new Map(endpointMap);
  endpointUnsigned.delete(E2EE_ENVELOPE_FIELDS.endpoint.signature);
  if (
    !(await ancV1VerifyDetached(
      "endpoint",
      encodeAncV1Canonical(endpointUnsigned),
      endpoint.signature,
      challenge.authorizerSigningPublicKey,
    ))
  ) {
    fail("Persisted endpoint envelope signature verification failed");
  }

  await verifyAncV1EekWrapEnvelope(authorization.eekWrapEnvelope, {
    expectedVaultId: vaultId,
    expectedRecipientEndpointId: offer.endpointId,
    expectedIssuerEndpointId: challenge.authorizerEndpointId,
    expectedEpoch: commit.epoch,
    expectedIssuerSigningPublicKey: challenge.authorizerSigningPublicKey,
  });

  const candidateId = ancV1LifecycleIdToHex(offer.endpointId);
  const expectedEnrollmentRef = ancV1LifecycleIdToHex(authorization.envelopeId);
  const committedCandidate = commit.activeMembers.find(
    (member) => member.endpointId === candidateId,
  );
  if (
    !committedCandidate ||
    committedCandidate.role !== authorization.targetMembershipRole ||
    committedCandidate.unattended !== endpoint.unattended ||
    committedCandidate.enrollmentRef !== expectedEnrollmentRef ||
    committedCandidate.signingPublicKey !==
      ancV1BytesToHex(offer.signingPublicKey) ||
    committedCandidate.keyAgreementPublicKey !==
      ancV1BytesToHex(offer.keyAgreementPublicKey)
  )
    fail("Signed commit candidate does not match the authorization");
  const currentCandidate = currentState.activeMembers.find(
    (member) => member.endpointId === candidateId,
  );
  if (
    !currentCandidate ||
    currentState.removedEndpointIds.includes(candidateId) ||
    JSON.stringify(currentCandidate) !== JSON.stringify(committedCandidate)
  ) {
    fail("Persisted candidate is no longer active or has changed authority");
  }
  return authorization;
}

export function ancV1EnrollmentOfferLiveChallengeKey(
  vaultId: Uint8Array,
  offerHash: Uint8Array,
): string {
  return `${ancV1LifecycleIdToHex(vaultId)}:${ancV1BytesToHex(bytes(offerHash, HASH_BYTES, "offerHash"))}`;
}

export function ancV1EnrollmentChallengeConsumptionKey(
  challengeEnvelopeId: Uint8Array,
  challengeNonce: Uint8Array,
): string {
  return `${ancV1LifecycleIdToHex(challengeEnvelopeId)}:${ancV1BytesToHex(bytes(challengeNonce, NONCE_BYTES, "challengeNonce"))}`;
}

export function assertAncV1AuthorizationRetryIsByteIdentical(
  persisted: Uint8Array,
  retry: Uint8Array,
): void {
  if (!equalBytes(persisted, retry)) {
    fail("Authorization retry conflicts with persisted bytes; never re-sign");
  }
}

import { z } from "zod";

import {
  type AncV1CanonicalValue,
  AncV1CanonicalEncodingError,
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Canonical,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import { opaqueIdSchema, protocolTimestampSchema } from "./contracts.js";
import { E2EE_SIZE_LIMITS, E2EE_SUITE_ID } from "./suite.js";

export const ANC_V1_GENESIS_ACCOUNT_ADMISSION_BOOTSTRAP_TRANSCRIPT_MAX_BYTES =
  E2EE_SIZE_LIMITS.genesisBootstrapTranscriptBytes;
export const ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECOVERY_CONFIRMATION_MAX_BYTES =
  E2EE_SIZE_LIMITS.controlEnvelopeBytes;
export const ANC_V1_GENESIS_ACCOUNT_ADMISSION_AUTHORIZATION_MAX_BYTES =
  E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes;
export const ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES =
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_BOOTSTRAP_TRANSCRIPT_MAX_BYTES +
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECOVERY_CONFIRMATION_MAX_BYTES +
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_AUTHORIZATION_MAX_BYTES +
  256;
export const ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES = 2048;
export const ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_LIFETIME_MS =
  10 * 60 * 1000;
export const ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES =
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES +
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES +
  256;
export const ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECEIPT_MAX_BYTES = 2048;

export const ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_HASH_DOMAIN =
  "anc/v1/private-vault/genesis-account-admission/candidate-hash";
export const ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_AUTH_DOMAIN =
  "anc/v1/private-vault/genesis-account-admission/challenge-authentication";

export interface AncV1GenesisAccountAdmissionCandidate {
  suite: typeof E2EE_SUITE_ID;
  version: 1;
  type: "genesis-account-admission-candidate";
  bootstrapTranscript: Uint8Array;
  recoveryConfirmation: Uint8Array;
  authorization: Uint8Array;
}

export interface AncV1GenesisAccountAdmissionChallenge {
  suite: typeof E2EE_SUITE_ID;
  version: 1;
  type: "genesis-account-admission-challenge";
  challengeId: string;
  accountId: string;
  workspaceId: string;
  candidateHash: string;
  issuedAt: string;
  expiresAt: string;
  authenticationTag: Uint8Array;
}

export type AncV1GenesisAccountAdmissionChallengeUnsigned = Omit<
  AncV1GenesisAccountAdmissionChallenge,
  "authenticationTag"
>;

/**
 * This body is deliberately not endpoint authorization by itself. Hosted
 * transport must additionally verify the endpoint's x-anc request proof over
 * the exact encoded request bytes before atomically consuming the challenge.
 */
export interface AncV1GenesisAccountAdmissionRequest {
  suite: typeof E2EE_SUITE_ID;
  version: 1;
  type: "genesis-account-admission-request";
  candidate: Uint8Array;
  challenge: Uint8Array;
}

export interface AncV1GenesisAccountAdmissionReceipt {
  suite: typeof E2EE_SUITE_ID;
  version: 1;
  type: "genesis-account-admission-receipt";
  accountId: string;
  workspaceId: string;
  vaultId: string;
  controlEntryId: string;
  controlEntryHash: string;
  signerEndpointId: string;
  candidateHash: string;
  bootstrapTranscriptHash: string;
}

const lowerHashSchema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/);
const challengeMetadataSchema = z
  .object({
    challengeId: opaqueIdSchema,
    accountId: opaqueIdSchema,
    workspaceId: opaqueIdSchema,
    candidateHash: lowerHashSchema,
    issuedAt: protocolTimestampSchema,
    expiresAt: protocolTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
    if (
      lifetime <= 0 ||
      lifetime > ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_LIFETIME_MS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "challenge lifetime must be positive and at most 10 minutes",
      });
    }
  });
const receiptSchema = z
  .object({
    suite: z.literal(E2EE_SUITE_ID),
    version: z.literal(1),
    type: z.literal("genesis-account-admission-receipt"),
    accountId: opaqueIdSchema,
    workspaceId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    controlEntryId: opaqueIdSchema,
    controlEntryHash: lowerHashSchema,
    signerEndpointId: opaqueIdSchema,
    candidateHash: lowerHashSchema,
    bootstrapTranscriptHash: lowerHashSchema,
  })
  .strict();

const CANDIDATE = Object.freeze({
  suite: 1,
  version: 2,
  type: 3,
  bootstrapTranscript: 4,
  recoveryConfirmation: 5,
  authorization: 6,
});
const CHALLENGE = Object.freeze({
  suite: 1,
  version: 2,
  type: 3,
  challengeId: 4,
  accountId: 5,
  workspaceId: 6,
  candidateHash: 7,
  issuedAt: 8,
  expiresAt: 9,
  authenticationTag: 10,
});
const REQUEST = Object.freeze({
  suite: 1,
  version: 2,
  type: 3,
  candidate: 4,
  challenge: 5,
});
const RECEIPT = Object.freeze({
  suite: 1,
  version: 2,
  type: 3,
  accountId: 4,
  workspaceId: 5,
  vaultId: 6,
  controlEntryId: 7,
  controlEntryHash: 8,
  signerEndpointId: 9,
  candidateHash: 10,
  bootstrapTranscriptHash: 11,
});

const CANDIDATE_FIELDS = [
  "suite",
  "version",
  "type",
  "bootstrapTranscript",
  "recoveryConfirmation",
  "authorization",
] as const;
const CHALLENGE_FIELDS = [
  "suite",
  "version",
  "type",
  "challengeId",
  "accountId",
  "workspaceId",
  "candidateHash",
  "issuedAt",
  "expiresAt",
  "authenticationTag",
] as const;
const CHALLENGE_UNSIGNED_FIELDS = CHALLENGE_FIELDS.filter(
  (field) => field !== "authenticationTag",
);
const REQUEST_FIELDS = [
  "suite",
  "version",
  "type",
  "candidate",
  "challenge",
] as const;

export class AncV1GenesisAccountAdmissionCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1GenesisAccountAdmissionCodecError";
  }
}

function fail(message: string): never {
  throw new AncV1GenesisAccountAdmissionCodecError(message);
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

function literal<T extends string | number>(
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

function text(value: unknown, name: string): string {
  if (typeof value !== "string") fail(`${name} must be text`);
  return value;
}

function fixedBytes(value: unknown, length: number, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    fail(`${name} must be exactly ${length} bytes`);
  }
  return value.slice();
}

function canonicalArtifact(
  value: unknown,
  maximum: number,
  name: string,
): Uint8Array {
  if (!(value instanceof Uint8Array)) fail(`${name} must be canonical bytes`);
  const snapshot = value.slice();
  if (snapshot.byteLength === 0 || snapshot.byteLength > maximum) {
    fail(`${name} must contain between 1 and ${maximum} canonical bytes`);
  }
  try {
    if (
      !(decodeAncV1Canonical(snapshot, { maxBytes: maximum }) instanceof Map)
    ) {
      fail(`${name} must be a canonical map`);
    }
  } catch (error) {
    if (error instanceof AncV1GenesisAccountAdmissionCodecError) throw error;
    if (error instanceof AncV1CanonicalEncodingError) fail(error.message);
    throw error;
  }
  return snapshot;
}

function canonicalEnvelopeBytes(
  value: unknown,
  maximum: number,
  name: string,
): Uint8Array {
  if (!(value instanceof Uint8Array)) fail(`${name} must be canonical bytes`);
  const snapshot = value.slice();
  if (snapshot.byteLength === 0 || snapshot.byteLength > maximum) {
    fail(`${name} must contain between 1 and ${maximum} canonical bytes`);
  }
  return snapshot;
}

function envelope(
  encoded: Uint8Array,
  keys: readonly number[],
  maximum: number,
): ReadonlyMap<number, AncV1CanonicalValue> {
  if (!(encoded instanceof Uint8Array)) fail("Envelope must be bytes");
  try {
    const map = decodeAncV1Envelope(encoded.slice(), keys, {
      maxBytes: maximum,
    });
    if (map.size !== keys.length) fail("Envelope is missing required fields");
    return map;
  } catch (error) {
    if (error instanceof AncV1GenesisAccountAdmissionCodecError) throw error;
    if (error instanceof AncV1CanonicalEncodingError) fail(error.message);
    throw error;
  }
}

function domainInput(domain: string, payload: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`${domain}\0`);
  const result = new Uint8Array(prefix.byteLength + payload.byteLength);
  result.set(prefix);
  result.set(payload, prefix.byteLength);
  return result;
}

function challengeMetadata(
  value: AncV1GenesisAccountAdmissionChallengeUnsigned,
) {
  const parsed = challengeMetadataSchema.safeParse({
    challengeId: value.challengeId,
    accountId: value.accountId,
    workspaceId: value.workspaceId,
    candidateHash: value.candidateHash,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  });
  if (!parsed.success) {
    fail("Genesis account admission challenge metadata is invalid");
  }
  return parsed.data;
}

function encodeChallengeUnsigned(
  value: AncV1GenesisAccountAdmissionChallengeUnsigned,
): Uint8Array {
  const parsed = challengeMetadata(value);
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [CHALLENGE.suite, literal(value.suite, E2EE_SUITE_ID, "suite")],
      [CHALLENGE.version, literal(value.version, 1, "version")],
      [
        CHALLENGE.type,
        literal(value.type, "genesis-account-admission-challenge", "type"),
      ],
      [CHALLENGE.challengeId, parsed.challengeId],
      [CHALLENGE.accountId, parsed.accountId],
      [CHALLENGE.workspaceId, parsed.workspaceId],
      [CHALLENGE.candidateHash, ancV1HexToBytes(parsed.candidateHash)],
      [CHALLENGE.issuedAt, parsed.issuedAt],
      [CHALLENGE.expiresAt, parsed.expiresAt],
    ]),
  );
}

/** SHA-256 this domain-separated input to obtain `candidateHash`. */
export function ancV1GenesisAccountAdmissionCandidateHashInput(
  canonicalCandidate: Uint8Array,
): Uint8Array {
  const candidate =
    decodeAncV1GenesisAccountAdmissionCandidate(canonicalCandidate);
  const snapshot = encodeAncV1GenesisAccountAdmissionCandidate(candidate);
  return domainInput(
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_HASH_DOMAIN,
    snapshot,
  );
}

/** HMAC-SHA-256 this domain-separated input to obtain `authenticationTag`. */
export function ancV1GenesisAccountAdmissionChallengeAuthenticationInput(
  value: AncV1GenesisAccountAdmissionChallengeUnsigned,
): Uint8Array {
  exact(
    value,
    CHALLENGE_UNSIGNED_FIELDS,
    "Unsigned genesis account admission challenge",
  );
  return domainInput(
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_AUTH_DOMAIN,
    encodeChallengeUnsigned(value),
  );
}

export function encodeAncV1GenesisAccountAdmissionCandidate(
  value: AncV1GenesisAccountAdmissionCandidate,
): Uint8Array {
  exact(value, CANDIDATE_FIELDS, "Genesis account admission candidate");
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [CANDIDATE.suite, literal(value.suite, E2EE_SUITE_ID, "suite")],
      [CANDIDATE.version, literal(value.version, 1, "version")],
      [
        CANDIDATE.type,
        literal(value.type, "genesis-account-admission-candidate", "type"),
      ],
      [
        CANDIDATE.bootstrapTranscript,
        canonicalArtifact(
          value.bootstrapTranscript,
          ANC_V1_GENESIS_ACCOUNT_ADMISSION_BOOTSTRAP_TRANSCRIPT_MAX_BYTES,
          "bootstrapTranscript",
        ),
      ],
      [
        CANDIDATE.recoveryConfirmation,
        canonicalArtifact(
          value.recoveryConfirmation,
          ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECOVERY_CONFIRMATION_MAX_BYTES,
          "recoveryConfirmation",
        ),
      ],
      [
        CANDIDATE.authorization,
        canonicalArtifact(
          value.authorization,
          ANC_V1_GENESIS_ACCOUNT_ADMISSION_AUTHORIZATION_MAX_BYTES,
          "authorization",
        ),
      ],
    ]),
  );
  if (
    encoded.byteLength > ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES
  ) {
    fail("Genesis account admission candidate exceeds its canonical size cap");
  }
  return encoded;
}

export function decodeAncV1GenesisAccountAdmissionCandidate(
  encoded: Uint8Array,
): AncV1GenesisAccountAdmissionCandidate {
  const map = envelope(
    encoded,
    Object.values(CANDIDATE),
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
  );
  return {
    suite: literal(
      field(map, CANDIDATE.suite, "suite"),
      E2EE_SUITE_ID,
      "suite",
    ),
    version: literal(field(map, CANDIDATE.version, "version"), 1, "version"),
    type: literal(
      field(map, CANDIDATE.type, "type"),
      "genesis-account-admission-candidate",
      "type",
    ),
    bootstrapTranscript: canonicalArtifact(
      field(map, CANDIDATE.bootstrapTranscript, "bootstrapTranscript"),
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_BOOTSTRAP_TRANSCRIPT_MAX_BYTES,
      "bootstrapTranscript",
    ),
    recoveryConfirmation: canonicalArtifact(
      field(map, CANDIDATE.recoveryConfirmation, "recoveryConfirmation"),
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECOVERY_CONFIRMATION_MAX_BYTES,
      "recoveryConfirmation",
    ),
    authorization: canonicalArtifact(
      field(map, CANDIDATE.authorization, "authorization"),
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_AUTHORIZATION_MAX_BYTES,
      "authorization",
    ),
  };
}

export function encodeAncV1GenesisAccountAdmissionChallenge(
  value: AncV1GenesisAccountAdmissionChallenge,
): Uint8Array {
  exact(value, CHALLENGE_FIELDS, "Genesis account admission challenge");
  const parsed = challengeMetadata(value);
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [CHALLENGE.suite, literal(value.suite, E2EE_SUITE_ID, "suite")],
      [CHALLENGE.version, literal(value.version, 1, "version")],
      [
        CHALLENGE.type,
        literal(value.type, "genesis-account-admission-challenge", "type"),
      ],
      [CHALLENGE.challengeId, parsed.challengeId],
      [CHALLENGE.accountId, parsed.accountId],
      [CHALLENGE.workspaceId, parsed.workspaceId],
      [CHALLENGE.candidateHash, ancV1HexToBytes(parsed.candidateHash)],
      [CHALLENGE.issuedAt, parsed.issuedAt],
      [CHALLENGE.expiresAt, parsed.expiresAt],
      [
        CHALLENGE.authenticationTag,
        fixedBytes(value.authenticationTag, 32, "authenticationTag"),
      ],
    ]),
  );
  if (
    encoded.byteLength > ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES
  ) {
    fail("Genesis account admission challenge exceeds its canonical size cap");
  }
  return encoded;
}

export function decodeAncV1GenesisAccountAdmissionChallenge(
  encoded: Uint8Array,
): AncV1GenesisAccountAdmissionChallenge {
  const map = envelope(
    encoded,
    Object.values(CHALLENGE),
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES,
  );
  const value: AncV1GenesisAccountAdmissionChallenge = {
    suite: literal(
      field(map, CHALLENGE.suite, "suite"),
      E2EE_SUITE_ID,
      "suite",
    ),
    version: literal(field(map, CHALLENGE.version, "version"), 1, "version"),
    type: literal(
      field(map, CHALLENGE.type, "type"),
      "genesis-account-admission-challenge",
      "type",
    ),
    challengeId: text(
      field(map, CHALLENGE.challengeId, "challengeId"),
      "challengeId",
    ),
    accountId: text(field(map, CHALLENGE.accountId, "accountId"), "accountId"),
    workspaceId: text(
      field(map, CHALLENGE.workspaceId, "workspaceId"),
      "workspaceId",
    ),
    candidateHash: ancV1BytesToHex(
      fixedBytes(
        field(map, CHALLENGE.candidateHash, "candidateHash"),
        32,
        "candidateHash",
      ),
    ),
    issuedAt: text(field(map, CHALLENGE.issuedAt, "issuedAt"), "issuedAt"),
    expiresAt: text(field(map, CHALLENGE.expiresAt, "expiresAt"), "expiresAt"),
    authenticationTag: fixedBytes(
      field(map, CHALLENGE.authenticationTag, "authenticationTag"),
      32,
      "authenticationTag",
    ),
  };
  challengeMetadata(value);
  return value;
}

export function encodeAncV1GenesisAccountAdmissionRequest(
  value: AncV1GenesisAccountAdmissionRequest,
): Uint8Array {
  exact(value, REQUEST_FIELDS, "Genesis account admission request");
  const candidate = canonicalEnvelopeBytes(
    value.candidate,
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
    "candidate",
  );
  const challenge = canonicalEnvelopeBytes(
    value.challenge,
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES,
    "challenge",
  );
  decodeAncV1GenesisAccountAdmissionCandidate(candidate);
  decodeAncV1GenesisAccountAdmissionChallenge(challenge);
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [REQUEST.suite, literal(value.suite, E2EE_SUITE_ID, "suite")],
      [REQUEST.version, literal(value.version, 1, "version")],
      [
        REQUEST.type,
        literal(value.type, "genesis-account-admission-request", "type"),
      ],
      [REQUEST.candidate, candidate],
      [REQUEST.challenge, challenge],
    ]),
  );
  if (encoded.byteLength > ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES) {
    fail("Genesis account admission request exceeds its canonical size cap");
  }
  return encoded;
}

export function decodeAncV1GenesisAccountAdmissionRequest(
  encoded: Uint8Array,
): AncV1GenesisAccountAdmissionRequest {
  const map = envelope(
    encoded,
    Object.values(REQUEST),
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES,
  );
  const candidate = canonicalEnvelopeBytes(
    field(map, REQUEST.candidate, "candidate"),
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
    "candidate",
  );
  const challenge = canonicalEnvelopeBytes(
    field(map, REQUEST.challenge, "challenge"),
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES,
    "challenge",
  );
  decodeAncV1GenesisAccountAdmissionCandidate(candidate);
  decodeAncV1GenesisAccountAdmissionChallenge(challenge);
  return {
    suite: literal(field(map, REQUEST.suite, "suite"), E2EE_SUITE_ID, "suite"),
    version: literal(field(map, REQUEST.version, "version"), 1, "version"),
    type: literal(
      field(map, REQUEST.type, "type"),
      "genesis-account-admission-request",
      "type",
    ),
    candidate,
    challenge,
  };
}

function parseReceipt(value: unknown): AncV1GenesisAccountAdmissionReceipt {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) {
    fail(
      "Genesis account admission receipt does not match the frozen anc/v1 schema",
    );
  }
  return parsed.data;
}

export function encodeAncV1GenesisAccountAdmissionReceipt(
  value: AncV1GenesisAccountAdmissionReceipt,
): Uint8Array {
  const parsed = parseReceipt(value);
  const encoded = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [RECEIPT.suite, parsed.suite],
      [RECEIPT.version, parsed.version],
      [RECEIPT.type, parsed.type],
      [RECEIPT.accountId, parsed.accountId],
      [RECEIPT.workspaceId, parsed.workspaceId],
      [RECEIPT.vaultId, parsed.vaultId],
      [RECEIPT.controlEntryId, parsed.controlEntryId],
      [RECEIPT.controlEntryHash, ancV1HexToBytes(parsed.controlEntryHash)],
      [RECEIPT.signerEndpointId, parsed.signerEndpointId],
      [RECEIPT.candidateHash, ancV1HexToBytes(parsed.candidateHash)],
      [
        RECEIPT.bootstrapTranscriptHash,
        ancV1HexToBytes(parsed.bootstrapTranscriptHash),
      ],
    ]),
  );
  if (encoded.byteLength > ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECEIPT_MAX_BYTES) {
    fail("Genesis account admission receipt exceeds its canonical size cap");
  }
  return encoded;
}

export function decodeAncV1GenesisAccountAdmissionReceipt(
  encoded: Uint8Array,
): AncV1GenesisAccountAdmissionReceipt {
  const map = envelope(
    encoded,
    Object.values(RECEIPT),
    ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECEIPT_MAX_BYTES,
  );
  return parseReceipt({
    suite: text(field(map, RECEIPT.suite, "suite"), "suite"),
    version: field(map, RECEIPT.version, "version"),
    type: text(field(map, RECEIPT.type, "type"), "type"),
    accountId: text(field(map, RECEIPT.accountId, "accountId"), "accountId"),
    workspaceId: text(
      field(map, RECEIPT.workspaceId, "workspaceId"),
      "workspaceId",
    ),
    vaultId: text(field(map, RECEIPT.vaultId, "vaultId"), "vaultId"),
    controlEntryId: text(
      field(map, RECEIPT.controlEntryId, "controlEntryId"),
      "controlEntryId",
    ),
    controlEntryHash: ancV1BytesToHex(
      fixedBytes(
        field(map, RECEIPT.controlEntryHash, "controlEntryHash"),
        32,
        "controlEntryHash",
      ),
    ),
    signerEndpointId: text(
      field(map, RECEIPT.signerEndpointId, "signerEndpointId"),
      "signerEndpointId",
    ),
    candidateHash: ancV1BytesToHex(
      fixedBytes(
        field(map, RECEIPT.candidateHash, "candidateHash"),
        32,
        "candidateHash",
      ),
    ),
    bootstrapTranscriptHash: ancV1BytesToHex(
      fixedBytes(
        field(map, RECEIPT.bootstrapTranscriptHash, "bootstrapTranscriptHash"),
        32,
        "bootstrapTranscriptHash",
      ),
    ),
  });
}

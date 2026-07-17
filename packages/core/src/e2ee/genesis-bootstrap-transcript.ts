import {
  type AncV1CanonicalValue,
  AncV1CanonicalEncodingError,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  decodeAncV1GenesisRecoveryConfirmation,
  hashAncV1GenesisRecoveryConfirmation,
} from "./genesis-ceremony-codecs.js";
import { ancV1Hash } from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
} from "./suite.js";

const COMMON = E2EE_ENVELOPE_FIELDS.common;
const TRANSCRIPT = E2EE_ENVELOPE_FIELDS.genesisBootstrapTranscript;
const ID_BYTES = 16;
const PUBLIC_KEY_BYTES = 32;
const HASH_BYTES = 32;

export class AncV1GenesisBootstrapTranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1GenesisBootstrapTranscriptError";
  }
}

/**
 * Canonical, public-only commitment to one prepared genesis candidate.
 *
 * This value is safe to persist beside pending custody state. It deliberately
 * cannot carry seeds, private keys, epoch keys, recovery plaintext, or wrapped
 * ciphertext. `recoveryConfirmationHash` binds the exact canonical confirmation
 * artifact accepted by the frozen genesis ceremony.
 */
export interface AncV1GenesisBootstrapTranscript {
  suite: typeof E2EE_SUITE_ID;
  vaultId: Uint8Array;
  type: "genesis-bootstrap-transcript";
  ceremonyId: Uint8Array;
  endpointId: Uint8Array;
  endpointSigningPublicKey: Uint8Array;
  endpointKeyAgreementPublicKey: Uint8Array;
  enrollmentRef: Uint8Array;
  recoveryId: Uint8Array;
  recoverySigningPublicKey: Uint8Array;
  recoveryKeyAgreementPublicKey: Uint8Array;
  recoveryGeneration: 1;
  epoch: 1;
  recoveryWrapHash: Uint8Array;
  recoveryConfirmationHash: Uint8Array;
}

export interface AncV1GenesisBootstrapTranscriptInput {
  vaultId: Uint8Array;
  ceremonyId: Uint8Array;
  endpointId: Uint8Array;
  endpointSigningPublicKey: Uint8Array;
  endpointKeyAgreementPublicKey: Uint8Array;
  enrollmentRef: Uint8Array;
  recoveryConfirmation: Uint8Array;
}

const FIELDS = [
  "suite",
  "vaultId",
  "type",
  "ceremonyId",
  "endpointId",
  "endpointSigningPublicKey",
  "endpointKeyAgreementPublicKey",
  "enrollmentRef",
  "recoveryId",
  "recoverySigningPublicKey",
  "recoveryKeyAgreementPublicKey",
  "recoveryGeneration",
  "epoch",
  "recoveryWrapHash",
  "recoveryConfirmationHash",
] as const;

const INPUT_FIELDS = [
  "vaultId",
  "ceremonyId",
  "endpointId",
  "endpointSigningPublicKey",
  "endpointKeyAgreementPublicKey",
  "enrollmentRef",
  "recoveryConfirmation",
] as const;

function fail(message: string): never {
  throw new AncV1GenesisBootstrapTranscriptError(message);
}

function exact(value: object, fields: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  )
    fail(`${name} must contain exactly the frozen anc/v1 fields`);
}

function bytes(value: unknown, length: number, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length)
    fail(`${name} must be exactly ${length} bytes`);
  return Uint8Array.from(value);
}

function inputBytes(value: unknown, name: string): Uint8Array {
  if (!(value instanceof Uint8Array)) fail(`${name} must be bytes`);
  return Uint8Array.from(value);
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
  if (!map.has(key)) fail(`Transcript is missing ${name}`);
  return map.get(key)!;
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function decodeMap(encoded: Uint8Array) {
  const allowed = [
    COMMON.suite,
    COMMON.vaultId,
    COMMON.type,
    ...Object.values(TRANSCRIPT),
  ];
  try {
    const map = decodeAncV1Envelope(encoded, allowed, {
      maxBytes: E2EE_SIZE_LIMITS.genesisBootstrapTranscriptBytes,
    });
    if (map.size !== allowed.length)
      fail("Transcript is missing required fields");
    return map;
  } catch (error) {
    if (error instanceof AncV1GenesisBootstrapTranscriptError) throw error;
    if (error instanceof AncV1CanonicalEncodingError)
      throw new AncV1GenesisBootstrapTranscriptError(error.message);
    throw error;
  }
}

function snapshotTranscript(
  value: AncV1GenesisBootstrapTranscript,
): AncV1GenesisBootstrapTranscript {
  exact(value, FIELDS, "Genesis bootstrap transcript");
  // Read every potentially Proxy-backed property exactly once, then validate
  // and encode only the detached plain snapshot.
  const suite = value.suite;
  const vaultId = value.vaultId;
  const type = value.type;
  const ceremonyId = value.ceremonyId;
  const endpointId = value.endpointId;
  const endpointSigningPublicKey = value.endpointSigningPublicKey;
  const endpointKeyAgreementPublicKey = value.endpointKeyAgreementPublicKey;
  const enrollmentRef = value.enrollmentRef;
  const recoveryId = value.recoveryId;
  const recoverySigningPublicKey = value.recoverySigningPublicKey;
  const recoveryKeyAgreementPublicKey = value.recoveryKeyAgreementPublicKey;
  const recoveryGeneration = value.recoveryGeneration;
  const epoch = value.epoch;
  const recoveryWrapHash = value.recoveryWrapHash;
  const recoveryConfirmationHash = value.recoveryConfirmationHash;
  if (recoveryGeneration !== 1)
    fail("Genesis recovery generation must be exactly 1");
  if (epoch !== 1) fail("Genesis epoch must be exactly 1");
  return {
    suite: literal(suite, E2EE_SUITE_ID, "suite"),
    vaultId: bytes(vaultId, ID_BYTES, "vaultId"),
    type: literal(type, "genesis-bootstrap-transcript", "type"),
    ceremonyId: bytes(ceremonyId, ID_BYTES, "ceremonyId"),
    endpointId: bytes(endpointId, ID_BYTES, "endpointId"),
    endpointSigningPublicKey: bytes(
      endpointSigningPublicKey,
      PUBLIC_KEY_BYTES,
      "endpointSigningPublicKey",
    ),
    endpointKeyAgreementPublicKey: bytes(
      endpointKeyAgreementPublicKey,
      PUBLIC_KEY_BYTES,
      "endpointKeyAgreementPublicKey",
    ),
    enrollmentRef: bytes(enrollmentRef, ID_BYTES, "enrollmentRef"),
    recoveryId: bytes(recoveryId, ID_BYTES, "recoveryId"),
    recoverySigningPublicKey: bytes(
      recoverySigningPublicKey,
      PUBLIC_KEY_BYTES,
      "recoverySigningPublicKey",
    ),
    recoveryKeyAgreementPublicKey: bytes(
      recoveryKeyAgreementPublicKey,
      PUBLIC_KEY_BYTES,
      "recoveryKeyAgreementPublicKey",
    ),
    recoveryGeneration: 1,
    epoch: 1,
    recoveryWrapHash: bytes(recoveryWrapHash, HASH_BYTES, "recoveryWrapHash"),
    recoveryConfirmationHash: bytes(
      recoveryConfirmationHash,
      HASH_BYTES,
      "recoveryConfirmationHash",
    ),
  };
}

export function encodeAncV1GenesisBootstrapTranscript(
  value: AncV1GenesisBootstrapTranscript,
): Uint8Array {
  const snapshot = snapshotTranscript(value);
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [COMMON.suite, snapshot.suite],
      [COMMON.vaultId, snapshot.vaultId],
      [COMMON.type, snapshot.type],
      [TRANSCRIPT.ceremonyId, snapshot.ceremonyId],
      [TRANSCRIPT.endpointId, snapshot.endpointId],
      [TRANSCRIPT.endpointSigningPublicKey, snapshot.endpointSigningPublicKey],
      [
        TRANSCRIPT.endpointKeyAgreementPublicKey,
        snapshot.endpointKeyAgreementPublicKey,
      ],
      [TRANSCRIPT.enrollmentRef, snapshot.enrollmentRef],
      [TRANSCRIPT.recoveryId, snapshot.recoveryId],
      [TRANSCRIPT.recoverySigningPublicKey, snapshot.recoverySigningPublicKey],
      [
        TRANSCRIPT.recoveryKeyAgreementPublicKey,
        snapshot.recoveryKeyAgreementPublicKey,
      ],
      [TRANSCRIPT.recoveryGeneration, 1],
      [TRANSCRIPT.epoch, 1],
      [TRANSCRIPT.recoveryWrapHash, snapshot.recoveryWrapHash],
      [TRANSCRIPT.recoveryConfirmationHash, snapshot.recoveryConfirmationHash],
    ]),
  );
}

export function decodeAncV1GenesisBootstrapTranscript(
  encoded: Uint8Array,
  binding?: { expectedVaultId: Uint8Array },
): AncV1GenesisBootstrapTranscript {
  if (binding)
    exact(binding, ["expectedVaultId"], "Bootstrap transcript binding");
  const encodedSnapshot = inputBytes(encoded, "encoded");
  const expectedVaultId = binding
    ? bytes(binding.expectedVaultId, ID_BYTES, "expectedVaultId")
    : null;
  const map = decodeMap(encodedSnapshot);
  const vaultId = bytes(
    field(map, COMMON.vaultId, "vaultId"),
    ID_BYTES,
    "vaultId",
  );
  if (expectedVaultId && !equal(vaultId, expectedVaultId))
    fail("Bootstrap transcript vault binding does not match");
  if (field(map, TRANSCRIPT.recoveryGeneration, "recoveryGeneration") !== 1)
    fail("Genesis recovery generation must be exactly 1");
  if (field(map, TRANSCRIPT.epoch, "epoch") !== 1)
    fail("Genesis epoch must be exactly 1");
  return {
    suite: literal(field(map, COMMON.suite, "suite"), E2EE_SUITE_ID, "suite"),
    vaultId,
    type: literal(
      field(map, COMMON.type, "type"),
      "genesis-bootstrap-transcript",
      "type",
    ),
    ceremonyId: bytes(
      field(map, TRANSCRIPT.ceremonyId, "ceremonyId"),
      ID_BYTES,
      "ceremonyId",
    ),
    endpointId: bytes(
      field(map, TRANSCRIPT.endpointId, "endpointId"),
      ID_BYTES,
      "endpointId",
    ),
    endpointSigningPublicKey: bytes(
      field(
        map,
        TRANSCRIPT.endpointSigningPublicKey,
        "endpointSigningPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "endpointSigningPublicKey",
    ),
    endpointKeyAgreementPublicKey: bytes(
      field(
        map,
        TRANSCRIPT.endpointKeyAgreementPublicKey,
        "endpointKeyAgreementPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "endpointKeyAgreementPublicKey",
    ),
    enrollmentRef: bytes(
      field(map, TRANSCRIPT.enrollmentRef, "enrollmentRef"),
      ID_BYTES,
      "enrollmentRef",
    ),
    recoveryId: bytes(
      field(map, TRANSCRIPT.recoveryId, "recoveryId"),
      ID_BYTES,
      "recoveryId",
    ),
    recoverySigningPublicKey: bytes(
      field(
        map,
        TRANSCRIPT.recoverySigningPublicKey,
        "recoverySigningPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "recoverySigningPublicKey",
    ),
    recoveryKeyAgreementPublicKey: bytes(
      field(
        map,
        TRANSCRIPT.recoveryKeyAgreementPublicKey,
        "recoveryKeyAgreementPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "recoveryKeyAgreementPublicKey",
    ),
    recoveryGeneration: 1,
    epoch: 1,
    recoveryWrapHash: bytes(
      field(map, TRANSCRIPT.recoveryWrapHash, "recoveryWrapHash"),
      HASH_BYTES,
      "recoveryWrapHash",
    ),
    recoveryConfirmationHash: bytes(
      field(
        map,
        TRANSCRIPT.recoveryConfirmationHash,
        "recoveryConfirmationHash",
      ),
      HASH_BYTES,
      "recoveryConfirmationHash",
    ),
  };
}

export async function hashAncV1GenesisBootstrapTranscript(
  encoded: Uint8Array,
  binding?: { expectedVaultId: Uint8Array },
): Promise<Uint8Array> {
  const encodedSnapshot = inputBytes(encoded, "encoded");
  const bindingSnapshot = binding
    ? {
        expectedVaultId: bytes(
          binding.expectedVaultId,
          ID_BYTES,
          "expectedVaultId",
        ),
      }
    : undefined;
  decodeAncV1GenesisBootstrapTranscript(encodedSnapshot, bindingSnapshot);
  return ancV1Hash("genesis-bootstrap-transcript", encodedSnapshot);
}

export async function createAncV1GenesisBootstrapTranscript(
  input: AncV1GenesisBootstrapTranscriptInput,
): Promise<AncV1GenesisBootstrapTranscript> {
  exact(input, INPUT_FIELDS, "Genesis bootstrap transcript input");
  // Capture every getter and every caller-owned byte array once before any
  // decode or await. This prevents a confirmation from supplying fields from
  // artifact A while the digest is computed over artifact B.
  const rawVaultId = input.vaultId;
  const rawCeremonyId = input.ceremonyId;
  const rawEndpointId = input.endpointId;
  const rawEndpointSigningPublicKey = input.endpointSigningPublicKey;
  const rawEndpointKeyAgreementPublicKey = input.endpointKeyAgreementPublicKey;
  const rawEnrollmentRef = input.enrollmentRef;
  const rawRecoveryConfirmation = input.recoveryConfirmation;
  const vaultId = bytes(rawVaultId, ID_BYTES, "vaultId");
  const ceremonyId = bytes(rawCeremonyId, ID_BYTES, "ceremonyId");
  const endpointId = bytes(rawEndpointId, ID_BYTES, "endpointId");
  const endpointSigningPublicKey = bytes(
    rawEndpointSigningPublicKey,
    PUBLIC_KEY_BYTES,
    "endpointSigningPublicKey",
  );
  const endpointKeyAgreementPublicKey = bytes(
    rawEndpointKeyAgreementPublicKey,
    PUBLIC_KEY_BYTES,
    "endpointKeyAgreementPublicKey",
  );
  const enrollmentRef = bytes(rawEnrollmentRef, ID_BYTES, "enrollmentRef");
  const recoveryConfirmation = inputBytes(
    rawRecoveryConfirmation,
    "recoveryConfirmation",
  );
  const confirmation = decodeAncV1GenesisRecoveryConfirmation(
    recoveryConfirmation,
    { expectedVaultId: vaultId },
  );
  if (!equal(confirmation.ceremonyId, ceremonyId))
    fail("Recovery confirmation ceremony binding does not match");
  if (!equal(confirmation.endpointId, endpointId))
    fail("Recovery confirmation endpoint binding does not match");
  return {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "genesis-bootstrap-transcript",
    ceremonyId,
    endpointId,
    endpointSigningPublicKey,
    endpointKeyAgreementPublicKey,
    enrollmentRef,
    recoveryId: confirmation.recoveryId,
    recoverySigningPublicKey: confirmation.recoverySigningPublicKey,
    recoveryKeyAgreementPublicKey: confirmation.recoveryKeyAgreementPublicKey,
    recoveryGeneration: 1,
    epoch: 1,
    recoveryWrapHash: confirmation.recoveryWrapHash,
    recoveryConfirmationHash: await hashAncV1GenesisRecoveryConfirmation(
      recoveryConfirmation,
      vaultId,
    ),
  };
}

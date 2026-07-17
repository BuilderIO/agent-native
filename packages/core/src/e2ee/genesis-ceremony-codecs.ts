import {
  type AncV1CanonicalValue,
  AncV1CanonicalEncodingError,
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Canonical,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  type ControlLogMember,
  type ControlMembershipCommit,
  type SignedControlLogEntry,
  decodeSignedControlLogEntry,
  encodeControlLogInnerEnvelope,
  encodeSignedControlLogEntry,
  encodeUnsignedControlLogEntry,
} from "./control-log.js";
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
const CONFIRMATION = E2EE_ENVELOPE_FIELDS.genesisRecoveryConfirmation;
const AUTHORIZATION = E2EE_ENVELOPE_FIELDS.genesisAuthorization;
const ENDPOINT = E2EE_ENVELOPE_FIELDS.endpoint;
const ID_BYTES = 16;
const HASH_BYTES = 32;
const PUBLIC_KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;
const ZERO_HASH = "00".repeat(HASH_BYTES);

export class AncV1GenesisCeremonyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1GenesisCeremonyError";
  }
}

export interface AncV1GenesisRecoveryConfirmation {
  suite: typeof E2EE_SUITE_ID;
  vaultId: Uint8Array;
  type: "genesis-recovery-confirmation";
  ceremonyId: Uint8Array;
  endpointId: Uint8Array;
  recoveryId: Uint8Array;
  recoverySigningPublicKey: Uint8Array;
  recoveryKeyAgreementPublicKey: Uint8Array;
  recoveryWrapHash: Uint8Array;
  confirmedAt: number;
  recoveryGeneration: 1;
}

interface CommonEnvelope {
  suite: typeof E2EE_SUITE_ID;
  vaultId: Uint8Array;
  type: string;
  createdAt: number;
  envelopeId: Uint8Array;
}

export interface AncV1UnsignedGenesisAuthorization extends CommonEnvelope {
  type: "genesis-authorization";
  ceremonyId: Uint8Array;
  endpointId: Uint8Array;
  epoch: 1;
  endpointEnvelope: Uint8Array;
  recoveryConfirmation: Uint8Array;
  signedGenesisCommit: Uint8Array;
}

export interface AncV1GenesisAuthorization extends AncV1UnsignedGenesisAuthorization {
  signature: Uint8Array;
}

type GenesisEndpointEnvelope = {
  createdAt: number;
  endpointId: Uint8Array;
  unattended: boolean;
  signingPublicKey: Uint8Array;
  keyAgreementPublicKey: Uint8Array;
  addedByEndpointId: Uint8Array;
  recoveryConfirmationHash: Uint8Array;
  signature: Uint8Array;
};

const CONFIRMATION_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "ceremonyId",
  "endpointId",
  "recoveryId",
  "recoverySigningPublicKey",
  "recoveryKeyAgreementPublicKey",
  "recoveryWrapHash",
  "confirmedAt",
  "recoveryGeneration",
] as const;
const AUTHORIZATION_UNSIGNED_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "ceremonyId",
  "endpointId",
  "epoch",
  "endpointEnvelope",
  "recoveryConfirmation",
  "signedGenesisCommit",
] as const;
const AUTHORIZATION_FIELDS = [
  ...AUTHORIZATION_UNSIGNED_FIELDS,
  "signature",
] as const;

function fail(message: string): never {
  throw new AncV1GenesisCeremonyError(message);
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

function canonicalBytes(
  value: unknown,
  maximum: number,
  name: string,
): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > maximum
  ) {
    fail(`${name} must contain 1 to ${maximum} canonical bytes`);
  }
  try {
    const decoded = decodeAncV1Canonical(value, { maxBytes: maximum });
    if (!(decoded instanceof Map)) fail(`${name} must be a canonical map`);
  } catch (error) {
    if (error instanceof AncV1GenesisCeremonyError) throw error;
    if (error instanceof AncV1CanonicalEncodingError) fail(error.message);
    throw error;
  }
  return value.slice();
}

function integer(value: unknown, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(`${name} must be a safe integer >= ${minimum}`);
  }
  return value as number;
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

function decodeMap(
  encoded: Uint8Array,
  allowed: readonly number[],
  maximum: number,
): ReadonlyMap<number, AncV1CanonicalValue> {
  try {
    const map = decodeAncV1Envelope(encoded, allowed, { maxBytes: maximum });
    if (map.size !== allowed.length)
      fail("Envelope is missing required fields");
    return map;
  } catch (error) {
    if (error instanceof AncV1GenesisCeremonyError) throw error;
    if (error instanceof AncV1CanonicalEncodingError) {
      throw new AncV1GenesisCeremonyError(error.message);
    }
    throw error;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function idHex(value: Uint8Array, name: string): string {
  return ancV1BytesToHex(bytes(value, ID_BYTES, name));
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

export function encodeAncV1GenesisRecoveryConfirmation(
  value: AncV1GenesisRecoveryConfirmation,
): Uint8Array {
  exact(value, CONFIRMATION_FIELDS, "Genesis recovery confirmation");
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [COMMON.suite, literal(value.suite, E2EE_SUITE_ID, "suite")],
      [COMMON.vaultId, bytes(value.vaultId, ID_BYTES, "vaultId")],
      [
        COMMON.type,
        literal(value.type, "genesis-recovery-confirmation", "type"),
      ],
      [
        CONFIRMATION.ceremonyId,
        bytes(value.ceremonyId, ID_BYTES, "ceremonyId"),
      ],
      [
        CONFIRMATION.endpointId,
        bytes(value.endpointId, ID_BYTES, "endpointId"),
      ],
      [
        CONFIRMATION.recoveryId,
        bytes(value.recoveryId, ID_BYTES, "recoveryId"),
      ],
      [
        CONFIRMATION.recoverySigningPublicKey,
        bytes(
          value.recoverySigningPublicKey,
          PUBLIC_KEY_BYTES,
          "recoverySigningPublicKey",
        ),
      ],
      [
        CONFIRMATION.recoveryKeyAgreementPublicKey,
        bytes(
          value.recoveryKeyAgreementPublicKey,
          PUBLIC_KEY_BYTES,
          "recoveryKeyAgreementPublicKey",
        ),
      ],
      [
        CONFIRMATION.recoveryWrapHash,
        bytes(value.recoveryWrapHash, HASH_BYTES, "recoveryWrapHash"),
      ],
      [CONFIRMATION.confirmedAt, integer(value.confirmedAt, 1, "confirmedAt")],
      [
        CONFIRMATION.recoveryGeneration,
        value.recoveryGeneration === 1
          ? 1
          : fail("Genesis recovery generation must be exactly 1"),
      ],
    ]),
  );
}

export function decodeAncV1GenesisRecoveryConfirmation(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1GenesisRecoveryConfirmation {
  exact(binding, ["expectedVaultId"], "Recovery confirmation binding");
  const allowed = [
    COMMON.suite,
    COMMON.vaultId,
    COMMON.type,
    ...Object.values(CONFIRMATION),
  ];
  const map = decodeMap(
    encoded,
    allowed,
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
  ) {
    fail("Recovery confirmation vault binding does not match");
  }
  const recoveryGeneration = integer(
    field(map, CONFIRMATION.recoveryGeneration, "recoveryGeneration"),
    1,
    "recoveryGeneration",
  );
  if (recoveryGeneration !== 1) {
    fail("Genesis recovery generation must be exactly 1");
  }
  return {
    suite: literal(field(map, COMMON.suite, "suite"), E2EE_SUITE_ID, "suite"),
    vaultId,
    type: literal(
      field(map, COMMON.type, "type"),
      "genesis-recovery-confirmation",
      "type",
    ),
    ceremonyId: bytes(
      field(map, CONFIRMATION.ceremonyId, "ceremonyId"),
      ID_BYTES,
      "ceremonyId",
    ),
    endpointId: bytes(
      field(map, CONFIRMATION.endpointId, "endpointId"),
      ID_BYTES,
      "endpointId",
    ),
    recoveryId: bytes(
      field(map, CONFIRMATION.recoveryId, "recoveryId"),
      ID_BYTES,
      "recoveryId",
    ),
    recoverySigningPublicKey: bytes(
      field(
        map,
        CONFIRMATION.recoverySigningPublicKey,
        "recoverySigningPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "recoverySigningPublicKey",
    ),
    recoveryKeyAgreementPublicKey: bytes(
      field(
        map,
        CONFIRMATION.recoveryKeyAgreementPublicKey,
        "recoveryKeyAgreementPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "recoveryKeyAgreementPublicKey",
    ),
    recoveryWrapHash: bytes(
      field(map, CONFIRMATION.recoveryWrapHash, "recoveryWrapHash"),
      HASH_BYTES,
      "recoveryWrapHash",
    ),
    confirmedAt: integer(
      field(map, CONFIRMATION.confirmedAt, "confirmedAt"),
      1,
      "confirmedAt",
    ),
    recoveryGeneration: 1,
  };
}

export async function hashAncV1GenesisRecoveryConfirmation(
  encoded: Uint8Array,
  expectedVaultId: Uint8Array,
): Promise<Uint8Array> {
  decodeAncV1GenesisRecoveryConfirmation(encoded, { expectedVaultId });
  return ancV1Hash("genesis-recovery-confirmation", encoded.slice());
}

function unsignedAuthorizationMap(
  value: AncV1UnsignedGenesisAuthorization,
): Map<number, AncV1CanonicalValue> {
  exact(value, AUTHORIZATION_UNSIGNED_FIELDS, "Unsigned genesis authorization");
  if (value.epoch !== 1) fail("Genesis epoch must be exactly 1");
  return new Map<number, AncV1CanonicalValue>([
    ...commonMap(value, "genesis-authorization"),
    [AUTHORIZATION.ceremonyId, bytes(value.ceremonyId, ID_BYTES, "ceremonyId")],
    [AUTHORIZATION.endpointId, bytes(value.endpointId, ID_BYTES, "endpointId")],
    [AUTHORIZATION.epoch, 1],
    [
      AUTHORIZATION.endpointEnvelope,
      canonicalBytes(
        value.endpointEnvelope,
        E2EE_SIZE_LIMITS.controlEnvelopeBytes,
        "endpointEnvelope",
      ),
    ],
    [
      AUTHORIZATION.recoveryConfirmation,
      canonicalBytes(
        value.recoveryConfirmation,
        E2EE_SIZE_LIMITS.controlEnvelopeBytes,
        "recoveryConfirmation",
      ),
    ],
    [
      AUTHORIZATION.signedGenesisCommit,
      canonicalBytes(
        value.signedGenesisCommit,
        E2EE_SIZE_LIMITS.vaultLogEntryBytes,
        "signedGenesisCommit",
      ),
    ],
  ]);
}

export function encodeAncV1UnsignedGenesisAuthorization(
  value: AncV1UnsignedGenesisAuthorization,
): Uint8Array {
  return encodeAncV1Canonical(unsignedAuthorizationMap(value));
}

export function encodeAncV1GenesisAuthorization(
  value: AncV1GenesisAuthorization,
): Uint8Array {
  exact(value, AUTHORIZATION_FIELDS, "Genesis authorization");
  const { signature, ...unsigned } = value;
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      ...unsignedAuthorizationMap(unsigned),
      [AUTHORIZATION.signature, bytes(signature, SIGNATURE_BYTES, "signature")],
    ]),
  );
}

export async function signAncV1GenesisAuthorization(
  value: AncV1UnsignedGenesisAuthorization,
  endpointSigningPrivateKey: Uint8Array,
): Promise<AncV1GenesisAuthorization> {
  return {
    ...value,
    signature: await ancV1SignDetached(
      "genesis-authorization",
      encodeAncV1UnsignedGenesisAuthorization(value),
      endpointSigningPrivateKey,
    ),
  };
}

export function decodeAncV1GenesisAuthorization(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1GenesisAuthorization {
  exact(binding, ["expectedVaultId"], "Genesis authorization binding");
  const allowed = [...Object.values(COMMON), ...Object.values(AUTHORIZATION)];
  const map = decodeMap(
    encoded,
    allowed,
    E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes,
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
  ) {
    fail("Genesis authorization vault binding does not match");
  }
  const epoch = integer(field(map, AUTHORIZATION.epoch, "epoch"), 1, "epoch");
  if (epoch !== 1) fail("Genesis epoch must be exactly 1");
  return {
    suite: literal(field(map, COMMON.suite, "suite"), E2EE_SUITE_ID, "suite"),
    vaultId,
    type: literal(
      field(map, COMMON.type, "type"),
      "genesis-authorization",
      "type",
    ),
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
    ceremonyId: bytes(
      field(map, AUTHORIZATION.ceremonyId, "ceremonyId"),
      ID_BYTES,
      "ceremonyId",
    ),
    endpointId: bytes(
      field(map, AUTHORIZATION.endpointId, "endpointId"),
      ID_BYTES,
      "endpointId",
    ),
    epoch: 1,
    endpointEnvelope: canonicalBytes(
      field(map, AUTHORIZATION.endpointEnvelope, "endpointEnvelope"),
      E2EE_SIZE_LIMITS.controlEnvelopeBytes,
      "endpointEnvelope",
    ),
    recoveryConfirmation: canonicalBytes(
      field(map, AUTHORIZATION.recoveryConfirmation, "recoveryConfirmation"),
      E2EE_SIZE_LIMITS.controlEnvelopeBytes,
      "recoveryConfirmation",
    ),
    signedGenesisCommit: canonicalBytes(
      field(map, AUTHORIZATION.signedGenesisCommit, "signedGenesisCommit"),
      E2EE_SIZE_LIMITS.vaultLogEntryBytes,
      "signedGenesisCommit",
    ),
    signature: bytes(
      field(map, AUTHORIZATION.signature, "signature"),
      SIGNATURE_BYTES,
      "signature",
    ),
  };
}

function decodeGenesisEndpointEnvelope(
  encoded: Uint8Array,
  expectedVaultId: Uint8Array,
): { value: GenesisEndpointEnvelope; unsigned: Uint8Array } {
  const allowed = [...Object.values(COMMON), ...Object.values(ENDPOINT)];
  const map = decodeMap(
    encoded,
    allowed,
    E2EE_SIZE_LIMITS.controlEnvelopeBytes,
  );
  const vaultId = bytes(
    field(map, COMMON.vaultId, "endpoint.vaultId"),
    ID_BYTES,
    "endpoint.vaultId",
  );
  if (!equalBytes(vaultId, expectedVaultId))
    fail("Endpoint vault binding does not match");
  literal(
    field(map, COMMON.suite, "endpoint.suite"),
    E2EE_SUITE_ID,
    "endpoint.suite",
  );
  literal(
    field(map, COMMON.type, "endpoint.type"),
    "endpoint",
    "endpoint.type",
  );
  bytes(
    field(map, COMMON.envelopeId, "endpoint.envelopeId"),
    ID_BYTES,
    "endpoint.envelopeId",
  );
  const softwareKind = field(map, ENDPOINT.role, "endpoint.role");
  if (
    typeof softwareKind !== "string" ||
    softwareKind.length < 1 ||
    softwareKind.length > 64
  ) {
    fail("endpoint.role must contain 1 to 64 characters");
  }
  const unattended = field(map, ENDPOINT.unattended, "endpoint.unattended");
  if (typeof unattended !== "boolean")
    fail("endpoint.unattended must be boolean");
  const unsignedMap = new Map(map);
  unsignedMap.delete(ENDPOINT.signature);
  return {
    value: {
      createdAt: integer(
        field(map, COMMON.createdAt, "endpoint.createdAt"),
        1,
        "endpoint.createdAt",
      ),
      endpointId: bytes(
        field(map, ENDPOINT.endpointId, "endpointId"),
        ID_BYTES,
        "endpointId",
      ),
      unattended,
      signingPublicKey: bytes(
        field(map, ENDPOINT.signingPublicKey, "signingPublicKey"),
        PUBLIC_KEY_BYTES,
        "signingPublicKey",
      ),
      keyAgreementPublicKey: bytes(
        field(map, ENDPOINT.keyAgreementPublicKey, "keyAgreementPublicKey"),
        PUBLIC_KEY_BYTES,
        "keyAgreementPublicKey",
      ),
      addedByEndpointId: bytes(
        field(map, ENDPOINT.addedByEndpointId, "addedByEndpointId"),
        ID_BYTES,
        "addedByEndpointId",
      ),
      recoveryConfirmationHash: bytes(
        field(map, ENDPOINT.sasTranscriptHash, "sasTranscriptHash"),
        HASH_BYTES,
        "sasTranscriptHash",
      ),
      signature: bytes(
        field(map, ENDPOINT.signature, "endpoint.signature"),
        SIGNATURE_BYTES,
        "endpoint.signature",
      ),
    },
    unsigned: encodeAncV1Canonical(unsignedMap),
  };
}

function memberMatchesEndpoint(
  member: ControlLogMember,
  endpoint: GenesisEndpointEnvelope,
  authorizationEnvelopeId: Uint8Array,
): boolean {
  return (
    member.endpointId === idHex(endpoint.endpointId, "endpointId") &&
    member.role === "endpoint" &&
    !member.unattended &&
    member.signingPublicKey === ancV1BytesToHex(endpoint.signingPublicKey) &&
    member.keyAgreementPublicKey ===
      ancV1BytesToHex(endpoint.keyAgreementPublicKey) &&
    member.enrollmentRef === idHex(authorizationEnvelopeId, "envelopeId")
  );
}

/**
 * Verify the sole anc/v1 trust-on-first-use authorization. The expected
 * recovery confirmation must be the exact local artifact emitted only after
 * echo-back. Hosted state is deliberately not an input and has no authority.
 */
export async function verifyAncV1GenesisAuthorization(
  encodedAuthorization: Uint8Array,
  expectedRecoveryConfirmation: Uint8Array,
  input: { commit: ControlMembershipCommit; entry: SignedControlLogEntry },
): Promise<boolean> {
  try {
    exact(input, ["commit", "entry"], "Genesis control-log callback input");
    if (!/^[0-9a-f]{32}$/.test(input.entry.vaultId)) return false;
    const entryBytes = encodeSignedControlLogEntry(input.entry);
    const vaultId = bytes(
      Uint8Array.from(
        input.entry.vaultId
          .match(/.{2}/g)
          ?.map((pair) => Number.parseInt(pair, 16)) ?? [],
      ),
      ID_BYTES,
      "entry.vaultId",
    );
    const authorization = decodeAncV1GenesisAuthorization(
      encodedAuthorization,
      { expectedVaultId: vaultId },
    );
    const confirmation = decodeAncV1GenesisRecoveryConfirmation(
      expectedRecoveryConfirmation,
      { expectedVaultId: vaultId },
    );
    if (
      !equalBytes(
        authorization.recoveryConfirmation,
        expectedRecoveryConfirmation,
      )
    )
      return false;
    const embeddedConfirmation = decodeAncV1GenesisRecoveryConfirmation(
      authorization.recoveryConfirmation,
      { expectedVaultId: vaultId },
    );
    if (
      !equalBytes(confirmation.ceremonyId, embeddedConfirmation.ceremonyId) ||
      !equalBytes(confirmation.endpointId, embeddedConfirmation.endpointId) ||
      !equalBytes(confirmation.recoveryId, embeddedConfirmation.recoveryId) ||
      !equalBytes(
        confirmation.recoverySigningPublicKey,
        embeddedConfirmation.recoverySigningPublicKey,
      ) ||
      !equalBytes(
        confirmation.recoveryKeyAgreementPublicKey,
        embeddedConfirmation.recoveryKeyAgreementPublicKey,
      ) ||
      !equalBytes(
        confirmation.recoveryWrapHash,
        embeddedConfirmation.recoveryWrapHash,
      ) ||
      confirmation.confirmedAt !== embeddedConfirmation.confirmedAt ||
      confirmation.recoveryGeneration !==
        embeddedConfirmation.recoveryGeneration
    )
      return false;
    const endpointResult = decodeGenesisEndpointEnvelope(
      authorization.endpointEnvelope,
      vaultId,
    );
    const endpoint = endpointResult.value;
    const confirmationHash = await hashAncV1GenesisRecoveryConfirmation(
      expectedRecoveryConfirmation,
      vaultId,
    );
    if (
      authorization.epoch !== 1 ||
      authorization.createdAt < confirmation.confirmedAt ||
      !equalBytes(authorization.ceremonyId, confirmation.ceremonyId) ||
      !equalBytes(authorization.endpointId, confirmation.endpointId) ||
      !equalBytes(endpoint.endpointId, authorization.endpointId) ||
      !equalBytes(endpoint.addedByEndpointId, authorization.endpointId) ||
      endpoint.unattended ||
      !equalBytes(endpoint.recoveryConfirmationHash, confirmationHash) ||
      !equalBytes(authorization.signedGenesisCommit, entryBytes)
    )
      return false;
    if (
      !(await ancV1VerifyDetached(
        "endpoint",
        endpointResult.unsigned,
        endpoint.signature,
        endpoint.signingPublicKey,
      ))
    )
      return false;
    const { signature, ...unsigned } = authorization;
    if (
      !(await ancV1VerifyDetached(
        "genesis-authorization",
        encodeAncV1UnsignedGenesisAuthorization(unsigned),
        signature,
        endpoint.signingPublicKey,
      ))
    )
      return false;
    const decodedEntry = decodeSignedControlLogEntry(
      authorization.signedGenesisCommit,
    );
    const entryCreatedAtMs = Date.parse(decodedEntry.createdAt);
    if (!Number.isFinite(entryCreatedAtMs)) return false;
    const { signature: entrySignature, ...unsignedEntry } = decodedEntry;
    if (
      !(await ancV1VerifyDetached(
        "log-entry",
        encodeUnsignedControlLogEntry(unsignedEntry),
        ancV1HexToBytes(entrySignature),
        endpoint.signingPublicKey,
      ))
    )
      return false;
    if (
      confirmation.confirmedAt > endpoint.createdAt ||
      endpoint.createdAt * 1_000 > entryCreatedAtMs ||
      entryCreatedAtMs > authorization.createdAt * 1_000 ||
      decodedEntry.sequence !== 0 ||
      decodedEntry.previousHash !== ZERO_HASH ||
      decodedEntry.vaultId !== input.entry.vaultId ||
      decodedEntry.innerEnvelope.vaultId !== decodedEntry.vaultId ||
      input.commit.vaultId !== input.entry.vaultId ||
      decodedEntry.signerEndpointId !==
        idHex(authorization.endpointId, "endpointId") ||
      decodedEntry.innerEnvelope.type !== "membership_commit" ||
      !equalBytes(
        encodeControlLogInnerEnvelope(decodedEntry.innerEnvelope),
        encodeControlLogInnerEnvelope(input.commit),
      ) ||
      input.commit.ceremonyKind !== "first_device" ||
      input.commit.ceremonyId !==
        idHex(authorization.ceremonyId, "ceremonyId") ||
      input.commit.epoch !== 1 ||
      input.commit.previousMembershipHash !== null ||
      input.commit.activeMembers.length !== 1 ||
      input.commit.removedEndpointIds.length !== 0 ||
      input.commit.rotationCompleted ||
      input.commit.outstandingJobsResolved ||
      input.commit.recoverySnapshotHash !== null ||
      input.commit.recoveryAuthorizationHash !== null ||
      input.commit.recoveryGeneration !== 1 ||
      input.commit.recoveryId !==
        idHex(confirmation.recoveryId, "recoveryId") ||
      input.commit.recoverySigningPublicKey !==
        ancV1BytesToHex(confirmation.recoverySigningPublicKey) ||
      input.commit.recoveryKeyAgreementPublicKey !==
        ancV1BytesToHex(confirmation.recoveryKeyAgreementPublicKey) ||
      input.commit.recoveryWrapHash !==
        ancV1BytesToHex(confirmation.recoveryWrapHash) ||
      !memberMatchesEndpoint(
        input.commit.activeMembers[0]!,
        endpoint,
        authorization.envelopeId,
      )
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

export function createAncV1GenesisAuthorizationVerifier(
  encodedAuthorization: Uint8Array,
  expectedRecoveryConfirmation: Uint8Array,
): (input: {
  commit: ControlMembershipCommit;
  entry: SignedControlLogEntry;
}) => Promise<boolean> {
  const authorization = encodedAuthorization.slice();
  const confirmation = expectedRecoveryConfirmation.slice();
  return (input) =>
    verifyAncV1GenesisAuthorization(authorization, confirmation, input);
}

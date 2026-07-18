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
  type ControlLogState,
  type ControlMembershipCommit,
  type SignedControlLogEntry,
  controlMembershipCommitSchema,
  controlLogStateSchema,
  encodeControlLogInnerEnvelope,
  encodeSignedControlLogEntry,
  encodeUnsignedControlLogEntry,
  signedControlLogEntrySchema,
} from "./control-log.js";
import {
  ancV1LifecycleIdFromHex,
  assertAncV1RecoverySnapshotAuthority,
  decodeAncV1RecoverySnapshotCommitment,
  hashAncV1RecoverySnapshotCommitment,
} from "./lifecycle-codecs.js";
import {
  type AncV1RecoveryEntropy,
  type AncV1VaultId,
  ancV1BoxDecrypt,
  ancV1BoxEncrypt,
  ancV1BoxKeypairFromSeed,
  ancV1DeriveRecoveryRoot,
  ancV1Hash,
  ancV1RecoveryEntropyFromBip39Bytes,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
  ancV1VaultId,
  ancV1VerifyDetached,
} from "./portable-crypto.js";
import { getAncV1RecoveryDerivationTestHook } from "./recovery-ceremony-test-hooks.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
} from "./suite.js";

const COMMON = E2EE_ENVELOPE_FIELDS.common;
const WRAP = E2EE_ENVELOPE_FIELDS.recoveryWrap;
const REPLACEMENT = E2EE_ENVELOPE_FIELDS.recoveryReplacementConfirmation;
const AUTHORIZATION = E2EE_ENVELOPE_FIELDS.recoveryAuthorization;
const ENDPOINT = E2EE_ENVELOPE_FIELDS.endpoint;
const ID_BYTES = 16;
const HASH_BYTES = 32;
const PUBLIC_KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;
const BOX_NONCE_BYTES = 24;
const EEK_BYTES = 32;
const BOXED_EEK_BYTES = 64;
const CONFIRMATION_NONCE_BYTES = 32;
const MAX_LIFETIME_SECONDS = 600;
const MAX_AGGREGATE_BYTES = 1024 * 1024;

export class AncV1RecoveryCeremonyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AncV1RecoveryCeremonyError";
  }
}

type CommonEnvelope = {
  suite: typeof E2EE_SUITE_ID;
  vaultId: Uint8Array;
  type: string;
  createdAt: number;
  envelopeId: Uint8Array;
};

export interface AncV1RecoveryAuthority {
  recoveryGeneration: number;
  recoveryId: Uint8Array;
  signingPublicKey: Uint8Array;
  signingPrivateKey: Uint8Array;
  keyAgreementPublicKey: Uint8Array;
  keyAgreementPrivateKey: Uint8Array;
}

export interface AncV1UnsignedRecoveryWrap extends CommonEnvelope {
  type: "recovery-wrap";
  ceremonyId: Uint8Array;
  recoveryGeneration: number;
  recoveryId: Uint8Array;
  recoveryKeyAgreementPublicKey: Uint8Array;
  epoch: number;
  issuerEndpointId: Uint8Array;
  activationControlSequence: number;
  activationPreviousHead: Uint8Array;
  activationPreviousMembershipHash: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export interface AncV1RecoveryWrap extends AncV1UnsignedRecoveryWrap {
  signature: Uint8Array;
}

export interface AncV1UnsignedRecoveryReplacementConfirmation extends CommonEnvelope {
  type: "recovery-replacement-confirmation";
  ceremonyId: Uint8Array;
  priorRecoveryGeneration: number;
  priorRecoveryId: Uint8Array;
  replacementRecoveryGeneration: number;
  replacementRecoveryId: Uint8Array;
  replacementRecoverySigningPublicKey: Uint8Array;
  replacementRecoveryKeyAgreementPublicKey: Uint8Array;
  replacementRecoveryWrapHash: Uint8Array;
  candidateEndpointId: Uint8Array;
  newEpoch: number;
  confirmationNonce: Uint8Array;
}

export interface AncV1RecoveryReplacementConfirmation extends AncV1UnsignedRecoveryReplacementConfirmation {
  signature: Uint8Array;
}

export interface AncV1UnsignedRecoveryAuthorization extends CommonEnvelope {
  type: "recovery-authorization";
  ceremonyId: Uint8Array;
  consumedRecoveryGeneration: number;
  consumedRecoveryId: Uint8Array;
  consumedRecoverySigningPublicKey: Uint8Array;
  consumedRecoveryKeyAgreementPublicKey: Uint8Array;
  currentSnapshotHash: Uint8Array;
  consumedRecoveryWrapHash: Uint8Array;
  candidateEndpointEnvelope: Uint8Array;
  replacementConfirmation: Uint8Array;
  replacementRecoveryWrap: Uint8Array;
  newEpoch: number;
  expiresAt: number;
}

export interface AncV1RecoveryAuthorization extends AncV1UnsignedRecoveryAuthorization {
  signature: Uint8Array;
}

export interface AncV1VerifiedRecoveryProjection {
  expectedCurrent: {
    vaultId: string;
    sequence: number;
    headHash: string;
    membershipHash: string;
    epoch: number;
    recoveryGeneration: number;
    recoveryId: string;
    recoveryWrapHash: string;
  };
  next: {
    epoch: number;
    recoveryGeneration: number;
    recoveryId: string;
    recoverySigningPublicKey: string;
    recoveryKeyAgreementPublicKey: string;
    recoveryWrapHash: string;
    soleEndpointId: string;
    soleEndpointSigningPublicKey: string;
    soleEndpointKeyAgreementPublicKey: string;
    removedEndpointIds: string[];
  };
  consumedAuthority: {
    recoveryGeneration: number;
    recoveryId: string;
  };
  authorizationHash: string;
  snapshotHash: string;
  confirmationNonce: string;
  confirmationEnvelopeId: string;
  ceremonyId: string;
}

export interface AncV1RecoveryDurableCasProjection {
  expectedCurrentState: ControlLogState;
  nextState: ControlLogState;
  entryHash: string;
  recovery: AncV1VerifiedRecoveryProjection;
}

export type AncV1PreparedRecoveryAuthorizationVerifier = ((callback: {
  commit: ControlMembershipCommit;
  entry: SignedControlLogEntry;
  current: ControlLogState;
}) => Promise<boolean>) & {
  projectNextState(reduced: {
    state: ControlLogState;
    entryHash: string;
    idempotent: boolean;
  }): AncV1RecoveryDurableCasProjection;
};

type CandidateEndpoint = {
  createdAt: number;
  envelopeId: Uint8Array;
  endpointId: Uint8Array;
  signingPublicKey: Uint8Array;
  keyAgreementPublicKey: Uint8Array;
  addedByEndpointId: Uint8Array;
  transcriptHash: Uint8Array;
  signature: Uint8Array;
  unsigned: Uint8Array;
};

export interface AncV1RecoveryConfirmationNonceClaim {
  vaultId: string;
  ceremonyId: string;
  confirmationEnvelopeId: string;
  confirmationNonce: Uint8Array;
  priorRecoveryGeneration: number;
  replacementRecoveryGeneration: number;
}

const commonKeys = Object.values(COMMON);
const wrapKeys = [...commonKeys, ...Object.values(WRAP)];
const replacementKeys = [...commonKeys, ...Object.values(REPLACEMENT)];
const authorizationKeys = [...commonKeys, ...Object.values(AUTHORIZATION)];

const WRAP_UNSIGNED_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "ceremonyId",
  "recoveryGeneration",
  "recoveryId",
  "recoveryKeyAgreementPublicKey",
  "epoch",
  "issuerEndpointId",
  "activationControlSequence",
  "activationPreviousHead",
  "activationPreviousMembershipHash",
  "nonce",
  "ciphertext",
] as const;
const WRAP_FIELDS = [...WRAP_UNSIGNED_FIELDS, "signature"] as const;
const REPLACEMENT_UNSIGNED_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "ceremonyId",
  "priorRecoveryGeneration",
  "priorRecoveryId",
  "replacementRecoveryGeneration",
  "replacementRecoveryId",
  "replacementRecoverySigningPublicKey",
  "replacementRecoveryKeyAgreementPublicKey",
  "replacementRecoveryWrapHash",
  "candidateEndpointId",
  "newEpoch",
  "confirmationNonce",
] as const;
const REPLACEMENT_FIELDS = [
  ...REPLACEMENT_UNSIGNED_FIELDS,
  "signature",
] as const;
const AUTHORIZATION_UNSIGNED_FIELDS = [
  "suite",
  "vaultId",
  "type",
  "createdAt",
  "envelopeId",
  "ceremonyId",
  "consumedRecoveryGeneration",
  "consumedRecoveryId",
  "consumedRecoverySigningPublicKey",
  "consumedRecoveryKeyAgreementPublicKey",
  "currentSnapshotHash",
  "consumedRecoveryWrapHash",
  "candidateEndpointEnvelope",
  "replacementConfirmation",
  "replacementRecoveryWrap",
  "newEpoch",
  "expiresAt",
] as const;
const AUTHORIZATION_FIELDS = [
  ...AUTHORIZATION_UNSIGNED_FIELDS,
  "signature",
] as const;

function fail(message: string): never {
  throw new AncV1RecoveryCeremonyError(message);
}

function exact(value: object, fields: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, i) => field !== expected[i])
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
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

function decodeMap(
  encoded: Uint8Array,
  allowed: readonly number[],
): ReadonlyMap<number, AncV1CanonicalValue> {
  if (
    !(encoded instanceof Uint8Array) ||
    encoded.byteLength === 0 ||
    encoded.byteLength > E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes
  ) {
    fail("Envelope exceeds the frozen anc/v1 size limit");
  }
  try {
    const map = decodeAncV1Envelope(encoded, allowed, {
      maxBytes: E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes,
    });
    if (map.size !== allowed.length)
      fail("Envelope is missing required fields");
    return map;
  } catch (error) {
    if (error instanceof AncV1RecoveryCeremonyError) throw error;
    if (error instanceof AncV1CanonicalEncodingError) fail(error.message);
    throw error;
  }
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
  if (!equalBytes(vaultId, bytes(expectedVaultId, ID_BYTES, "expectedVaultId")))
    fail("Envelope vault binding does not match");
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

function assertLifetime(createdAt: number, expiresAt: number): void {
  if (expiresAt < createdAt || expiresAt - createdAt > MAX_LIFETIME_SECONDS) {
    fail("Recovery authorization lifetime must be at most 10 minutes");
  }
}

export async function deriveAncV1RecoveryId(input: {
  vaultId: Uint8Array;
  recoveryGeneration: number;
  recoverySigningPublicKey: Uint8Array;
  recoveryKeyAgreementPublicKey: Uint8Array;
}): Promise<Uint8Array> {
  exact(
    input,
    [
      "vaultId",
      "recoveryGeneration",
      "recoverySigningPublicKey",
      "recoveryKeyAgreementPublicKey",
    ],
    "Recovery public descriptor",
  );
  const descriptor = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [COMMON.suite, E2EE_SUITE_ID],
      [COMMON.vaultId, bytes(input.vaultId, ID_BYTES, "vaultId")],
      [
        E2EE_ENVELOPE_FIELDS.recovery.recoveryGeneration,
        integer(input.recoveryGeneration, 1, "recoveryGeneration"),
      ],
      [
        E2EE_ENVELOPE_FIELDS.genesisRecoveryConfirmation
          .recoverySigningPublicKey,
        bytes(
          input.recoverySigningPublicKey,
          PUBLIC_KEY_BYTES,
          "recoverySigningPublicKey",
        ),
      ],
      [
        E2EE_ENVELOPE_FIELDS.genesisRecoveryConfirmation
          .recoveryKeyAgreementPublicKey,
        bytes(
          input.recoveryKeyAgreementPublicKey,
          PUBLIC_KEY_BYTES,
          "recoveryKeyAgreementPublicKey",
        ),
      ],
    ]),
  );
  return (await ancV1Hash("recovery-authority", descriptor)).slice(0, ID_BYTES);
}

/**
 * Low-level native-parity primitive deriving authority from an existing root.
 * Product callers should use `deriveAncV1RecoveryAuthorityFromEntropy` so the
 * frozen entropy, vault-salt, KDF, generation-separation, and cleanup contract
 * cannot be composed inconsistently.
 */
export async function deriveAncV1RecoveryAuthority(input: {
  vaultId: Uint8Array;
  recoveryGeneration: number;
  argon2Root: Uint8Array;
}): Promise<AncV1RecoveryAuthority> {
  exact(
    input,
    ["vaultId", "recoveryGeneration", "argon2Root"],
    "Recovery authority derivation input",
  );
  const vaultId = bytes(input.vaultId, ID_BYTES, "vaultId");
  const generation = integer(input.recoveryGeneration, 1, "recoveryGeneration");
  const root = bytes(input.argon2Root, HASH_BYTES, "argon2Root");
  const preimage = (purpose: "signing" | "key-agreement") =>
    encodeAncV1Canonical(
      new Map<number, AncV1CanonicalValue>([
        [COMMON.suite, E2EE_SUITE_ID],
        [COMMON.vaultId, vaultId],
        [E2EE_ENVELOPE_FIELDS.recovery.recoveryGeneration, generation],
        [COMMON.type, purpose],
        [E2EE_ENVELOPE_FIELDS.recovery.ciphertext, root],
      ]),
    );
  const signingPreimage = preimage("signing");
  const agreementPreimage = preimage("key-agreement");
  let signingSeed: Uint8Array | undefined;
  let agreementSeed: Uint8Array | undefined;
  let temporarySigningPrivateKey: Uint8Array | undefined;
  let temporaryAgreementPrivateKey: Uint8Array | undefined;
  const testHook = getAncV1RecoveryDerivationTestHook();
  try {
    signingSeed = await ancV1Hash("recovery-authority", signingPreimage);
    agreementSeed = await ancV1Hash("recovery-authority", agreementPreimage);
    const signing = await ancV1SigningKeypairFromSeed(signingSeed);
    temporarySigningPrivateKey = signing.privateKey;
    testHook?.afterSigningKeypair?.();
    const agreement = await ancV1BoxKeypairFromSeed(agreementSeed);
    temporaryAgreementPrivateKey = agreement.privateKey;
    const recoveryId = await deriveAncV1RecoveryId({
      vaultId,
      recoveryGeneration: generation,
      recoverySigningPublicKey: signing.publicKey,
      recoveryKeyAgreementPublicKey: agreement.publicKey,
    });
    return {
      recoveryGeneration: generation,
      recoveryId,
      signingPublicKey: signing.publicKey.slice(),
      signingPrivateKey: signing.privateKey.slice(),
      keyAgreementPublicKey: agreement.publicKey.slice(),
      keyAgreementPrivateKey: agreement.privateKey.slice(),
    };
  } finally {
    signingPreimage.fill(0);
    agreementPreimage.fill(0);
    signingSeed?.fill(0);
    agreementSeed?.fill(0);
    temporarySigningPrivateKey?.fill(0);
    temporaryAgreementPrivateKey?.fill(0);
    if (temporarySigningPrivateKey)
      testHook?.observeWipedPrivateKey?.("signing", temporarySigningPrivateKey);
    if (temporaryAgreementPrivateKey)
      testHook?.observeWipedPrivateKey?.(
        "key-agreement",
        temporaryAgreementPrivateKey,
      );
    root.fill(0);
  }
}

/**
 * Normative anc/v1 product helper for genesis and every recovery generation.
 * It snapshots caller inputs before its first await, derives the frozen Argon2
 * root using vaultId as salt, generation-separates the authority, and wipes all
 * owned secret intermediates.
 */
export async function deriveAncV1RecoveryAuthorityFromEntropy(input: {
  recoveryEntropy: AncV1RecoveryEntropy;
  vaultId: AncV1VaultId;
  recoveryGeneration: number;
}): Promise<AncV1RecoveryAuthority> {
  exact(
    input,
    ["recoveryEntropy", "vaultId", "recoveryGeneration"],
    "Canonical recovery authority derivation input",
  );
  let recoveryEntropy: AncV1RecoveryEntropy | undefined;
  let vaultId: AncV1VaultId | undefined;
  let argon2Root: Uint8Array | undefined;
  try {
    const recoveryEntropyInput = input.recoveryEntropy;
    recoveryEntropy = ancV1RecoveryEntropyFromBip39Bytes(recoveryEntropyInput);
    const vaultIdInput = input.vaultId;
    vaultId = ancV1VaultId(vaultIdInput);
    const generationInput = input.recoveryGeneration;
    const generation = integer(generationInput, 1, "recoveryGeneration");
    argon2Root = await ancV1DeriveRecoveryRoot({
      recoveryEntropy,
      vaultId,
    });
    return await deriveAncV1RecoveryAuthority({
      vaultId,
      recoveryGeneration: generation,
      argon2Root,
    });
  } finally {
    recoveryEntropy?.fill(0);
    vaultId?.fill(0);
    argon2Root?.fill(0);
    if (argon2Root)
      getAncV1RecoveryDerivationTestHook()?.observeWipedArgon2Root?.(
        argon2Root,
      );
  }
}

function wrapMap(
  value: AncV1UnsignedRecoveryWrap,
): Map<number, AncV1CanonicalValue> {
  const map = commonMap(value, "recovery-wrap");
  map.set(WRAP.ceremonyId, bytes(value.ceremonyId, ID_BYTES, "ceremonyId"));
  map.set(
    WRAP.recoveryGeneration,
    integer(value.recoveryGeneration, 1, "recoveryGeneration"),
  );
  map.set(WRAP.recoveryId, bytes(value.recoveryId, ID_BYTES, "recoveryId"));
  map.set(
    WRAP.recoveryKeyAgreementPublicKey,
    bytes(
      value.recoveryKeyAgreementPublicKey,
      PUBLIC_KEY_BYTES,
      "recoveryKeyAgreementPublicKey",
    ),
  );
  map.set(WRAP.epoch, integer(value.epoch, 1, "epoch"));
  map.set(
    WRAP.issuerEndpointId,
    bytes(value.issuerEndpointId, ID_BYTES, "issuerEndpointId"),
  );
  map.set(
    WRAP.activationControlSequence,
    integer(value.activationControlSequence, 0, "activationControlSequence"),
  );
  map.set(
    WRAP.activationPreviousHead,
    bytes(value.activationPreviousHead, HASH_BYTES, "activationPreviousHead"),
  );
  map.set(
    WRAP.activationPreviousMembershipHash,
    bytes(
      value.activationPreviousMembershipHash,
      HASH_BYTES,
      "activationPreviousMembershipHash",
    ),
  );
  map.set(WRAP.nonce, bytes(value.nonce, BOX_NONCE_BYTES, "nonce"));
  map.set(
    WRAP.ciphertext,
    bytes(value.ciphertext, BOXED_EEK_BYTES, "ciphertext"),
  );
  return map;
}

export function encodeAncV1UnsignedRecoveryWrap(
  value: AncV1UnsignedRecoveryWrap,
): Uint8Array {
  exact(value, WRAP_UNSIGNED_FIELDS, "Unsigned recovery wrap");
  return encodeAncV1Canonical(wrapMap(value));
}

export function encodeAncV1RecoveryWrap(value: AncV1RecoveryWrap): Uint8Array {
  exact(value, WRAP_FIELDS, "Recovery wrap");
  const { signature, ...unsigned } = value;
  const map = wrapMap(unsigned);
  map.set(WRAP.signature, bytes(signature, SIGNATURE_BYTES, "signature"));
  return encodeAncV1Canonical(map);
}

export async function createAncV1RecoveryWrap(
  value: Omit<AncV1UnsignedRecoveryWrap, "ciphertext"> & { eek: Uint8Array },
  keys: {
    issuerKeyAgreementPrivateKey: Uint8Array;
    issuerSigningPrivateKey: Uint8Array;
  },
): Promise<AncV1RecoveryWrap> {
  exact(
    value,
    [...WRAP_UNSIGNED_FIELDS.filter((field) => field !== "ciphertext"), "eek"],
    "Recovery wrap creation input",
  );
  exact(
    keys,
    ["issuerKeyAgreementPrivateKey", "issuerSigningPrivateKey"],
    "Recovery wrap creation keys",
  );
  const { eek, ...base } = value;
  const eekCopy = bytes(eek, EEK_BYTES, "eek");
  const agreementPrivateKey = bytes(
    keys.issuerKeyAgreementPrivateKey,
    32,
    "issuerKeyAgreementPrivateKey",
  );
  const signingPrivateKey = bytes(
    keys.issuerSigningPrivateKey,
    64,
    "issuerSigningPrivateKey",
  );
  try {
    const ciphertext = await ancV1BoxEncrypt(
      "eek-wrap",
      eekCopy,
      bytes(value.nonce, BOX_NONCE_BYTES, "nonce"),
      bytes(
        value.recoveryKeyAgreementPublicKey,
        PUBLIC_KEY_BYTES,
        "recoveryKeyAgreementPublicKey",
      ),
      agreementPrivateKey,
    );
    const unsigned: AncV1UnsignedRecoveryWrap = { ...base, ciphertext };
    return {
      ...unsigned,
      signature: await ancV1SignDetached(
        "recovery-wrap",
        encodeAncV1UnsignedRecoveryWrap(unsigned),
        signingPrivateKey,
      ),
    };
  } finally {
    eekCopy.fill(0);
    agreementPrivateKey.fill(0);
    signingPrivateKey.fill(0);
  }
}

export function decodeAncV1RecoveryWrap(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1RecoveryWrap {
  exact(binding, ["expectedVaultId"], "Recovery wrap binding");
  const map = decodeMap(encoded, wrapKeys);
  return {
    ...commonFromMap(map, "recovery-wrap", binding.expectedVaultId),
    ceremonyId: bytes(
      field(map, WRAP.ceremonyId, "ceremonyId"),
      ID_BYTES,
      "ceremonyId",
    ),
    recoveryGeneration: integer(
      field(map, WRAP.recoveryGeneration, "recoveryGeneration"),
      1,
      "recoveryGeneration",
    ),
    recoveryId: bytes(
      field(map, WRAP.recoveryId, "recoveryId"),
      ID_BYTES,
      "recoveryId",
    ),
    recoveryKeyAgreementPublicKey: bytes(
      field(
        map,
        WRAP.recoveryKeyAgreementPublicKey,
        "recoveryKeyAgreementPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "recoveryKeyAgreementPublicKey",
    ),
    epoch: integer(field(map, WRAP.epoch, "epoch"), 1, "epoch"),
    issuerEndpointId: bytes(
      field(map, WRAP.issuerEndpointId, "issuerEndpointId"),
      ID_BYTES,
      "issuerEndpointId",
    ),
    activationControlSequence: integer(
      field(map, WRAP.activationControlSequence, "activationControlSequence"),
      0,
      "activationControlSequence",
    ),
    activationPreviousHead: bytes(
      field(map, WRAP.activationPreviousHead, "activationPreviousHead"),
      HASH_BYTES,
      "activationPreviousHead",
    ),
    activationPreviousMembershipHash: bytes(
      field(
        map,
        WRAP.activationPreviousMembershipHash,
        "activationPreviousMembershipHash",
      ),
      HASH_BYTES,
      "activationPreviousMembershipHash",
    ),
    nonce: bytes(field(map, WRAP.nonce, "nonce"), BOX_NONCE_BYTES, "nonce"),
    ciphertext: bytes(
      field(map, WRAP.ciphertext, "ciphertext"),
      BOXED_EEK_BYTES,
      "ciphertext",
    ),
    signature: bytes(
      field(map, WRAP.signature, "signature"),
      SIGNATURE_BYTES,
      "signature",
    ),
  };
}

export async function hashAncV1RecoveryWrap(
  encoded: Uint8Array,
  expectedVaultId: Uint8Array,
): Promise<Uint8Array> {
  decodeAncV1RecoveryWrap(encoded, { expectedVaultId });
  return ancV1Hash("recovery-wrap", encoded.slice());
}

export async function verifyAncV1RecoveryWrap(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array; issuerSigningPublicKey: Uint8Array },
): Promise<AncV1RecoveryWrap> {
  exact(
    binding,
    ["expectedVaultId", "issuerSigningPublicKey"],
    "Recovery wrap verification binding",
  );
  const wrap = decodeAncV1RecoveryWrap(encoded, {
    expectedVaultId: binding.expectedVaultId,
  });
  const { signature, ...unsigned } = wrap;
  if (
    !(await ancV1VerifyDetached(
      "recovery-wrap",
      encodeAncV1UnsignedRecoveryWrap(unsigned),
      signature,
      bytes(
        binding.issuerSigningPublicKey,
        PUBLIC_KEY_BYTES,
        "issuerSigningPublicKey",
      ),
    ))
  )
    fail("Recovery wrap signature verification failed");
  return wrap;
}

export async function verifyAncV1RecoveryWrapRotation(
  encodedWrap: Uint8Array,
  input: {
    commit: ControlMembershipCommit;
    entry: SignedControlLogEntry;
    current: ControlLogState;
  },
): Promise<AncV1RecoveryWrap> {
  exact(input, ["commit", "entry", "current"], "Recovery wrap rotation input");
  const wrapBytes = encodedWrap.slice();
  const commit = controlMembershipCommitSchema.parse(input.commit);
  const entry = signedControlLogEntrySchema.parse(input.entry);
  const current = controlLogStateSchema.parse(input.current);
  if (
    commit.ceremonyKind === "recovery" ||
    commit.epoch !== current.epoch + 1 ||
    entry.vaultId !== current.vaultId ||
    commit.vaultId !== current.vaultId ||
    entry.innerEnvelope.type !== "membership_commit" ||
    !equalBytes(
      encodeControlLogInnerEnvelope(entry.innerEnvelope),
      encodeControlLogInnerEnvelope(commit),
    ) ||
    entry.sequence !== current.sequence + 1 ||
    entry.previousHash !== current.headHash
  )
    fail("Recovery wrap rotation is not the exact next ordinary commit");
  const vaultId = ancV1LifecycleIdFromHex(current.vaultId);
  const wrapHash = await hashAncV1RecoveryWrap(wrapBytes, vaultId);
  if (ancV1BytesToHex(wrapHash) !== commit.recoveryWrapHash)
    fail("Recovery wrap rotation hash does not match the signed commit");
  const decoded = decodeAncV1RecoveryWrap(wrapBytes, {
    expectedVaultId: vaultId,
  });
  const issuerId = ancV1BytesToHex(decoded.issuerEndpointId);
  const issuer = current.activeMembers.find(
    (member) => member.endpointId === issuerId && member.role === "endpoint",
  );
  if (
    !issuer ||
    issuerId !== entry.signerEndpointId ||
    !equalBytes(
      decoded.ceremonyId,
      ancV1LifecycleIdFromHex(commit.ceremonyId),
    ) ||
    decoded.recoveryGeneration !== current.recoveryGeneration ||
    ancV1BytesToHex(decoded.recoveryId) !== current.recoveryId ||
    ancV1BytesToHex(decoded.recoveryKeyAgreementPublicKey) !==
      current.recoveryKeyAgreementPublicKey ||
    decoded.epoch !== commit.epoch ||
    decoded.activationControlSequence !== entry.sequence ||
    !equalBytes(
      decoded.activationPreviousHead,
      ancV1HexToBytes(current.headHash),
    ) ||
    !equalBytes(
      decoded.activationPreviousMembershipHash,
      ancV1HexToBytes(current.membershipHash),
    ) ||
    commit.recoveryGeneration !== current.recoveryGeneration ||
    commit.recoveryId !== current.recoveryId ||
    commit.recoverySigningPublicKey !== current.recoverySigningPublicKey ||
    commit.recoveryKeyAgreementPublicKey !==
      current.recoveryKeyAgreementPublicKey
  )
    fail("Recovery wrap rotation authority binding is invalid");
  const currentSignedAt = Date.parse(current.signedAt) / 1000;
  const entrySignedAt = Date.parse(entry.createdAt) / 1000;
  if (
    !Number.isFinite(currentSignedAt) ||
    !Number.isFinite(entrySignedAt) ||
    decoded.createdAt < currentSignedAt ||
    decoded.createdAt > entrySignedAt
  )
    fail("Recovery wrap rotation timestamp is outside the signed edge");
  return verifyAncV1RecoveryWrap(wrapBytes, {
    expectedVaultId: vaultId,
    issuerSigningPublicKey: ancV1HexToBytes(issuer.signingPublicKey),
  });
}

export function createAncV1RecoveryWrapRotationVerifier(
  encodedWrap: Uint8Array,
): (input: {
  commit: ControlMembershipCommit;
  entry: SignedControlLogEntry;
  current: ControlLogState;
}) => Promise<boolean> {
  const wrap = encodedWrap.slice();
  return async (input) => {
    try {
      await verifyAncV1RecoveryWrapRotation(wrap, input);
      return true;
    } catch {
      return false;
    }
  };
}

export async function unsealAncV1RecoveryWrap(
  encoded: Uint8Array,
  input: {
    expectedVaultId: Uint8Array;
    issuerSigningPublicKey: Uint8Array;
    issuerKeyAgreementPublicKey: Uint8Array;
    recoveryKeyAgreementPrivateKey: Uint8Array;
  },
): Promise<Uint8Array> {
  exact(
    input,
    [
      "expectedVaultId",
      "issuerSigningPublicKey",
      "issuerKeyAgreementPublicKey",
      "recoveryKeyAgreementPrivateKey",
    ],
    "Recovery unseal input",
  );
  const wrap = await verifyAncV1RecoveryWrap(encoded, {
    expectedVaultId: input.expectedVaultId,
    issuerSigningPublicKey: input.issuerSigningPublicKey,
  });
  const privateKey = bytes(
    input.recoveryKeyAgreementPrivateKey,
    32,
    "recoveryKeyAgreementPrivateKey",
  );
  try {
    return await ancV1BoxDecrypt(
      "eek-wrap",
      wrap.ciphertext,
      wrap.nonce,
      bytes(
        input.issuerKeyAgreementPublicKey,
        PUBLIC_KEY_BYTES,
        "issuerKeyAgreementPublicKey",
      ),
      privateKey,
    );
  } finally {
    privateKey.fill(0);
  }
}

function replacementMap(
  value: AncV1UnsignedRecoveryReplacementConfirmation,
): Map<number, AncV1CanonicalValue> {
  const map = commonMap(value, "recovery-replacement-confirmation");
  map.set(
    REPLACEMENT.ceremonyId,
    bytes(value.ceremonyId, ID_BYTES, "ceremonyId"),
  );
  map.set(
    REPLACEMENT.priorRecoveryGeneration,
    integer(value.priorRecoveryGeneration, 1, "priorRecoveryGeneration"),
  );
  map.set(
    REPLACEMENT.priorRecoveryId,
    bytes(value.priorRecoveryId, ID_BYTES, "priorRecoveryId"),
  );
  map.set(
    REPLACEMENT.replacementRecoveryGeneration,
    integer(
      value.replacementRecoveryGeneration,
      1,
      "replacementRecoveryGeneration",
    ),
  );
  map.set(
    REPLACEMENT.replacementRecoveryId,
    bytes(value.replacementRecoveryId, ID_BYTES, "replacementRecoveryId"),
  );
  map.set(
    REPLACEMENT.replacementRecoverySigningPublicKey,
    bytes(
      value.replacementRecoverySigningPublicKey,
      PUBLIC_KEY_BYTES,
      "replacementRecoverySigningPublicKey",
    ),
  );
  map.set(
    REPLACEMENT.replacementRecoveryKeyAgreementPublicKey,
    bytes(
      value.replacementRecoveryKeyAgreementPublicKey,
      PUBLIC_KEY_BYTES,
      "replacementRecoveryKeyAgreementPublicKey",
    ),
  );
  map.set(
    REPLACEMENT.replacementRecoveryWrapHash,
    bytes(
      value.replacementRecoveryWrapHash,
      HASH_BYTES,
      "replacementRecoveryWrapHash",
    ),
  );
  map.set(
    REPLACEMENT.candidateEndpointId,
    bytes(value.candidateEndpointId, ID_BYTES, "candidateEndpointId"),
  );
  map.set(REPLACEMENT.newEpoch, integer(value.newEpoch, 2, "newEpoch"));
  map.set(
    REPLACEMENT.confirmationNonce,
    bytes(
      value.confirmationNonce,
      CONFIRMATION_NONCE_BYTES,
      "confirmationNonce",
    ),
  );
  return map;
}

export function encodeAncV1UnsignedRecoveryReplacementConfirmation(
  value: AncV1UnsignedRecoveryReplacementConfirmation,
): Uint8Array {
  exact(
    value,
    REPLACEMENT_UNSIGNED_FIELDS,
    "Unsigned replacement confirmation",
  );
  return encodeAncV1Canonical(replacementMap(value));
}

export function encodeAncV1RecoveryReplacementConfirmation(
  value: AncV1RecoveryReplacementConfirmation,
): Uint8Array {
  exact(value, REPLACEMENT_FIELDS, "Replacement confirmation");
  const { signature, ...unsigned } = value;
  const map = replacementMap(unsigned);
  map.set(
    REPLACEMENT.signature,
    bytes(signature, SIGNATURE_BYTES, "signature"),
  );
  return encodeAncV1Canonical(map);
}

export async function signAncV1RecoveryReplacementConfirmation(
  value: AncV1UnsignedRecoveryReplacementConfirmation,
  replacementSigningPrivateKey: Uint8Array,
): Promise<AncV1RecoveryReplacementConfirmation> {
  const privateKey = bytes(
    replacementSigningPrivateKey,
    64,
    "replacementSigningPrivateKey",
  );
  try {
    return {
      ...value,
      signature: await ancV1SignDetached(
        "recovery-replacement-confirmation",
        encodeAncV1UnsignedRecoveryReplacementConfirmation(value),
        privateKey,
      ),
    };
  } finally {
    privateKey.fill(0);
  }
}

export function decodeAncV1RecoveryReplacementConfirmation(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1RecoveryReplacementConfirmation {
  exact(binding, ["expectedVaultId"], "Replacement confirmation binding");
  const map = decodeMap(encoded, replacementKeys);
  return {
    ...commonFromMap(
      map,
      "recovery-replacement-confirmation",
      binding.expectedVaultId,
    ),
    ceremonyId: bytes(
      field(map, REPLACEMENT.ceremonyId, "ceremonyId"),
      ID_BYTES,
      "ceremonyId",
    ),
    priorRecoveryGeneration: integer(
      field(
        map,
        REPLACEMENT.priorRecoveryGeneration,
        "priorRecoveryGeneration",
      ),
      1,
      "priorRecoveryGeneration",
    ),
    priorRecoveryId: bytes(
      field(map, REPLACEMENT.priorRecoveryId, "priorRecoveryId"),
      ID_BYTES,
      "priorRecoveryId",
    ),
    replacementRecoveryGeneration: integer(
      field(
        map,
        REPLACEMENT.replacementRecoveryGeneration,
        "replacementRecoveryGeneration",
      ),
      1,
      "replacementRecoveryGeneration",
    ),
    replacementRecoveryId: bytes(
      field(map, REPLACEMENT.replacementRecoveryId, "replacementRecoveryId"),
      ID_BYTES,
      "replacementRecoveryId",
    ),
    replacementRecoverySigningPublicKey: bytes(
      field(
        map,
        REPLACEMENT.replacementRecoverySigningPublicKey,
        "replacementRecoverySigningPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "replacementRecoverySigningPublicKey",
    ),
    replacementRecoveryKeyAgreementPublicKey: bytes(
      field(
        map,
        REPLACEMENT.replacementRecoveryKeyAgreementPublicKey,
        "replacementRecoveryKeyAgreementPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "replacementRecoveryKeyAgreementPublicKey",
    ),
    replacementRecoveryWrapHash: bytes(
      field(
        map,
        REPLACEMENT.replacementRecoveryWrapHash,
        "replacementRecoveryWrapHash",
      ),
      HASH_BYTES,
      "replacementRecoveryWrapHash",
    ),
    candidateEndpointId: bytes(
      field(map, REPLACEMENT.candidateEndpointId, "candidateEndpointId"),
      ID_BYTES,
      "candidateEndpointId",
    ),
    newEpoch: integer(
      field(map, REPLACEMENT.newEpoch, "newEpoch"),
      2,
      "newEpoch",
    ),
    confirmationNonce: bytes(
      field(map, REPLACEMENT.confirmationNonce, "confirmationNonce"),
      CONFIRMATION_NONCE_BYTES,
      "confirmationNonce",
    ),
    signature: bytes(
      field(map, REPLACEMENT.signature, "signature"),
      SIGNATURE_BYTES,
      "signature",
    ),
  };
}

export async function verifyAncV1RecoveryReplacementConfirmation(
  encoded: Uint8Array,
  expectedVaultId: Uint8Array,
): Promise<AncV1RecoveryReplacementConfirmation> {
  const value = decodeAncV1RecoveryReplacementConfirmation(encoded, {
    expectedVaultId,
  });
  const { signature, ...unsigned } = value;
  if (
    !(await ancV1VerifyDetached(
      "recovery-replacement-confirmation",
      encodeAncV1UnsignedRecoveryReplacementConfirmation(unsigned),
      signature,
      value.replacementRecoverySigningPublicKey,
    ))
  )
    fail("Replacement authority proof failed");
  return value;
}

function authorizationMap(
  value: AncV1UnsignedRecoveryAuthorization,
): Map<number, AncV1CanonicalValue> {
  const map = commonMap(value, "recovery-authorization");
  const canonical = (encoded: Uint8Array, name: string): Uint8Array => {
    if (
      !(encoded instanceof Uint8Array) ||
      encoded.byteLength === 0 ||
      encoded.byteLength > E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes
    )
      fail(`${name} exceeds the frozen size limit`);
    if (
      !(
        decodeAncV1Canonical(encoded, {
          maxBytes: E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes,
        }) instanceof Map
      )
    )
      fail(`${name} must be a canonical map`);
    return encoded.slice();
  };
  map.set(
    AUTHORIZATION.ceremonyId,
    bytes(value.ceremonyId, ID_BYTES, "ceremonyId"),
  );
  map.set(
    AUTHORIZATION.consumedRecoveryGeneration,
    integer(value.consumedRecoveryGeneration, 1, "consumedRecoveryGeneration"),
  );
  map.set(
    AUTHORIZATION.consumedRecoveryId,
    bytes(value.consumedRecoveryId, ID_BYTES, "consumedRecoveryId"),
  );
  map.set(
    AUTHORIZATION.consumedRecoverySigningPublicKey,
    bytes(
      value.consumedRecoverySigningPublicKey,
      PUBLIC_KEY_BYTES,
      "consumedRecoverySigningPublicKey",
    ),
  );
  map.set(
    AUTHORIZATION.consumedRecoveryKeyAgreementPublicKey,
    bytes(
      value.consumedRecoveryKeyAgreementPublicKey,
      PUBLIC_KEY_BYTES,
      "consumedRecoveryKeyAgreementPublicKey",
    ),
  );
  map.set(
    AUTHORIZATION.currentSnapshotHash,
    bytes(value.currentSnapshotHash, HASH_BYTES, "currentSnapshotHash"),
  );
  map.set(
    AUTHORIZATION.consumedRecoveryWrapHash,
    bytes(
      value.consumedRecoveryWrapHash,
      HASH_BYTES,
      "consumedRecoveryWrapHash",
    ),
  );
  map.set(
    AUTHORIZATION.candidateEndpointEnvelope,
    canonical(value.candidateEndpointEnvelope, "candidateEndpointEnvelope"),
  );
  map.set(
    AUTHORIZATION.replacementConfirmation,
    canonical(value.replacementConfirmation, "replacementConfirmation"),
  );
  map.set(
    AUTHORIZATION.replacementRecoveryWrap,
    canonical(value.replacementRecoveryWrap, "replacementRecoveryWrap"),
  );
  map.set(AUTHORIZATION.newEpoch, integer(value.newEpoch, 2, "newEpoch"));
  map.set(AUTHORIZATION.expiresAt, integer(value.expiresAt, 1, "expiresAt"));
  return map;
}

export function encodeAncV1UnsignedRecoveryAuthorization(
  value: AncV1UnsignedRecoveryAuthorization,
): Uint8Array {
  exact(
    value,
    AUTHORIZATION_UNSIGNED_FIELDS,
    "Unsigned recovery authorization",
  );
  assertLifetime(value.createdAt, value.expiresAt);
  return encodeAncV1Canonical(authorizationMap(value));
}

export function encodeAncV1RecoveryAuthorization(
  value: AncV1RecoveryAuthorization,
): Uint8Array {
  exact(value, AUTHORIZATION_FIELDS, "Recovery authorization");
  const { signature, ...unsigned } = value;
  const map = authorizationMap(unsigned);
  map.set(
    AUTHORIZATION.signature,
    bytes(signature, SIGNATURE_BYTES, "signature"),
  );
  return encodeAncV1Canonical(map);
}

export async function signAncV1RecoveryAuthorization(
  value: AncV1UnsignedRecoveryAuthorization,
  consumedRecoverySigningPrivateKey: Uint8Array,
): Promise<AncV1RecoveryAuthorization> {
  const privateKey = bytes(
    consumedRecoverySigningPrivateKey,
    64,
    "consumedRecoverySigningPrivateKey",
  );
  try {
    return {
      ...value,
      signature: await ancV1SignDetached(
        "recovery-authorization",
        encodeAncV1UnsignedRecoveryAuthorization(value),
        privateKey,
      ),
    };
  } finally {
    privateKey.fill(0);
  }
}

export function decodeAncV1RecoveryAuthorization(
  encoded: Uint8Array,
  binding: { expectedVaultId: Uint8Array },
): AncV1RecoveryAuthorization {
  exact(binding, ["expectedVaultId"], "Recovery authorization binding");
  const map = decodeMap(encoded, authorizationKeys);
  const canonical = (key: number, name: string) => {
    const value = field(map, key, name);
    if (
      !(value instanceof Uint8Array) ||
      value.byteLength === 0 ||
      value.byteLength > E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes ||
      !(
        decodeAncV1Canonical(value, {
          maxBytes: E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes,
        }) instanceof Map
      )
    )
      fail(`${name} must be a bounded canonical map`);
    return value.slice();
  };
  const result: AncV1RecoveryAuthorization = {
    ...commonFromMap(map, "recovery-authorization", binding.expectedVaultId),
    ceremonyId: bytes(
      field(map, AUTHORIZATION.ceremonyId, "ceremonyId"),
      ID_BYTES,
      "ceremonyId",
    ),
    consumedRecoveryGeneration: integer(
      field(
        map,
        AUTHORIZATION.consumedRecoveryGeneration,
        "consumedRecoveryGeneration",
      ),
      1,
      "consumedRecoveryGeneration",
    ),
    consumedRecoveryId: bytes(
      field(map, AUTHORIZATION.consumedRecoveryId, "consumedRecoveryId"),
      ID_BYTES,
      "consumedRecoveryId",
    ),
    consumedRecoverySigningPublicKey: bytes(
      field(
        map,
        AUTHORIZATION.consumedRecoverySigningPublicKey,
        "consumedRecoverySigningPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "consumedRecoverySigningPublicKey",
    ),
    consumedRecoveryKeyAgreementPublicKey: bytes(
      field(
        map,
        AUTHORIZATION.consumedRecoveryKeyAgreementPublicKey,
        "consumedRecoveryKeyAgreementPublicKey",
      ),
      PUBLIC_KEY_BYTES,
      "consumedRecoveryKeyAgreementPublicKey",
    ),
    currentSnapshotHash: bytes(
      field(map, AUTHORIZATION.currentSnapshotHash, "currentSnapshotHash"),
      HASH_BYTES,
      "currentSnapshotHash",
    ),
    consumedRecoveryWrapHash: bytes(
      field(
        map,
        AUTHORIZATION.consumedRecoveryWrapHash,
        "consumedRecoveryWrapHash",
      ),
      HASH_BYTES,
      "consumedRecoveryWrapHash",
    ),
    candidateEndpointEnvelope: canonical(
      AUTHORIZATION.candidateEndpointEnvelope,
      "candidateEndpointEnvelope",
    ),
    replacementConfirmation: canonical(
      AUTHORIZATION.replacementConfirmation,
      "replacementConfirmation",
    ),
    replacementRecoveryWrap: canonical(
      AUTHORIZATION.replacementRecoveryWrap,
      "replacementRecoveryWrap",
    ),
    newEpoch: integer(
      field(map, AUTHORIZATION.newEpoch, "newEpoch"),
      2,
      "newEpoch",
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
  assertLifetime(result.createdAt, result.expiresAt);
  if (
    encoded.byteLength +
      result.candidateEndpointEnvelope.byteLength +
      result.replacementConfirmation.byteLength +
      result.replacementRecoveryWrap.byteLength >
    MAX_AGGREGATE_BYTES
  )
    fail("Recovery bundle exceeds the aggregate size cap");
  return result;
}

export async function hashAncV1RecoveryCandidateTranscript(input: {
  vaultId: Uint8Array;
  ceremonyId: Uint8Array;
  snapshotHash: Uint8Array;
  consumedRecoveryId: Uint8Array;
  candidateEndpointId: Uint8Array;
  candidateSigningPublicKey: Uint8Array;
  candidateKeyAgreementPublicKey: Uint8Array;
  targetEpoch: number;
}): Promise<Uint8Array> {
  exact(
    input,
    [
      "vaultId",
      "ceremonyId",
      "snapshotHash",
      "consumedRecoveryId",
      "candidateEndpointId",
      "candidateSigningPublicKey",
      "candidateKeyAgreementPublicKey",
      "targetEpoch",
    ],
    "Recovery candidate transcript input",
  );
  return ancV1Hash(
    "recovery-authorization",
    encodeAncV1Canonical(
      new Map<number, AncV1CanonicalValue>([
        [COMMON.suite, E2EE_SUITE_ID],
        [COMMON.vaultId, bytes(input.vaultId, ID_BYTES, "vaultId")],
        [
          AUTHORIZATION.ceremonyId,
          bytes(input.ceremonyId, ID_BYTES, "ceremonyId"),
        ],
        [
          AUTHORIZATION.currentSnapshotHash,
          bytes(input.snapshotHash, HASH_BYTES, "snapshotHash"),
        ],
        [
          AUTHORIZATION.consumedRecoveryId,
          bytes(input.consumedRecoveryId, ID_BYTES, "consumedRecoveryId"),
        ],
        [
          ENDPOINT.endpointId,
          bytes(input.candidateEndpointId, ID_BYTES, "candidateEndpointId"),
        ],
        [
          ENDPOINT.signingPublicKey,
          bytes(
            input.candidateSigningPublicKey,
            PUBLIC_KEY_BYTES,
            "candidateSigningPublicKey",
          ),
        ],
        [
          ENDPOINT.keyAgreementPublicKey,
          bytes(
            input.candidateKeyAgreementPublicKey,
            PUBLIC_KEY_BYTES,
            "candidateKeyAgreementPublicKey",
          ),
        ],
        [AUTHORIZATION.newEpoch, integer(input.targetEpoch, 2, "targetEpoch")],
      ]),
    ),
  );
}

function decodeCandidateEndpoint(
  encoded: Uint8Array,
  expectedVaultId: Uint8Array,
): CandidateEndpoint {
  const allowed = [...Object.values(COMMON), ...Object.values(ENDPOINT)];
  const map = decodeMap(encoded, allowed);
  const common = commonFromMap(map, "endpoint", expectedVaultId);
  const unattended = field(map, ENDPOINT.unattended, "endpoint.unattended");
  if (unattended !== false) fail("Recovery candidate must be attended");
  const role = field(map, ENDPOINT.role, "endpoint.role");
  if (typeof role !== "string" || role.length < 1 || role.length > 64)
    fail("endpoint.role is invalid");
  const unsignedMap = new Map(map);
  unsignedMap.delete(ENDPOINT.signature);
  return {
    createdAt: common.createdAt,
    envelopeId: common.envelopeId,
    endpointId: bytes(
      field(map, ENDPOINT.endpointId, "endpointId"),
      ID_BYTES,
      "endpointId",
    ),
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
    transcriptHash: bytes(
      field(map, ENDPOINT.sasTranscriptHash, "sasTranscriptHash"),
      HASH_BYTES,
      "sasTranscriptHash",
    ),
    signature: bytes(
      field(map, ENDPOINT.signature, "signature"),
      SIGNATURE_BYTES,
      "signature",
    ),
    unsigned: encodeAncV1Canonical(unsignedMap),
  };
}

function memberMatchesCandidate(
  member: ControlLogMember,
  candidate: CandidateEndpoint,
  enrollmentRef: Uint8Array,
): boolean {
  return (
    member.endpointId === ancV1BytesToHex(candidate.endpointId) &&
    member.role === "endpoint" &&
    !member.unattended &&
    member.signingPublicKey === ancV1BytesToHex(candidate.signingPublicKey) &&
    member.keyAgreementPublicKey ===
      ancV1BytesToHex(candidate.keyAgreementPublicKey) &&
    member.enrollmentRef === ancV1BytesToHex(enrollmentRef)
  );
}

export async function verifyAncV1RecoveryAuthorization(
  encodedAuthorization: Uint8Array,
  input: {
    currentRecoveryWrap: Uint8Array;
    currentSnapshot: Uint8Array;
    verifiedControlState: ControlLogState;
    commit: ControlMembershipCommit;
    entry: SignedControlLogEntry;
    now: number;
    isConfirmationNonceAvailable: (
      input: AncV1RecoveryConfirmationNonceClaim,
    ) => Promise<boolean>;
    verifyConsumedWrapUnseals: (input: {
      wrap: AncV1RecoveryWrap;
      encodedWrap: Uint8Array;
      issuer: ControlLogMember;
    }) => Promise<boolean>;
  },
): Promise<AncV1VerifiedRecoveryProjection> {
  exact(
    input,
    [
      "currentRecoveryWrap",
      "currentSnapshot",
      "verifiedControlState",
      "commit",
      "entry",
      "now",
      "isConfirmationNonceAvailable",
      "verifyConsumedWrapUnseals",
    ],
    "Recovery verification input",
  );
  const authorizationBytes = Uint8Array.from(encodedAuthorization);
  const currentWrapBytes = Uint8Array.from(input.currentRecoveryWrap);
  const currentSnapshotBytes = Uint8Array.from(input.currentSnapshot);
  const commit = controlMembershipCommitSchema.parse(input.commit);
  const entry = signedControlLogEntrySchema.parse(input.entry);
  const now = integer(input.now, 1, "now");
  const isNonceAvailable = input.isConfirmationNonceAvailable;
  const verifyUnseal = input.verifyConsumedWrapUnseals;
  const state = controlLogStateSchema.parse(input.verifiedControlState);
  const vaultId = ancV1LifecycleIdFromHex(state.vaultId);
  const authorization = decodeAncV1RecoveryAuthorization(authorizationBytes, {
    expectedVaultId: vaultId,
  });
  const snapshot = decodeAncV1RecoverySnapshotCommitment(currentSnapshotBytes, {
    expectedVaultId: vaultId,
  });
  assertAncV1RecoverySnapshotAuthority(snapshot, state);
  const decodedCurrentWrap = decodeAncV1RecoveryWrap(currentWrapBytes, {
    expectedVaultId: vaultId,
  });
  if (now < authorization.createdAt || now > authorization.expiresAt)
    fail("Recovery authorization is expired or not yet valid");
  const { signature, ...unsignedAuthorization } = authorization;
  if (
    !(await ancV1VerifyDetached(
      "recovery-authorization",
      encodeAncV1UnsignedRecoveryAuthorization(unsignedAuthorization),
      signature,
      ancV1HexToBytes(state.recoverySigningPublicKey),
    ))
  )
    fail("Consumed recovery authority signature failed");
  if (
    authorization.consumedRecoveryGeneration !== state.recoveryGeneration ||
    ancV1BytesToHex(authorization.consumedRecoveryId) !== state.recoveryId ||
    ancV1BytesToHex(authorization.consumedRecoverySigningPublicKey) !==
      state.recoverySigningPublicKey ||
    ancV1BytesToHex(authorization.consumedRecoveryKeyAgreementPublicKey) !==
      state.recoveryKeyAgreementPublicKey ||
    authorization.newEpoch !== state.epoch + 1
  )
    fail("Recovery authorization does not consume the exact current authority");
  const expectedConsumedRecoveryId = await deriveAncV1RecoveryId({
    vaultId,
    recoveryGeneration: state.recoveryGeneration,
    recoverySigningPublicKey: authorization.consumedRecoverySigningPublicKey,
    recoveryKeyAgreementPublicKey:
      authorization.consumedRecoveryKeyAgreementPublicKey,
  });
  if (!equalBytes(expectedConsumedRecoveryId, authorization.consumedRecoveryId))
    fail("Consumed recovery ID does not match its public descriptor");
  if (
    entry.vaultId !== state.vaultId ||
    commit.vaultId !== state.vaultId ||
    entry.innerEnvelope.vaultId !== state.vaultId
  )
    fail("Recovery entry, commit, and authenticated state vaults must match");

  const snapshotHash = await hashAncV1RecoverySnapshotCommitment(snapshot);
  if (!equalBytes(snapshotHash, authorization.currentSnapshotHash))
    fail("Recovery snapshot hash mismatch");
  const currentWrapHash = await hashAncV1RecoveryWrap(
    currentWrapBytes,
    vaultId,
  );
  if (
    !equalBytes(currentWrapHash, authorization.consumedRecoveryWrapHash) ||
    ancV1BytesToHex(currentWrapHash) !== state.recoveryWrapHash
  )
    fail("Consumed recovery wrap is not the authenticated current wrap");
  const currentIssuer = state.activeMembers.find(
    (member) =>
      member.endpointId ===
      ancV1BytesToHex(decodedCurrentWrap.issuerEndpointId),
  );
  const stateSignedAtSeconds = Date.parse(state.signedAt) / 1000;
  if (
    !currentIssuer ||
    !Number.isFinite(stateSignedAtSeconds) ||
    decodedCurrentWrap.createdAt > stateSignedAtSeconds ||
    decodedCurrentWrap.createdAt > now ||
    decodedCurrentWrap.recoveryGeneration !== state.recoveryGeneration ||
    ancV1BytesToHex(decodedCurrentWrap.recoveryId) !== state.recoveryId ||
    ancV1BytesToHex(decodedCurrentWrap.recoveryKeyAgreementPublicKey) !==
      state.recoveryKeyAgreementPublicKey ||
    decodedCurrentWrap.epoch !== state.epoch ||
    decodedCurrentWrap.activationControlSequence > state.sequence
  )
    fail("Consumed recovery wrap binding is invalid");
  await verifyAncV1RecoveryWrap(currentWrapBytes, {
    expectedVaultId: vaultId,
    issuerSigningPublicKey: ancV1HexToBytes(currentIssuer.signingPublicKey),
  });
  if (
    !(await verifyUnseal({
      wrap: decodedCurrentWrap,
      encodedWrap: currentWrapBytes.slice(),
      issuer: structuredClone(currentIssuer),
    }))
  )
    fail("Consumed recovery wrap could not be authenticated and unsealed");

  const candidate = decodeCandidateEndpoint(
    authorization.candidateEndpointEnvelope,
    vaultId,
  );
  const candidateId = ancV1BytesToHex(candidate.endpointId);
  if (
    state.activeMembers.some((member) => member.endpointId === candidateId) ||
    state.removedEndpointIds.includes(candidateId)
  )
    fail("Recovery candidate cannot alias an active member or tombstone");
  if (
    !equalBytes(candidate.addedByEndpointId, authorization.consumedRecoveryId)
  )
    fail("Recovery candidate addedBy authority mismatch");
  const expectedTranscript = await hashAncV1RecoveryCandidateTranscript({
    vaultId,
    ceremonyId: authorization.ceremonyId,
    snapshotHash,
    consumedRecoveryId: authorization.consumedRecoveryId,
    candidateEndpointId: candidate.endpointId,
    candidateSigningPublicKey: candidate.signingPublicKey,
    candidateKeyAgreementPublicKey: candidate.keyAgreementPublicKey,
    targetEpoch: authorization.newEpoch,
  });
  if (
    !equalBytes(candidate.transcriptHash, expectedTranscript) ||
    !(await ancV1VerifyDetached(
      "endpoint",
      candidate.unsigned,
      candidate.signature,
      authorization.consumedRecoverySigningPublicKey,
    ))
  )
    fail("Recovery candidate envelope proof failed");

  const replacement = await verifyAncV1RecoveryReplacementConfirmation(
    authorization.replacementConfirmation,
    vaultId,
  );
  const replacementWrapHash = await hashAncV1RecoveryWrap(
    authorization.replacementRecoveryWrap,
    vaultId,
  );
  const expectedReplacementRecoveryId = await deriveAncV1RecoveryId({
    vaultId,
    recoveryGeneration: replacement.replacementRecoveryGeneration,
    recoverySigningPublicKey: replacement.replacementRecoverySigningPublicKey,
    recoveryKeyAgreementPublicKey:
      replacement.replacementRecoveryKeyAgreementPublicKey,
  });
  if (
    !equalBytes(replacement.ceremonyId, authorization.ceremonyId) ||
    replacement.priorRecoveryGeneration !== state.recoveryGeneration ||
    ancV1BytesToHex(replacement.priorRecoveryId) !== state.recoveryId ||
    replacement.replacementRecoveryGeneration !==
      state.recoveryGeneration + 1 ||
    replacement.replacementRecoveryGeneration !==
      authorization.consumedRecoveryGeneration + 1 ||
    equalBytes(
      replacement.replacementRecoveryId,
      authorization.consumedRecoveryId,
    ) ||
    !equalBytes(
      replacement.replacementRecoveryId,
      expectedReplacementRecoveryId,
    ) ||
    equalBytes(
      replacement.replacementRecoverySigningPublicKey,
      authorization.consumedRecoverySigningPublicKey,
    ) ||
    equalBytes(
      replacement.replacementRecoveryKeyAgreementPublicKey,
      authorization.consumedRecoveryKeyAgreementPublicKey,
    ) ||
    !equalBytes(replacement.replacementRecoveryWrapHash, replacementWrapHash) ||
    !equalBytes(replacement.candidateEndpointId, candidate.endpointId) ||
    replacement.newEpoch !== authorization.newEpoch ||
    replacement.createdAt > authorization.createdAt ||
    authorization.createdAt - replacement.createdAt > MAX_LIFETIME_SECONDS
  )
    fail("Replacement authority confirmation binding failed");
  const replacementWrap = await verifyAncV1RecoveryWrap(
    authorization.replacementRecoveryWrap,
    {
      expectedVaultId: vaultId,
      issuerSigningPublicKey: candidate.signingPublicKey,
    },
  );
  if (
    !equalBytes(replacementWrap.ceremonyId, authorization.ceremonyId) ||
    replacementWrap.recoveryGeneration !==
      replacement.replacementRecoveryGeneration ||
    !equalBytes(
      replacementWrap.recoveryId,
      replacement.replacementRecoveryId,
    ) ||
    !equalBytes(
      replacementWrap.recoveryKeyAgreementPublicKey,
      replacement.replacementRecoveryKeyAgreementPublicKey,
    ) ||
    replacementWrap.epoch !== authorization.newEpoch ||
    !equalBytes(replacementWrap.issuerEndpointId, candidate.endpointId) ||
    replacementWrap.activationControlSequence !== state.sequence + 1 ||
    !equalBytes(
      replacementWrap.activationPreviousHead,
      ancV1HexToBytes(state.headHash),
    ) ||
    !equalBytes(
      replacementWrap.activationPreviousMembershipHash,
      ancV1HexToBytes(state.membershipHash),
    )
  )
    fail("Replacement recovery wrap activation binding failed");

  const stateSignedAt = stateSignedAtSeconds;
  const entryCreatedAt = Date.parse(entry.createdAt) / 1000;
  if (
    !Number.isFinite(stateSignedAt) ||
    !Number.isFinite(entryCreatedAt) ||
    candidate.createdAt < stateSignedAt ||
    replacementWrap.createdAt < candidate.createdAt ||
    replacement.createdAt < replacementWrap.createdAt ||
    authorization.createdAt < replacement.createdAt ||
    entryCreatedAt < authorization.createdAt ||
    entryCreatedAt > authorization.expiresAt ||
    entryCreatedAt - candidate.createdAt > MAX_LIFETIME_SECONDS ||
    entryCreatedAt > now + 30
  )
    fail("Recovery ceremony timestamps are out of order");

  const { signature: entrySignature, ...unsignedEntry } = entry;
  if (
    !(await ancV1VerifyDetached(
      "log-entry",
      encodeUnsignedControlLogEntry(unsignedEntry),
      ancV1HexToBytes(entrySignature),
      candidate.signingPublicKey,
    ))
  )
    fail("Recovery membership commit signature is invalid");

  const authorizationHash = await ancV1Hash(
    "recovery-authorization",
    authorizationBytes,
  );
  const priorIds = state.activeMembers
    .map((member) => member.endpointId)
    .sort();
  if (
    entry.vaultId !== state.vaultId ||
    entry.sequence !== state.sequence + 1 ||
    entry.previousHash !== state.headHash ||
    entry.signerEndpointId !== candidateId ||
    entry.innerEnvelope.type !== "membership_commit" ||
    !equalBytes(
      encodeControlLogInnerEnvelope(entry.innerEnvelope),
      encodeControlLogInnerEnvelope(commit),
    ) ||
    commit.ceremonyKind !== "recovery" ||
    commit.ceremonyId !== ancV1BytesToHex(authorization.ceremonyId) ||
    commit.previousMembershipHash !== state.membershipHash ||
    commit.epoch !== authorization.newEpoch ||
    commit.activeMembers.length !== 1 ||
    !memberMatchesCandidate(
      commit.activeMembers[0]!,
      candidate,
      authorization.envelopeId,
    ) ||
    commit.removedEndpointIds.length !== priorIds.length ||
    commit.removedEndpointIds.some((id, index) => id !== priorIds[index]) ||
    !commit.rotationCompleted ||
    commit.outstandingJobsResolved !==
      state.activeMembers.some((member) => member.role === "broker") ||
    commit.recoverySnapshotHash !== ancV1BytesToHex(snapshotHash) ||
    commit.recoveryAuthorizationHash !== ancV1BytesToHex(authorizationHash) ||
    commit.recoveryGeneration !== replacement.replacementRecoveryGeneration ||
    commit.recoveryId !== ancV1BytesToHex(replacement.replacementRecoveryId) ||
    commit.recoverySigningPublicKey !==
      ancV1BytesToHex(replacement.replacementRecoverySigningPublicKey) ||
    commit.recoveryKeyAgreementPublicKey !==
      ancV1BytesToHex(replacement.replacementRecoveryKeyAgreementPublicKey) ||
    commit.recoveryWrapHash !== ancV1BytesToHex(replacementWrapHash)
  )
    fail("Recovery membership projection does not match the authorization");

  if (
    !(await isNonceAvailable({
      vaultId: state.vaultId,
      ceremonyId: ancV1BytesToHex(authorization.ceremonyId),
      confirmationEnvelopeId: ancV1BytesToHex(replacement.envelopeId),
      confirmationNonce: replacement.confirmationNonce.slice(),
      priorRecoveryGeneration: replacement.priorRecoveryGeneration,
      replacementRecoveryGeneration: replacement.replacementRecoveryGeneration,
    }))
  )
    fail("Replacement confirmation nonce was already consumed");

  return {
    expectedCurrent: {
      vaultId: state.vaultId,
      sequence: state.sequence,
      headHash: state.headHash,
      membershipHash: state.membershipHash,
      epoch: state.epoch,
      recoveryGeneration: state.recoveryGeneration,
      recoveryId: state.recoveryId,
      recoveryWrapHash: state.recoveryWrapHash,
    },
    next: {
      epoch: commit.epoch,
      recoveryGeneration: commit.recoveryGeneration,
      recoveryId: commit.recoveryId,
      recoverySigningPublicKey: commit.recoverySigningPublicKey,
      recoveryKeyAgreementPublicKey: commit.recoveryKeyAgreementPublicKey,
      recoveryWrapHash: commit.recoveryWrapHash,
      soleEndpointId: candidateId,
      soleEndpointSigningPublicKey: ancV1BytesToHex(candidate.signingPublicKey),
      soleEndpointKeyAgreementPublicKey: ancV1BytesToHex(
        candidate.keyAgreementPublicKey,
      ),
      removedEndpointIds: [...commit.removedEndpointIds],
    },
    consumedAuthority: {
      recoveryGeneration: state.recoveryGeneration,
      recoveryId: state.recoveryId,
    },
    authorizationHash: ancV1BytesToHex(authorizationHash),
    snapshotHash: ancV1BytesToHex(snapshotHash),
    confirmationNonce: ancV1BytesToHex(replacement.confirmationNonce),
    confirmationEnvelopeId: ancV1BytesToHex(replacement.envelopeId),
    ceremonyId: ancV1BytesToHex(authorization.ceremonyId),
  };
}

/**
 * Verifies the complete publicly checkable recovery transition. The signed
 * recovery authorization proves possession of the current recovery authority;
 * a trusted client must still use verifyAncV1RecoveryAuthorization to prove
 * that its mnemonic actually unseals the consumed wrap.
 */
export async function verifyAncV1RecoveryAuthorizationPublicEvidence(
  encodedAuthorization: Uint8Array,
  input: Omit<
    Parameters<typeof verifyAncV1RecoveryAuthorization>[1],
    "verifyConsumedWrapUnseals"
  >,
): Promise<AncV1VerifiedRecoveryProjection> {
  return verifyAncV1RecoveryAuthorization(encodedAuthorization, {
    ...input,
    verifyConsumedWrapUnseals: async () => true,
  });
}

export function createAncV1RecoveryAuthorizationVerifier(input: {
  encodedAuthorization: Uint8Array;
  currentRecoveryWrap: Uint8Array;
  currentSnapshot: Uint8Array;
  now: number;
  isConfirmationNonceAvailable: (
    input: AncV1RecoveryConfirmationNonceClaim,
  ) => Promise<boolean>;
  verifyConsumedWrapUnseals: (input: {
    wrap: AncV1RecoveryWrap;
    encodedWrap: Uint8Array;
    issuer: ControlLogMember;
  }) => Promise<boolean>;
}): AncV1PreparedRecoveryAuthorizationVerifier {
  exact(
    input,
    [
      "encodedAuthorization",
      "currentRecoveryWrap",
      "currentSnapshot",
      "now",
      "isConfirmationNonceAvailable",
      "verifyConsumedWrapUnseals",
    ],
    "Recovery verifier preparation input",
  );
  const authorization = input.encodedAuthorization.slice();
  const wrap = input.currentRecoveryWrap.slice();
  const snapshot = input.currentSnapshot.slice();
  const now = integer(input.now, 1, "now");
  const nonceAvailable = input.isConfirmationNonceAvailable;
  const unseal = input.verifyConsumedWrapUnseals;
  let consumed = false;
  let projected = false;
  let cached:
    | {
        recovery: AncV1VerifiedRecoveryProjection;
        expectedCurrentState: ControlLogState;
        nextState: ControlLogState;
        entryHash: string;
      }
    | undefined;
  const verifier = (async (callback: {
    commit: ControlMembershipCommit;
    entry: SignedControlLogEntry;
    current: ControlLogState;
  }) => {
    if (consumed) return false;
    consumed = true;
    try {
      exact(
        callback,
        ["commit", "entry", "current"],
        "Recovery control-log callback input",
      );
      const current = controlLogStateSchema.parse(callback.current);
      const commit = controlMembershipCommitSchema.parse(callback.commit);
      const entry = signedControlLogEntrySchema.parse(callback.entry);
      const recovery = await verifyAncV1RecoveryAuthorization(authorization, {
        currentRecoveryWrap: wrap,
        currentSnapshot: snapshot,
        verifiedControlState: current,
        commit,
        entry,
        now,
        isConfirmationNonceAvailable: nonceAvailable,
        verifyConsumedWrapUnseals: unseal,
      });
      const entryHash = ancV1BytesToHex(
        await ancV1Hash("log-entry", encodeSignedControlLogEntry(entry)),
      );
      const membershipHash = ancV1BytesToHex(
        await ancV1Hash("log-entry", encodeControlLogInnerEnvelope(commit)),
      );
      const removedEndpointIds = Array.from(
        new Set([...current.removedEndpointIds, ...commit.removedEndpointIds]),
      ).sort();
      const nextState = controlLogStateSchema.parse({
        vaultId: current.vaultId,
        sequence: entry.sequence,
        headHash: entryHash,
        membershipHash,
        signedAt: entry.createdAt,
        activeMembers: commit.activeMembers,
        removedEndpointIds,
        epoch: commit.epoch,
        recoveryGeneration: commit.recoveryGeneration,
        recoveryId: commit.recoveryId,
        recoverySigningPublicKey: commit.recoverySigningPublicKey,
        recoveryKeyAgreementPublicKey: commit.recoveryKeyAgreementPublicKey,
        recoveryWrapHash: commit.recoveryWrapHash,
        freshnessMode: "endpoint_witnessed",
      });
      cached = {
        recovery: copyAncV1RecoveryProjection(recovery),
        expectedCurrentState: current,
        nextState,
        entryHash,
      };
      return true;
    } catch {
      return false;
    }
  }) as AncV1PreparedRecoveryAuthorizationVerifier;
  verifier.projectNextState = (reduced) => {
    exact(
      reduced,
      ["state", "entryHash", "idempotent"],
      "Reduced recovery result",
    );
    if (projected || cached === undefined || reduced.idempotent) {
      fail(
        "Recovery projection requires one successful non-idempotent reducer",
      );
    }
    const state = controlLogStateSchema.parse(reduced.state);
    if (
      reduced.entryHash !== cached.entryHash ||
      JSON.stringify(state) !== JSON.stringify(cached.nextState)
    )
      fail("Reduced recovery state does not match the verified transition");
    projected = true;
    return {
      expectedCurrentState: structuredClone(cached.expectedCurrentState),
      nextState: structuredClone(cached.nextState),
      entryHash: cached.entryHash,
      recovery: copyAncV1RecoveryProjection(cached.recovery),
    };
  };
  return verifier;
}

/** Helper for native durable CAS: verify first, then atomically compare expectedCurrent and install next. */
export function copyAncV1RecoveryProjection(
  value: AncV1VerifiedRecoveryProjection,
): AncV1VerifiedRecoveryProjection {
  return {
    expectedCurrent: { ...value.expectedCurrent },
    next: {
      ...value.next,
      removedEndpointIds: [...value.next.removedEndpointIds],
    },
    consumedAuthority: { ...value.consumedAuthority },
    authorizationHash: value.authorizationHash,
    snapshotHash: value.snapshotHash,
    confirmationNonce: value.confirmationNonce,
    confirmationEnvelopeId: value.confirmationEnvelopeId,
    ceremonyId: value.ceremonyId,
  };
}

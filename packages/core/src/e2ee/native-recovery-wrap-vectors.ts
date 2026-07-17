import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  type ControlLogMember,
  type ControlLogState,
  type ControlMembershipCommit,
  type SignedControlLogEntry,
  createSignedControlLogEntry,
} from "./control-log.js";
import {
  ancV1BoxEncrypt,
  ancV1BoxKeypairFromSeed,
  ancV1Hash,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import {
  type AncV1RecoveryWrap,
  createAncV1RecoveryWrap,
  encodeAncV1RecoveryWrap,
  encodeAncV1UnsignedRecoveryWrap,
  hashAncV1RecoveryWrap,
} from "./recovery-ceremony-codecs.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SUITE_ID,
  e2eeDomainSeparationPrefix,
} from "./suite.js";

export const ANC_V1_NATIVE_RECOVERY_WRAP_CORPUS_SCHEMA =
  "anc/v1-native-recovery-wrap-vectors@1" as const;
export const ANC_V1_NATIVE_RECOVERY_WRAP_GENERATOR =
  "buildAncV1NativeRecoveryWrapVectors" as const;
export const ANC_V1_NATIVE_RECOVERY_WRAP_SOURCE_PATHS = [
  "packages/core/src/e2ee/native-recovery-wrap-vectors.ts",
  "packages/core/src/e2ee/recovery-ceremony-codecs.ts",
  "packages/core/src/e2ee/canonical.ts",
  "packages/core/src/e2ee/portable-crypto.ts",
  "packages/core/src/e2ee/suite.ts",
  "packages/core/src/e2ee/lifecycle-codecs.ts",
  "packages/core/src/e2ee/control-log.ts",
] as const;

export const ANC_V1_NATIVE_RECOVERY_WRAP_CATEGORIES = [
  "wire.invalid_canonical",
  "wire.missing_field",
  "wire.unknown_field",
  "wire.wrong_type",
  "wire.length",
  "wire.range",
  "limits.envelope",
  "crypto.signature",
  "crypto.hash",
  "binding.control",
  "binding.authority",
  "binding.issuer",
  "binding.activation",
  "time.rotation",
  "time.current",
  "unseal.authentication",
  "unseal.domain",
  "unseal.zeroization",
] as const;

type Category = (typeof ANC_V1_NATIVE_RECOVERY_WRAP_CATEGORIES)[number];
type Stage = "decode" | "verify" | "hash" | "rotation" | "current" | "unseal";

export interface AncV1NativeRecoveryWrapProvenance {
  protocolBaseCommit: string;
  sources: readonly {
    path: (typeof ANC_V1_NATIVE_RECOVERY_WRAP_SOURCE_PATHS)[number];
    sha256: string;
  }[];
}

export interface AncV1NativeRecoveryWrapCase {
  name: string;
  stage: Stage;
  expectedStatus: "accept" | "reject";
  expectedCategory: Category | null;
  encodedHex: string;
  expectedCoreErrorIncludes: string | null;
  expectedOutputZeroed: boolean;
  expectedCreatedAt: number | null;
  overrides: {
    expectedVaultIdHex?: string;
    issuerSigningPublicKeyHex?: string;
    issuerKeyAgreementPublicKeyHex?: string;
    recoveryKeyAgreementPrivateKeyLabel?: string;
    now?: number;
    state?: ControlLogState;
    commit?: ControlMembershipCommit;
    entry?: SignedControlLogEntry;
  };
}

export interface AncV1NativeRecoveryWrapCorpus {
  schema: typeof ANC_V1_NATIVE_RECOVERY_WRAP_CORPUS_SCHEMA;
  suite: typeof E2EE_SUITE_ID;
  encoding: "hex";
  generator: typeof ANC_V1_NATIVE_RECOVERY_WRAP_GENERATOR;
  protocolBaseCommit: string;
  sourceAnchors: AncV1NativeRecoveryWrapProvenance["sources"];
  domains: readonly {
    operation: "signature" | "artifact_hash" | "box_plaintext";
    tag: "recovery-wrap" | "eek-wrap";
    escaped: string;
    utf8Hex: string;
  }[];
  fieldKeys: Readonly<Record<string, number>>;
  categoryVocabulary: readonly Category[];
  syntheticDerivation: {
    warning: string;
    algorithm: "blake2b-256";
    domainEscaped: string;
    labels: {
      eek: string;
      issuerSigningSeed: string;
      issuerAgreementSeed: string;
      recoveryAgreementSeed: string;
      wrongSigningSeed: string;
      wrongAgreementSeed: string;
    };
    commitments: Record<string, string>;
  };
  exact: {
    unsignedHex: string;
    signedHex: string;
    signatureHex: string;
    artifactHashHex: string;
    boxPlaintextCommitmentHex: string;
    ciphertextHex: string;
    unsealedEekCommitmentHex: string;
    parsed: {
      vaultIdHex: string;
      envelopeIdHex: string;
      ceremonyIdHex: string;
      recoveryGeneration: number;
      recoveryIdHex: string;
      recoveryKeyAgreementPublicKeyHex: string;
      epoch: number;
      issuerEndpointIdHex: string;
      activationControlSequence: number;
      activationPreviousHeadHex: string;
      activationPreviousMembershipHashHex: string;
      nonceHex: string;
      createdAt: number;
    };
    issuerSigningPublicKeyHex: string;
    issuerAgreementPublicKeyHex: string;
    recoveryAgreementPublicKeyHex: string;
  };
  baseControl: {
    state: ControlLogState;
    commit: ControlMembershipCommit;
    entry: SignedControlLogEntry;
  };
  positiveCases: readonly AncV1NativeRecoveryWrapCase[];
  negativeCases: readonly AncV1NativeRecoveryWrapCase[];
}

const F = E2EE_ENVELOPE_FIELDS;
const WRAP_KEYS = [
  F.common.suite,
  F.common.vaultId,
  F.common.type,
  F.common.createdAt,
  F.common.envelopeId,
  F.recoveryWrap.ceremonyId,
  F.recoveryWrap.recoveryGeneration,
  F.recoveryWrap.recoveryId,
  F.recoveryWrap.recoveryKeyAgreementPublicKey,
  F.recoveryWrap.epoch,
  F.recoveryWrap.issuerEndpointId,
  F.recoveryWrap.activationControlSequence,
  F.recoveryWrap.activationPreviousHead,
  F.recoveryWrap.activationPreviousMembershipHash,
  F.recoveryWrap.nonce,
  F.recoveryWrap.ciphertext,
  F.recoveryWrap.signature,
] as const;
const p = (byte: number, length: number) => new Uint8Array(length).fill(byte);
const hex = (byte: number, length: number) =>
  byte.toString(16).padStart(2, "0").repeat(length);
const text = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: readonly Uint8Array[]) => {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};
const DERIVATION_LABELS = {
  eek: "synthetic-eek",
  issuerSigningSeed: "synthetic-issuer-signing-seed",
  issuerAgreementSeed: "synthetic-issuer-agreement-seed",
  recoveryAgreementSeed: "synthetic-recovery-agreement-seed",
  wrongSigningSeed: "synthetic-wrong-signing-seed",
  wrongAgreementSeed: "synthetic-wrong-agreement-seed",
} as const;

async function deriveSynthetic(label: string) {
  return ancV1Hash(
    "recovery-wrap",
    concat(
      text("native-recovery-wrap/test-derivation"),
      Uint8Array.of(0),
      text(label),
    ),
  );
}

async function syntheticCommitment(value: Uint8Array) {
  return ancV1Hash(
    "recovery-wrap",
    concat(
      text("native-recovery-wrap/test-commitment"),
      Uint8Array.of(0),
      value,
    ),
  );
}
function provenanceValid(value: AncV1NativeRecoveryWrapProvenance) {
  return (
    /^[0-9a-f]{40}$/.test(value.protocolBaseCommit) &&
    value.sources.length === ANC_V1_NATIVE_RECOVERY_WRAP_SOURCE_PATHS.length &&
    ANC_V1_NATIVE_RECOVERY_WRAP_SOURCE_PATHS.every(
      (path, index) =>
        value.sources[index]?.path === path &&
        /^[0-9a-f]{64}$/.test(value.sources[index]!.sha256),
    )
  );
}

function asMap(encoded: Uint8Array): Map<number, AncV1CanonicalValue> {
  const decoded = decodeAncV1Canonical(encoded);
  if (!(decoded instanceof Map)) throw new Error("Expected recovery-wrap map");
  return decoded as Map<number, AncV1CanonicalValue>;
}

async function resign(
  encoded: Uint8Array,
  signingPrivateKey: Uint8Array,
  mutate: (map: Map<number, AncV1CanonicalValue>) => void,
) {
  const map = asMap(encoded);
  mutate(map);
  map.delete(F.recoveryWrap.signature);
  const signature = await ancV1SignDetached(
    "recovery-wrap",
    encodeAncV1Canonical(map),
    signingPrivateKey,
  );
  map.set(F.recoveryWrap.signature, signature);
  return encodeAncV1Canonical(map);
}

function mutateCanonical(
  encoded: Uint8Array,
  mutate: (map: Map<number, AncV1CanonicalValue>) => void,
) {
  const map = asMap(encoded);
  mutate(map);
  return encodeAncV1Canonical(map);
}

function rawMap(entries: readonly [number, AncV1CanonicalValue][]) {
  if (entries.length > 23) throw new Error("fixture map is too large");
  const parts = entries.map(([key, value]) => {
    const one = encodeAncV1Canonical(new Map([[key, value]]));
    return one.slice(1);
  });
  return concat(Uint8Array.of(0xa0 + entries.length), ...parts);
}

function fieldName(key: number) {
  return (
    Object.entries({
      suite: F.common.suite,
      vaultId: F.common.vaultId,
      type: F.common.type,
      createdAt: F.common.createdAt,
      envelopeId: F.common.envelopeId,
      ceremonyId: F.recoveryWrap.ceremonyId,
      recoveryGeneration: F.recoveryWrap.recoveryGeneration,
      recoveryId: F.recoveryWrap.recoveryId,
      recoveryKeyAgreementPublicKey:
        F.recoveryWrap.recoveryKeyAgreementPublicKey,
      epoch: F.recoveryWrap.epoch,
      issuerEndpointId: F.recoveryWrap.issuerEndpointId,
      activationControlSequence: F.recoveryWrap.activationControlSequence,
      activationPreviousHead: F.recoveryWrap.activationPreviousHead,
      activationPreviousMembershipHash:
        F.recoveryWrap.activationPreviousMembershipHash,
      nonce: F.recoveryWrap.nonce,
      ciphertext: F.recoveryWrap.ciphertext,
      signature: F.recoveryWrap.signature,
    }).find(([, value]) => value === key)?.[0] ?? String(key)
  );
}

function makeCase(
  input: Omit<
    AncV1NativeRecoveryWrapCase,
    "overrides" | "expectedOutputZeroed" | "expectedCreatedAt"
  > & {
    overrides?: AncV1NativeRecoveryWrapCase["overrides"];
    expectedOutputZeroed?: boolean;
    expectedCreatedAt?: number | null;
  },
): AncV1NativeRecoveryWrapCase {
  return {
    ...input,
    overrides: input.overrides ?? {},
    expectedOutputZeroed: input.expectedOutputZeroed ?? false,
    expectedCreatedAt: input.expectedCreatedAt ?? null,
  };
}

/** Build synthetic, deterministic recovery-wrap vectors. Never use these keys outside tests. */
export async function buildAncV1NativeRecoveryWrapVectors(
  provenance: AncV1NativeRecoveryWrapProvenance,
): Promise<AncV1NativeRecoveryWrapCorpus> {
  if (!provenanceValid(provenance))
    throw new Error("Native recovery-wrap provenance is incomplete");

  const vaultId = p(0x01, 16);
  const envelopeId = p(0x02, 16);
  const ceremonyId = p(0x03, 16);
  const issuerId = p(0x04, 16);
  const recoveryId = p(0x05, 16);
  const previousHead = p(0x06, 32);
  const previousMembership = p(0x07, 32);
  const eek = await deriveSynthetic(DERIVATION_LABELS.eek);
  const nonce = p(0x09, 24);
  const issuerSigningSeed = await deriveSynthetic(
    DERIVATION_LABELS.issuerSigningSeed,
  );
  const issuerAgreementSeed = await deriveSynthetic(
    DERIVATION_LABELS.issuerAgreementSeed,
  );
  const recoveryAgreementSeed = await deriveSynthetic(
    DERIVATION_LABELS.recoveryAgreementSeed,
  );
  const wrongSigningSeed = await deriveSynthetic(
    DERIVATION_LABELS.wrongSigningSeed,
  );
  const wrongAgreementSeed = await deriveSynthetic(
    DERIVATION_LABELS.wrongAgreementSeed,
  );
  const issuerSigning = await ancV1SigningKeypairFromSeed(issuerSigningSeed);
  const issuerAgreement = await ancV1BoxKeypairFromSeed(issuerAgreementSeed);
  const recoveryAgreement = await ancV1BoxKeypairFromSeed(
    recoveryAgreementSeed,
  );
  const wrongSigning = await ancV1SigningKeypairFromSeed(wrongSigningSeed);
  const wrongAgreement = await ancV1BoxKeypairFromSeed(wrongAgreementSeed);
  const createdAt = 1_721_200_050;
  const baseWrap = await createAncV1RecoveryWrap(
    {
      suite: E2EE_SUITE_ID,
      vaultId,
      type: "recovery-wrap",
      createdAt,
      envelopeId,
      ceremonyId,
      recoveryGeneration: 1,
      recoveryId,
      recoveryKeyAgreementPublicKey: recoveryAgreement.publicKey,
      epoch: 3,
      issuerEndpointId: issuerId,
      activationControlSequence: 5,
      activationPreviousHead: previousHead,
      activationPreviousMembershipHash: previousMembership,
      nonce,
      eek,
    },
    {
      issuerKeyAgreementPrivateKey: issuerAgreement.privateKey,
      issuerSigningPrivateKey: issuerSigning.privateKey,
    },
  );
  const signed = encodeAncV1RecoveryWrap(baseWrap);
  const { signature, ...unsignedWrap } = baseWrap;
  const unsigned = encodeAncV1UnsignedRecoveryWrap(unsignedWrap);
  const wrapHash = await hashAncV1RecoveryWrap(signed, vaultId);
  const issuer: ControlLogMember = {
    endpointId: ancV1BytesToHex(issuerId),
    role: "endpoint",
    unattended: false,
    signingPublicKey: ancV1BytesToHex(issuerSigning.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(issuerAgreement.publicKey),
    enrollmentRef: hex(0x21, 16),
  };
  const broker: ControlLogMember = {
    ...issuer,
    endpointId: hex(0x22, 16),
    role: "broker",
    unattended: true,
  };
  const state: ControlLogState = {
    vaultId: ancV1BytesToHex(vaultId),
    sequence: 4,
    headHash: ancV1BytesToHex(previousHead),
    membershipHash: ancV1BytesToHex(previousMembership),
    signedAt: "2024-07-17T07:07:29.500Z",
    activeMembers: [issuer, broker].sort((a, b) =>
      a.endpointId.localeCompare(b.endpointId),
    ),
    removedEndpointIds: [],
    epoch: 2,
    recoveryGeneration: 1,
    recoveryId: ancV1BytesToHex(recoveryId),
    recoverySigningPublicKey: hex(0x31, 32),
    recoveryKeyAgreementPublicKey: ancV1BytesToHex(recoveryAgreement.publicKey),
    recoveryWrapHash: ancV1BytesToHex(wrapHash),
    freshnessMode: "endpoint_witnessed",
  };
  const commit: ControlMembershipCommit = {
    suite: E2EE_SUITE_ID,
    type: "membership_commit",
    vaultId: state.vaultId,
    ceremonyId: ancV1BytesToHex(ceremonyId),
    ceremonyKind: "remove_broker",
    epoch: 3,
    previousMembershipHash: state.membershipHash,
    activeMembers: [issuer],
    removedEndpointIds: [broker.endpointId],
    rotationCompleted: true,
    outstandingJobsResolved: true,
    recoverySnapshotHash: null,
    recoveryAuthorizationHash: null,
    recoveryGeneration: state.recoveryGeneration,
    recoveryId: state.recoveryId,
    recoverySigningPublicKey: state.recoverySigningPublicKey,
    recoveryKeyAgreementPublicKey: state.recoveryKeyAgreementPublicKey,
    recoveryWrapHash: ancV1BytesToHex(wrapHash),
  };
  const entry = await createSignedControlLogEntry({
    vaultId: state.vaultId,
    createdAt: "2024-07-17T07:07:40.000Z",
    envelopeId: hex(0x23, 16),
    sequence: 5,
    previousHash: state.headHash,
    innerEnvelope: commit,
    signerEndpointId: issuer.endpointId,
    signingPrivateKey: issuerSigning.privateKey,
  });

  const baseOverrides = {
    expectedVaultIdHex: state.vaultId,
    issuerSigningPublicKeyHex: issuer.signingPublicKey,
    issuerKeyAgreementPublicKeyHex: issuer.keyAgreementPublicKey,
    recoveryKeyAgreementPrivateKeyLabel:
      DERIVATION_LABELS.recoveryAgreementSeed,
  };
  const positiveCases: AncV1NativeRecoveryWrapCase[] = [
    makeCase({
      name: "exact_signature",
      stage: "verify",
      expectedStatus: "accept",
      expectedCategory: null,
      encodedHex: ancV1BytesToHex(signed),
      expectedCoreErrorIncludes: null,
      expectedCreatedAt: createdAt,
      overrides: baseOverrides,
    }),
    makeCase({
      name: "exact_eek_unseal",
      stage: "unseal",
      expectedStatus: "accept",
      expectedCategory: null,
      encodedHex: ancV1BytesToHex(signed),
      expectedCoreErrorIncludes: null,
      overrides: baseOverrides,
    }),
    makeCase({
      name: "ordinary_rotation_fractional_lower_boundary",
      stage: "rotation",
      expectedStatus: "accept",
      expectedCategory: null,
      encodedHex: ancV1BytesToHex(signed),
      expectedCoreErrorIncludes: null,
      expectedCreatedAt: createdAt,
      overrides: { state, commit, entry },
    }),
    makeCase({
      name: "ordinary_rotation_equal_lower_boundary",
      stage: "rotation",
      expectedStatus: "accept",
      expectedCategory: null,
      encodedHex: ancV1BytesToHex(signed),
      expectedCoreErrorIncludes: null,
      expectedCreatedAt: createdAt,
      overrides: {
        state: { ...state, signedAt: "2024-07-17T07:07:30.000Z" },
        commit,
        entry,
      },
    }),
    makeCase({
      name: "current_wrap_after_later_replay",
      stage: "current",
      expectedStatus: "accept",
      expectedCategory: null,
      encodedHex: ancV1BytesToHex(signed),
      expectedCoreErrorIncludes: null,
      overrides: {
        ...baseOverrides,
        now: createdAt + 10_000,
        state: {
          ...state,
          sequence: 99,
          epoch: 3,
          signedAt: "2024-07-17T10:00:00.000Z",
          headHash: hex(0x91, 32),
          membershipHash: hex(0x92, 32),
        },
      },
    }),
  ];
  const { ciphertext: _currentCiphertext, ...ancientBase } = unsignedWrap;
  const ancientWrap = await createAncV1RecoveryWrap(
    { ...ancientBase, createdAt: 1_700_000_000, eek },
    {
      issuerKeyAgreementPrivateKey: issuerAgreement.privateKey,
      issuerSigningPrivateKey: issuerSigning.privateKey,
    },
  );
  const ancientBytes = encodeAncV1RecoveryWrap(ancientWrap);
  positiveCases.push(
    makeCase({
      name: "ancient_authenticated_standing_wrap",
      stage: "current",
      expectedStatus: "accept",
      expectedCategory: null,
      encodedHex: ancV1BytesToHex(ancientBytes),
      expectedCoreErrorIncludes: null,
      overrides: {
        ...baseOverrides,
        now: createdAt + 10_000,
        state: {
          ...state,
          sequence: 99,
          epoch: 3,
          signedAt: "2024-07-17T10:00:00.000Z",
          recoveryWrapHash: ancV1BytesToHex(
            await hashAncV1RecoveryWrap(ancientBytes, vaultId),
          ),
        },
      },
    }),
  );

  const negativeCases: AncV1NativeRecoveryWrapCase[] = [];
  const reject = (
    name: string,
    stage: Stage,
    category: Category,
    encoded: Uint8Array,
    expectedCoreErrorIncludes: string | null,
    overrides: AncV1NativeRecoveryWrapCase["overrides"] = {},
    expectedOutputZeroed = false,
  ) =>
    negativeCases.push(
      makeCase({
        name,
        stage,
        expectedStatus: "reject",
        expectedCategory: category,
        encodedHex: ancV1BytesToHex(encoded),
        expectedCoreErrorIncludes,
        overrides,
        expectedOutputZeroed,
      }),
    );

  reject(
    "unknown_field_999",
    "decode",
    "wire.unknown_field",
    mutateCanonical(signed, (map) => map.set(999, true)),
    "unknown",
  );
  for (const key of WRAP_KEYS) {
    reject(
      `missing_${fieldName(key)}`,
      "decode",
      "wire.missing_field",
      mutateCanonical(signed, (map) => map.delete(key)),
      null,
    );
    reject(
      `wrong_type_${fieldName(key)}`,
      "decode",
      "wire.wrong_type",
      mutateCanonical(signed, (map) => map.set(key, true)),
      null,
    );
  }
  for (const [key, length] of [
    [F.common.vaultId, 16],
    [F.common.envelopeId, 16],
    [F.recoveryWrap.ceremonyId, 16],
    [F.recoveryWrap.recoveryId, 16],
    [F.recoveryWrap.recoveryKeyAgreementPublicKey, 32],
    [F.recoveryWrap.issuerEndpointId, 16],
    [F.recoveryWrap.activationPreviousHead, 32],
    [F.recoveryWrap.activationPreviousMembershipHash, 32],
    [F.recoveryWrap.nonce, 24],
    [F.recoveryWrap.ciphertext, 64],
    [F.recoveryWrap.signature, 64],
  ] as const) {
    reject(
      `wrong_length_${fieldName(key)}`,
      "decode",
      "wire.length",
      mutateCanonical(signed, (map) => map.set(key, p(0xaa, length - 1))),
      "bytes",
    );
  }
  for (const key of [
    F.common.createdAt,
    F.recoveryWrap.recoveryGeneration,
    F.recoveryWrap.epoch,
  ]) {
    reject(
      `range_zero_${fieldName(key)}`,
      "decode",
      "wire.range",
      mutateCanonical(signed, (map) => map.set(key, 0)),
      "integer",
    );
  }
  reject(
    "range_negative_activation_sequence",
    "decode",
    "wire.range",
    mutateCanonical(signed, (map) =>
      map.set(F.recoveryWrap.activationControlSequence, -1),
    ),
    "integer",
  );
  const entries = [...asMap(signed).entries()];
  reject(
    "noncanonical_reversed_keys",
    "decode",
    "wire.invalid_canonical",
    rawMap([...entries].reverse()),
    null,
  );
  const duplicate = rawMap([...entries, entries[0]!]);
  reject("duplicate_key", "decode", "wire.invalid_canonical", duplicate, null);
  reject(
    "indefinite_length_map",
    "decode",
    "wire.invalid_canonical",
    concat(Uint8Array.of(0xbf), rawMap(entries).slice(1), Uint8Array.of(0xff)),
    null,
  );
  reject(
    "non_shortest_key",
    "decode",
    "wire.invalid_canonical",
    concat(Uint8Array.of(0xb1, 0x18, 0x01), rawMap(entries).slice(2)),
    null,
  );
  reject(
    "envelope_size_limit",
    "decode",
    "limits.envelope",
    mutateCanonical(signed, (map) =>
      map.set(F.recoveryWrap.ciphertext, p(0xee, 1024 * 1024 + 1)),
    ),
    null,
  );
  reject(
    "wrong_suite",
    "decode",
    "wire.wrong_type",
    mutateCanonical(signed, (map) => map.set(F.common.suite, "anc/v2")),
    "suite",
  );
  reject(
    "wrong_artifact_type",
    "decode",
    "wire.wrong_type",
    mutateCanonical(signed, (map) =>
      map.set(F.common.type, "recovery-authorization"),
    ),
    "type",
  );
  const corruptedSignature = signed.slice();
  corruptedSignature[corruptedSignature.length - 1] ^= 1;
  reject(
    "corrupt_signature",
    "verify",
    "crypto.signature",
    corruptedSignature,
    "signature",
    baseOverrides,
  );
  reject(
    "wrong_issuer_signing_key",
    "verify",
    "crypto.signature",
    signed,
    "signature",
    {
      ...baseOverrides,
      issuerSigningPublicKeyHex: ancV1BytesToHex(wrongSigning.publicKey),
    },
  );
  const wrongVault = p(0x81, 16);
  reject("wrong_expected_vault", "verify", "binding.control", signed, "vault", {
    ...baseOverrides,
    expectedVaultIdHex: ancV1BytesToHex(wrongVault),
  });
  for (const [name, key] of [
    ["nonce", F.recoveryWrap.nonce],
    ["ciphertext", F.recoveryWrap.ciphertext],
  ] as const) {
    const mutated = mutateCanonical(signed, (map) => {
      const value = map.get(key) as Uint8Array;
      const copy = value.slice();
      copy[0] ^= 1;
      map.set(key, copy);
    });
    reject(
      `hash_substitution_${name}`,
      "rotation",
      "crypto.hash",
      mutated,
      "hash",
      { state, commit, entry },
    );
  }
  const rotationMutation = async (
    name: string,
    category: Category,
    mutateWrap: (map: Map<number, AncV1CanonicalValue>) => void,
    error: string,
  ) => {
    const encoded = await resign(signed, issuerSigning.privateKey, mutateWrap);
    const boundCommit = {
      ...commit,
      recoveryWrapHash: ancV1BytesToHex(
        await hashAncV1RecoveryWrap(encoded, vaultId),
      ),
    };
    const boundEntry = { ...entry, innerEnvelope: boundCommit };
    reject(name, "rotation", category, encoded, error, {
      state,
      commit: boundCommit,
      entry: boundEntry,
    });
  };
  await rotationMutation(
    "wrong_ceremony_binding",
    "binding.control",
    (map) => map.set(F.recoveryWrap.ceremonyId, p(0x82, 16)),
    "authority",
  );
  await rotationMutation(
    "wrong_recovery_generation",
    "binding.authority",
    (map) => map.set(F.recoveryWrap.recoveryGeneration, 2),
    "authority",
  );
  await rotationMutation(
    "wrong_recovery_id",
    "binding.authority",
    (map) => map.set(F.recoveryWrap.recoveryId, p(0x83, 16)),
    "authority",
  );
  await rotationMutation(
    "wrong_recipient_agreement_key",
    "binding.authority",
    (map) => map.set(F.recoveryWrap.recoveryKeyAgreementPublicKey, p(0x84, 32)),
    "authority",
  );
  await rotationMutation(
    "wrong_epoch",
    "binding.activation",
    (map) => map.set(F.recoveryWrap.epoch, 4),
    "authority",
  );
  await rotationMutation(
    "wrong_activation_sequence",
    "binding.activation",
    (map) => map.set(F.recoveryWrap.activationControlSequence, 6),
    "authority",
  );
  await rotationMutation(
    "wrong_activation_previous_head",
    "binding.activation",
    (map) => map.set(F.recoveryWrap.activationPreviousHead, p(0x85, 32)),
    "authority",
  );
  await rotationMutation(
    "wrong_activation_previous_membership",
    "binding.activation",
    (map) =>
      map.set(F.recoveryWrap.activationPreviousMembershipHash, p(0x86, 32)),
    "authority",
  );
  await rotationMutation(
    "issuer_not_current",
    "binding.issuer",
    (map) => map.set(F.recoveryWrap.issuerEndpointId, p(0x87, 16)),
    "authority",
  );
  const brokerState = {
    ...state,
    activeMembers: [
      {
        ...issuer,
        role: "broker" as const,
        unattended: true,
      },
    ],
  };
  reject("broker_issuer", "rotation", "binding.issuer", signed, "authority", {
    state: brokerState,
    commit,
    entry,
  });
  reject(
    "issuer_differs_from_entry_signer",
    "rotation",
    "binding.issuer",
    signed,
    "authority",
    { state, commit, entry: { ...entry, signerEndpointId: broker.endpointId } },
  );
  reject(
    "recovery_ceremony_on_ordinary_path",
    "rotation",
    "binding.control",
    signed,
    "ordinary",
    {
      state,
      commit: {
        ...commit,
        ceremonyKind: "recovery",
        recoverySnapshotHash: hex(0x93, 32),
        recoveryAuthorizationHash: hex(0x94, 32),
      },
      entry: {
        ...entry,
        innerEnvelope: {
          ...commit,
          ceremonyKind: "recovery",
          recoverySnapshotHash: hex(0x93, 32),
          recoveryAuthorizationHash: hex(0x94, 32),
        },
      },
    },
  );
  reject(
    "entry_vault_mismatch",
    "rotation",
    "binding.control",
    signed,
    "ordinary",
    { state, commit, entry: { ...entry, vaultId: hex(0x91, 16) } },
  );
  reject(
    "commit_vault_mismatch",
    "rotation",
    "binding.control",
    signed,
    "ordinary",
    { state, commit: { ...commit, vaultId: hex(0x91, 16) }, entry },
  );
  reject(
    "non_exact_inner_commit",
    "rotation",
    "binding.control",
    signed,
    "ordinary",
    {
      state,
      commit,
      entry: { ...entry, innerEnvelope: { ...commit, epoch: 4 } },
    },
  );
  reject(
    "control_sequence_gap",
    "rotation",
    "binding.control",
    signed,
    "ordinary",
    { state, commit, entry: { ...entry, sequence: 6 } },
  );
  reject(
    "control_head_fork",
    "rotation",
    "binding.control",
    signed,
    "ordinary",
    { state, commit, entry: { ...entry, previousHash: hex(0x92, 32) } },
  );
  const beforeWrap = await resign(signed, issuerSigning.privateKey, (map) =>
    map.set(F.common.createdAt, 1_721_200_049),
  );
  const beforeCommit = {
    ...commit,
    recoveryWrapHash: ancV1BytesToHex(
      await hashAncV1RecoveryWrap(beforeWrap, vaultId),
    ),
  };
  reject(
    "rotation_before_fractional_current_state",
    "rotation",
    "time.rotation",
    beforeWrap,
    "timestamp",
    {
      state,
      commit: beforeCommit,
      entry: { ...entry, innerEnvelope: beforeCommit },
    },
  );
  const afterWrap = await resign(signed, issuerSigning.privateKey, (map) =>
    map.set(F.common.createdAt, 1_721_200_061),
  );
  const afterCommit = {
    ...commit,
    recoveryWrapHash: ancV1BytesToHex(
      await hashAncV1RecoveryWrap(afterWrap, vaultId),
    ),
  };
  reject(
    "rotation_after_entry",
    "rotation",
    "time.rotation",
    afterWrap,
    "timestamp",
    {
      state,
      commit: afterCommit,
      entry: { ...entry, innerEnvelope: afterCommit },
    },
  );
  reject(
    "rotation_invalid_current_timestamp",
    "rotation",
    "time.rotation",
    signed,
    "datetime",
    { state: { ...state, signedAt: "not-a-time" }, commit, entry },
  );
  reject(
    "rotation_invalid_entry_timestamp",
    "rotation",
    "time.rotation",
    signed,
    "datetime",
    { state, commit, entry: { ...entry, createdAt: "not-a-time" } },
  );
  reject(
    "current_wrap_future_created_at",
    "current",
    "time.current",
    signed,
    null,
    {
      ...baseOverrides,
      now: createdAt - 1,
      state: {
        ...state,
        sequence: 5,
        epoch: 3,
        signedAt: "2024-07-17T10:00:00.000Z",
      },
    },
  );
  reject(
    "current_state_hash_mismatch",
    "current",
    "crypto.hash",
    signed,
    null,
    {
      ...baseOverrides,
      now: createdAt + 1,
      state: {
        ...state,
        epoch: 3,
        signedAt: "2024-07-17T10:00:00.000Z",
        recoveryWrapHash: hex(0xaa, 32),
      },
    },
  );
  reject(
    "current_authority_mismatch",
    "current",
    "binding.authority",
    signed,
    null,
    {
      ...baseOverrides,
      now: createdAt + 1,
      state: {
        ...state,
        epoch: 3,
        signedAt: "2024-07-17T10:00:00.000Z",
        recoveryId: hex(0xab, 16),
      },
    },
  );
  reject(
    "current_epoch_mismatch",
    "current",
    "binding.authority",
    signed,
    null,
    {
      ...baseOverrides,
      now: createdAt + 1,
      state: { ...state, signedAt: "2024-07-17T10:00:00.000Z" },
    },
  );
  reject(
    "current_future_activation_sequence",
    "current",
    "binding.activation",
    signed,
    null,
    {
      ...baseOverrides,
      now: createdAt + 1,
      state: {
        ...state,
        epoch: 3,
        sequence: 4,
        signedAt: "2024-07-17T10:00:00.000Z",
      },
    },
  );
  reject(
    "wrong_recovery_private_key",
    "unseal",
    "unseal.authentication",
    signed,
    null,
    {
      ...baseOverrides,
      recoveryKeyAgreementPrivateKeyLabel: DERIVATION_LABELS.wrongAgreementSeed,
    },
    true,
  );
  reject(
    "wrong_issuer_agreement_key",
    "unseal",
    "unseal.authentication",
    signed,
    null,
    {
      ...baseOverrides,
      issuerKeyAgreementPublicKeyHex: ancV1BytesToHex(wrongAgreement.publicKey),
    },
    true,
  );
  const corruptCipher = await resign(
    signed,
    issuerSigning.privateKey,
    (map) => {
      const value = (map.get(F.recoveryWrap.ciphertext) as Uint8Array).slice();
      value[0] ^= 1;
      map.set(F.recoveryWrap.ciphertext, value);
    },
  );
  reject(
    "corrupted_authenticated_ciphertext",
    "unseal",
    "unseal.authentication",
    corruptCipher,
    null,
    baseOverrides,
    true,
  );
  const wrongDomainCipher = await ancV1BoxEncrypt(
    "dek-wrap",
    eek,
    nonce,
    recoveryAgreement.publicKey,
    issuerAgreement.privateKey,
  );
  const wrongDomainWrap: AncV1RecoveryWrap = {
    ...baseWrap,
    ciphertext: wrongDomainCipher,
    signature: new Uint8Array(64),
  };
  const wrongDomainUnsigned = {
    ...wrongDomainWrap,
    signature: undefined,
  } as unknown as Omit<AncV1RecoveryWrap, "signature">;
  delete (wrongDomainUnsigned as Partial<AncV1RecoveryWrap>).signature;
  wrongDomainWrap.signature = await ancV1SignDetached(
    "recovery-wrap",
    encodeAncV1UnsignedRecoveryWrap(wrongDomainUnsigned),
    issuerSigning.privateKey,
  );
  reject(
    "authenticated_box_wrong_plaintext_domain",
    "unseal",
    "unseal.domain",
    encodeAncV1RecoveryWrap(wrongDomainWrap),
    null,
    baseOverrides,
    true,
  );
  reject(
    "failure_output_zeroization_contract",
    "unseal",
    "unseal.authentication",
    corruptCipher,
    null,
    baseOverrides,
    true,
  );

  const corpus: AncV1NativeRecoveryWrapCorpus = {
    schema: ANC_V1_NATIVE_RECOVERY_WRAP_CORPUS_SCHEMA,
    suite: E2EE_SUITE_ID,
    encoding: "hex",
    generator: ANC_V1_NATIVE_RECOVERY_WRAP_GENERATOR,
    protocolBaseCommit: provenance.protocolBaseCommit,
    sourceAnchors: provenance.sources,
    domains: [
      {
        operation: "signature",
        tag: "recovery-wrap",
        escaped: "anc/v1/recovery-wrap\\u0000",
        utf8Hex: ancV1BytesToHex(e2eeDomainSeparationPrefix("recovery-wrap")),
      },
      {
        operation: "artifact_hash",
        tag: "recovery-wrap",
        escaped: "anc/v1/recovery-wrap\\u0000",
        utf8Hex: ancV1BytesToHex(e2eeDomainSeparationPrefix("recovery-wrap")),
      },
      {
        operation: "box_plaintext",
        tag: "eek-wrap",
        escaped: "anc/v1/eek-wrap\\u0000",
        utf8Hex: ancV1BytesToHex(e2eeDomainSeparationPrefix("eek-wrap")),
      },
    ],
    fieldKeys: {
      suite: 1,
      vaultId: 2,
      type: 3,
      createdAt: 4,
      envelopeId: 5,
      ceremonyId: 400,
      recoveryGeneration: 401,
      recoveryId: 402,
      recoveryKeyAgreementPublicKey: 403,
      epoch: 404,
      issuerEndpointId: 405,
      activationControlSequence: 406,
      activationPreviousHead: 407,
      activationPreviousMembershipHash: 408,
      nonce: 409,
      ciphertext: 410,
      signature: 411,
    },
    categoryVocabulary: ANC_V1_NATIVE_RECOVERY_WRAP_CATEGORIES,
    syntheticDerivation: {
      warning:
        "Synthetic derivation labels and commitments only. Secret test bytes are derived in memory, verified, and zeroized by each runner.",
      algorithm: "blake2b-256",
      domainEscaped:
        "anc/v1/recovery-wrap\\u0000native-recovery-wrap/test-derivation\\u0000",
      labels: DERIVATION_LABELS,
      commitments: {
        eek: ancV1BytesToHex(await syntheticCommitment(eek)),
        issuerSigningSeed: ancV1BytesToHex(
          await syntheticCommitment(issuerSigningSeed),
        ),
        issuerAgreementSeed: ancV1BytesToHex(
          await syntheticCommitment(issuerAgreementSeed),
        ),
        recoveryAgreementSeed: ancV1BytesToHex(
          await syntheticCommitment(recoveryAgreementSeed),
        ),
        wrongSigningSeed: ancV1BytesToHex(
          await syntheticCommitment(wrongSigningSeed),
        ),
        wrongAgreementSeed: ancV1BytesToHex(
          await syntheticCommitment(wrongAgreementSeed),
        ),
      },
    },
    exact: {
      unsignedHex: ancV1BytesToHex(unsigned),
      signedHex: ancV1BytesToHex(signed),
      signatureHex: ancV1BytesToHex(signature),
      artifactHashHex: ancV1BytesToHex(wrapHash),
      boxPlaintextCommitmentHex: ancV1BytesToHex(
        await syntheticCommitment(
          concat(e2eeDomainSeparationPrefix("eek-wrap"), eek),
        ),
      ),
      ciphertextHex: ancV1BytesToHex(baseWrap.ciphertext),
      unsealedEekCommitmentHex: ancV1BytesToHex(await syntheticCommitment(eek)),
      parsed: {
        vaultIdHex: ancV1BytesToHex(vaultId),
        envelopeIdHex: ancV1BytesToHex(envelopeId),
        ceremonyIdHex: ancV1BytesToHex(ceremonyId),
        recoveryGeneration: 1,
        recoveryIdHex: ancV1BytesToHex(recoveryId),
        recoveryKeyAgreementPublicKeyHex: ancV1BytesToHex(
          recoveryAgreement.publicKey,
        ),
        epoch: 3,
        issuerEndpointIdHex: ancV1BytesToHex(issuerId),
        activationControlSequence: 5,
        activationPreviousHeadHex: ancV1BytesToHex(previousHead),
        activationPreviousMembershipHashHex:
          ancV1BytesToHex(previousMembership),
        nonceHex: ancV1BytesToHex(nonce),
        createdAt,
      },
      issuerSigningPublicKeyHex: ancV1BytesToHex(issuerSigning.publicKey),
      issuerAgreementPublicKeyHex: ancV1BytesToHex(issuerAgreement.publicKey),
      recoveryAgreementPublicKeyHex: ancV1BytesToHex(
        recoveryAgreement.publicKey,
      ),
    },
    baseControl: { state, commit, entry },
    positiveCases,
    negativeCases,
  };
  for (const secret of [
    eek,
    issuerSigningSeed,
    issuerAgreementSeed,
    recoveryAgreementSeed,
    wrongSigningSeed,
    wrongAgreementSeed,
    issuerSigning.privateKey,
    issuerAgreement.privateKey,
    recoveryAgreement.privateKey,
    wrongSigning.privateKey,
    wrongAgreement.privateKey,
  ])
    secret.fill(0);
  return corpus;
}

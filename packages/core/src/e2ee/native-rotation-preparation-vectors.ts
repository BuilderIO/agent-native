import sodium from "libsodium-wrappers-sumo";

import { ancV1BytesToHex } from "./canonical.js";
import {
  type ControlLogMember,
  type ControlMembershipCommit,
  createSignedControlLogEntry,
  encodeControlLogInnerEnvelope,
  encodeSignedControlLogEntry,
} from "./control-log.js";
import {
  ancV1BoxKeypairFromSeed,
  ancV1Hash,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import {
  createAncV1RecoveryWrap,
  encodeAncV1RecoveryWrap,
  hashAncV1RecoveryWrap,
} from "./recovery-ceremony-codecs.js";

export const ANC_V1_NATIVE_ROTATION_PREPARATION_CORPUS_SCHEMA =
  "anc/v1-native-rotation-preparation-vectors@2" as const;
export const ANC_V1_NATIVE_ROTATION_PREPARATION_GENERATOR =
  "buildAncV1NativeRotationPreparationVectors" as const;
export const ANC_V1_NATIVE_ROTATION_PREPARATION_SOURCE_PATHS = [
  "packages/core/scripts/materialize-native-rotation-preparation-vectors.ts",
  "packages/core/src/e2ee/native-rotation-preparation-vectors.ts",
  "packages/core/src/e2ee/control-log.ts",
  "packages/core/src/e2ee/recovery-ceremony-codecs.ts",
  "packages/core/src/e2ee/canonical.ts",
  "packages/core/src/e2ee/portable-crypto.ts",
  "packages/core/src/e2ee/suite.ts",
] as const;

export const ANC_V1_NATIVE_ROTATION_PREPARATION_CATEGORIES = [
  "record.wire.magic",
  "record.wire.version",
  "record.wire.length",
  "record.wire.phase",
  "record.wire.flags",
  "record.wire.role",
  "record.wire.unattended_role",
  "record.wire.zero_padding",
  "record.range.generation",
  "record.range.sequence",
  "record.range.epoch",
  "record.binding.pending_epoch",
  "record.phase.edge_fields",
  "record.phase.artifact_fields",
  "record.phase.expected_sequence",
  "record.phase.previous_head",
  "record.phase.transcript",
  "record.phase.artifact_length",
  "record.phase.spool_digest",
  "record.phase.pending_key",
  "record.phase.cleaned",
  "record.transition.generation",
  "record.crypto.checksum",
  "record.wire.truncation",
  "record.wire.extra_bytes",
  "record.binding.substitution",
  "spool.wire.magic",
  "spool.wire.version",
  "spool.wire.flags",
  "spool.wire.reserved",
  "spool.range.artifact_length",
  "spool.binding.vault",
  "spool.binding.ceremony",
  "spool.binding.signed_hash",
  "spool.binding.recovery_wrap_hash",
  "spool.crypto.checksum",
  "spool.wire.truncation",
  "spool.wire.extra_bytes",
  "spool.binding.substitution",
  "spool.encryption.aead",
  "spool.encryption.checksum",
  "spool.encryption.magic",
  "spool.encryption.version",
  "spool.encryption.flags",
  "spool.encryption.reserved",
  "spool.encryption.length",
  "spool.encryption.bounds",
  "binding.record_spool_length",
  "binding.record_spool_digest",
] as const;

export type AncV1NativeRotationPreparationCategory =
  (typeof ANC_V1_NATIVE_ROTATION_PREPARATION_CATEGORIES)[number];

export interface AncV1NativeRotationPreparationProvenance {
  protocolBaseCommit: string;
  sources: readonly {
    path: (typeof ANC_V1_NATIVE_ROTATION_PREPARATION_SOURCE_PATHS)[number];
    sha256: string;
  }[];
}

type Mutation =
  | { op: "set_u8"; offset: number; value: number }
  | { op: "set_u16"; offset: number; value: number }
  | { op: "set_u64"; offset: number; value: number }
  | { op: "flip"; offset: number }
  | { op: "zero"; offset: number; length: number }
  | { op: "truncate"; bytes: number }
  | { op: "append"; hex: string }
  | { op: "substitute"; target: "record" | "spool" };

type PositiveShape = {
  name: string;
  role: 1 | 2;
  unattended: 0 | 1;
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  flags: 0 | 3;
};

export interface AncV1NativeRotationPreparationNegativeCase {
  name: string;
  target: "record" | "spool" | "binding";
  category: AncV1NativeRotationPreparationCategory;
  mutation: Mutation;
}

const RECORD_LAYOUT = {
  bytes: 512,
  magicHex: "414e5652",
  version: 1,
  checksumOffset: 480,
  pendingKeyOffset: 288,
  pendingKeyLength: 32,
  phases: {
    prepared: 1,
    rewrapped: 2,
    acknowledged: 3,
    awaitingControlCommit: 4,
    consumed: 5,
    cleaned: 6,
  },
  checksumDomainEscaped:
    "agent-native/private-vault/rotation-preparation/checksum/anc-v1\\0",
} as const;
const SPOOL_LAYOUT = {
  magicHex: "414e56524f543031",
  version: 1,
  flagsOffset: 10,
  reservedOffset: 11,
  headerBytes: 124,
  checksumBytes: 32,
  signedEntryMaxBytes: 65_536,
  recoveryWrapMaxBytes: 1_048_576,
  checksumDomainEscaped:
    "agent-native/private-vault/rotation-preparation-artifacts/anc-v1\\0",
  encryptedAtRest: {
    magicHex: "414e56524f544531",
    headerBytes: 108,
    tagBytes: 16,
    checksumBytes: 32,
    nonceBytes: 24,
    kdfDomainEscaped:
      "agent-native/private-vault/rotation-preparation-spool-key/anc-v1\\0",
    checksumDomainEscaped:
      "agent-native/private-vault/rotation-preparation-spool-checksum/anc-v1\\0",
    digestDomainEscaped:
      "agent-native/private-vault/rotation-preparation-spool-frame/anc-v1\\0",
  },
} as const;
const MATERIAL_STREAM_LAYOUT = {
  magicHex: "414e56524d533032",
  version: 2,
  headerBytes: 152,
  checksumBytes: 32,
  alternateOuterMaxBytes: 1_114_424,
  maxBytes: 2_228_776,
  checksumDomainEscaped:
    "agent-native/private-vault/rotation-preparation-material-stream/anc-v1\\0",
} as const;

const DERIVATION = {
  warning:
    "Synthetic labels and BLAKE2b-256 commitments only. Secret-bearing material is derived only at test runtime, zeroized after use, and never committed or packaged; native parity may bridge it through the guarded ephemeral materializer.",
  algorithm: "blake2b-256",
  domainEscaped:
    "agent-native/private-vault/rotation-preparation/test-derivation/anc-v1\\0",
  labels: {
    pendingEpochKey: "pending-epoch-key",
    signedEntry: "signed-control-log-entry",
    recoveryWrap: "recovery-wrap-artifact",
    spoolNonce: "encrypted-spool-nonce",
    alternateSpoolNonce: "alternate-encrypted-spool-nonce",
    issuerSigningSeed: "issuer-signing-seed",
    issuerAgreementSeed: "issuer-agreement-seed",
    recoveryAgreementSeed: "recovery-agreement-seed",
    brokerSigningSeed: "broker-signing-seed",
    brokerAgreementSeed: "broker-agreement-seed",
  },
} as const;

const ID = {
  vault: new Uint8Array(16).fill(0x11),
  endpoint: new Uint8Array(16).fill(0x22),
  ceremony: new Uint8Array(16).fill(0x33),
  enrollment: new Uint8Array(16).fill(0x44),
  recovery: new Uint8Array(16).fill(0x45),
  envelope: new Uint8Array(16).fill(0x46),
  removedEndpoint: new Uint8Array(16).fill(0x47),
  broker: new Uint8Array(16).fill(0x49),
  brokerEnrollment: new Uint8Array(16).fill(0x4a),
} as const;
const ALTERNATE_ID = {
  ...ID,
  vault: new Uint8Array(16).fill(0x81),
  ceremony: new Uint8Array(16).fill(0x83),
} as const;
const BASE = {
  custodyGeneration: 11,
  sequence: 19,
  head: new Uint8Array(32).fill(0x55),
  membership: new Uint8Array(32).fill(0x66),
  epoch: 4,
  recoveryGeneration: 2,
  recoverySigningPublicKey: new Uint8Array(32).fill(0x67),
} as const;

const text = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: readonly Uint8Array[]) => {
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};
const domain = (escaped: string) => text(escaped.replace("\\0", "\0"));

async function derive(label: string, length: number) {
  await sodium.ready;
  const output = new Uint8Array(length);
  let offset = 0;
  let counter = 0;
  while (offset < length) {
    const input = concat(
      domain(DERIVATION.domainEscaped),
      text(label),
      Uint8Array.of(counter++),
    );
    const block = sodium.crypto_generichash(32, input, null);
    output.set(
      block.subarray(0, Math.min(block.length, length - offset)),
      offset,
    );
    offset += block.length;
    input.fill(0);
    block.fill(0);
  }
  return output;
}

async function commitment(bytes: Uint8Array) {
  await sodium.ready;
  return sodium.crypto_generichash(32, bytes, null);
}

async function domainHash(escapedDomain: string, bytes: Uint8Array) {
  const message = concat(domain(escapedDomain), bytes);
  const digest = await commitment(message);
  message.fill(0);
  return digest;
}

const setU16 = (view: DataView, offset: number, value: number) =>
  view.setUint16(offset, value, true);
const setU64 = (view: DataView, offset: number, value: number) =>
  view.setBigUint64(offset, BigInt(value), true);

async function encodeSpool(
  artifacts: Awaited<ReturnType<typeof canonicalArtifacts>>,
) {
  const signedHash = await commitment(artifacts.signedEntry);
  const wrapHash = await commitment(artifacts.recoveryWrap);
  const bytes = new Uint8Array(
    SPOOL_LAYOUT.headerBytes +
      artifacts.signedEntry.length +
      artifacts.recoveryWrap.length +
      SPOOL_LAYOUT.checksumBytes,
  );
  const view = new DataView(bytes.buffer);
  bytes.set(text("ANVROT01"), 0);
  setU16(view, 8, SPOOL_LAYOUT.version);
  setU64(view, 12, artifacts.signedEntry.length);
  setU64(view, 20, artifacts.recoveryWrap.length);
  bytes.set(artifacts.bindings.vault, 28);
  bytes.set(artifacts.bindings.ceremony, 44);
  bytes.set(signedHash, 60);
  bytes.set(wrapHash, 92);
  bytes.set(artifacts.signedEntry, SPOOL_LAYOUT.headerBytes);
  bytes.set(
    artifacts.recoveryWrap,
    SPOOL_LAYOUT.headerBytes + artifacts.signedEntry.length,
  );
  bytes.set(
    await domainHash(
      SPOOL_LAYOUT.checksumDomainEscaped,
      bytes.subarray(0, -SPOOL_LAYOUT.checksumBytes),
    ),
    bytes.length - SPOOL_LAYOUT.checksumBytes,
  );
  signedHash.fill(0);
  wrapHash.fill(0);
  return bytes;
}

async function encodeEncryptedSpool(
  artifacts: Awaited<ReturnType<typeof canonicalArtifacts>>,
  inner: Uint8Array,
) {
  await sodium.ready;
  const header = new Uint8Array(SPOOL_LAYOUT.encryptedAtRest.headerBytes);
  const view = new DataView(header.buffer);
  header.set(text("ANVROTE1"), 0);
  setU16(view, 8, SPOOL_LAYOUT.version);
  setU64(view, 12, inner.length);
  header.set(artifacts.bindings.vault, 20);
  header.set(artifacts.bindings.ceremony, 36);
  header.set(artifacts.spoolNonce, 52);
  header.set(await commitment(inner), 76);
  const kdfInput = concat(
    artifacts.pendingKey,
    artifacts.bindings.vault,
    artifacts.bindings.ceremony,
  );
  const key = await domainHash(
    SPOOL_LAYOUT.encryptedAtRest.kdfDomainEscaped,
    kdfInput,
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    inner,
    header,
    null,
    artifacts.spoolNonce,
    key,
  );
  const withoutChecksum = concat(header, ciphertext);
  const bytes = concat(
    withoutChecksum,
    await domainHash(
      SPOOL_LAYOUT.encryptedAtRest.checksumDomainEscaped,
      withoutChecksum,
    ),
  );
  const commitments = {
    bytes: bytes.length,
    outerFrameCommitmentHex: ancV1BytesToHex(await commitment(bytes)),
    aadCommitmentHex: ancV1BytesToHex(await commitment(header)),
    kdfInputCommitmentHex: ancV1BytesToHex(await commitment(kdfInput)),
    derivedKeyCommitmentHex: ancV1BytesToHex(await commitment(key)),
    ciphertextCommitmentHex: ancV1BytesToHex(await commitment(ciphertext)),
    checksumHex: ancV1BytesToHex(bytes.subarray(-32)),
    frameDigestHex: ancV1BytesToHex(
      await domainHash(SPOOL_LAYOUT.encryptedAtRest.digestDomainEscaped, bytes),
    ),
  };
  header.fill(0);
  kdfInput.fill(0);
  key.fill(0);
  ciphertext.fill(0);
  withoutChecksum.fill(0);
  return { bytes, commitments };
}

async function encodeRecord(
  shape: PositiveShape,
  artifacts: Awaited<ReturnType<typeof canonicalArtifacts>>,
  innerSpool: Uint8Array,
  encryptedSpool: Uint8Array,
) {
  const checkpoint = shape.role === 1 ? artifacts.endpoint : artifacts.broker;
  const bytes = new Uint8Array(RECORD_LAYOUT.bytes);
  const view = new DataView(bytes.buffer);
  bytes.set(text("ANVR"), 0);
  setU16(view, 4, RECORD_LAYOUT.version);
  setU16(view, 6, RECORD_LAYOUT.bytes);
  bytes[8] = shape.phase;
  bytes[9] = shape.flags;
  bytes[10] = shape.role;
  bytes[11] = shape.unattended;
  setU64(view, 16, 7);
  bytes.set(ID.vault, 24);
  bytes.set(checkpoint.endpointId, 40);
  bytes.set(ID.ceremony, 56);
  setU64(view, 72, BASE.custodyGeneration);
  bytes.set(new Uint8Array(32).fill(0x99), 80);
  setU64(view, 112, BASE.sequence);
  bytes.set(BASE.head, 120);
  bytes.set(BASE.membership, 152);
  setU64(view, 184, BASE.epoch);
  setU64(view, 192, BASE.recoveryGeneration);
  bytes.set(checkpoint.signingPublicKey, 200);
  bytes.set(checkpoint.agreementPublicKey, 232);
  bytes.set(checkpoint.enrollmentRef, 264);
  if (shape.phase < 6) setU64(view, 280, BASE.epoch + 1);
  if (shape.phase < 5) bytes.set(artifacts.pendingKey, 288);
  if (shape.phase === 4 || shape.phase === 5) {
    const spoolView = new DataView(
      innerSpool.buffer,
      innerSpool.byteOffset,
      innerSpool.byteLength,
    );
    setU64(view, 320, BASE.sequence + 1);
    bytes.set(BASE.head, 328);
    bytes.set(artifacts.transcript, 360);
    setU64(view, 392, Number(spoolView.getBigUint64(12, true)));
    setU64(view, 400, Number(spoolView.getBigUint64(20, true)));
    bytes.set(
      await domainHash(
        SPOOL_LAYOUT.encryptedAtRest.digestDomainEscaped,
        encryptedSpool,
      ),
      408,
    );
  }
  bytes.set(
    await domainHash(
      RECORD_LAYOUT.checksumDomainEscaped,
      bytes.subarray(0, RECORD_LAYOUT.checksumOffset),
    ),
    RECORD_LAYOUT.checksumOffset,
  );
  return bytes;
}

async function canonicalArtifacts(ids = ID, suppliedPendingKey?: Uint8Array) {
  const pendingKey =
    suppliedPendingKey?.slice() ??
    (await derive(DERIVATION.labels.pendingEpochKey, 32));
  const signingSeed = await derive(DERIVATION.labels.issuerSigningSeed, 32);
  const agreementSeed = await derive(DERIVATION.labels.issuerAgreementSeed, 32);
  const recoverySeed = await derive(
    DERIVATION.labels.recoveryAgreementSeed,
    32,
  );
  const brokerSigningSeed = await derive(
    DERIVATION.labels.brokerSigningSeed,
    32,
  );
  const brokerAgreementSeed = await derive(
    DERIVATION.labels.brokerAgreementSeed,
    32,
  );
  const signing = await ancV1SigningKeypairFromSeed(signingSeed);
  const agreement = await ancV1BoxKeypairFromSeed(agreementSeed);
  const recovery = await ancV1BoxKeypairFromSeed(recoverySeed);
  const brokerSigning = await ancV1SigningKeypairFromSeed(brokerSigningSeed);
  const brokerAgreement = await ancV1BoxKeypairFromSeed(brokerAgreementSeed);
  const recoveryWrap = await createAncV1RecoveryWrap(
    {
      suite: "anc/v1",
      vaultId: ids.vault,
      type: "recovery-wrap",
      createdAt: 1_721_296_801,
      envelopeId: ids.envelope,
      ceremonyId: ids.ceremony,
      recoveryGeneration: BASE.recoveryGeneration,
      recoveryId: ids.recovery,
      recoveryKeyAgreementPublicKey: recovery.publicKey,
      epoch: BASE.epoch + 1,
      issuerEndpointId: ids.endpoint,
      activationControlSequence: BASE.sequence + 1,
      activationPreviousHead: BASE.head,
      activationPreviousMembershipHash: BASE.membership,
      nonce: new Uint8Array(24).fill(0x48),
      eek: pendingKey,
    },
    {
      issuerKeyAgreementPrivateKey: agreement.privateKey,
      issuerSigningPrivateKey: signing.privateKey,
    },
  );
  const recoveryWrapBytes = encodeAncV1RecoveryWrap(recoveryWrap);
  const recoveryWrapHash = await hashAncV1RecoveryWrap(
    recoveryWrapBytes,
    ids.vault,
  );
  const issuer: ControlLogMember = {
    endpointId: ancV1BytesToHex(ids.endpoint),
    role: "endpoint",
    unattended: false,
    signingPublicKey: ancV1BytesToHex(signing.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(agreement.publicKey),
    enrollmentRef: ancV1BytesToHex(ids.enrollment),
  };
  const broker: ControlLogMember = {
    endpointId: ancV1BytesToHex(ids.broker),
    role: "broker",
    unattended: true,
    signingPublicKey: ancV1BytesToHex(brokerSigning.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(brokerAgreement.publicKey),
    enrollmentRef: ancV1BytesToHex(ids.brokerEnrollment),
  };
  const commit: ControlMembershipCommit = {
    suite: "anc/v1",
    type: "membership_commit",
    vaultId: ancV1BytesToHex(ids.vault),
    ceremonyId: ancV1BytesToHex(ids.ceremony),
    ceremonyKind: "remove_device",
    epoch: BASE.epoch + 1,
    previousMembershipHash: ancV1BytesToHex(BASE.membership),
    activeMembers: [issuer, broker].sort((left, right) =>
      left.endpointId.localeCompare(right.endpointId),
    ),
    removedEndpointIds: [ancV1BytesToHex(ids.removedEndpoint)],
    rotationCompleted: true,
    outstandingJobsResolved: false,
    recoverySnapshotHash: null,
    recoveryAuthorizationHash: null,
    recoveryGeneration: BASE.recoveryGeneration,
    recoveryId: ancV1BytesToHex(ids.recovery),
    recoverySigningPublicKey: ancV1BytesToHex(BASE.recoverySigningPublicKey),
    recoveryKeyAgreementPublicKey: ancV1BytesToHex(recovery.publicKey),
    recoveryWrapHash: ancV1BytesToHex(recoveryWrapHash),
  };
  const entry = await createSignedControlLogEntry({
    vaultId: commit.vaultId,
    createdAt: "2024-07-18T10:00:02.000Z",
    envelopeId: ancV1BytesToHex(ids.envelope),
    sequence: BASE.sequence + 1,
    previousHash: ancV1BytesToHex(BASE.head),
    innerEnvelope: commit,
    signerEndpointId: issuer.endpointId,
    signingPrivateKey: signing.privateKey,
  });
  const signedEntry = encodeSignedControlLogEntry(entry);
  const transcript = await ancV1Hash(
    "log-entry",
    encodeControlLogInnerEnvelope(commit),
  );
  const spoolNonce = await derive(DERIVATION.labels.spoolNonce, 24);
  for (const secret of [
    signingSeed,
    agreementSeed,
    recoverySeed,
    brokerSigningSeed,
    brokerAgreementSeed,
    signing.privateKey,
    agreement.privateKey,
    recovery.privateKey,
    brokerSigning.privateKey,
    brokerAgreement.privateKey,
  ])
    secret.fill(0);
  return {
    pendingKey,
    signedEntry,
    recoveryWrap: recoveryWrapBytes,
    spoolNonce,
    transcript,
    signingPublicKey: signing.publicKey,
    agreementPublicKey: agreement.publicKey,
    recoveryAgreementPublicKey: recovery.publicKey,
    brokerSigningPublicKey: brokerSigning.publicKey,
    brokerAgreementPublicKey: brokerAgreement.publicKey,
    endpoint: {
      endpointId: ids.endpoint,
      signingPublicKey: signing.publicKey,
      agreementPublicKey: agreement.publicKey,
      enrollmentRef: ids.enrollment,
    },
    broker: {
      endpointId: ids.broker,
      signingPublicKey: brokerSigning.publicKey,
      agreementPublicKey: brokerAgreement.publicKey,
      enrollmentRef: ids.brokerEnrollment,
    },
    bindings: {
      vault: ids.vault,
      ceremony: ids.ceremony,
    },
  };
}

function provenanceValid(value: AncV1NativeRotationPreparationProvenance) {
  return (
    /^[0-9a-f]{40}$/.test(value.protocolBaseCommit) &&
    value.sources.length ===
      ANC_V1_NATIVE_ROTATION_PREPARATION_SOURCE_PATHS.length &&
    ANC_V1_NATIVE_ROTATION_PREPARATION_SOURCE_PATHS.every(
      (path, index) =>
        value.sources[index]?.path === path &&
        /^[0-9a-f]{64}$/.test(value.sources[index]!.sha256),
    )
  );
}

export async function buildAncV1NativeRotationPreparationEphemeralMaterial() {
  const artifacts = await canonicalArtifacts();
  const alternate = await canonicalArtifacts(
    ALTERNATE_ID,
    artifacts.pendingKey,
  );
  alternate.spoolNonce.fill(0);
  alternate.spoolNonce.set(
    await derive(DERIVATION.labels.alternateSpoolNonce, 24),
  );
  const alternateInner = await encodeSpool(alternate);
  const alternateOuter = await encodeEncryptedSpool(alternate, alternateInner);
  alternateInner.fill(0);
  alternate.pendingKey.fill(0);
  alternate.spoolNonce.fill(0);
  alternate.signedEntry.fill(0);
  alternate.recoveryWrap.fill(0);
  return {
    bindings: {
      vaultIdHex: ancV1BytesToHex(ID.vault),
      ceremonyIdHex: ancV1BytesToHex(ID.ceremony),
      alternateVaultIdHex: ancV1BytesToHex(ALTERNATE_ID.vault),
      alternateCeremonyIdHex: ancV1BytesToHex(ALTERNATE_ID.ceremony),
    },
    identities: {
      endpoint: {
        role: 1 as const,
        unattended: 0 as const,
        endpointIdHex: ancV1BytesToHex(ID.endpoint),
      },
      broker: {
        role: 2 as const,
        unattended: 1 as const,
        endpointIdHex: ancV1BytesToHex(ID.broker),
      },
    },
    files: {
      pendingEpochKey: artifacts.pendingKey,
      spoolNonce: artifacts.spoolNonce,
      signedEntry: artifacts.signedEntry,
      recoveryWrap: artifacts.recoveryWrap,
      alternateOuter: alternateOuter.bytes,
    },
  };
}

const negativeCases: readonly AncV1NativeRotationPreparationNegativeCase[] = [
  {
    name: "record_magic",
    target: "record",
    category: "record.wire.magic",
    mutation: { op: "flip", offset: 0 },
  },
  {
    name: "record_version",
    target: "record",
    category: "record.wire.version",
    mutation: { op: "set_u16", offset: 4, value: 2 },
  },
  {
    name: "record_declared_length",
    target: "record",
    category: "record.wire.length",
    mutation: { op: "set_u16", offset: 6, value: 511 },
  },
  {
    name: "record_phase_zero",
    target: "record",
    category: "record.wire.phase",
    mutation: { op: "set_u8", offset: 8, value: 0 },
  },
  {
    name: "record_phase_seven",
    target: "record",
    category: "record.wire.phase",
    mutation: { op: "set_u8", offset: 8, value: 7 },
  },
  {
    name: "record_unknown_flag",
    target: "record",
    category: "record.wire.flags",
    mutation: { op: "set_u8", offset: 9, value: 4 },
  },
  {
    name: "record_phase4_missing_edge_flag",
    target: "record",
    category: "record.wire.flags",
    mutation: { op: "set_u8", offset: 9, value: 2 },
  },
  {
    name: "record_phase4_missing_durable_flag",
    target: "record",
    category: "record.wire.flags",
    mutation: { op: "set_u8", offset: 9, value: 1 },
  },
  {
    name: "record_role_zero",
    target: "record",
    category: "record.wire.role",
    mutation: { op: "set_u8", offset: 10, value: 0 },
  },
  {
    name: "record_role_three",
    target: "record",
    category: "record.wire.role",
    mutation: { op: "set_u8", offset: 10, value: 3 },
  },
  {
    name: "record_unattended_role_mismatch",
    target: "record",
    category: "record.wire.unattended_role",
    mutation: { op: "set_u8", offset: 11, value: 1 },
  },
  {
    name: "record_reserved_nonzero",
    target: "record",
    category: "record.wire.zero_padding",
    mutation: { op: "set_u8", offset: 12, value: 1 },
  },
  {
    name: "record_tail_padding_nonzero",
    target: "record",
    category: "record.wire.zero_padding",
    mutation: { op: "set_u8", offset: 479, value: 1 },
  },
  {
    name: "record_prep_generation_zero",
    target: "record",
    category: "record.range.generation",
    mutation: { op: "set_u64", offset: 16, value: 0 },
  },
  {
    name: "record_base_generation_zero",
    target: "record",
    category: "record.range.generation",
    mutation: { op: "set_u64", offset: 72, value: 0 },
  },
  {
    name: "record_base_sequence_unsafe",
    target: "record",
    category: "record.range.sequence",
    mutation: {
      op: "set_u64",
      offset: 112,
      value: Number.MAX_SAFE_INTEGER + 1,
    },
  },
  {
    name: "record_base_epoch_zero",
    target: "record",
    category: "record.range.epoch",
    mutation: { op: "set_u64", offset: 184, value: 0 },
  },
  {
    name: "record_recovery_generation_zero",
    target: "record",
    category: "record.range.generation",
    mutation: { op: "set_u64", offset: 192, value: 0 },
  },
  {
    name: "record_pending_epoch_not_next",
    target: "record",
    category: "record.binding.pending_epoch",
    mutation: { op: "set_u64", offset: 280, value: 9 },
  },
  {
    name: "record_phase4_pending_key_zero",
    target: "record",
    category: "record.phase.pending_key",
    mutation: { op: "zero", offset: 288, length: 32 },
  },
  {
    name: "record_phase5_pending_key_present",
    target: "record",
    category: "record.phase.pending_key",
    mutation: { op: "flip", offset: 288 },
  },
  {
    name: "record_phase6_pending_epoch_present",
    target: "record",
    category: "record.phase.cleaned",
    mutation: { op: "set_u64", offset: 280, value: 5 },
  },
  {
    name: "record_phase6_pending_key_present",
    target: "record",
    category: "record.phase.cleaned",
    mutation: { op: "flip", offset: 288 },
  },
  {
    name: "record_phase6_edge_present",
    target: "record",
    category: "record.phase.cleaned",
    mutation: { op: "set_u64", offset: 320, value: 20 },
  },
  {
    name: "record_phase6_artifact_present",
    target: "record",
    category: "record.phase.cleaned",
    mutation: { op: "set_u64", offset: 392, value: 97 },
  },
  {
    name: "record_cleaned_to_prepared_same_generation",
    target: "binding",
    category: "record.transition.generation",
    mutation: { op: "set_u64", offset: 16, value: 7 },
  },
  {
    name: "record_phase1_edge_field",
    target: "record",
    category: "record.phase.edge_fields",
    mutation: { op: "set_u64", offset: 320, value: 1 },
  },
  {
    name: "record_phase1_artifact_field",
    target: "record",
    category: "record.phase.artifact_fields",
    mutation: { op: "set_u64", offset: 392, value: 1 },
  },
  {
    name: "record_phase4_wrong_next_sequence",
    target: "record",
    category: "record.phase.expected_sequence",
    mutation: { op: "set_u64", offset: 320, value: 9 },
  },
  {
    name: "record_phase4_wrong_previous_head",
    target: "record",
    category: "record.phase.previous_head",
    mutation: { op: "flip", offset: 328 },
  },
  {
    name: "record_phase4_zero_transcript",
    target: "record",
    category: "record.phase.transcript",
    mutation: { op: "zero", offset: 360, length: 32 },
  },
  {
    name: "record_signed_length_zero",
    target: "record",
    category: "record.phase.artifact_length",
    mutation: { op: "set_u64", offset: 392, value: 0 },
  },
  {
    name: "record_signed_length_over_max",
    target: "record",
    category: "record.phase.artifact_length",
    mutation: { op: "set_u64", offset: 392, value: 65_537 },
  },
  {
    name: "record_wrap_length_zero",
    target: "record",
    category: "record.phase.artifact_length",
    mutation: { op: "set_u64", offset: 400, value: 0 },
  },
  {
    name: "record_wrap_length_over_max",
    target: "record",
    category: "record.phase.artifact_length",
    mutation: { op: "set_u64", offset: 400, value: 1_048_577 },
  },
  {
    name: "record_spool_digest_zero",
    target: "record",
    category: "record.phase.spool_digest",
    mutation: { op: "zero", offset: 408, length: 32 },
  },
  {
    name: "record_checksum",
    target: "record",
    category: "record.crypto.checksum",
    mutation: { op: "flip", offset: 480 },
  },
  {
    name: "record_truncated",
    target: "record",
    category: "record.wire.truncation",
    mutation: { op: "truncate", bytes: 1 },
  },
  {
    name: "record_extra",
    target: "record",
    category: "record.wire.extra_bytes",
    mutation: { op: "append", hex: "00" },
  },
  {
    name: "record_substitution",
    target: "binding",
    category: "record.binding.substitution",
    mutation: { op: "substitute", target: "record" },
  },
  {
    name: "spool_magic",
    target: "spool",
    category: "spool.wire.magic",
    mutation: { op: "flip", offset: 0 },
  },
  {
    name: "spool_version",
    target: "spool",
    category: "spool.wire.version",
    mutation: { op: "set_u16", offset: 8, value: 2 },
  },
  {
    name: "spool_flags",
    target: "spool",
    category: "spool.wire.flags",
    mutation: { op: "set_u8", offset: 10, value: 1 },
  },
  {
    name: "spool_reserved",
    target: "spool",
    category: "spool.wire.reserved",
    mutation: { op: "set_u8", offset: 11, value: 1 },
  },
  {
    name: "spool_signed_length_zero",
    target: "spool",
    category: "spool.range.artifact_length",
    mutation: { op: "set_u64", offset: 12, value: 0 },
  },
  {
    name: "spool_signed_length_over_max",
    target: "spool",
    category: "spool.range.artifact_length",
    mutation: { op: "set_u64", offset: 12, value: 65_537 },
  },
  {
    name: "spool_wrap_length_zero",
    target: "spool",
    category: "spool.range.artifact_length",
    mutation: { op: "set_u64", offset: 20, value: 0 },
  },
  {
    name: "spool_wrap_length_over_max",
    target: "spool",
    category: "spool.range.artifact_length",
    mutation: { op: "set_u64", offset: 20, value: 1_048_577 },
  },
  {
    name: "spool_vault_substitution",
    target: "spool",
    category: "spool.binding.vault",
    mutation: { op: "flip", offset: 28 },
  },
  {
    name: "spool_ceremony_substitution",
    target: "spool",
    category: "spool.binding.ceremony",
    mutation: { op: "flip", offset: 44 },
  },
  {
    name: "spool_signed_hash",
    target: "spool",
    category: "spool.binding.signed_hash",
    mutation: { op: "flip", offset: 60 },
  },
  {
    name: "spool_wrap_hash",
    target: "spool",
    category: "spool.binding.recovery_wrap_hash",
    mutation: { op: "flip", offset: 92 },
  },
  {
    name: "spool_payload_substitution",
    target: "spool",
    category: "spool.binding.signed_hash",
    mutation: { op: "flip", offset: 124 },
  },
  {
    name: "spool_checksum",
    target: "spool",
    category: "spool.crypto.checksum",
    mutation: { op: "flip", offset: -1 },
  },
  {
    name: "spool_truncated",
    target: "spool",
    category: "spool.wire.truncation",
    mutation: { op: "truncate", bytes: 1 },
  },
  {
    name: "spool_extra",
    target: "spool",
    category: "spool.wire.extra_bytes",
    mutation: { op: "append", hex: "00" },
  },
  {
    name: "spool_substitution",
    target: "binding",
    category: "spool.binding.substitution",
    mutation: { op: "substitute", target: "spool" },
  },
  {
    name: "encrypted_spool_ciphertext_substitution",
    target: "binding",
    category: "spool.encryption.aead",
    mutation: { op: "substitute", target: "spool" },
  },
  {
    name: "encrypted_spool_checksum_substitution",
    target: "binding",
    category: "spool.encryption.checksum",
    mutation: { op: "substitute", target: "spool" },
  },
  {
    name: "encrypted_spool_magic",
    target: "binding",
    category: "spool.encryption.magic",
    mutation: { op: "substitute", target: "spool" },
  },
  {
    name: "encrypted_spool_version",
    target: "binding",
    category: "spool.encryption.version",
    mutation: { op: "substitute", target: "spool" },
  },
  {
    name: "encrypted_spool_flags",
    target: "binding",
    category: "spool.encryption.flags",
    mutation: { op: "substitute", target: "spool" },
  },
  {
    name: "encrypted_spool_reserved",
    target: "binding",
    category: "spool.encryption.reserved",
    mutation: { op: "substitute", target: "spool" },
  },
  {
    name: "encrypted_spool_length_mismatch",
    target: "binding",
    category: "spool.encryption.length",
    mutation: { op: "substitute", target: "spool" },
  },
  {
    name: "encrypted_spool_length_unsafe",
    target: "binding",
    category: "spool.encryption.bounds",
    mutation: { op: "substitute", target: "spool" },
  },
  {
    name: "binding_signed_length",
    target: "binding",
    category: "binding.record_spool_length",
    mutation: { op: "set_u64", offset: 392, value: 98 },
  },
  {
    name: "binding_wrap_length",
    target: "binding",
    category: "binding.record_spool_length",
    mutation: { op: "set_u64", offset: 400, value: 194 },
  },
  {
    name: "binding_spool_digest",
    target: "binding",
    category: "binding.record_spool_digest",
    mutation: { op: "flip", offset: 408 },
  },
] as const;

function mutationExecution(
  testCase: AncV1NativeRotationPreparationNegativeCase,
  encryptedOuterBytes: number,
) {
  const baselineRecord = testCase.name.startsWith("record_phase1")
    ? "endpoint_prepared"
    : testCase.category === "record.transition.generation"
      ? "endpoint_prepared"
      : testCase.name.startsWith("record_phase5")
        ? "endpoint_consumed"
        : testCase.name.startsWith("record_phase6")
          ? "endpoint_cleaned"
          : "endpoint_awaiting_control_commit";
  const applyTo = testCase.category.startsWith("spool.encryption")
    ? "encrypted_outer_spool"
    : testCase.target === "spool"
      ? "inner_spool"
      : testCase.mutation.op === "substitute" &&
          testCase.mutation.target === "spool"
        ? "encrypted_outer_spool"
        : "record";
  const effectiveMutation: Mutation = testCase.category.startsWith(
    "spool.encryption",
  )
    ? testCase.category === "spool.encryption.aead"
      ? { op: "flip", offset: 108 }
      : testCase.category === "spool.encryption.checksum"
        ? { op: "flip", offset: -1 }
        : testCase.category === "spool.encryption.magic"
          ? { op: "flip", offset: 0 }
          : testCase.category === "spool.encryption.version"
            ? { op: "set_u16", offset: 8, value: 2 }
            : testCase.category === "spool.encryption.flags"
              ? { op: "set_u8", offset: 10, value: 1 }
              : testCase.category === "spool.encryption.reserved"
                ? { op: "set_u8", offset: 11, value: 1 }
                : testCase.category === "spool.encryption.length"
                  ? {
                      op: "set_u64",
                      offset: 12,
                      value: encryptedOuterBytes,
                    }
                  : {
                      op: "set_u64",
                      offset: 12,
                      value: Number.MAX_SAFE_INTEGER + 1,
                    }
    : testCase.category === "spool.binding.substitution"
      ? testCase.mutation
      : testCase.mutation.op === "substitute"
        ? testCase.mutation.target === "record"
          ? { op: "flip", offset: 24 }
          : { op: "flip", offset: 28 }
        : testCase.mutation;
  const integrityRepair =
    testCase.category === "spool.encryption.aead"
      ? "outer_spool_checksum"
      : applyTo === "record" &&
          !testCase.category.startsWith("record.crypto") &&
          !testCase.category.startsWith("record.wire.truncation") &&
          !testCase.category.startsWith("record.wire.extra")
        ? "record_checksum"
        : applyTo === "inner_spool" &&
            !testCase.category.startsWith("spool.crypto") &&
            !testCase.category.startsWith("spool.wire.truncation") &&
            !testCase.category.startsWith("spool.wire.extra") &&
            !testCase.category.startsWith("spool.binding.signed_hash") &&
            !testCase.category.startsWith("spool.binding.recovery_wrap_hash") &&
            !testCase.category.startsWith("spool.binding.substitution")
          ? "inner_spool_checksum"
          : "none";
  return {
    baselineRecord,
    baselineSpool:
      testCase.category === "spool.binding.substitution"
        ? "alternate_substitution_outer"
        : applyTo === "inner_spool"
          ? "inner"
          : "shared_primary_outer",
    transition:
      testCase.category === "record.transition.generation"
        ? {
            from: "endpoint_cleaned" as const,
            to: "endpoint_prepared" as const,
            expectedStatus: "reject" as const,
          }
        : null,
    applyTo,
    effectiveMutation,
    integrityRepair,
  } as const;
}

export async function buildAncV1NativeRotationPreparationVectors(
  provenance: AncV1NativeRotationPreparationProvenance,
) {
  if (!provenanceValid(provenance))
    throw new Error("Invalid fixture provenance");
  const artifacts = await canonicalArtifacts();
  const alternateSpoolNonce = await derive(
    DERIVATION.labels.alternateSpoolNonce,
    24,
  );
  const commitments = {
    pendingEpochKey: ancV1BytesToHex(await commitment(artifacts.pendingKey)),
    signedEntry: ancV1BytesToHex(await commitment(artifacts.signedEntry)),
    recoveryWrap: ancV1BytesToHex(await commitment(artifacts.recoveryWrap)),
    spoolNonce: ancV1BytesToHex(await commitment(artifacts.spoolNonce)),
    alternateSpoolNonce: ancV1BytesToHex(await commitment(alternateSpoolNonce)),
  };
  const externalCheckpoint = {
    vaultIdHex: ancV1BytesToHex(ID.vault),
    endpointIdHex: ancV1BytesToHex(ID.endpoint),
    ceremonyIdHex: ancV1BytesToHex(ID.ceremony),
    baseCustodyGeneration: BASE.custodyGeneration,
    baseFrameDigestHex: ancV1BytesToHex(new Uint8Array(32).fill(0x99)),
    baseSequence: BASE.sequence,
    baseHeadHex: ancV1BytesToHex(BASE.head),
    baseMembershipHex: ancV1BytesToHex(BASE.membership),
    baseEpoch: BASE.epoch,
    baseRecoveryGeneration: BASE.recoveryGeneration,
    role: 1 as const,
    unattended: 0 as const,
    signingPublicKeyHex: ancV1BytesToHex(artifacts.signingPublicKey),
    agreementPublicKeyHex: ancV1BytesToHex(artifacts.agreementPublicKey),
    enrollmentRefHex: ancV1BytesToHex(ID.enrollment),
    pendingEpoch: BASE.epoch + 1,
    transcriptHex: ancV1BytesToHex(artifacts.transcript),
    recoveryAgreementPublicKeyHex: ancV1BytesToHex(
      artifacts.recoveryAgreementPublicKey,
    ),
  };
  const brokerCheckpoint = {
    ...externalCheckpoint,
    endpointIdHex: ancV1BytesToHex(ID.broker),
    role: 2 as const,
    unattended: 1 as const,
    signingPublicKeyHex: ancV1BytesToHex(artifacts.brokerSigningPublicKey),
    agreementPublicKeyHex: ancV1BytesToHex(artifacts.brokerAgreementPublicKey),
    enrollmentRefHex: ancV1BytesToHex(ID.brokerEnrollment),
  };
  const transitionCases = Array.from({ length: 6 }, (_, from) =>
    Array.from({ length: 6 }, (_, to) => ({
      name: `phase_${from + 1}_to_${to + 1}`,
      from: from + 1,
      to: to + 1,
      expectedStatus:
        to === from + 1 || (from === 5 && to === 0) ? "accept" : "reject",
    })),
  ).flat();
  const positiveShapes: readonly PositiveShape[] = [
    { name: "endpoint_prepared", role: 1, unattended: 0, phase: 1, flags: 0 },
    { name: "endpoint_rewrapped", role: 1, unattended: 0, phase: 2, flags: 0 },
    {
      name: "endpoint_acknowledged",
      role: 1,
      unattended: 0,
      phase: 3,
      flags: 0,
    },
    {
      name: "endpoint_awaiting_control_commit",
      role: 1,
      unattended: 0,
      phase: 4,
      flags: 3,
    },
    { name: "broker_prepared", role: 2, unattended: 1, phase: 1, flags: 0 },
    { name: "broker_rewrapped", role: 2, unattended: 1, phase: 2, flags: 0 },
    {
      name: "broker_acknowledged",
      role: 2,
      unattended: 1,
      phase: 3,
      flags: 0,
    },
    {
      name: "broker_awaiting_control_commit",
      role: 2,
      unattended: 1,
      phase: 4,
      flags: 3,
    },
    { name: "endpoint_consumed", role: 1, unattended: 0, phase: 5, flags: 3 },
    { name: "broker_consumed", role: 2, unattended: 1, phase: 5, flags: 3 },
    { name: "endpoint_cleaned", role: 1, unattended: 0, phase: 6, flags: 0 },
    { name: "broker_cleaned", role: 2, unattended: 1, phase: 6, flags: 0 },
  ];
  const innerSpool = await encodeSpool(artifacts);
  const primaryOuter = await encodeEncryptedSpool(artifacts, innerSpool);
  const alternateMaterial = await canonicalArtifacts(
    ALTERNATE_ID,
    artifacts.pendingKey,
  );
  alternateMaterial.spoolNonce.fill(0);
  alternateMaterial.spoolNonce.set(alternateSpoolNonce);
  const alternateInnerSpool = await encodeSpool(alternateMaterial);
  const alternateOuter = await encodeEncryptedSpool(
    alternateMaterial,
    alternateInnerSpool,
  );
  const positiveCases = await Promise.all(
    positiveShapes.map(async (shape) => {
      const bytes = await encodeRecord(
        shape,
        artifacts,
        innerSpool,
        primaryOuter.bytes,
      );
      const result = {
        ...shape,
        recordBytes: bytes.length,
        recordCommitmentHex: ancV1BytesToHex(await commitment(bytes)),
        recordChecksumHex: ancV1BytesToHex(
          bytes.subarray(RECORD_LAYOUT.checksumOffset),
        ),
        encryptedOuterFrame:
          shape.phase === 4 || shape.phase === 5
            ? ("shared_primary" as const)
            : null,
      };
      bytes.fill(0);
      return result;
    }),
  );
  const wireCommitments = {
    commitmentAlgorithm: "blake2b-256" as const,
    innerSpool: {
      bytes: innerSpool.length,
      commitmentHex: ancV1BytesToHex(await commitment(innerSpool)),
      checksumHex: ancV1BytesToHex(innerSpool.subarray(-32)),
      signedEntryBytes: artifacts.signedEntry.length,
      recoveryWrapBytes: artifacts.recoveryWrap.length,
    },
    primaryOuterFrame: {
      name: "shared_primary" as const,
      holderRoles: [1, 2] as const,
      ...primaryOuter.commitments,
    },
    alternateSubstitutionOuterFrame: {
      name: "alternate_substitution" as const,
      vaultIdHex: ancV1BytesToHex(ALTERNATE_ID.vault),
      ceremonyIdHex: ancV1BytesToHex(ALTERNATE_ID.ceremony),
      ...alternateOuter.commitments,
    },
  };
  const result = {
    schema: ANC_V1_NATIVE_ROTATION_PREPARATION_CORPUS_SCHEMA,
    suite: "anc/v1" as const,
    encoding: "hex" as const,
    generator: ANC_V1_NATIVE_ROTATION_PREPARATION_GENERATOR,
    protocolBaseCommit: provenance.protocolBaseCommit,
    sourceAnchors: provenance.sources,
    recordLayout: RECORD_LAYOUT,
    spoolLayout: SPOOL_LAYOUT,
    materialStreamLayout: MATERIAL_STREAM_LAYOUT,
    syntheticDerivation: { ...DERIVATION, commitments },
    externalCheckpoint,
    brokerCheckpoint,
    wireCommitments,
    positiveCases,
    categoryVocabulary: ANC_V1_NATIVE_ROTATION_PREPARATION_CATEGORIES,
    negativeCases: negativeCases.map((testCase) => ({
      ...testCase,
      execution: mutationExecution(testCase, primaryOuter.bytes.length),
    })),
    transitionCases,
  };
  innerSpool.fill(0);
  primaryOuter.bytes.fill(0);
  alternateOuter.bytes.fill(0);
  alternateInnerSpool.fill(0);
  alternateMaterial.pendingKey.fill(0);
  alternateMaterial.signedEntry.fill(0);
  alternateMaterial.recoveryWrap.fill(0);
  alternateMaterial.spoolNonce.fill(0);
  artifacts.pendingKey.fill(0);
  artifacts.signedEntry.fill(0);
  artifacts.recoveryWrap.fill(0);
  artifacts.spoolNonce.fill(0);
  return result;
}

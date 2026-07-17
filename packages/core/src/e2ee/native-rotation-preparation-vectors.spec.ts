import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_CHECKSUM_DOMAIN,
  ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_ALTERNATE_OUTER_MAX_BYTES,
  ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_HEADER_BYTES,
  ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_MAGIC,
  ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_MAX_BYTES,
  ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_VERSION,
  buildEphemeralRotationPreparationStream,
} from "../../scripts/materialize-native-rotation-preparation-vectors.js";
import { ancV1BytesToHex, ancV1HexToBytes } from "./canonical.js";
import {
  type ControlLogMember,
  type ControlMembershipCommit,
  type ControlLogState,
  createSignedControlLogEntry,
  decodeSignedControlLogEntry,
  encodeControlLogInnerEnvelope,
  encodeSignedControlLogEntry,
  encodeUnsignedControlLogEntry,
  verifyAndReduceControlLogEntry,
} from "./control-log.js";
import {
  ANC_V1_NATIVE_ROTATION_PREPARATION_CATEGORIES,
  ANC_V1_NATIVE_ROTATION_PREPARATION_CORPUS_SCHEMA,
  ANC_V1_NATIVE_ROTATION_PREPARATION_GENERATOR,
  ANC_V1_NATIVE_ROTATION_PREPARATION_SOURCE_PATHS,
  type AncV1NativeRotationPreparationCategory,
  buildAncV1NativeRotationPreparationVectors,
} from "./native-rotation-preparation-vectors.js";
import {
  ancV1BoxKeypairFromSeed,
  ancV1Hash,
  ancV1SigningKeypairFromSeed,
  ancV1VerifyDetached,
} from "./portable-crypto.js";
import {
  createAncV1RecoveryWrap,
  decodeAncV1RecoveryWrap,
  encodeAncV1RecoveryWrap,
  hashAncV1RecoveryWrap,
  verifyAncV1RecoveryWrap,
  verifyAncV1RecoveryWrapRotation,
} from "./recovery-ceremony-codecs.js";

const PROTOCOL_BASE_COMMIT = "8234f8525136d818c9615556dc266f6e9873e061";
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURE = new URL(
  "./fixtures/anc-v1-native-rotation-preparation-vectors.json",
  import.meta.url,
);
const hex = z.string().regex(/^(?:[0-9a-f]{2})*$/);
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const category = z.enum(ANC_V1_NATIVE_ROTATION_PREPARATION_CATEGORIES);
const mutation = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("set_u8"),
      offset: z.number().int(),
      value: z.number().int(),
    })
    .strict(),
  z
    .object({
      op: z.literal("set_u16"),
      offset: z.number().int(),
      value: z.number().int(),
    })
    .strict(),
  z
    .object({
      op: z.literal("set_u64"),
      offset: z.number().int(),
      value: z.number(),
    })
    .strict(),
  z.object({ op: z.literal("flip"), offset: z.number().int() }).strict(),
  z
    .object({
      op: z.literal("zero"),
      offset: z.number().int(),
      length: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ op: z.literal("truncate"), bytes: z.number().int().positive() })
    .strict(),
  z.object({ op: z.literal("append"), hex }).strict(),
  z
    .object({
      op: z.literal("substitute"),
      target: z.enum(["record", "spool"]),
    })
    .strict(),
]);
const frameCommitmentSchema = z
  .object({
    bytes: z.number().int().positive(),
    outerFrameCommitmentHex: hex32,
    aadCommitmentHex: hex32,
    kdfInputCommitmentHex: hex32,
    derivedKeyCommitmentHex: hex32,
    ciphertextCommitmentHex: hex32,
    checksumHex: hex32,
    frameDigestHex: hex32,
  })
  .strict();
const corpusSchema = z
  .object({
    schema: z.literal(ANC_V1_NATIVE_ROTATION_PREPARATION_CORPUS_SCHEMA),
    suite: z.literal("anc/v1"),
    encoding: z.literal("hex"),
    generator: z.literal(ANC_V1_NATIVE_ROTATION_PREPARATION_GENERATOR),
    protocolBaseCommit: z.literal(PROTOCOL_BASE_COMMIT),
    sourceAnchors: z
      .array(
        z
          .object({
            path: z.enum(ANC_V1_NATIVE_ROTATION_PREPARATION_SOURCE_PATHS),
            sha256: hex32,
          })
          .strict(),
      )
      .length(ANC_V1_NATIVE_ROTATION_PREPARATION_SOURCE_PATHS.length),
    recordLayout: z
      .object({
        bytes: z.literal(512),
        magicHex: z.literal("414e5652"),
        version: z.literal(1),
        checksumOffset: z.literal(480),
        pendingKeyOffset: z.literal(288),
        pendingKeyLength: z.literal(32),
        phases: z
          .object({
            prepared: z.literal(1),
            rewrapped: z.literal(2),
            acknowledged: z.literal(3),
            awaitingControlCommit: z.literal(4),
            consumed: z.literal(5),
            cleaned: z.literal(6),
          })
          .strict(),
        checksumDomainEscaped: z.literal(
          "agent-native/private-vault/rotation-preparation/checksum/anc-v1\\0",
        ),
      })
      .strict(),
    spoolLayout: z
      .object({
        magicHex: z.literal("414e56524f543031"),
        version: z.literal(1),
        flagsOffset: z.literal(10),
        reservedOffset: z.literal(11),
        headerBytes: z.literal(124),
        checksumBytes: z.literal(32),
        signedEntryMaxBytes: z.literal(65_536),
        recoveryWrapMaxBytes: z.literal(1_048_576),
        checksumDomainEscaped: z.literal(
          "agent-native/private-vault/rotation-preparation-artifacts/anc-v1\\0",
        ),
        encryptedAtRest: z
          .object({
            magicHex: z.literal("414e56524f544531"),
            headerBytes: z.literal(108),
            tagBytes: z.literal(16),
            checksumBytes: z.literal(32),
            nonceBytes: z.literal(24),
            kdfDomainEscaped: z.literal(
              "agent-native/private-vault/rotation-preparation-spool-key/anc-v1\\0",
            ),
            checksumDomainEscaped: z.literal(
              "agent-native/private-vault/rotation-preparation-spool-checksum/anc-v1\\0",
            ),
            digestDomainEscaped: z.literal(
              "agent-native/private-vault/rotation-preparation-spool-frame/anc-v1\\0",
            ),
          })
          .strict(),
      })
      .strict(),
    materialStreamLayout: z
      .object({
        magicHex: z.literal("414e56524d533032"),
        version: z.literal(2),
        headerBytes: z.literal(152),
        checksumBytes: z.literal(32),
        alternateOuterMaxBytes: z.literal(1_114_424),
        maxBytes: z.literal(2_228_776),
        checksumDomainEscaped: z.literal(
          "agent-native/private-vault/rotation-preparation-material-stream/anc-v1\\0",
        ),
      })
      .strict(),
    syntheticDerivation: z
      .object({
        warning: z.string().includes("zeroized"),
        algorithm: z.literal("blake2b-256"),
        domainEscaped: z.literal(
          "agent-native/private-vault/rotation-preparation/test-derivation/anc-v1\\0",
        ),
        labels: z
          .object({
            pendingEpochKey: z.literal("pending-epoch-key"),
            signedEntry: z.literal("signed-control-log-entry"),
            recoveryWrap: z.literal("recovery-wrap-artifact"),
            spoolNonce: z.literal("encrypted-spool-nonce"),
            alternateSpoolNonce: z.literal("alternate-encrypted-spool-nonce"),
            issuerSigningSeed: z.literal("issuer-signing-seed"),
            issuerAgreementSeed: z.literal("issuer-agreement-seed"),
            recoveryAgreementSeed: z.literal("recovery-agreement-seed"),
            brokerSigningSeed: z.literal("broker-signing-seed"),
            brokerAgreementSeed: z.literal("broker-agreement-seed"),
          })
          .strict(),
        commitments: z
          .object({
            pendingEpochKey: hex32,
            signedEntry: hex32,
            recoveryWrap: hex32,
            spoolNonce: hex32,
            alternateSpoolNonce: hex32,
          })
          .strict(),
      })
      .strict(),
    externalCheckpoint: z
      .object({
        vaultIdHex: z.string().regex(/^[0-9a-f]{32}$/),
        endpointIdHex: z.string().regex(/^[0-9a-f]{32}$/),
        ceremonyIdHex: z.string().regex(/^[0-9a-f]{32}$/),
        baseCustodyGeneration: z.literal(11),
        baseFrameDigestHex: hex32,
        baseSequence: z.literal(19),
        baseHeadHex: hex32,
        baseMembershipHex: hex32,
        baseEpoch: z.literal(4),
        baseRecoveryGeneration: z.literal(2),
        role: z.literal(1),
        unattended: z.literal(0),
        signingPublicKeyHex: hex32,
        agreementPublicKeyHex: hex32,
        enrollmentRefHex: z.string().regex(/^[0-9a-f]{32}$/),
        pendingEpoch: z.literal(5),
        transcriptHex: hex32,
        recoveryAgreementPublicKeyHex: hex32,
      })
      .strict(),
    brokerCheckpoint: z
      .object({
        vaultIdHex: z.string().regex(/^[0-9a-f]{32}$/),
        endpointIdHex: z.string().regex(/^[0-9a-f]{32}$/),
        ceremonyIdHex: z.string().regex(/^[0-9a-f]{32}$/),
        baseCustodyGeneration: z.literal(11),
        baseFrameDigestHex: hex32,
        baseSequence: z.literal(19),
        baseHeadHex: hex32,
        baseMembershipHex: hex32,
        baseEpoch: z.literal(4),
        baseRecoveryGeneration: z.literal(2),
        role: z.literal(2),
        unattended: z.literal(1),
        signingPublicKeyHex: hex32,
        agreementPublicKeyHex: hex32,
        enrollmentRefHex: z.string().regex(/^[0-9a-f]{32}$/),
        pendingEpoch: z.literal(5),
        transcriptHex: hex32,
        recoveryAgreementPublicKeyHex: hex32,
      })
      .strict(),
    wireCommitments: z
      .object({
        commitmentAlgorithm: z.literal("blake2b-256"),
        innerSpool: z
          .object({
            bytes: z.number().int().positive(),
            commitmentHex: hex32,
            checksumHex: hex32,
            signedEntryBytes: z.number().int().positive().max(65_536),
            recoveryWrapBytes: z.number().int().positive().max(1_048_576),
          })
          .strict(),
        primaryOuterFrame: frameCommitmentSchema.extend({
          name: z.literal("shared_primary"),
          holderRoles: z.tuple([z.literal(1), z.literal(2)]),
        }),
        alternateSubstitutionOuterFrame: frameCommitmentSchema.extend({
          name: z.literal("alternate_substitution"),
          vaultIdHex: z.string().regex(/^[0-9a-f]{32}$/),
          ceremonyIdHex: z.string().regex(/^[0-9a-f]{32}$/),
        }),
      })
      .strict(),
    positiveCases: z
      .array(
        z
          .object({
            name: z.string(),
            role: z.union([z.literal(1), z.literal(2)]),
            unattended: z.union([z.literal(0), z.literal(1)]),
            phase: z.union([
              z.literal(1),
              z.literal(2),
              z.literal(3),
              z.literal(4),
              z.literal(5),
              z.literal(6),
            ]),
            flags: z.union([z.literal(0), z.literal(3)]),
            recordBytes: z.literal(512),
            recordCommitmentHex: hex32,
            recordChecksumHex: hex32,
            encryptedOuterFrame: z.literal("shared_primary").nullable(),
          })
          .strict(),
      )
      .length(12),
    categoryVocabulary: z.tuple(
      ANC_V1_NATIVE_ROTATION_PREPARATION_CATEGORIES.map((value) =>
        z.literal(value),
      ) as [
        z.ZodLiteral<AncV1NativeRotationPreparationCategory>,
        ...z.ZodLiteral<AncV1NativeRotationPreparationCategory>[],
      ],
    ),
    negativeCases: z
      .array(
        z
          .object({
            name: z.string().min(1),
            target: z.enum(["record", "spool", "binding"]),
            category,
            mutation,
            execution: z
              .object({
                baselineRecord: z.enum([
                  "endpoint_prepared",
                  "endpoint_awaiting_control_commit",
                  "endpoint_consumed",
                  "endpoint_cleaned",
                ]),
                baselineSpool: z.enum([
                  "inner",
                  "shared_primary_outer",
                  "alternate_substitution_outer",
                ]),
                transition: z
                  .object({
                    from: z.literal("endpoint_cleaned"),
                    to: z.literal("endpoint_prepared"),
                    expectedStatus: z.literal("reject"),
                  })
                  .strict()
                  .nullable(),
                applyTo: z.enum([
                  "record",
                  "inner_spool",
                  "encrypted_outer_spool",
                ]),
                effectiveMutation: mutation,
                integrityRepair: z.enum([
                  "none",
                  "record_checksum",
                  "inner_spool_checksum",
                  "outer_spool_checksum",
                ]),
              })
              .strict(),
          })
          .strict(),
      )
      .length(68),
    transitionCases: z
      .array(
        z
          .object({
            name: z.string(),
            from: z.number().int().min(1).max(6),
            to: z.number().int().min(1).max(6),
            expectedStatus: z.enum(["accept", "reject"]),
          })
          .strict(),
      )
      .length(36),
  })
  .strict();

type Corpus = z.infer<typeof corpusSchema>;
type Positive = Corpus["positiveCases"][number];
type Negative = Corpus["negativeCases"][number];

const RECORD_DOMAIN = new TextEncoder().encode(
  "agent-native/private-vault/rotation-preparation/checksum/anc-v1\0",
);
const SPOOL_DOMAIN = new TextEncoder().encode(
  "agent-native/private-vault/rotation-preparation-artifacts/anc-v1\0",
);
const DERIVATION_DOMAIN = new TextEncoder().encode(
  "agent-native/private-vault/rotation-preparation/test-derivation/anc-v1\0",
);
const MAGIC = new TextEncoder().encode("ANVR");
const SPOOL_MAGIC = new TextEncoder().encode("ANVROT01");
const ENCRYPTED_SPOOL_MAGIC = new TextEncoder().encode("ANVROTE1");
const SPOOL_KDF_DOMAIN = new TextEncoder().encode(
  "agent-native/private-vault/rotation-preparation-spool-key/anc-v1\0",
);
const SPOOL_OUTER_CHECKSUM_DOMAIN = new TextEncoder().encode(
  "agent-native/private-vault/rotation-preparation-spool-checksum/anc-v1\0",
);
const SPOOL_FRAME_DIGEST_DOMAIN = new TextEncoder().encode(
  "agent-native/private-vault/rotation-preparation-spool-frame/anc-v1\0",
);
const ids = {
  vault: new Uint8Array(16).fill(0x11),
  endpoint: new Uint8Array(16).fill(0x22),
  ceremony: new Uint8Array(16).fill(0x33),
  enrollment: new Uint8Array(16).fill(0x44),
  recovery: new Uint8Array(16).fill(0x45),
  envelope: new Uint8Array(16).fill(0x46),
  removedEndpoint: new Uint8Array(16).fill(0x47),
  broker: new Uint8Array(16).fill(0x49),
  brokerEnrollment: new Uint8Array(16).fill(0x4a),
};
const base = {
  preparationGeneration: 7,
  custodyGeneration: 11,
  sequence: 19,
  head: new Uint8Array(32).fill(0x55),
  membership: new Uint8Array(32).fill(0x66),
  epoch: 4,
  recoveryGeneration: 2,
  frameDigest: new Uint8Array(32).fill(0x99),
  recoverySigningPublicKey: new Uint8Array(32).fill(0x67),
};
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
const u16 = (view: DataView, offset: number, value?: number) =>
  value === undefined
    ? view.getUint16(offset, true)
    : view.setUint16(offset, value, true);
const u64 = (view: DataView, offset: number, value?: number) =>
  value === undefined
    ? Number(view.getBigUint64(offset, true))
    : view.setBigUint64(offset, BigInt(value), true);
const zero = (bytes: Uint8Array) => bytes.every((byte) => byte === 0);
const equal = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && sodium.memcmp(left, right);

async function hash(domain: Uint8Array, payload: Uint8Array) {
  await sodium.ready;
  const message = concat(domain, payload);
  const result = sodium.crypto_generichash(32, message, null);
  message.fill(0);
  return result;
}

async function derive(label: string, length: number) {
  const output = new Uint8Array(length);
  let cursor = 0;
  let counter = 0;
  while (cursor < length) {
    const block = await hash(
      DERIVATION_DOMAIN,
      concat(new TextEncoder().encode(label), Uint8Array.of(counter++)),
    );
    output.set(block.subarray(0, Math.min(32, length - cursor)), cursor);
    cursor += 32;
    block.fill(0);
  }
  return output;
}

async function materials(role: 1 | 2 = 1) {
  const pendingKey = await derive("pending-epoch-key", 32);
  const signingSeed = await derive("issuer-signing-seed", 32);
  const agreementSeed = await derive("issuer-agreement-seed", 32);
  const recoverySeed = await derive("recovery-agreement-seed", 32);
  const brokerSigningSeed = await derive("broker-signing-seed", 32);
  const brokerAgreementSeed = await derive("broker-agreement-seed", 32);
  const signing = await ancV1SigningKeypairFromSeed(signingSeed);
  const agreement = await ancV1BoxKeypairFromSeed(agreementSeed);
  const recovery = await ancV1BoxKeypairFromSeed(recoverySeed);
  const brokerSigning = await ancV1SigningKeypairFromSeed(brokerSigningSeed);
  const brokerAgreement = await ancV1BoxKeypairFromSeed(brokerAgreementSeed);
  const wrapValue = await createAncV1RecoveryWrap(
    {
      suite: "anc/v1",
      vaultId: ids.vault,
      type: "recovery-wrap",
      createdAt: 1_721_296_801,
      envelopeId: ids.envelope,
      ceremonyId: ids.ceremony,
      recoveryGeneration: base.recoveryGeneration,
      recoveryId: ids.recovery,
      recoveryKeyAgreementPublicKey: recovery.publicKey,
      epoch: base.epoch + 1,
      issuerEndpointId: ids.endpoint,
      activationControlSequence: base.sequence + 1,
      activationPreviousHead: base.head,
      activationPreviousMembershipHash: base.membership,
      nonce: new Uint8Array(24).fill(0x48),
      eek: pendingKey,
    },
    {
      issuerKeyAgreementPrivateKey: agreement.privateKey,
      issuerSigningPrivateKey: signing.privateKey,
    },
  );
  const recoveryWrap = encodeAncV1RecoveryWrap(wrapValue);
  const recoveryWrapHash = await hashAncV1RecoveryWrap(recoveryWrap, ids.vault);
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
    epoch: base.epoch + 1,
    previousMembershipHash: ancV1BytesToHex(base.membership),
    activeMembers: [issuer, broker].sort((left, right) =>
      left.endpointId.localeCompare(right.endpointId),
    ),
    removedEndpointIds: [ancV1BytesToHex(ids.removedEndpoint)],
    rotationCompleted: true,
    outstandingJobsResolved: false,
    recoverySnapshotHash: null,
    recoveryAuthorizationHash: null,
    recoveryGeneration: base.recoveryGeneration,
    recoveryId: ancV1BytesToHex(ids.recovery),
    recoverySigningPublicKey: ancV1BytesToHex(base.recoverySigningPublicKey),
    recoveryKeyAgreementPublicKey: ancV1BytesToHex(recovery.publicKey),
    recoveryWrapHash: ancV1BytesToHex(recoveryWrapHash),
  };
  const entry = await createSignedControlLogEntry({
    vaultId: commit.vaultId,
    createdAt: "2024-07-18T10:00:02.000Z",
    envelopeId: ancV1BytesToHex(ids.envelope),
    sequence: base.sequence + 1,
    previousHash: ancV1BytesToHex(base.head),
    innerEnvelope: commit,
    signerEndpointId: issuer.endpointId,
    signingPrivateKey: signing.privateKey,
  });
  const transcript = await ancV1Hash(
    "log-entry",
    encodeControlLogInnerEnvelope(commit),
  );
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
    signedEntry: encodeSignedControlLogEntry(entry),
    recoveryWrap,
    spoolNonce: await derive("encrypted-spool-nonce", 24),
    signingPublicKey: role === 1 ? signing.publicKey : brokerSigning.publicKey,
    agreementPublicKey:
      role === 1 ? agreement.publicKey : brokerAgreement.publicKey,
    recoveryAgreementPublicKey: recovery.publicKey,
    transcript,
    role,
    localEndpointId: (role === 1 ? ids.endpoint : ids.broker).slice(),
    localEnrollment: (role === 1
      ? ids.enrollment
      : ids.brokerEnrollment
    ).slice(),
    issuerSigningPublicKey: signing.publicKey,
  };
}

async function encryptedSpool(material: Awaited<ReturnType<typeof materials>>) {
  const bindingIds = "bindingIds" in material ? material.bindingIds : ids;
  const inner = await spool(material);
  const header = new Uint8Array(108);
  const view = new DataView(header.buffer);
  header.set(ENCRYPTED_SPOOL_MAGIC, 0);
  u16(view, 8, 1);
  header[10] = 0;
  header[11] = 0;
  u64(view, 12, inner.length);
  header.set(bindingIds.vault, 20);
  header.set(bindingIds.ceremony, 36);
  header.set(material.spoolNonce, 52);
  header.set(await hash(new Uint8Array(), inner), 76);
  const key = await hash(
    SPOOL_KDF_DOMAIN,
    concat(material.pendingKey, bindingIds.vault, bindingIds.ceremony),
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    inner,
    header,
    null,
    material.spoolNonce,
    key,
  );
  const withoutChecksum = concat(header, ciphertext);
  const output = concat(
    withoutChecksum,
    await hash(SPOOL_OUTER_CHECKSUM_DOMAIN, withoutChecksum),
  );
  key.fill(0);
  inner.fill(0);
  return output;
}

async function encryptedSpoolCommitments(
  outer: Uint8Array,
  material: Awaited<ReturnType<typeof materials>>,
) {
  const bindingIds = "bindingIds" in material ? material.bindingIds : ids;
  const kdfInput = concat(
    material.pendingKey,
    bindingIds.vault,
    bindingIds.ceremony,
  );
  const key = await hash(SPOOL_KDF_DOMAIN, kdfInput);
  const result = {
    bytes: outer.length,
    outerFrameCommitmentHex: ancV1BytesToHex(
      await hash(new Uint8Array(), outer),
    ),
    aadCommitmentHex: ancV1BytesToHex(
      await hash(new Uint8Array(), outer.slice(0, 108)),
    ),
    kdfInputCommitmentHex: ancV1BytesToHex(
      await hash(new Uint8Array(), kdfInput),
    ),
    derivedKeyCommitmentHex: ancV1BytesToHex(await hash(new Uint8Array(), key)),
    ciphertextCommitmentHex: ancV1BytesToHex(
      await hash(new Uint8Array(), outer.slice(108, -32)),
    ),
    checksumHex: ancV1BytesToHex(outer.slice(-32)),
    frameDigestHex: ancV1BytesToHex(
      await hash(SPOOL_FRAME_DIGEST_DOMAIN, outer),
    ),
  };
  kdfInput.fill(0);
  key.fill(0);
  return result;
}

async function decryptSpool(
  outer: Uint8Array,
  material: Awaited<ReturnType<typeof materials>>,
) {
  const bindingIds = "bindingIds" in material ? material.bindingIds : ids;
  if (outer.length < 156)
    return { ok: false as const, category: "spool.encryption.length" as const };
  if (!equal(outer.slice(0, 8), ENCRYPTED_SPOOL_MAGIC))
    return { ok: false as const, category: "spool.encryption.magic" as const };
  const view = new DataView(outer.buffer, outer.byteOffset, outer.byteLength);
  if (u16(view, 8) !== 1)
    return {
      ok: false as const,
      category: "spool.encryption.version" as const,
    };
  if (outer[10] !== 0)
    return { ok: false as const, category: "spool.encryption.flags" as const };
  if (outer[11] !== 0)
    return {
      ok: false as const,
      category: "spool.encryption.reserved" as const,
    };
  const innerLength = u64(view, 12) as number;
  if (
    !Number.isSafeInteger(innerLength) ||
    innerLength < 156 ||
    innerLength > 1_114_268
  )
    return { ok: false as const, category: "spool.encryption.bounds" as const };
  if (outer.length !== 108 + innerLength + 16 + 32)
    return { ok: false as const, category: "spool.encryption.length" as const };
  if (
    !equal(
      await hash(SPOOL_OUTER_CHECKSUM_DOMAIN, outer.slice(0, -32)),
      outer.slice(-32),
    )
  )
    return {
      ok: false as const,
      category: "spool.encryption.checksum" as const,
    };
  const key = await hash(
    SPOOL_KDF_DOMAIN,
    concat(material.pendingKey, bindingIds.vault, bindingIds.ceremony),
  );
  try {
    const inner = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      outer.slice(108, -32),
      outer.slice(0, 108),
      outer.slice(52, 76),
      key,
    );
    if (!equal(await hash(new Uint8Array(), inner), outer.slice(76, 108)))
      return { ok: false as const, category: "spool.encryption.aead" as const };
    return { ok: true as const, inner };
  } catch {
    return { ok: false as const, category: "spool.encryption.aead" as const };
  } finally {
    key.fill(0);
  }
}

async function spool(material: Awaited<ReturnType<typeof materials>>) {
  const signedHash = await hash(new Uint8Array(), material.signedEntry);
  const wrapHash = await hash(new Uint8Array(), material.recoveryWrap);
  // Raw artifact hashes are unkeyed BLAKE2b-256; the checksum alone is domain-separated.
  const output = new Uint8Array(
    124 + material.signedEntry.length + material.recoveryWrap.length + 32,
  );
  const view = new DataView(output.buffer);
  output.set(SPOOL_MAGIC, 0);
  u16(view, 8, 1);
  output[10] = 0;
  output[11] = 0;
  u64(view, 12, material.signedEntry.length);
  u64(view, 20, material.recoveryWrap.length);
  output.set(ids.vault, 28);
  output.set(ids.ceremony, 44);
  output.set(signedHash, 60);
  output.set(wrapHash, 92);
  output.set(material.signedEntry, 124);
  output.set(material.recoveryWrap, 124 + material.signedEntry.length);
  output.set(
    await hash(SPOOL_DOMAIN, output.slice(0, -32)),
    output.length - 32,
  );
  return output;
}

async function record(
  shape: Positive,
  material: Awaited<ReturnType<typeof materials>>,
) {
  const output = new Uint8Array(512);
  const view = new DataView(output.buffer);
  output.set(MAGIC, 0);
  u16(view, 4, 1);
  u16(view, 6, 512);
  output[8] = shape.phase;
  output[9] = shape.flags;
  output[10] = shape.role;
  output[11] = shape.unattended;
  u64(view, 16, base.preparationGeneration);
  output.set(ids.vault, 24);
  output.set(material.localEndpointId, 40);
  output.set(ids.ceremony, 56);
  u64(view, 72, base.custodyGeneration);
  output.set(base.frameDigest, 80);
  u64(view, 112, base.sequence);
  output.set(base.head, 120);
  output.set(base.membership, 152);
  u64(view, 184, base.epoch);
  u64(view, 192, base.recoveryGeneration);
  output.set(material.signingPublicKey, 200);
  output.set(material.agreementPublicKey, 232);
  output.set(material.localEnrollment, 264);
  if (shape.phase < 6) u64(view, 280, base.epoch + 1);
  if (shape.phase < 5) output.set(material.pendingKey, 288);
  if (shape.phase === 4 || shape.phase === 5) {
    const innerSpool = await spool(material);
    const spoolView = new DataView(innerSpool.buffer);
    const artifactSpool = await encryptedSpool(material);
    u64(view, 320, base.sequence + 1);
    output.set(base.head, 328);
    output.set(material.transcript, 360);
    u64(view, 392, u64(spoolView, 12) as number);
    u64(view, 400, u64(spoolView, 20) as number);
    output.set(await hash(SPOOL_FRAME_DIGEST_DOMAIN, artifactSpool), 408);
    innerSpool.fill(0);
    artifactSpool.fill(0);
  }
  output.set(await hash(RECORD_DOMAIN, output.slice(0, 480)), 480);
  return output;
}

type Status =
  | { ok: true }
  | { ok: false; category: AncV1NativeRotationPreparationCategory };
const reject = (category: AncV1NativeRotationPreparationCategory): Status => ({
  ok: false,
  category,
});

async function recordStatus(bytes: Uint8Array): Promise<Status> {
  if (bytes.length < 512) return reject("record.wire.truncation");
  if (bytes.length > 512) return reject("record.wire.extra_bytes");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!equal(bytes.slice(0, 4), MAGIC)) return reject("record.wire.magic");
  if (u16(view, 4) !== 1) return reject("record.wire.version");
  if (u16(view, 6) !== 512) return reject("record.wire.length");
  const phase = bytes[8]!;
  const flags = bytes[9]!;
  const role = bytes[10]!;
  if (phase < 1 || phase > 6) return reject("record.wire.phase");
  if ((flags & ~3) !== 0 || flags !== (phase === 4 || phase === 5 ? 3 : 0))
    return reject("record.wire.flags");
  if (role !== 1 && role !== 2) return reject("record.wire.role");
  if (bytes[11] !== (role === 2 ? 1 : 0))
    return reject("record.wire.unattended_role");
  if (!zero(bytes.slice(12, 16)) || !zero(bytes.slice(440, 480)))
    return reject("record.wire.zero_padding");
  if (
    (u64(view, 16) as number) <= 0 ||
    (u64(view, 72) as number) <= 0 ||
    (u64(view, 192) as number) <= 0
  )
    return reject("record.range.generation");
  if (!Number.isSafeInteger(u64(view, 112)))
    return reject("record.range.sequence");
  const epoch = u64(view, 184) as number;
  if (epoch <= 0) return reject("record.range.epoch");
  if (phase < 6 && u64(view, 280) !== epoch + 1)
    return reject("record.binding.pending_epoch");
  if (phase < 5 && zero(bytes.slice(288, 320)))
    return reject("record.phase.pending_key");
  if (phase >= 5 && !zero(bytes.slice(288, 320)))
    return reject(
      phase === 5 ? "record.phase.pending_key" : "record.phase.cleaned",
    );
  if (phase < 4) {
    if (!zero(bytes.slice(320, 392))) return reject("record.phase.edge_fields");
    if (!zero(bytes.slice(392, 440)))
      return reject("record.phase.artifact_fields");
  } else if (phase < 6) {
    if (u64(view, 320) !== (u64(view, 112) as number) + 1)
      return reject("record.phase.expected_sequence");
    if (!equal(bytes.slice(328, 360), bytes.slice(120, 152)))
      return reject("record.phase.previous_head");
    if (zero(bytes.slice(360, 392))) return reject("record.phase.transcript");
    const signedLength = u64(view, 392) as number;
    const wrapLength = u64(view, 400) as number;
    if (
      signedLength < 1 ||
      signedLength > 65_536 ||
      wrapLength < 1 ||
      wrapLength > 1_048_576
    )
      return reject("record.phase.artifact_length");
    if (zero(bytes.slice(408, 440))) return reject("record.phase.spool_digest");
  } else if (!zero(bytes.slice(280, 440))) {
    return reject("record.phase.cleaned");
  }
  if (!equal(await hash(RECORD_DOMAIN, bytes.slice(0, 480)), bytes.slice(480)))
    return reject("record.crypto.checksum");
  return { ok: true };
}

async function spoolStatus(
  bytes: Uint8Array,
  material: Awaited<ReturnType<typeof materials>>,
): Promise<Status> {
  const bindingIds = "bindingIds" in material ? material.bindingIds : ids;
  const primaryBinding =
    equal(bindingIds.vault, ids.vault) &&
    equal(bindingIds.ceremony, ids.ceremony);
  if (bytes.length < 156) return reject("spool.wire.truncation");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!equal(bytes.slice(0, 8), SPOOL_MAGIC)) return reject("spool.wire.magic");
  if (u16(view, 8) !== 1) return reject("spool.wire.version");
  if (bytes[10] !== 0) return reject("spool.wire.flags");
  if (bytes[11] !== 0) return reject("spool.wire.reserved");
  const signedLength = u64(view, 12) as number;
  const wrapLength = u64(view, 20) as number;
  if (
    signedLength < 1 ||
    signedLength > 65_536 ||
    wrapLength < 1 ||
    wrapLength > 1_048_576
  )
    return reject("spool.range.artifact_length");
  const exactLength = 124 + signedLength + wrapLength + 32;
  if (bytes.length < exactLength) return reject("spool.wire.truncation");
  if (bytes.length > exactLength) return reject("spool.wire.extra_bytes");
  if (!equal(bytes.slice(28, 44), bindingIds.vault))
    return reject("spool.binding.vault");
  if (!equal(bytes.slice(44, 60), bindingIds.ceremony))
    return reject("spool.binding.ceremony");
  const signed = bytes.slice(124, 124 + signedLength);
  const wrap = bytes.slice(124 + signedLength, exactLength - 32);
  if (!equal(await hash(new Uint8Array(), signed), bytes.slice(60, 92)))
    return reject("spool.binding.signed_hash");
  if (!equal(await hash(new Uint8Array(), wrap), bytes.slice(92, 124)))
    return reject("spool.binding.recovery_wrap_hash");
  if (!equal(await hash(SPOOL_DOMAIN, bytes.slice(0, -32)), bytes.slice(-32)))
    return reject("spool.crypto.checksum");
  try {
    const entry = decodeSignedControlLogEntry(signed);
    if (!equal(encodeSignedControlLogEntry(entry), signed))
      return reject("spool.binding.signed_hash");
    const { signature, ...unsignedEntry } = entry;
    if (
      !(await ancV1VerifyDetached(
        "log-entry",
        encodeUnsignedControlLogEntry(unsignedEntry),
        ancV1HexToBytes(signature),
        material.issuerSigningPublicKey,
      ))
    )
      return reject("spool.binding.signed_hash");
    const commit = entry.innerEnvelope;
    if (
      entry.sequence !== base.sequence + 1 ||
      entry.previousHash !== ancV1BytesToHex(base.head) ||
      entry.vaultId !== ancV1BytesToHex(bindingIds.vault) ||
      entry.signerEndpointId !== ancV1BytesToHex(ids.endpoint) ||
      commit.type !== "membership_commit" ||
      commit.ceremonyId !== ancV1BytesToHex(bindingIds.ceremony) ||
      commit.epoch !== base.epoch + 1 ||
      !commit.activeMembers.some(
        (member) =>
          member.endpointId === ancV1BytesToHex(material.localEndpointId) &&
          member.role === (material.role === 1 ? "endpoint" : "broker") &&
          member.unattended === (material.role === 2),
      ) ||
      (primaryBinding &&
        !equal(
          await ancV1Hash("log-entry", encodeControlLogInnerEnvelope(commit)),
          material.transcript,
        ))
    )
      return reject("spool.binding.substitution");
    const decodedWrap = decodeAncV1RecoveryWrap(wrap, {
      expectedVaultId: bindingIds.vault,
    });
    await verifyAncV1RecoveryWrap(wrap, {
      expectedVaultId: bindingIds.vault,
      issuerSigningPublicKey: material.issuerSigningPublicKey,
    });
    if (
      !equal(encodeAncV1RecoveryWrap(decodedWrap), wrap) ||
      !equal(decodedWrap.ceremonyId, bindingIds.ceremony) ||
      decodedWrap.epoch !== base.epoch + 1 ||
      decodedWrap.recoveryGeneration !== base.recoveryGeneration ||
      !equal(decodedWrap.issuerEndpointId, ids.endpoint) ||
      decodedWrap.activationControlSequence !== base.sequence + 1 ||
      !equal(decodedWrap.activationPreviousHead, base.head) ||
      !equal(decodedWrap.activationPreviousMembershipHash, base.membership)
    )
      return reject("spool.binding.substitution");
    const removedMember: ControlLogMember = {
      endpointId: ancV1BytesToHex(ids.removedEndpoint),
      role: "endpoint",
      unattended: false,
      signingPublicKey: "4b".repeat(32),
      keyAgreementPublicKey: "4c".repeat(32),
      enrollmentRef: "4d".repeat(16),
    };
    const current: ControlLogState = {
      vaultId: ancV1BytesToHex(bindingIds.vault),
      sequence: base.sequence,
      headHash: ancV1BytesToHex(base.head),
      membershipHash: ancV1BytesToHex(base.membership),
      signedAt: "2024-07-18T10:00:00.000Z",
      activeMembers: [...commit.activeMembers, removedMember].sort(
        (left, right) => left.endpointId.localeCompare(right.endpointId),
      ),
      removedEndpointIds: [],
      epoch: base.epoch,
      recoveryGeneration: base.recoveryGeneration,
      recoveryId: ancV1BytesToHex(ids.recovery),
      recoverySigningPublicKey: ancV1BytesToHex(base.recoverySigningPublicKey),
      recoveryKeyAgreementPublicKey: ancV1BytesToHex(
        material.recoveryAgreementPublicKey,
      ),
      recoveryWrapHash: ancV1BytesToHex(new Uint8Array(32).fill(0x68)),
      freshnessMode: "endpoint_witnessed",
    };
    await verifyAncV1RecoveryWrapRotation(wrap, { commit, entry, current });
    const reduced = await verifyAndReduceControlLogEntry({
      current,
      entry,
      verifyRecoveryWrapRotation: async (binding) => {
        await verifyAncV1RecoveryWrapRotation(wrap, binding);
        return true;
      },
    });
    if (
      reduced.state.sequence !== entry.sequence ||
      reduced.state.activeMembers.some(
        (member) => member.endpointId === removedMember.endpointId,
      )
    )
      return reject("spool.binding.substitution");
  } catch {
    return reject("spool.binding.substitution");
  }
  return { ok: true };
}

async function bindingStatus(
  recordBytes: Uint8Array,
  spoolBytes: Uint8Array,
  material: Awaited<ReturnType<typeof materials>>,
  alternateMaterial?: Awaited<ReturnType<typeof materials>>,
): Promise<Status> {
  const recordView = new DataView(
    recordBytes.buffer,
    recordBytes.byteOffset,
    recordBytes.byteLength,
  );
  if (recordBytes[10] !== material.role)
    return reject("record.binding.substitution");
  const decrypted = await decryptSpool(spoolBytes, material);
  if (!decrypted.ok) {
    if (alternateMaterial) {
      const alternate = await decryptSpool(spoolBytes, alternateMaterial);
      if (alternate.ok) {
        const status = await spoolStatus(alternate.inner, alternateMaterial);
        alternate.inner.fill(0);
        if (status.ok) return reject("spool.binding.substitution");
      }
    }
    return reject(decrypted.category);
  }
  const inner = decrypted.inner;
  const innerStatus = await spoolStatus(inner, material);
  if (!innerStatus.ok) return innerStatus;
  const spoolView = new DataView(
    inner.buffer,
    inner.byteOffset,
    inner.byteLength,
  );
  if (
    !equal(recordBytes.slice(24, 40), spoolBytes.slice(20, 36)) ||
    !equal(recordBytes.slice(56, 72), spoolBytes.slice(36, 52))
  )
    return reject("record.binding.substitution");
  if (
    u64(recordView, 392) !== u64(spoolView, 12) ||
    u64(recordView, 400) !== u64(spoolView, 20)
  )
    return reject("binding.record_spool_length");
  if (
    !equal(
      recordBytes.slice(408, 440),
      await hash(SPOOL_FRAME_DIGEST_DOMAIN, spoolBytes),
    )
  )
    return reject("binding.record_spool_digest");
  inner.fill(0);
  return { ok: true };
}

async function checksumRecord(bytes: Uint8Array) {
  if (bytes.length === 512)
    bytes.set(await hash(RECORD_DOMAIN, bytes.slice(0, 480)), 480);
}
async function checksumSpool(bytes: Uint8Array) {
  if (bytes.length >= 156)
    bytes.set(await hash(SPOOL_DOMAIN, bytes.slice(0, -32)), bytes.length - 32);
}

interface Checkpoint {
  vaultIdHex: string;
  endpointIdHex: string;
  ceremonyIdHex: string;
  baseCustodyGeneration: number;
  baseFrameDigestHex: string;
  baseSequence: number;
  baseHeadHex: string;
  baseMembershipHex: string;
  baseEpoch: number;
  baseRecoveryGeneration: number;
  role: 1 | 2;
  unattended: 0 | 1;
  signingPublicKeyHex: string;
  agreementPublicKeyHex: string;
  enrollmentRefHex: string;
  pendingEpoch: number;
  transcriptHex: string;
  recoveryAgreementPublicKeyHex: string;
}

function checkpointMatches(
  recordBytes: Uint8Array,
  checkpoint: Checkpoint,
  observedRecoveryAgreementPublicKeyHex?: string,
) {
  const view = new DataView(
    recordBytes.buffer,
    recordBytes.byteOffset,
    recordBytes.byteLength,
  );
  const phase = recordBytes[8]!;
  return (
    ancV1BytesToHex(recordBytes.slice(24, 40)) === checkpoint.vaultIdHex &&
    ancV1BytesToHex(recordBytes.slice(40, 56)) === checkpoint.endpointIdHex &&
    ancV1BytesToHex(recordBytes.slice(56, 72)) === checkpoint.ceremonyIdHex &&
    u64(view, 72) === checkpoint.baseCustodyGeneration &&
    ancV1BytesToHex(recordBytes.slice(80, 112)) ===
      checkpoint.baseFrameDigestHex &&
    u64(view, 112) === checkpoint.baseSequence &&
    ancV1BytesToHex(recordBytes.slice(120, 152)) === checkpoint.baseHeadHex &&
    ancV1BytesToHex(recordBytes.slice(152, 184)) ===
      checkpoint.baseMembershipHex &&
    u64(view, 184) === checkpoint.baseEpoch &&
    u64(view, 192) === checkpoint.baseRecoveryGeneration &&
    recordBytes[10] === checkpoint.role &&
    recordBytes[11] === checkpoint.unattended &&
    ancV1BytesToHex(recordBytes.slice(200, 232)) ===
      checkpoint.signingPublicKeyHex &&
    ancV1BytesToHex(recordBytes.slice(232, 264)) ===
      checkpoint.agreementPublicKeyHex &&
    ancV1BytesToHex(recordBytes.slice(264, 280)) ===
      checkpoint.enrollmentRefHex &&
    (phase === 6 || u64(view, 280) === checkpoint.pendingEpoch) &&
    (phase < 4 ||
      ancV1BytesToHex(recordBytes.slice(360, 392)) ===
        checkpoint.transcriptHex) &&
    (phase < 4 ||
      observedRecoveryAgreementPublicKeyHex ===
        checkpoint.recoveryAgreementPublicKeyHex)
  );
}

interface OfficialRereadTuple {
  custodyGeneration: number;
  frameDigestHex: string;
  sequence: number;
  headHex: string;
  membershipHex: string;
  epoch: number;
  recoveryGeneration: number;
  vaultIdHex: string;
  endpointIdHex: string;
  role: 1 | 2;
  unattended: 0 | 1;
  signingPublicKeyHex: string;
  agreementPublicKeyHex: string;
  enrollmentRefHex: string;
  activeEpochKey: Uint8Array;
}

async function verifiedReplayFromSpool(
  encryptedSpool: Uint8Array,
  material: Awaited<ReturnType<typeof materials>>,
) {
  const decrypted = await decryptSpool(encryptedSpool, material);
  if (!decrypted.ok || !(await spoolStatus(decrypted.inner, material)).ok)
    return null;
  const view = new DataView(
    decrypted.inner.buffer,
    decrypted.inner.byteOffset,
    decrypted.inner.byteLength,
  );
  const signedLength = u64(view, 12) as number;
  const wrapLength = u64(view, 20) as number;
  const signed = decrypted.inner.slice(124, 124 + signedLength);
  const wrap = decrypted.inner.slice(
    124 + signedLength,
    124 + signedLength + wrapLength,
  );
  const entry = decodeSignedControlLogEntry(signed);
  const commit = entry.innerEnvelope;
  if (commit.type !== "membership_commit") return null;
  const removedMember: ControlLogMember = {
    endpointId: ancV1BytesToHex(ids.removedEndpoint),
    role: "endpoint",
    unattended: false,
    signingPublicKey: "4b".repeat(32),
    keyAgreementPublicKey: "4c".repeat(32),
    enrollmentRef: "4d".repeat(16),
  };
  const current: ControlLogState = {
    vaultId: ancV1BytesToHex(ids.vault),
    sequence: base.sequence,
    headHash: ancV1BytesToHex(base.head),
    membershipHash: ancV1BytesToHex(base.membership),
    signedAt: "2024-07-18T10:00:00.000Z",
    activeMembers: [...commit.activeMembers, removedMember].sort(
      (left, right) => left.endpointId.localeCompare(right.endpointId),
    ),
    removedEndpointIds: [],
    epoch: base.epoch,
    recoveryGeneration: base.recoveryGeneration,
    recoveryId: ancV1BytesToHex(ids.recovery),
    recoverySigningPublicKey: ancV1BytesToHex(base.recoverySigningPublicKey),
    recoveryKeyAgreementPublicKey: ancV1BytesToHex(
      material.recoveryAgreementPublicKey,
    ),
    recoveryWrapHash: ancV1BytesToHex(new Uint8Array(32).fill(0x68)),
    freshnessMode: "endpoint_witnessed",
  };
  const reduced = await verifyAndReduceControlLogEntry({
    current,
    entry,
    verifyRecoveryWrapRotation: async (binding) => {
      await verifyAncV1RecoveryWrapRotation(wrap, binding);
      return true;
    },
  });
  const replay = {
    sequence: reduced.state.sequence,
    headHex: reduced.state.headHash,
    membershipHex: reduced.state.membershipHash,
    epoch: reduced.state.epoch,
    recoveryGeneration: reduced.state.recoveryGeneration,
  };
  decrypted.inner.fill(0);
  signed.fill(0);
  wrap.fill(0);
  return replay;
}

async function transitionAllowed(input: {
  from: Uint8Array;
  to: Uint8Array;
  actualOfficialReread: OfficialRereadTuple;
  officialCasResult: {
    custodyGeneration: number;
    frameDigestHex: string;
    activeEpochKey: Uint8Array;
  };
  encryptedSpool: Uint8Array;
  artifactMaterial: Awaited<ReturnType<typeof materials>>;
  hostedAckDurable: boolean;
  spoolPresent: boolean;
  spoolDeletedAndDirectoryFsynced: boolean;
  nextAuthoritativeBase: Checkpoint | null;
  nextRecoveryAgreementPublicKeyHex: string | null;
  priorPendingKey: Uint8Array;
}) {
  if (
    !(await recordStatus(input.from)).ok ||
    !(await recordStatus(input.to)).ok
  )
    return false;
  const fromView = new DataView(
    input.from.buffer,
    input.from.byteOffset,
    input.from.byteLength,
  );
  const toView = new DataView(
    input.to.buffer,
    input.to.byteOffset,
    input.to.byteLength,
  );
  const fromPhase = input.from[8]!;
  const toPhase = input.to[8]!;
  const samePreparation =
    u64(fromView, 16) === u64(toView, 16) &&
    equal(input.from.slice(24, 288), input.to.slice(24, 288));
  const samePendingKey = equal(
    input.from.slice(288, 320),
    input.to.slice(288, 320),
  );
  const actual = input.actualOfficialReread;
  const replay =
    fromPhase === 4
      ? await verifiedReplayFromSpool(
          input.encryptedSpool,
          input.artifactMaterial,
        )
      : null;
  const exactSpoolBinding =
    fromPhase !== 4 ||
    (
      await bindingStatus(
        input.from,
        input.encryptedSpool,
        input.artifactMaterial,
      )
    ).ok;
  const officialMatchesPreparation =
    replay !== null &&
    actual.custodyGeneration === (u64(fromView, 72) as number) + 1 &&
    actual.custodyGeneration === input.officialCasResult.custodyGeneration &&
    actual.frameDigestHex === input.officialCasResult.frameDigestHex &&
    actual.sequence === replay.sequence &&
    actual.headHex === replay.headHex &&
    actual.membershipHex === replay.membershipHex &&
    actual.membershipHex === ancV1BytesToHex(input.from.slice(360, 392)) &&
    actual.epoch === replay.epoch &&
    actual.epoch === u64(fromView, 280) &&
    actual.recoveryGeneration === replay.recoveryGeneration &&
    actual.recoveryGeneration === u64(fromView, 192) &&
    actual.vaultIdHex === ancV1BytesToHex(input.from.slice(24, 40)) &&
    actual.endpointIdHex === ancV1BytesToHex(input.from.slice(40, 56)) &&
    actual.role === input.from[10] &&
    actual.unattended === input.from[11] &&
    actual.signingPublicKeyHex ===
      ancV1BytesToHex(input.from.slice(200, 232)) &&
    actual.agreementPublicKeyHex ===
      ancV1BytesToHex(input.from.slice(232, 264)) &&
    actual.enrollmentRefHex === ancV1BytesToHex(input.from.slice(264, 280)) &&
    !/^0+$/.test(actual.frameDigestHex) &&
    equal(actual.activeEpochKey, input.from.slice(288, 320)) &&
    equal(actual.activeEpochKey, input.officialCasResult.activeEpochKey);
  if (fromPhase >= 1 && fromPhase <= 3)
    return toPhase === fromPhase + 1 && samePreparation && samePendingKey;
  if (fromPhase === 4)
    return (
      toPhase === 5 &&
      samePreparation &&
      exactSpoolBinding &&
      officialMatchesPreparation &&
      input.spoolPresent &&
      zero(input.to.slice(288, 320)) &&
      equal(input.from.slice(320, 440), input.to.slice(320, 440))
    );
  if (fromPhase === 5)
    return (
      toPhase === 6 &&
      u64(fromView, 16) === u64(toView, 16) &&
      equal(input.from.slice(24, 280), input.to.slice(24, 280)) &&
      input.hostedAckDurable &&
      !input.spoolPresent &&
      input.spoolDeletedAndDirectoryFsynced &&
      zero(input.to.slice(280, 440))
    );
  if (fromPhase === 6)
    return (
      toPhase === 1 &&
      u64(toView, 16) === (u64(fromView, 16) as number) + 1 &&
      input.nextAuthoritativeBase !== null &&
      checkpointMatches(
        input.to,
        input.nextAuthoritativeBase,
        input.nextRecoveryAgreementPublicKeyHex ?? undefined,
      ) &&
      !equal(input.from.slice(56, 72), input.to.slice(56, 72)) &&
      !zero(input.to.slice(288, 320)) &&
      !equal(input.to.slice(288, 320), input.priorPendingKey)
    );
  return false;
}

async function mutateBytes(input: Uint8Array, mutation: Negative["mutation"]) {
  let output = input.slice();
  if (mutation.op === "truncate") output = output.slice(0, -mutation.bytes);
  else if (mutation.op === "append")
    output = concat(output, ancV1HexToBytes(mutation.hex));
  else if (mutation.op === "flip") {
    const offset =
      mutation.offset < 0 ? output.length + mutation.offset : mutation.offset;
    output[offset] ^= 1;
  } else if (mutation.op === "zero")
    output.fill(0, mutation.offset, mutation.offset + mutation.length);
  else if (mutation.op === "set_u8") output[mutation.offset] = mutation.value;
  else if (mutation.op === "set_u16")
    u16(new DataView(output.buffer), mutation.offset, mutation.value);
  else if (mutation.op === "set_u64")
    u64(new DataView(output.buffer), mutation.offset, mutation.value);
  return output;
}

async function provenance() {
  return {
    protocolBaseCommit: PROTOCOL_BASE_COMMIT,
    sources: await Promise.all(
      ANC_V1_NATIVE_ROTATION_PREPARATION_SOURCE_PATHS.map(async (path) => ({
        path,
        sha256: createHash("sha256")
          .update(await readFile(`${ROOT}${path}`))
          .digest("hex"),
      })),
    ),
  };
}

async function corpus() {
  return corpusSchema.parse(JSON.parse(await readFile(FIXTURE, "utf8")));
}

async function parseMaterialStream(input: Uint8Array) {
  if (input.length < 184) throw new Error("truncation");
  if (
    new TextDecoder().decode(input.slice(0, 8)) !==
    ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_MAGIC
  )
    throw new Error("magic");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (
    view.getUint16(8, true) !==
    ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_VERSION
  )
    throw new Error("version");
  if (view.getUint16(10, true) !== 0) throw new Error("flags");
  if (
    view.getUint32(12, true) !==
    ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_HEADER_BYTES
  )
    throw new Error("header length");
  const lengths = Array.from({ length: 5 }, (_, index) =>
    Number(view.getBigUint64(16 + index * 8, true)),
  );
  if (lengths.some((length) => !Number.isSafeInteger(length) || length <= 0))
    throw new Error("length");
  if (
    lengths[0] !== 32 ||
    lengths[1] !== 24 ||
    lengths[2]! > 65_536 ||
    lengths[3]! > 1_048_576 ||
    lengths[4]! >
      ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_ALTERNATE_OUTER_MAX_BYTES
  )
    throw new Error("length");
  const expected = 152 + lengths.reduce((sum, length) => sum + length, 0) + 32;
  if (input.length !== expected)
    throw new Error(input.length < expected ? "truncation" : "extra");
  const checksumDomain = new TextEncoder().encode(
    ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_CHECKSUM_DOMAIN.replace(
      "\\0",
      "\0",
    ),
  );
  if (!equal(await hash(checksumDomain, input.slice(0, -32)), input.slice(-32)))
    throw new Error("checksum");
  let offset = 152;
  const values = lengths.map((length) => {
    const value = input.slice(offset, offset + length);
    offset += length;
    return value;
  });
  return { lengths, values };
}

describe("anc/v1 native rotation-preparation vectors", () => {
  it("emits a strict stdout-only canonical material stream", async () => {
    const stream = new Uint8Array(
      execFileSync(
        "pnpm",
        [
          "--filter",
          "@agent-native/core",
          "exec",
          "tsx",
          "scripts/materialize-native-rotation-preparation-vectors.ts",
          "--ephemeral-material-stdout",
        ],
        {
          cwd: ROOT,
          maxBuffer: ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_MAX_BYTES,
        },
      ),
    );
    const parsed = await parseMaterialStream(stream);
    expect(parsed.lengths.slice(0, 2)).toEqual([32, 24]);
    const fixture = await corpus();
    for (const [index, expected] of [
      fixture.syntheticDerivation.commitments.pendingEpochKey,
      fixture.syntheticDerivation.commitments.spoolNonce,
      fixture.syntheticDerivation.commitments.signedEntry,
      fixture.syntheticDerivation.commitments.recoveryWrap,
    ].entries())
      expect(
        ancV1BytesToHex(await hash(new Uint8Array(), parsed.values[index]!)),
      ).toBe(expected);
    for (const [name, mutate, expected] of [
      [
        "magic",
        (bytes: Uint8Array) => {
          bytes[0] ^= 1;
          return bytes;
        },
        "magic",
      ],
      [
        "length",
        (bytes: Uint8Array) => {
          new DataView(bytes.buffer).setBigUint64(16, 33n, true);
          return bytes;
        },
        "length",
      ],
      [
        "alternate_outer_bound",
        (bytes: Uint8Array) => {
          new DataView(bytes.buffer).setBigUint64(
            48,
            BigInt(
              ANC_V1_NATIVE_ROTATION_PREPARATION_STREAM_ALTERNATE_OUTER_MAX_BYTES +
                1,
            ),
            true,
          );
          return bytes;
        },
        "length",
      ],
      [
        "checksum",
        (bytes: Uint8Array) => {
          bytes[bytes.length - 1] ^= 1;
          return bytes;
        },
        "checksum",
      ],
      [
        "truncation",
        (bytes: Uint8Array) => bytes.subarray(0, -1),
        "truncation",
      ],
      [
        "extra",
        (bytes: Uint8Array) => concat(bytes, Uint8Array.of(0)),
        "extra",
      ],
    ] as const) {
      const changed = stream.slice();
      const result = mutate(changed);
      await expect(parseMaterialStream(result)).rejects.toThrow(expected);
    }
    for (const value of parsed.values) value.fill(0);
    stream.fill(0);
    const brokenPipeExit = await new Promise<number | null>(
      (resolve, reject) => {
        const child = spawn(
          `${ROOT}node_modules/.bin/tsx`,
          [
            `${ROOT}packages/core/scripts/materialize-native-rotation-preparation-vectors.ts`,
            "--ephemeral-material-stdout",
          ],
          {
            cwd: ROOT,
            env: { ...process.env, ANC_ROTATION_STREAM_TEST_DELAY: "1" },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        child.once("error", reject);
        child.stdout.destroy();
        child.once("close", (code) => resolve(code));
      },
    );
    expect(brokenPipeExit).not.toBe(0);
  });

  it("is strict, source-anchored, generated, and contains commitments only", async () => {
    const fixture = await corpus();
    expect(fixture).toEqual(
      await buildAncV1NativeRotationPreparationVectors(await provenance()),
    );
    expect(corpusSchema.safeParse({ ...fixture, unknown: true }).success).toBe(
      false,
    );
    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toContain("recordHex");
    expect(serialized).not.toContain("pendingKeyHex");
    expect(serialized).not.toContain("spoolHex");
    expect(serialized).not.toContain("signedEntryHex");
    expect(serialized).not.toContain("recoveryWrapHex");
    const endpointMaterial = await materials();
    const brokerMaterial = await materials(2);
    const innerSpool = await spool(endpointMaterial);
    const endpointOuter = await encryptedSpool(endpointMaterial);
    const brokerOuter = await encryptedSpool(brokerMaterial);
    for (const bytes of [
      endpointMaterial.pendingKey,
      endpointMaterial.signedEntry,
      endpointMaterial.recoveryWrap,
      endpointMaterial.spoolNonce,
      innerSpool,
      endpointOuter,
      brokerOuter,
    ])
      expect(serialized).not.toContain(ancV1BytesToHex(bytes));
    for (const shape of fixture.positiveCases) {
      const material = shape.role === 1 ? endpointMaterial : brokerMaterial;
      const bytes = await record(shape, material);
      expect(serialized, shape.name).not.toContain(ancV1BytesToHex(bytes));
      bytes.fill(0);
    }
    for (const value of [
      ...Object.values(endpointMaterial),
      ...Object.values(brokerMaterial),
      innerSpool,
      endpointOuter,
      brokerOuter,
    ])
      if (value instanceof Uint8Array) value.fill(0);
  });

  it("accepts every endpoint and broker phase without an official active key", async () => {
    const fixture = await corpus();
    const material = await materials();
    const brokerMaterial = await materials(2);
    expect(await hash(new Uint8Array(), material.pendingKey)).toEqual(
      ancV1HexToBytes(fixture.syntheticDerivation.commitments.pendingEpochKey),
    );
    expect(brokerMaterial.signedEntry).toEqual(material.signedEntry);
    for (const shape of fixture.positiveCases) {
      const shapeMaterial = shape.role === 1 ? material : brokerMaterial;
      const bytes = await record(shape, shapeMaterial);
      expect(await recordStatus(bytes), shape.name).toEqual({ ok: true });
      expect(shape.recordCommitmentHex, shape.name).toBe(
        ancV1BytesToHex(await hash(new Uint8Array(), bytes)),
      );
      expect(shape.recordChecksumHex, shape.name).toBe(
        ancV1BytesToHex(bytes.slice(480)),
      );
      expect(shape.encryptedOuterFrame, shape.name).toBe(
        shape.phase === 4 || shape.phase === 5 ? "shared_primary" : null,
      );
      expect(zero(bytes.slice(288, 320)), shape.name).toBe(shape.phase >= 5);
      if (shape.phase < 5)
        expect(bytes.slice(288, 320)).toEqual(shapeMaterial.pendingKey);
      // This separate namespace has exactly one epoch-key slot: pending N+1.
      expect(fixture.recordLayout.pendingKeyOffset).toBe(288);
      expect(fixture.recordLayout.pendingKeyLength).toBe(32);
      bytes.fill(0);
    }
    const innerSpool = await spool(material);
    expect(await spoolStatus(innerSpool, material)).toEqual({ ok: true });
    const artifactSpool = await encryptedSpool(material);
    expect(fixture.wireCommitments.innerSpool).toEqual({
      bytes: innerSpool.length,
      commitmentHex: ancV1BytesToHex(await hash(new Uint8Array(), innerSpool)),
      checksumHex: ancV1BytesToHex(innerSpool.slice(-32)),
      signedEntryBytes: material.signedEntry.length,
      recoveryWrapBytes: material.recoveryWrap.length,
    });
    const brokerOuterForCommitment = await encryptedSpool(brokerMaterial);
    expect(brokerOuterForCommitment).toEqual(artifactSpool);
    const ephemeral = await buildEphemeralRotationPreparationStream();
    const parsedEphemeral = await parseMaterialStream(ephemeral.stream);
    const alternateMaterial = {
      ...material,
      bindingIds: {
        ...ids,
        vault: ancV1HexToBytes(
          fixture.wireCommitments.alternateSubstitutionOuterFrame.vaultIdHex,
        ),
        ceremony: ancV1HexToBytes(
          fixture.wireCommitments.alternateSubstitutionOuterFrame.ceremonyIdHex,
        ),
      },
    };
    const alternateOuter = parsedEphemeral.values[4]!;
    expect(fixture.wireCommitments.primaryOuterFrame).toEqual({
      name: "shared_primary",
      holderRoles: [1, 2],
      ...(await encryptedSpoolCommitments(artifactSpool, material)),
    });
    expect(fixture.wireCommitments.alternateSubstitutionOuterFrame).toEqual({
      name: "alternate_substitution",
      vaultIdHex: ancV1BytesToHex(alternateMaterial.bindingIds.vault),
      ceremonyIdHex: ancV1BytesToHex(alternateMaterial.bindingIds.ceremony),
      ...(await encryptedSpoolCommitments(alternateOuter, alternateMaterial)),
    });
    expect((await decryptSpool(artifactSpool, material)).ok).toBe(true);
    const awaitingShape = fixture.positiveCases.find(
      ({ name }) => name === "endpoint_awaiting_control_commit",
    )!;
    const awaiting = await record(awaitingShape, material);
    expect(await bindingStatus(awaiting, artifactSpool, material)).toEqual({
      ok: true,
    });
    const brokerSpool = await encryptedSpool(brokerMaterial);
    const brokerAwaiting = await record(
      fixture.positiveCases.find(
        ({ name }) => name === "broker_awaiting_control_commit",
      )!,
      brokerMaterial,
    );
    expect(
      await bindingStatus(brokerAwaiting, brokerSpool, brokerMaterial),
    ).toEqual({ ok: true });
    awaiting.fill(0);
    artifactSpool.fill(0);
    innerSpool.fill(0);
    brokerSpool.fill(0);
    brokerOuterForCommitment.fill(0);
    alternateOuter.fill(0);
    ephemeral.stream.fill(0);
    for (const bytes of Object.values(ephemeral.material.files)) bytes.fill(0);
    brokerAwaiting.fill(0);
    material.pendingKey.fill(0);
    material.signedEntry.fill(0);
    material.recoveryWrap.fill(0);
    material.spoolNonce.fill(0);
    for (const value of Object.values(brokerMaterial))
      if (value instanceof Uint8Array) value.fill(0);
  });

  it("binds preparation to the exact official checkpoint and local identity", async () => {
    const fixture = await corpus();
    const material = await materials();
    const prepared = await record(
      fixture.positiveCases.find(({ name }) => name === "endpoint_prepared")!,
      material,
    );
    expect(checkpointMatches(prepared, fixture.externalCheckpoint)).toBe(true);
    for (const offset of [
      24, 40, 56, 72, 80, 112, 120, 152, 184, 192, 200, 232, 264,
    ]) {
      const substituted = prepared.slice();
      substituted[offset] ^= 1;
      expect(
        checkpointMatches(substituted, fixture.externalCheckpoint),
        String(offset),
      ).toBe(false);
      substituted.fill(0);
    }
    const brokerMaterial = await materials(2);
    const brokerPrepared = await record(
      fixture.positiveCases.find(({ name }) => name === "broker_prepared")!,
      brokerMaterial,
    );
    expect(checkpointMatches(brokerPrepared, fixture.brokerCheckpoint)).toBe(
      true,
    );
    const awaiting = await record(
      fixture.positiveCases.find(
        ({ name }) => name === "endpoint_awaiting_control_commit",
      )!,
      material,
    );
    expect(
      checkpointMatches(
        awaiting,
        fixture.externalCheckpoint,
        ancV1BytesToHex(material.recoveryAgreementPublicKey),
      ),
    ).toBe(true);
    for (const [checkpoint, recoveryKey] of [
      [
        { ...fixture.externalCheckpoint, pendingEpoch: 6 },
        material.recoveryAgreementPublicKey,
      ],
      [
        { ...fixture.externalCheckpoint, transcriptHex: "00".repeat(32) },
        material.recoveryAgreementPublicKey,
      ],
      [fixture.externalCheckpoint, new Uint8Array(32).fill(0xff)],
    ] as const)
      expect(
        checkpointMatches(awaiting, checkpoint, ancV1BytesToHex(recoveryKey)),
      ).toBe(false);
    prepared.fill(0);
    brokerPrepared.fill(0);
    awaiting.fill(0);
    for (const value of Object.values(material))
      if (value instanceof Uint8Array) value.fill(0);
    for (const value of Object.values(brokerMaterial))
      if (value instanceof Uint8Array) value.fill(0);
  });

  it("freezes the complete lifecycle matrix and external durability gates", async () => {
    const fixture = await corpus();
    const material = await materials();
    const endpointShapes = fixture.positiveCases.filter(
      ({ role }) => role === 1,
    );
    const records = new Map<number, Uint8Array>();
    for (const shape of endpointShapes)
      records.set(shape.phase, await record(shape, material));
    const freshPrepared = records.get(1)!.slice();
    u64(new DataView(freshPrepared.buffer), 16, 8);
    freshPrepared[56] ^= 1;
    const outer = await encryptedSpool(material);
    expect((await decryptSpool(outer, material)).ok).toBe(true);
    const wrongKey = material.pendingKey.slice();
    wrongKey[0] ^= 1;
    const wrongMaterial = { ...material, pendingKey: wrongKey };
    expect((await decryptSpool(outer, wrongMaterial)).ok).toBe(false);
    const expectedOfficialReread: OfficialRereadTuple = {
      custodyGeneration: 12,
      frameDigestHex: "bb".repeat(32),
      sequence: 20,
      headHex: ancV1BytesToHex(
        await ancV1Hash("log-entry", material.signedEntry),
      ),
      membershipHex: ancV1BytesToHex(material.transcript),
      epoch: 5,
      recoveryGeneration: 2,
      vaultIdHex: fixture.externalCheckpoint.vaultIdHex,
      endpointIdHex: fixture.externalCheckpoint.endpointIdHex,
      role: 1,
      unattended: 0,
      signingPublicKeyHex: fixture.externalCheckpoint.signingPublicKeyHex,
      agreementPublicKeyHex: fixture.externalCheckpoint.agreementPublicKeyHex,
      enrollmentRefHex: fixture.externalCheckpoint.enrollmentRefHex,
      activeEpochKey: material.pendingKey.slice(),
    };
    const actualOfficialReread: OfficialRereadTuple = {
      ...expectedOfficialReread,
      activeEpochKey: expectedOfficialReread.activeEpochKey.slice(),
    };
    const freshView = new DataView(freshPrepared.buffer);
    u64(freshView, 72, actualOfficialReread.custodyGeneration);
    freshPrepared.set(ancV1HexToBytes(actualOfficialReread.frameDigestHex), 80);
    u64(freshView, 112, actualOfficialReread.sequence);
    freshPrepared.set(ancV1HexToBytes(actualOfficialReread.headHex), 120);
    freshPrepared.set(ancV1HexToBytes(actualOfficialReread.membershipHex), 152);
    u64(freshView, 184, actualOfficialReread.epoch);
    u64(freshView, 192, actualOfficialReread.recoveryGeneration);
    u64(freshView, 280, actualOfficialReread.epoch + 1);
    freshPrepared.set(wrongKey, 288);
    await checksumRecord(freshPrepared);
    const nextAuthoritativeBase = {
      ...fixture.externalCheckpoint,
      ceremonyIdHex: ancV1BytesToHex(freshPrepared.slice(56, 72)),
      baseCustodyGeneration: actualOfficialReread.custodyGeneration,
      baseFrameDigestHex: actualOfficialReread.frameDigestHex,
      baseSequence: actualOfficialReread.sequence,
      baseHeadHex: actualOfficialReread.headHex,
      baseMembershipHex: actualOfficialReread.membershipHex,
      baseEpoch: actualOfficialReread.epoch,
      baseRecoveryGeneration: actualOfficialReread.recoveryGeneration,
      pendingEpoch: actualOfficialReread.epoch + 1,
    };
    const transitionContext = {
      actualOfficialReread,
      officialCasResult: {
        custodyGeneration: actualOfficialReread.custodyGeneration,
        frameDigestHex: actualOfficialReread.frameDigestHex,
        activeEpochKey: actualOfficialReread.activeEpochKey,
      },
      encryptedSpool: outer,
      artifactMaterial: material,
      hostedAckDurable: true,
      spoolPresent: true,
      spoolDeletedAndDirectoryFsynced: true,
      nextAuthoritativeBase,
      nextRecoveryAgreementPublicKeyHex: ancV1BytesToHex(
        material.recoveryAgreementPublicKey,
      ),
      priorPendingKey: material.pendingKey,
    };
    for (const testCase of fixture.transitionCases) {
      const from = records.get(testCase.from)!;
      const to =
        testCase.from === 6 && testCase.to === 1
          ? freshPrepared
          : records.get(testCase.to)!;
      const accepted = await transitionAllowed({
        from,
        to,
        ...transitionContext,
        spoolPresent: testCase.from !== 5,
      });
      expect(accepted, testCase.name).toBe(
        testCase.expectedStatus === "accept",
      );
    }
    const awaiting = records.get(4)!;
    const consumed = records.get(5)!;
    const wrongActualKey = {
      ...actualOfficialReread,
      activeEpochKey: wrongKey,
    };
    for (const overrides of [
      {
        actualOfficialReread: {
          ...actualOfficialReread,
          frameDigestHex: "cc".repeat(32),
        },
      },
      { actualOfficialReread: wrongActualKey },
      { spoolPresent: false },
    ])
      expect(
        await transitionAllowed({
          from: awaiting,
          to: consumed,
          ...transitionContext,
          hostedAckDurable: false,
          spoolPresent: true,
          spoolDeletedAndDirectoryFsynced: false,
          ...overrides,
        }),
      ).toBe(false);
    for (const offset of [392, 408]) {
      const substitutedAwaiting = awaiting.slice();
      substitutedAwaiting[offset] ^= 1;
      await checksumRecord(substitutedAwaiting);
      expect((await recordStatus(substitutedAwaiting)).ok).toBe(true);
      expect(
        await transitionAllowed({
          from: substitutedAwaiting,
          to: consumed,
          ...transitionContext,
        }),
      ).toBe(false);
      substitutedAwaiting.fill(0);
    }
    const cleaned = records.get(6)!;
    for (const overrides of [
      { hostedAckDurable: false },
      { spoolPresent: true },
      { spoolDeletedAndDirectoryFsynced: false },
    ])
      expect(
        await transitionAllowed({
          from: consumed,
          to: cleaned,
          ...transitionContext,
          spoolPresent: false,
          ...overrides,
        }),
      ).toBe(false);
    const swappedTombstone = cleaned.slice();
    swappedTombstone[24] ^= 1;
    await checksumRecord(swappedTombstone);
    expect((await recordStatus(swappedTombstone)).ok).toBe(true);
    expect(
      await transitionAllowed({
        from: consumed,
        to: swappedTombstone,
        ...transitionContext,
        spoolPresent: false,
      }),
    ).toBe(false);
    swappedTombstone.fill(0);
    const corruptTarget = consumed.slice();
    corruptTarget[0] ^= 1;
    expect(
      await transitionAllowed({
        from: awaiting,
        to: corruptTarget,
        ...transitionContext,
      }),
    ).toBe(false);
    corruptTarget.fill(0);
    for (const value of records.values()) value.fill(0);
    freshPrepared.fill(0);
    outer.fill(0);
    wrongKey.fill(0);
    expectedOfficialReread.activeEpochKey.fill(0);
    actualOfficialReread.activeEpochKey.fill(0);
    for (const value of Object.values(material))
      if (value instanceof Uint8Array) value.fill(0);
  });

  it("rejects every frozen wire, state, checksum, and binding mutation", async () => {
    const fixture = await corpus();
    const material = await materials();
    const phase1 = await record(fixture.positiveCases[0]!, material);
    const phase4 = await record(
      fixture.positiveCases.find(
        ({ name }) => name === "endpoint_awaiting_control_commit",
      )!,
      material,
    );
    const phase5 = await record(
      fixture.positiveCases.find(({ name }) => name === "endpoint_consumed")!,
      material,
    );
    const phase6 = await record(
      fixture.positiveCases.find(({ name }) => name === "endpoint_cleaned")!,
      material,
    );
    const innerSpool = await spool(material);
    const artifactSpool = await encryptedSpool(material);
    const ephemeral = await buildEphemeralRotationPreparationStream();
    const parsedEphemeral = await parseMaterialStream(ephemeral.stream);
    const alternateMaterial = {
      ...material,
      bindingIds: {
        ...ids,
        vault: ancV1HexToBytes(
          fixture.wireCommitments.alternateSubstitutionOuterFrame.vaultIdHex,
        ),
        ceremony: ancV1HexToBytes(
          fixture.wireCommitments.alternateSubstitutionOuterFrame.ceremonyIdHex,
        ),
      },
    };
    const alternateSpool = parsedEphemeral.values[4]!;
    expect(ancV1BytesToHex(await hash(new Uint8Array(), alternateSpool))).toBe(
      fixture.wireCommitments.alternateSubstitutionOuterFrame
        .outerFrameCommitmentHex,
    );
    expect(
      (await encryptedSpoolCommitments(alternateSpool, alternateMaterial))
        .derivedKeyCommitmentHex,
    ).toBe(
      fixture.wireCommitments.alternateSubstitutionOuterFrame
        .derivedKeyCommitmentHex,
    );
    const alternateDecrypted = await decryptSpool(
      alternateSpool,
      alternateMaterial,
    );
    expect(alternateDecrypted.ok).toBe(true);
    if (alternateDecrypted.ok)
      expect(
        await spoolStatus(alternateDecrypted.inner, alternateMaterial),
      ).toEqual({ ok: true });
    expect(
      await bindingStatus(phase4, alternateSpool, material, alternateMaterial),
    ).toEqual({ ok: false, category: "spool.binding.substitution" });
    for (const testCase of fixture.negativeCases) {
      let changedRecord =
        testCase.execution.baselineRecord === "endpoint_prepared"
          ? phase1.slice()
          : testCase.execution.baselineRecord === "endpoint_consumed"
            ? phase5.slice()
            : testCase.execution.baselineRecord === "endpoint_cleaned"
              ? phase6.slice()
              : phase4.slice();
      let changedSpool =
        testCase.execution.baselineSpool === "inner"
          ? innerSpool.slice()
          : testCase.execution.baselineSpool === "alternate_substitution_outer"
            ? alternateSpool.slice()
            : artifactSpool.slice();
      if (testCase.execution.applyTo === "record")
        changedRecord = await mutateBytes(
          changedRecord,
          testCase.execution.effectiveMutation,
        );
      else
        changedSpool = await mutateBytes(
          changedSpool,
          testCase.execution.effectiveMutation,
        );

      if (testCase.execution.integrityRepair === "record_checksum")
        await checksumRecord(changedRecord);
      if (testCase.execution.integrityRepair === "inner_spool_checksum")
        await checksumSpool(changedSpool);
      if (testCase.execution.integrityRepair === "outer_spool_checksum")
        changedSpool.set(
          await hash(SPOOL_OUTER_CHECKSUM_DOMAIN, changedSpool.slice(0, -32)),
          changedSpool.length - 32,
        );

      let status: Status;
      if (testCase.target === "record")
        status = await recordStatus(changedRecord);
      else if (testCase.target === "spool")
        status = await spoolStatus(changedSpool, material);
      else {
        if (testCase.category === "record.transition.generation") {
          expect(testCase.execution.transition).toEqual({
            from: "endpoint_cleaned",
            to: "endpoint_prepared",
            expectedStatus: "reject",
          });
          expect(
            await transitionAllowed({
              from: phase6,
              to: changedRecord,
              actualOfficialReread: {} as OfficialRereadTuple,
              officialCasResult: {} as OfficialRereadTuple,
              encryptedSpool: artifactSpool,
              artifactMaterial: material,
              hostedAckDurable: true,
              spoolPresent: false,
              spoolDeletedAndDirectoryFsynced: true,
              nextAuthoritativeBase: fixture.externalCheckpoint,
              nextRecoveryAgreementPublicKeyHex:
                fixture.externalCheckpoint.recoveryAgreementPublicKeyHex,
              priorPendingKey: material.pendingKey,
            }),
          ).toBe(false);
          changedRecord.fill(0);
          changedSpool.fill(0);
          continue;
        }
        const recordWire = await recordStatus(changedRecord);
        if (testCase.category.startsWith("spool.encryption")) {
          const outerStatus = await decryptSpool(changedSpool, material);
          status = outerStatus.ok ? { ok: true } : reject(outerStatus.category);
          expect(status, testCase.name).toEqual({
            ok: false,
            category: testCase.category,
          });
          changedRecord.fill(0);
          changedSpool.fill(0);
          continue;
        }
        const spoolWire = await decryptSpool(changedSpool, material);
        status = !recordWire.ok
          ? recordWire
          : !spoolWire.ok
            ? await bindingStatus(
                changedRecord,
                changedSpool,
                material,
                testCase.execution.baselineSpool ===
                  "alternate_substitution_outer"
                  ? alternateMaterial
                  : undefined,
              )
            : await bindingStatus(changedRecord, changedSpool, material);
        if (spoolWire.ok) spoolWire.inner.fill(0);
      }
      expect(status, testCase.name).toEqual({
        ok: false,
        category: testCase.category,
      });
      changedRecord.fill(0);
      changedSpool.fill(0);
    }
    phase1.fill(0);
    phase4.fill(0);
    phase5.fill(0);
    phase6.fill(0);
    artifactSpool.fill(0);
    alternateSpool.fill(0);
    ephemeral.stream.fill(0);
    for (const bytes of Object.values(ephemeral.material.files)) bytes.fill(0);
    innerSpool.fill(0);
    material.pendingKey.fill(0);
    material.signedEntry.fill(0);
    material.recoveryWrap.fill(0);
    material.spoolNonce.fill(0);
  });

  it("pins all requested negative categories to at least one case", async () => {
    const fixture = await corpus();
    const present = new Set(
      fixture.negativeCases.map(({ category: value }) => value),
    );
    for (const value of ANC_V1_NATIVE_ROTATION_PREPARATION_CATEGORIES)
      expect(present.has(value), value).toBe(true);
    expect(new Set(fixture.negativeCases.map(({ name }) => name))).toHaveLength(
      fixture.negativeCases.length,
    );
    expect(ancV1BytesToHex(RECORD_DOMAIN)).toBe(
      "6167656e742d6e61746976652f707269766174652d7661756c742f726f746174696f6e2d7072657061726174696f6e2f636865636b73756d2f616e632d763100",
    );
    expect(ancV1BytesToHex(SPOOL_DOMAIN)).toBe(
      "6167656e742d6e61746976652f707269766174652d7661756c742f726f746174696f6e2d7072657061726174696f6e2d6172746966616374732f616e632d763100",
    );
  });
});

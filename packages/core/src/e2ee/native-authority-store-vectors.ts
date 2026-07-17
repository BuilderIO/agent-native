import sodium from "libsodium-wrappers-sumo";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import { protocolTimestampSchema } from "./contracts.js";
import type { ControlLogMember } from "./control-log.js";
import { E2EE_SUITE_ID } from "./suite.js";

export const ANC_V1_NATIVE_AUTHORITY_STORE_CORPUS_SCHEMA =
  "anc/v1-native-authority-store-vectors@1" as const;
export const ANC_V1_NATIVE_AUTHORITY_STORE_GENERATOR =
  "buildAncV1NativeAuthorityStoreVectors" as const;
export const ANC_V1_NATIVE_AUTHORITY_STORE_SOURCE_PATHS = [
  "packages/core/src/e2ee/native-authority-store-vectors.ts",
  "packages/core/src/e2ee/canonical.ts",
  "packages/core/src/e2ee/contracts.ts",
  "packages/core/src/e2ee/suite.ts",
] as const;

export interface AncV1NativeAuthorityStoreProvenance {
  protocolBaseCommit: string;
  sources: readonly {
    path: (typeof ANC_V1_NATIVE_AUTHORITY_STORE_SOURCE_PATHS)[number];
    sha256: string;
  }[];
}

export interface AuthoritySnapshotFixture {
  version: 1;
  vaultId: string;
  targetCustodyGeneration: number;
  previousCustodyGeneration: number;
  previousSequence: number | null;
  previousHeadHex: string | null;
  verifiedAtMs: number;
  sequence: number;
  headHex: string;
  membershipHex: string;
  signedAt: string;
  activeMembers: ControlLogMember[];
  removedEndpointIds: string[];
  epoch: number;
  recoveryGeneration: number;
  recoveryId: string;
  recoverySigningPublicKeyHex: string;
  recoveryKeyAgreementPublicKeyHex: string;
  recoveryWrapHashHex: string;
  freshnessMode: "endpoint_witnessed" | "eventual_fork_detection";
}

export interface AncV1NativeAuthorityStoreCorpus {
  schema: typeof ANC_V1_NATIVE_AUTHORITY_STORE_CORPUS_SCHEMA;
  suite: typeof E2EE_SUITE_ID;
  encoding: "hex";
  generator: typeof ANC_V1_NATIVE_AUTHORITY_STORE_GENERATOR;
  protocolBaseCommit: string;
  sourceAnchors: AncV1NativeAuthorityStoreProvenance["sources"];
  domains: Record<string, { escaped: string; utf8Hex: string }>;
  syntheticDerivation: {
    warning: string;
    labels: Record<string, string>;
    commitments: Record<string, string>;
  };
  custodyLayout: {
    bytes: 1088;
    versionOffset: 4;
    flagsOffset: 13;
    anchorPresentBit: 0;
    expectedEdgePresentBit: 1;
    checksumOffset: 1056;
  };
  custodyCases: readonly {
    name: string;
    recordTemplateHex: string;
    recordCommitmentHex: string;
    secretSlots: readonly {
      offset: number;
      length: number;
      label: string | null;
    }[];
    checksumXor: number;
    expectedStatus: "accept" | "reject";
    expectedError: string | null;
    expectedPresence: { anchor: boolean; expectedEdge: boolean } | null;
  }[];
  snapshotCases: readonly {
    name: string;
    snapshot: AuthoritySnapshotFixture | null;
    canonicalHex: string;
    canonicalBlake2b256Hex: string | null;
    expectedStatus: "accept" | "reject";
    expectedError: string | null;
  }[];
  frameVector: {
    localStateKeyLabel: string;
    localStateKeyCommitmentHex: string;
    vaultId: string;
    custodyGeneration: number;
    nonceHex: string;
    derivedKeyCommitmentHex: string;
    vaultDigestHex: string;
    plaintextCommitmentHex: string;
    headerHex: string;
    aadHex: string;
    ciphertextHex: string;
    frameHex: string;
    frameDigestHex: string;
  };
  frameMutations: readonly {
    name: string;
    frameHex: string;
    frameDigestHex: string;
    localStateKeyLabel: string;
    vaultId: string;
    custodyGeneration: number;
    expectedStatus: "reject";
    expectedError: string;
  }[];
}

const text = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: readonly Uint8Array[]) => {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
const u16 = (value: number) => Uint8Array.of(value >>> 8, value);
const u32 = (value: number) =>
  Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
const u64 = (value: number) => {
  const result = new Uint8Array(8);
  let remaining = BigInt(value);
  for (let index = 7; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
};
const put = (target: Uint8Array, offset: number, value: Uint8Array) =>
  target.set(value, offset);
const pattern = (byte: number, length = 32) =>
  new Uint8Array(length).fill(byte);
const domain = (value: string) => concat(text(value), Uint8Array.of(0));
const DOMAINS = {
  custodyChecksum: domain(
    "agent-native/private-vault/custody-record/checksum/anc-v1",
  ),
  vaultId: domain("anc/v1/private-vault/authority-store/vault-id"),
  key: domain("anc/v1/private-vault/authority-store/key"),
  aad: domain("anc/v1/private-vault/authority-store/aad"),
  frameDigest: domain("anc/v1/private-vault/authority-store/frame-digest"),
};

async function hash(message: Uint8Array, key?: Uint8Array) {
  await sodium.ready;
  return sodium.crypto_generichash(32, message, key ?? null);
}

const SYNTHETIC_LABELS = {
  custodySigningSeed: "synthetic-custody-signing-seed",
  custodyBoxSeed: "synthetic-custody-box-seed",
  localStateKey: "synthetic-local-state-key",
  wrongLocalStateKey: "synthetic-wrong-local-state-key",
  activeEpochKey: "synthetic-active-epoch-key",
  pendingEpochKey: "synthetic-pending-epoch-key",
} as const;

async function deriveSynthetic(label: string) {
  return hash(
    concat(
      domain("anc/v1/private-vault/authority-store/test-derivation"),
      text(label),
    ),
  );
}

async function syntheticCommitment(value: Uint8Array) {
  return hash(
    concat(
      domain("anc/v1/private-vault/authority-store/test-commitment"),
      value,
    ),
  );
}

function provenanceValid(value: AncV1NativeAuthorityStoreProvenance) {
  return (
    /^[0-9a-f]{40}$/.test(value.protocolBaseCommit) &&
    value.sources.length ===
      ANC_V1_NATIVE_AUTHORITY_STORE_SOURCE_PATHS.length &&
    ANC_V1_NATIVE_AUTHORITY_STORE_SOURCE_PATHS.every(
      (path, index) =>
        value.sources[index]?.path === path &&
        /^[0-9a-f]{64}$/.test(value.sources[index]!.sha256),
    )
  );
}

interface CustodyValues {
  version: 1 | 2 | 3;
  flags: number;
  lifecycle: number;
  role: number;
  pendingKind: number;
  rotationPhase: number;
  enrollmentPhase: number;
  custodyGeneration: number;
  vaultId: string;
  endpointId: string;
  ceremonyId: string;
  signingSeed: Uint8Array;
  signingPublicKey: Uint8Array;
  boxSeed: Uint8Array;
  boxPublicKey: Uint8Array;
  localStateKey: Uint8Array;
  activeEpoch: number;
  activeEpochKey: Uint8Array;
  pendingEpoch: number;
  pendingEpochKey: Uint8Array;
  recoveryGeneration: number;
  anchoredSequence: number;
  anchoredHead: Uint8Array;
  membershipDigest: Uint8Array;
  signedAtMs: number;
  snapshotDigest: Uint8Array;
  freshnessMs: number;
  expectedNextSequence: number;
  expectedPreviousHead: Uint8Array;
  pendingTranscriptDigest: Uint8Array;
  removalSequence: number;
  removalHead: Uint8Array;
  removalAuthorizationDigest: Uint8Array;
  removalTimeMs: number;
}

async function custodyRecord(values: CustodyValues) {
  const record = new Uint8Array(1088);
  put(record, 0, text("ANVC"));
  put(record, 4, u16(values.version));
  put(record, 6, u16(1088));
  record.set(
    [
      values.lifecycle,
      values.role,
      values.pendingKind,
      values.rotationPhase,
      values.enrollmentPhase,
      values.flags,
    ],
    8,
  );
  put(record, 16, u64(values.custodyGeneration));
  put(record, 24, text(values.vaultId));
  put(record, 184, text(values.endpointId));
  put(record, 344, text(values.ceremonyId));
  put(record, 504, values.signingSeed);
  put(record, 536, values.signingPublicKey);
  put(record, 568, values.boxSeed);
  put(record, 600, values.boxPublicKey);
  put(record, 632, values.localStateKey);
  put(record, 664, u64(values.activeEpoch));
  put(record, 672, values.activeEpochKey);
  put(record, 704, u64(values.pendingEpoch));
  put(record, 712, values.pendingEpochKey);
  put(record, 744, u64(values.recoveryGeneration));
  put(record, 752, u64(values.anchoredSequence));
  put(record, 760, values.anchoredHead);
  put(record, 792, values.membershipDigest);
  put(record, 824, u64(values.signedAtMs));
  put(record, 832, values.snapshotDigest);
  put(record, 864, u64(values.freshnessMs));
  put(record, 872, u64(values.expectedNextSequence));
  put(record, 880, values.expectedPreviousHead);
  put(record, 912, values.pendingTranscriptDigest);
  put(record, 944, u64(values.removalSequence));
  put(record, 952, values.removalHead);
  put(record, 984, values.removalAuthorizationDigest);
  put(record, 1016, u64(values.removalTimeMs));
  put(
    record,
    1056,
    await hash(concat(DOMAINS.custodyChecksum, record.slice(0, 1056))),
  );
  return record;
}

function memberTuple(member: ControlLogMember): AncV1CanonicalValue {
  return [
    member.endpointId,
    member.role,
    member.unattended,
    ancV1HexToBytes(member.signingPublicKey),
    ancV1HexToBytes(member.keyAgreementPublicKey),
    member.enrollmentRef,
  ];
}

function encodeSnapshot(snapshot: AuthoritySnapshotFixture) {
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [1, E2EE_SUITE_ID],
      [2, snapshot.vaultId],
      [3, "authority-snapshot"],
      [500, snapshot.version],
      [501, snapshot.targetCustodyGeneration],
      [502, snapshot.previousCustodyGeneration],
      [503, snapshot.previousSequence],
      [
        504,
        snapshot.previousHeadHex === null
          ? null
          : ancV1HexToBytes(snapshot.previousHeadHex),
      ],
      [505, snapshot.verifiedAtMs],
      [510, snapshot.sequence],
      [511, ancV1HexToBytes(snapshot.headHex)],
      [512, ancV1HexToBytes(snapshot.membershipHex)],
      [513, snapshot.signedAt],
      [514, snapshot.activeMembers.map(memberTuple)],
      [515, snapshot.removedEndpointIds],
      [516, snapshot.epoch],
      [517, snapshot.recoveryGeneration],
      [518, snapshot.recoveryId],
      [519, ancV1HexToBytes(snapshot.recoverySigningPublicKeyHex)],
      [520, ancV1HexToBytes(snapshot.recoveryKeyAgreementPublicKeyHex)],
      [521, ancV1HexToBytes(snapshot.recoveryWrapHashHex)],
      [522, snapshot.freshnessMode],
    ]),
  );
}

export async function buildAncV1NativeAuthorityStoreVectors(
  provenance: AncV1NativeAuthorityStoreProvenance,
): Promise<AncV1NativeAuthorityStoreCorpus> {
  if (!provenanceValid(provenance))
    throw new Error("Invalid fixture provenance");
  await sodium.ready;
  const signingSeed = await deriveSynthetic(
    SYNTHETIC_LABELS.custodySigningSeed,
  );
  const boxSeed = await deriveSynthetic(SYNTHETIC_LABELS.custodyBoxSeed);
  const localStateKey = await deriveSynthetic(SYNTHETIC_LABELS.localStateKey);
  const activeEpochKey = await deriveSynthetic(SYNTHETIC_LABELS.activeEpochKey);
  const pendingEpochKey = await deriveSynthetic(
    SYNTHETIC_LABELS.pendingEpochKey,
  );
  const wrongLocalStateKey = await deriveSynthetic(
    SYNTHETIC_LABELS.wrongLocalStateKey,
  );
  const signing = sodium.crypto_sign_seed_keypair(signingSeed);
  const box = sodium.crypto_box_seed_keypair(boxSeed);
  const zeros = pattern(0);
  const base: CustodyValues = {
    version: 2,
    flags: 1,
    lifecycle: 2,
    role: 1,
    pendingKind: 0,
    rotationPhase: 0,
    enrollmentPhase: 0,
    custodyGeneration: 2,
    vaultId: "vault:authority-fixture",
    endpointId: "endpoint:authority-owner",
    ceremonyId: "",
    signingSeed,
    signingPublicKey: signing.publicKey,
    boxSeed,
    boxPublicKey: box.publicKey,
    localStateKey,
    activeEpoch: 2,
    activeEpochKey,
    pendingEpoch: 0,
    pendingEpochKey: zeros,
    recoveryGeneration: 1,
    anchoredSequence: 1,
    anchoredHead: pattern(0x51),
    membershipDigest: pattern(0x52),
    signedAtMs: 1_721_111_111_000,
    snapshotDigest: pattern(0x53),
    freshnessMs: 1_721_111_112_000,
    expectedNextSequence: 0,
    expectedPreviousHead: zeros,
    pendingTranscriptDigest: zeros,
    removalSequence: 0,
    removalHead: zeros,
    removalAuthorizationDigest: zeros,
    removalTimeMs: 0,
  };
  const custodyCases: AncV1NativeAuthorityStoreCorpus["custodyCases"][number][] =
    [];
  const secretLabel = (value: Uint8Array) => {
    if (value.every((byte) => byte === 0)) return null;
    for (const [labelName, derived] of [
      [SYNTHETIC_LABELS.custodySigningSeed, signingSeed],
      [SYNTHETIC_LABELS.custodyBoxSeed, boxSeed],
      [SYNTHETIC_LABELS.localStateKey, localStateKey],
      [SYNTHETIC_LABELS.activeEpochKey, activeEpochKey],
      [SYNTHETIC_LABELS.pendingEpochKey, pendingEpochKey],
    ] as const)
      if (sodium.memcmp(value, derived)) return labelName;
    throw new Error("Unregistered synthetic custody secret");
  };
  const addCustody = async (
    name: string,
    values: CustodyValues,
    expectedStatus: "accept" | "reject",
    expectedError: string | null,
    expectedPresence: { anchor: boolean; expectedEdge: boolean } | null,
  ) => {
    const record = await custodyRecord(values);
    const secretSlots = [
      { offset: 504, length: 32, label: secretLabel(values.signingSeed) },
      { offset: 568, length: 32, label: secretLabel(values.boxSeed) },
      { offset: 632, length: 32, label: secretLabel(values.localStateKey) },
      { offset: 672, length: 32, label: secretLabel(values.activeEpochKey) },
      { offset: 712, length: 32, label: secretLabel(values.pendingEpochKey) },
    ];
    const recordTemplate = record.slice();
    for (const slot of secretSlots)
      recordTemplate.fill(0, slot.offset, slot.offset + slot.length);
    recordTemplate.fill(0, 1056);
    custodyCases.push({
      name,
      recordTemplateHex: ancV1BytesToHex(recordTemplate),
      recordCommitmentHex: ancV1BytesToHex(await syntheticCommitment(record)),
      secretSlots,
      checksumXor: 0,
      expectedStatus,
      expectedError,
      expectedPresence,
    });
    record.fill(0);
    recordTemplate.fill(0);
  };
  const genesis = {
    ...base,
    flags: 3,
    lifecycle: 1,
    pendingKind: 1,
    rotationPhase: 1,
    ceremonyId: "ceremony:genesis-fixture",
    custodyGeneration: 1,
    activeEpoch: 0,
    activeEpochKey: zeros,
    pendingEpoch: 1,
    pendingEpochKey,
    recoveryGeneration: 0,
    anchoredSequence: 0,
    anchoredHead: pattern(0x61),
    membershipDigest: pattern(0x62),
    snapshotDigest: pattern(0x63),
    expectedNextSequence: 0,
    expectedPreviousHead: zeros,
    pendingTranscriptDigest: pattern(0x64),
  } satisfies CustodyValues;
  const absent = {
    ...base,
    flags: 0,
    lifecycle: 1,
    pendingKind: 2,
    enrollmentPhase: 1,
    ceremonyId: "ceremony:offer-fixture",
    activeEpoch: 0,
    activeEpochKey: zeros,
    recoveryGeneration: 0,
    anchoredSequence: 0,
    anchoredHead: zeros,
    membershipDigest: zeros,
    signedAtMs: 0,
    snapshotDigest: zeros,
    freshnessMs: 0,
  } satisfies CustodyValues;
  const terminal = {
    ...base,
    lifecycle: 4,
    signingSeed: zeros,
    boxSeed: zeros,
    localStateKey: zeros,
    activeEpoch: 0,
    activeEpochKey: zeros,
    removalSequence: 2,
    removalHead: pattern(0x71),
    removalAuthorizationDigest: pattern(0x72),
    removalTimeMs: 1_721_111_113_000,
  } satisfies CustodyValues;
  await addCustody(
    "v2_genesis_sequence_zero_present",
    genesis,
    "accept",
    null,
    {
      anchor: true,
      expectedEdge: true,
    },
  );
  await addCustody("v2_anchor_and_edge_absent", absent, "accept", null, {
    anchor: false,
    expectedEdge: false,
  });
  await addCustody("v2_terminal_anchor_present", terminal, "accept", null, {
    anchor: true,
    expectedEdge: false,
  });
  await addCustody("v2_descendant_anchor_present", base, "accept", null, {
    anchor: true,
    expectedEdge: false,
  });
  await addCustody(
    "v1_descendant_presence_mapping",
    { ...base, version: 1, flags: 0 },
    "accept",
    null,
    {
      anchor: true,
      expectedEdge: false,
    },
  );
  await addCustody(
    "v1_terminal_presence_mapping",
    { ...terminal, version: 1, flags: 0 },
    "accept",
    null,
    {
      anchor: true,
      expectedEdge: false,
    },
  );
  const invalidCustody: readonly [string, CustodyValues, string][] = [
    ["v2_unknown_presence_bits", { ...base, flags: 0x04 }, "unknown_flags"],
    [
      "v2_absent_anchor_nonzero_sequence",
      { ...absent, anchoredSequence: 1 },
      "absent_anchor_nonzero",
    ],
    [
      "v2_absent_anchor_nonzero_hash",
      { ...absent, anchoredHead: pattern(0x81) },
      "absent_anchor_nonzero",
    ],
    [
      "v2_present_anchor_zero_head",
      { ...base, anchoredHead: zeros },
      "present_anchor_incomplete",
    ],
    [
      "v2_expected_absent_nonzero_sequence",
      { ...base, expectedNextSequence: 2 },
      "absent_edge_nonzero",
    ],
    [
      "v2_genesis_previous_head_nonzero",
      { ...genesis, expectedPreviousHead: pattern(0x82) },
      "genesis_previous_head",
    ],
    [
      "v2_descendant_expected_sequence_wrong",
      {
        ...base,
        flags: 3,
        expectedNextSequence: 7,
        expectedPreviousHead: base.anchoredHead,
        pendingTranscriptDigest: pattern(0x83),
      },
      "descendant_edge",
    ],
    [
      "v2_descendant_previous_head_wrong",
      {
        ...base,
        flags: 3,
        expectedNextSequence: 2,
        expectedPreviousHead: pattern(0x84),
        pendingTranscriptDigest: pattern(0x83),
      },
      "descendant_edge",
    ],
    ["v1_flags_nonzero", { ...base, version: 1, flags: 1 }, "v1_flags"],
    [
      "v1_sequence_zero_nonzero_anchor",
      { ...genesis, version: 1, flags: 0 },
      "v1_sequence_zero_anchor",
    ],
    ["unknown_custody_version", { ...base, version: 3 }, "unknown_version"],
  ];
  for (const [name, values, error] of invalidCustody) {
    await addCustody(name, values, "reject", error, null);
  }
  const checksumRecord = await custodyRecord(base);
  checksumRecord[1056] ^= 1;
  const checksumSecretSlots = [
    { offset: 504, length: 32, label: SYNTHETIC_LABELS.custodySigningSeed },
    { offset: 568, length: 32, label: SYNTHETIC_LABELS.custodyBoxSeed },
    { offset: 632, length: 32, label: SYNTHETIC_LABELS.localStateKey },
    { offset: 672, length: 32, label: SYNTHETIC_LABELS.activeEpochKey },
    { offset: 712, length: 32, label: null },
  ];
  const checksumTemplate = checksumRecord.slice();
  for (const slot of checksumSecretSlots)
    checksumTemplate.fill(0, slot.offset, slot.offset + slot.length);
  checksumTemplate.fill(0, 1056);
  custodyCases.push({
    name: "custody_checksum_mismatch",
    recordTemplateHex: ancV1BytesToHex(checksumTemplate),
    recordCommitmentHex: ancV1BytesToHex(
      await syntheticCommitment(checksumRecord),
    ),
    secretSlots: checksumSecretSlots,
    checksumXor: 1,
    expectedStatus: "reject",
    expectedError: "checksum_failed",
    expectedPresence: null,
  });
  checksumRecord.fill(0);
  checksumTemplate.fill(0);

  const identity = (
    id: string,
    role: "endpoint" | "broker",
    byte: number,
  ): ControlLogMember => ({
    endpointId: id,
    role,
    unattended: role === "broker",
    signingPublicKey: byte.toString(16).padStart(2, "0").repeat(32),
    keyAgreementPublicKey: (byte + 16).toString(16).padStart(2, "0").repeat(32),
    enrollmentRef: `enrollment:${id}`,
  });
  const owner = identity("endpoint:01-owner", "endpoint", 0x11);
  const device = identity("endpoint:02-device", "endpoint", 0x22);
  const brokerMember = identity("endpoint:03-broker", "broker", 0x33);
  const recovered = identity("endpoint:04-recovered", "endpoint", 0x44);
  const snapshotBase: AuthoritySnapshotFixture = {
    version: 1,
    vaultId: base.vaultId,
    targetCustodyGeneration: 1,
    previousCustodyGeneration: 0,
    previousSequence: null,
    previousHeadHex: null,
    verifiedAtMs: 1_721_117_511_000,
    sequence: 0,
    headHex: "91".repeat(32),
    membershipHex: "92".repeat(32),
    signedAt: "2024-07-16T08:11:51.000Z",
    activeMembers: [owner],
    removedEndpointIds: [],
    epoch: 1,
    recoveryGeneration: 1,
    recoveryId: "recovery:authority-01",
    recoverySigningPublicKeyHex: "93".repeat(32),
    recoveryKeyAgreementPublicKeyHex: "94".repeat(32),
    recoveryWrapHashHex: "95".repeat(32),
    freshnessMode: "endpoint_witnessed",
  };
  const snapshots: readonly [string, AuthoritySnapshotFixture][] = [
    ["genesis", snapshotBase],
    [
      "signed_at_offset_0530",
      { ...snapshotBase, signedAt: "2024-07-16T13:41:51+05:30" },
    ],
    [
      "signed_at_z_without_fraction",
      { ...snapshotBase, signedAt: "2024-07-16T08:11:51Z" },
    ],
    [
      "descendant",
      {
        ...snapshotBase,
        targetCustodyGeneration: 2,
        previousCustodyGeneration: 1,
        previousSequence: 0,
        previousHeadHex: snapshotBase.headHex,
        sequence: 1,
        headHex: "96".repeat(32),
        membershipHex: "97".repeat(32),
        activeMembers: [owner, device],
      },
    ],
    [
      "broker",
      {
        ...snapshotBase,
        targetCustodyGeneration: 3,
        previousCustodyGeneration: 2,
        previousSequence: 1,
        previousHeadHex: "96".repeat(32),
        sequence: 2,
        headHex: "98".repeat(32),
        membershipHex: "99".repeat(32),
        activeMembers: [owner, device, brokerMember],
        freshnessMode: "eventual_fork_detection",
      },
    ],
    [
      "recovery",
      {
        ...snapshotBase,
        targetCustodyGeneration: 4,
        previousCustodyGeneration: 3,
        previousSequence: 2,
        previousHeadHex: "98".repeat(32),
        sequence: 3,
        headHex: "9a".repeat(32),
        membershipHex: "9b".repeat(32),
        activeMembers: [recovered],
        removedEndpointIds: [
          owner.endpointId,
          device.endpointId,
          brokerMember.endpointId,
        ],
        epoch: 2,
        recoveryGeneration: 2,
        recoveryId: "recovery:authority-02",
        recoverySigningPublicKeyHex: "9c".repeat(32),
        recoveryKeyAgreementPublicKeyHex: "9d".repeat(32),
        recoveryWrapHashHex: "9e".repeat(32),
      },
    ],
    [
      "tombstones_4096",
      {
        ...snapshotBase,
        targetCustodyGeneration: 5,
        previousCustodyGeneration: 4,
        previousSequence: 3,
        previousHeadHex: "9a".repeat(32),
        sequence: 4,
        headHex: "a1".repeat(32),
        membershipHex: "a2".repeat(32),
        activeMembers: [recovered],
        removedEndpointIds: Array.from(
          { length: 4096 },
          (_, index) => `removed:${index.toString().padStart(4, "0")}`,
        ),
        epoch: 2,
        recoveryGeneration: 2,
        recoveryId: "recovery:authority-02",
        recoverySigningPublicKeyHex: "9c".repeat(32),
        recoveryKeyAgreementPublicKeyHex: "9d".repeat(32),
        recoveryWrapHashHex: "9e".repeat(32),
      },
    ],
  ];
  const snapshotCases: AncV1NativeAuthorityStoreCorpus["snapshotCases"][number][] =
    [];
  for (const [name, snapshot] of snapshots) {
    if (
      !Number.isSafeInteger(snapshot.verifiedAtMs) ||
      snapshot.verifiedAtMs < 1 ||
      !protocolTimestampSchema.safeParse(snapshot.signedAt).success ||
      Date.parse(snapshot.signedAt) > snapshot.verifiedAtMs + 30_000
    )
      throw new Error(`${name} has invalid snapshot timestamp semantics`);
    const bytes = encodeSnapshot(snapshot);
    snapshotCases.push({
      name,
      snapshot,
      canonicalHex: ancV1BytesToHex(bytes),
      canonicalBlake2b256Hex: ancV1BytesToHex(await hash(bytes)),
      expectedStatus: "accept",
      expectedError: null,
    });
  }
  const genesisBytes = encodeSnapshot(snapshotBase);
  const mutateSnapshot = (
    mutate: (map: Map<number, AncV1CanonicalValue>) => void,
  ) => {
    const decoded = decodeAncV1Canonical(genesisBytes);
    if (!(decoded instanceof Map))
      throw new Error("snapshot fixture map expected");
    const map = new Map(decoded);
    mutate(map);
    return encodeAncV1Canonical(map);
  };
  const rejectedSnapshots: readonly [string, Uint8Array, string][] = [
    ["non_shortest_integer", Uint8Array.from([0x18, 0x17]), "non_canonical"],
    ["indefinite_map", Uint8Array.from([0xbf, 0xff]), "non_canonical"],
    [
      "duplicate_map_key",
      Uint8Array.from([0xa2, 0x01, 0x01, 0x01, 0x02]),
      "duplicate_key",
    ],
    [
      "unknown_field",
      mutateSnapshot((map) => map.set(999, "unknown")),
      "unknown_field",
    ],
    [
      "missing_members",
      mutateSnapshot((map) => map.delete(514)),
      "missing_field",
    ],
    [
      "wrong_head_type",
      mutateSnapshot((map) => map.set(511, "head")),
      "wrong_type",
    ],
    [
      "invalid_vault_id_too_short",
      mutateSnapshot((map) => map.set(2, "short")),
      "invalid_id",
    ],
    [
      "invalid_member_id_unicode",
      mutateSnapshot((map) => {
        const tuple = memberTuple(owner) as AncV1CanonicalValue[];
        tuple[0] = "endpoint:☃owner";
        map.set(514, [tuple]);
      }),
      "invalid_id",
    ],
    [
      "invalid_enrollment_ref_whitespace",
      mutateSnapshot((map) => {
        const tuple = memberTuple(owner) as AncV1CanonicalValue[];
        tuple[5] = "enrollment invalid";
        map.set(514, [tuple]);
      }),
      "invalid_id",
    ],
    [
      "invalid_removed_id_slash",
      mutateSnapshot((map) => map.set(515, ["removed/invalid"])),
      "invalid_id",
    ],
    [
      "invalid_recovery_id_leading_punctuation",
      mutateSnapshot((map) => map.set(518, ":recovery-invalid")),
      "invalid_id",
    ],
    [
      "members_out_of_order",
      mutateSnapshot((map) =>
        map.set(514, [memberTuple(device), memberTuple(owner)]),
      ),
      "member_order",
    ],
    [
      "endpoint_member_unattended_true",
      mutateSnapshot((map) => {
        const tuple = memberTuple(owner) as AncV1CanonicalValue[];
        tuple[2] = true;
        map.set(514, [tuple]);
      }),
      "member_unattended_role",
    ],
    [
      "broker_member_unattended_false",
      mutateSnapshot((map) => {
        const tuple = memberTuple(brokerMember) as AncV1CanonicalValue[];
        tuple[2] = false;
        map.set(514, [tuple]);
      }),
      "member_unattended_role",
    ],
    [
      "multiple_active_brokers",
      mutateSnapshot((map) =>
        map.set(514, [
          memberTuple(brokerMember),
          memberTuple(identity("endpoint:04-broker-second", "broker", 0x34)),
        ]),
      ),
      "multiple_active_brokers",
    ],
    [
      "duplicate_removed_ids",
      mutateSnapshot((map) => map.set(515, ["removed:0001", "removed:0001"])),
      "removed_duplicates",
    ],
    [
      "active_member_also_removed",
      mutateSnapshot((map) => map.set(515, [owner.endpointId])),
      "removed_active_overlap",
    ],
    [
      "tombstones_4097_rejected",
      mutateSnapshot((map) =>
        map.set(
          515,
          Array.from(
            { length: 4097 },
            (_, index) => `removed:${index.toString().padStart(4, "0")}`,
          ),
        ),
      ),
      "removed_limit",
    ],
    [
      "key_wrong_length",
      mutateSnapshot((map) => map.set(519, new Uint8Array(31))),
      "key_length",
    ],
    [
      "verified_at_zero",
      mutateSnapshot((map) => map.set(505, 0)),
      "verified_at_range",
    ],
    [
      "signed_at_missing_offset",
      mutateSnapshot((map) => map.set(513, "2024-07-16T08:11:51")),
      "invalid_timestamp",
    ],
    [
      "signed_at_impossible_date",
      mutateSnapshot((map) => map.set(513, "2024-02-30T08:11:51Z")),
      "invalid_timestamp",
    ],
    [
      "future_signed_at",
      mutateSnapshot((map) => map.set(513, "2024-07-16T08:12:22.000Z")),
      "future_timestamp",
    ],
    [
      "excessive_depth",
      concat(
        ...Array.from({ length: 34 }, () => Uint8Array.of(0x81)),
        Uint8Array.of(0),
      ),
      "depth",
    ],
    ["oversized_snapshot", new Uint8Array(1024 * 1024 + 1), "size"],
  ];
  const classifyMemberSemantics = (bytes: Uint8Array) => {
    const decoded = decodeAncV1Canonical(bytes);
    if (!(decoded instanceof Map)) return null;
    const members = decoded.get(514);
    const removed = decoded.get(515);
    if (!Array.isArray(members) || !Array.isArray(removed)) return null;
    const opaqueId = (value: unknown) =>
      typeof value === "string" &&
      value.length >= 8 &&
      value.length <= 160 &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
    if (!opaqueId(decoded.get(2)) || !opaqueId(decoded.get(518)))
      return "invalid_id";
    const activeIds: string[] = [];
    let brokerCount = 0;
    for (const member of members) {
      if (
        !Array.isArray(member) ||
        typeof member[0] !== "string" ||
        (member[1] !== "endpoint" && member[1] !== "broker") ||
        typeof member[2] !== "boolean"
      )
        return null;
      if (!opaqueId(member[0]) || !opaqueId(member[5])) return "invalid_id";
      activeIds.push(member[0]);
      if (member[2] !== (member[1] === "broker"))
        return "member_unattended_role";
      if (member[1] === "broker") brokerCount += 1;
    }
    if (brokerCount > 1) return "multiple_active_brokers";
    if (removed.some((removedId) => !opaqueId(removedId))) return "invalid_id";
    if (
      removed.some(
        (removedId) =>
          typeof removedId === "string" && activeIds.includes(removedId),
      )
    )
      return "removed_active_overlap";
    return null;
  };
  for (const [name, bytes, expected] of rejectedSnapshots.filter(
    ([, , error]) =>
      [
        "member_unattended_role",
        "multiple_active_brokers",
        "removed_active_overlap",
        "invalid_id",
      ].includes(error),
  )) {
    const actual = classifyMemberSemantics(bytes);
    if (actual !== expected)
      throw new Error(
        `${name} semantic category mismatch: expected ${expected}, got ${String(actual)}`,
      );
  }
  const classifyTimestampSemantics = (bytes: Uint8Array) => {
    const decoded = decodeAncV1Canonical(bytes);
    if (!(decoded instanceof Map)) return null;
    const verifiedAt = decoded.get(505);
    const signedAt = decoded.get(513);
    if (!Number.isSafeInteger(verifiedAt) || (verifiedAt as number) < 1)
      return "verified_at_range";
    if (!protocolTimestampSchema.safeParse(signedAt).success)
      return "invalid_timestamp";
    if (Date.parse(signedAt as string) > (verifiedAt as number) + 30_000)
      return "future_timestamp";
    return null;
  };
  for (const [name, bytes, expected] of rejectedSnapshots.filter(
    ([, , error]) =>
      ["verified_at_range", "invalid_timestamp", "future_timestamp"].includes(
        error,
      ),
  )) {
    const actual = classifyTimestampSemantics(bytes);
    if (actual !== expected)
      throw new Error(
        `${name} timestamp category mismatch: expected ${expected}, got ${String(actual)}`,
      );
  }
  for (const [name, bytes, error] of rejectedSnapshots) {
    snapshotCases.push({
      name,
      snapshot: null,
      canonicalHex: ancV1BytesToHex(bytes),
      canonicalBlake2b256Hex: null,
      expectedStatus: "reject",
      expectedError: error,
    });
  }

  const frameSnapshot = snapshotCases.find(
    (entry) => entry.name === "descendant",
  )!;
  const plaintext = ancV1HexToBytes(frameSnapshot.canonicalHex);
  const vaultBytes = text(base.vaultId);
  const vaultDigest = await hash(
    concat(DOMAINS.vaultId, u32(vaultBytes.length), vaultBytes),
  );
  const generation = 2;
  const derivedKey = await hash(
    concat(DOMAINS.key, vaultDigest, u64(generation)),
    base.localStateKey,
  );
  const nonce = pattern(0xa5, 24);
  const header = concat(
    text("ANPVAU01"),
    u16(1),
    u16(0),
    u64(generation),
    u32(plaintext.length),
    u32(plaintext.length + 16),
    vaultDigest,
    nonce,
  );
  const aad = concat(DOMAINS.aad, header);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    derivedKey,
  );
  const frame = concat(header, ciphertext);
  const frameDigest = await hash(concat(DOMAINS.frameDigest, frame));
  const frameVector = {
    localStateKeyLabel: SYNTHETIC_LABELS.localStateKey,
    localStateKeyCommitmentHex: ancV1BytesToHex(
      await syntheticCommitment(base.localStateKey),
    ),
    vaultId: base.vaultId,
    custodyGeneration: generation,
    nonceHex: ancV1BytesToHex(nonce),
    derivedKeyCommitmentHex: ancV1BytesToHex(
      await syntheticCommitment(derivedKey),
    ),
    vaultDigestHex: ancV1BytesToHex(vaultDigest),
    plaintextCommitmentHex: ancV1BytesToHex(
      await syntheticCommitment(plaintext),
    ),
    headerHex: ancV1BytesToHex(header),
    aadHex: ancV1BytesToHex(aad),
    ciphertextHex: ancV1BytesToHex(ciphertext),
    frameHex: ancV1BytesToHex(frame),
    frameDigestHex: ancV1BytesToHex(frameDigest),
  };
  const frameMutations: AncV1NativeAuthorityStoreCorpus["frameMutations"][number][] =
    [];
  const addFrameMutation = async (
    name: string,
    mutated: Uint8Array,
    error: string,
    options: Partial<{
      digest: Uint8Array;
      keyLabel: string;
      vaultId: string;
      generation: number;
    }> = {},
  ) => {
    frameMutations.push({
      name,
      frameHex: ancV1BytesToHex(mutated),
      frameDigestHex: ancV1BytesToHex(
        options.digest ?? (await hash(concat(DOMAINS.frameDigest, mutated))),
      ),
      localStateKeyLabel: options.keyLabel ?? SYNTHETIC_LABELS.localStateKey,
      vaultId: options.vaultId ?? base.vaultId,
      custodyGeneration: options.generation ?? generation,
      expectedStatus: "reject",
      expectedError: error,
    });
  };
  const flip = (offset: number) => {
    const value = frame.slice();
    value[offset] ^= 1;
    return value;
  };
  await addFrameMutation("magic", flip(0), "invalid_header");
  await addFrameMutation("codec", flip(9), "invalid_header");
  await addFrameMutation("reserved_flags", flip(11), "invalid_header");
  await addFrameMutation("header_generation", flip(19), "wrong_generation");
  await addFrameMutation("plaintext_length", flip(23), "invalid_length");
  await addFrameMutation("ciphertext_length", flip(27), "invalid_length");
  await addFrameMutation("vault_digest", flip(28), "wrong_vault");
  await addFrameMutation("nonce", flip(60), "authentication_failed");
  await addFrameMutation("ciphertext", flip(84), "authentication_failed");
  await addFrameMutation(
    "authentication_tag",
    flip(frame.length - 1),
    "authentication_failed",
  );
  await addFrameMutation(
    "truncated",
    frame.slice(0, frame.length - 1),
    "invalid_length",
  );
  await addFrameMutation(
    "appended",
    concat(frame, Uint8Array.of(0)),
    "invalid_length",
  );
  await addFrameMutation(
    "wrong_local_state_key",
    frame,
    "authentication_failed",
    { keyLabel: SYNTHETIC_LABELS.wrongLocalStateKey },
  );
  await addFrameMutation("wrong_vault_argument", frame, "wrong_vault", {
    vaultId: "vault:wrong",
  });
  await addFrameMutation(
    "wrong_generation_argument",
    frame,
    "wrong_generation",
    { generation: 3 },
  );
  await addFrameMutation("frame_digest", frame, "frame_digest_mismatch", {
    digest: pattern(0xee),
  });

  const corpus: AncV1NativeAuthorityStoreCorpus = {
    schema: ANC_V1_NATIVE_AUTHORITY_STORE_CORPUS_SCHEMA,
    suite: E2EE_SUITE_ID,
    encoding: "hex",
    generator: ANC_V1_NATIVE_AUTHORITY_STORE_GENERATOR,
    protocolBaseCommit: provenance.protocolBaseCommit,
    sourceAnchors: provenance.sources.map((source) => ({ ...source })),
    domains: Object.fromEntries(
      Object.entries(DOMAINS).map(([name, bytes]) => [
        name,
        {
          escaped: `${new TextDecoder().decode(bytes.slice(0, -1))}\\u0000`,
          utf8Hex: ancV1BytesToHex(bytes),
        },
      ]),
    ),
    syntheticDerivation: {
      warning:
        "Synthetic derivation labels and commitments only. Derive secret test bytes in memory and zeroize them after use.",
      labels: { ...SYNTHETIC_LABELS },
      commitments: Object.fromEntries(
        await Promise.all(
          [
            [SYNTHETIC_LABELS.custodySigningSeed, signingSeed],
            [SYNTHETIC_LABELS.custodyBoxSeed, boxSeed],
            [SYNTHETIC_LABELS.localStateKey, localStateKey],
            [SYNTHETIC_LABELS.wrongLocalStateKey, wrongLocalStateKey],
            [SYNTHETIC_LABELS.activeEpochKey, activeEpochKey],
            [SYNTHETIC_LABELS.pendingEpochKey, pendingEpochKey],
          ].map(async ([label, value]) => [
            label as string,
            ancV1BytesToHex(await syntheticCommitment(value as Uint8Array)),
          ]),
        ),
      ),
    },
    custodyLayout: {
      bytes: 1088,
      versionOffset: 4,
      flagsOffset: 13,
      anchorPresentBit: 0,
      expectedEdgePresentBit: 1,
      checksumOffset: 1056,
    },
    custodyCases,
    snapshotCases,
    frameVector,
    frameMutations,
  };
  for (const secret of [
    signingSeed,
    boxSeed,
    localStateKey,
    wrongLocalStateKey,
    activeEpochKey,
    pendingEpochKey,
    signing.privateKey,
    box.privateKey,
    derivedKey,
    plaintext,
  ])
    secret.fill(0);
  return corpus;
}

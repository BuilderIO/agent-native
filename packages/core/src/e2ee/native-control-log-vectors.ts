import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  CONTROL_LOG_ZERO_HASH,
  ControlLogVerificationError,
  type ControlLogFailureCode,
  type ControlLogInnerEnvelope,
  type ControlLogMember,
  type ControlLogState,
  type ControlMembershipCommit,
  type SignedControlLogEntry,
  createSignedControlLogEntry,
  encodeControlLogInnerEnvelope,
  encodeSignedControlLogEntry,
  encodeUnsignedControlLogEntry,
  verifyAndReduceControlLogEntry,
} from "./control-log.js";
import { sealAncV1GrantRevocation } from "./grant-codecs.js";
import { ancV1Hash, ancV1SigningKeypairFromSeed } from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
  e2eeDomainSeparationPrefix,
} from "./suite.js";

export const ANC_V1_NATIVE_CONTROL_LOG_CORPUS_SCHEMA =
  "anc/v1-native-control-log-vectors@3" as const;
export const ANC_V1_NATIVE_CONTROL_LOG_GENERATOR =
  "buildAncV1NativeControlLogVectors" as const;
export const ANC_V1_NATIVE_CONTROL_LOG_SOURCE_PATHS = [
  "packages/core/src/e2ee/native-control-log-vectors.ts",
  "packages/core/src/e2ee/canonical.ts",
  "packages/core/src/e2ee/control-log.ts",
  "packages/core/src/e2ee/grant-codecs.ts",
  "packages/core/src/e2ee/portable-crypto.ts",
  "packages/core/src/e2ee/suite.ts",
] as const;

export interface AncV1NativeControlLogSourceAnchor {
  path: (typeof ANC_V1_NATIVE_CONTROL_LOG_SOURCE_PATHS)[number];
  sha256: string;
}
export interface AncV1NativeControlLogProvenance {
  protocolBaseCommit: string;
  sources: readonly AncV1NativeControlLogSourceAnchor[];
}
export interface AncV1NativeControlLogStep {
  name:
    | "genesis"
    | "add_device"
    | "add_broker"
    | "broker_continuity"
    | "remove_broker"
    | "add_broker_replacement_candidate"
    | "broker_replacement"
    | "remove_device"
    | "recovery"
    | "continuity"
    | "ceremony_abort"
    | "grant_revocation";
  expected: "accept";
  sequence: number;
  innerType:
    | "membership_commit"
    | "continuity_checkpoint"
    | "ceremony_abort"
    | "grant_revocation";
  ceremonyKind: string | null;
  signerEndpointId: string;
  signerPublicKeyHex: string;
  innerHex: string;
  unsignedHex: string;
  signatureHex: string;
  outerHex: string;
  entryHashHex: string;
  membershipHashHex: string;
  expectedState: ControlLogState;
}
export interface AncV1NativeControlLogStateVector {
  ref: string;
  state: ControlLogState | null;
}

export interface AncV1NativeControlLogCase {
  name: string;
  matrix: "stateful" | "boundary" | "authorization" | "transition" | "wire";
  priorStateRef: string;
  entryHex: string;
  expectedStatus: "reject" | "accept" | "idempotent";
  expectedError: ControlLogFailureCode | null;
  expectedState: ControlLogState | null;
  expectedEntryHashHex: string | null;
  authorization: {
    genesis: boolean;
    recovery: boolean;
    recoveryWrapRotation: boolean;
    ceremonyAbort: boolean;
    grantRevocation: boolean;
  };
  canonicalErrorCategory: string | null;
}
export interface AncV1NativeControlLogVectorCorpus {
  schema: typeof ANC_V1_NATIVE_CONTROL_LOG_CORPUS_SCHEMA;
  suite: typeof E2EE_SUITE_ID;
  encoding: "hex";
  generator: typeof ANC_V1_NATIVE_CONTROL_LOG_GENERATOR;
  protocolBaseCommit: string;
  sourceAnchors: readonly AncV1NativeControlLogSourceAnchor[];
  domains: readonly {
    operation: "signature" | "entry_hash" | "membership_hash";
    tag: "log-entry";
    escaped: "anc/v1/log-entry\\u0000";
    utf8Hex: string;
  }[];
  identities: Record<string, ControlLogMember>;
  states: readonly AncV1NativeControlLogStateVector[];
  steps: readonly AncV1NativeControlLogStep[];
  cases: readonly AncV1NativeControlLogCase[];
}

interface FixtureIdentity {
  member: ControlLogMember;
  privateKey: Uint8Array;
}

const FIXED_VAULT_ID = "vault:native-control-log-0001";
const FIXED_RECOVERY_ID = "recovery:native-0001";
const FIXED_RECOVERY_REPLACEMENT_ID = "recovery:native-0002";
const FIXED_AT = Date.parse("2026-07-17T12:00:00.000Z");
const text = (value: string) => new TextEncoder().encode(value);

function fixedTimestamp(sequence: number): string {
  return new Date(FIXED_AT + sequence * 1_000).toISOString();
}

async function fixtureHash(label: string): Promise<string> {
  return ancV1BytesToHex(await ancV1Hash("log-entry", text(label)));
}

async function fixtureIdentity(
  seedByte: number,
  endpointId: string,
  role: "endpoint" | "broker",
): Promise<FixtureIdentity> {
  const pair = await ancV1SigningKeypairFromSeed(
    new Uint8Array(32).fill(seedByte),
  );
  return {
    member: {
      endpointId,
      role,
      unattended: role === "broker",
      signingPublicKey: ancV1BytesToHex(pair.publicKey),
      keyAgreementPublicKey: ancV1BytesToHex(
        new Uint8Array(32).fill(seedByte + 0x40),
      ),
      enrollmentRef: `enrollment:native-${seedByte.toString(16).padStart(2, "0")}`,
    },
    privateKey: pair.privateKey,
  };
}

function provenanceIsComplete(
  provenance: AncV1NativeControlLogProvenance,
): boolean {
  return (
    /^[0-9a-f]{40}$/.test(provenance.protocolBaseCommit) &&
    provenance.sources.length ===
      ANC_V1_NATIVE_CONTROL_LOG_SOURCE_PATHS.length &&
    ANC_V1_NATIVE_CONTROL_LOG_SOURCE_PATHS.every(
      (path, index) =>
        provenance.sources[index]?.path === path &&
        /^[0-9a-f]{64}$/.test(provenance.sources[index]!.sha256),
    )
  );
}

/** Build the fixed synthetic native control-log parity corpus. */
export async function buildAncV1NativeControlLogVectors(
  provenance: AncV1NativeControlLogProvenance,
): Promise<AncV1NativeControlLogVectorCorpus> {
  if (!provenanceIsComplete(provenance)) {
    throw new Error("Native control-log corpus provenance is incomplete");
  }
  const owner = await fixtureIdentity(0x11, "endpoint:01-owner", "endpoint");
  const device = await fixtureIdentity(0x22, "endpoint:02-device", "endpoint");
  const broker = await fixtureIdentity(0x33, "endpoint:03-broker", "broker");
  const brokerReplacementCandidate = await fixtureIdentity(
    0x34,
    "endpoint:04-broker-replacement-candidate",
    "broker",
  );
  const brokerReplacement = await fixtureIdentity(
    0x35,
    "endpoint:05-broker-replacement",
    "broker",
  );
  const recovered = await fixtureIdentity(
    0x44,
    "endpoint:06-recovered",
    "endpoint",
  );
  const recoverySigning = await ancV1SigningKeypairFromSeed(
    new Uint8Array(32).fill(0x55),
  );
  const replacementSigning = await ancV1SigningKeypairFromSeed(
    new Uint8Array(32).fill(0x66),
  );
  const recoveryAuthority = {
    recoveryGeneration: 1,
    recoveryId: FIXED_RECOVERY_ID,
    recoverySigningPublicKey: ancV1BytesToHex(recoverySigning.publicKey),
    recoveryKeyAgreementPublicKey: "75".repeat(32),
    recoveryWrapHash: await fixtureHash("native recovery wrap generation 1"),
  };
  const replacementAuthority = {
    recoveryGeneration: 2,
    recoveryId: FIXED_RECOVERY_REPLACEMENT_ID,
    recoverySigningPublicKey: ancV1BytesToHex(replacementSigning.publicKey),
    recoveryKeyAgreementPublicKey: "76".repeat(32),
    recoveryWrapHash: await fixtureHash("native recovery wrap generation 2"),
  };
  const steps: AncV1NativeControlLogStep[] = [];
  const states: AncV1NativeControlLogStateVector[] = [
    { ref: "none", state: null },
  ];
  const stepEntries = new Map<string, SignedControlLogEntry>();
  let state: ControlLogState | null = null;

  const append = async (
    name: AncV1NativeControlLogStep["name"],
    inner: Parameters<typeof createSignedControlLogEntry>[0]["innerEnvelope"],
    signer: FixtureIdentity,
  ) => {
    const sequence = steps.length;
    const entry = await createSignedControlLogEntry({
      vaultId: FIXED_VAULT_ID,
      createdAt: fixedTimestamp(sequence),
      envelopeId: `log-entry:native-${sequence.toString().padStart(2, "0")}`,
      sequence,
      previousHash: state?.headHash ?? CONTROL_LOG_ZERO_HASH,
      innerEnvelope: inner,
      signerEndpointId: signer.member.endpointId,
      signingPrivateKey: signer.privateKey,
    });
    const reduced = await verifyAndReduceControlLogEntry({
      current: state,
      entry,
      verifyGenesisAuthorization: async () => true,
      verifyRecoveryAuthorization: async () => true,
      verifyRecoveryWrapRotation: async () => true,
      verifyCeremonyAbortAuthorization: async () => true,
      verifyGrantRevocationAuthorization: async () => true,
    });
    state = reduced.state;
    states.push({ ref: `step:${name}`, state: reduced.state });
    stepEntries.set(name, entry);
    const { signature, ...unsigned } = entry;
    steps.push({
      name,
      expected: "accept",
      sequence,
      innerType: inner.type,
      ceremonyKind:
        inner.type === "membership_commit" || inner.type === "ceremony_abort"
          ? inner.ceremonyKind
          : null,
      signerEndpointId: signer.member.endpointId,
      signerPublicKeyHex: signer.member.signingPublicKey,
      innerHex: ancV1BytesToHex(encodeControlLogInnerEnvelope(inner)),
      unsignedHex: ancV1BytesToHex(encodeUnsignedControlLogEntry(unsigned)),
      signatureHex: signature,
      outerHex: ancV1BytesToHex(encodeSignedControlLogEntry(entry)),
      entryHashHex: reduced.entryHash,
      membershipHashHex: reduced.state.membershipHash,
      expectedState: reduced.state,
    });
  };

  const genesis: ControlMembershipCommit = {
    suite: E2EE_SUITE_ID,
    type: "membership_commit",
    vaultId: FIXED_VAULT_ID,
    ceremonyId: "ceremony:native-genesis",
    ceremonyKind: "first_device",
    epoch: 1,
    previousMembershipHash: null,
    activeMembers: [owner.member],
    removedEndpointIds: [],
    rotationCompleted: false,
    outstandingJobsResolved: false,
    recoverySnapshotHash: null,
    recoveryAuthorizationHash: null,
    ...recoveryAuthority,
  };
  await append("genesis", genesis, owner);
  const addDevice: ControlMembershipCommit = {
    ...genesis,
    ceremonyId: "ceremony:native-add-device",
    ceremonyKind: "add_device",
    previousMembershipHash: state!.membershipHash,
    activeMembers: [owner.member, device.member],
  };
  await append("add_device", addDevice, owner);
  const addBroker: ControlMembershipCommit = {
    ...addDevice,
    ceremonyId: "ceremony:native-add-broker",
    ceremonyKind: "add_broker",
    previousMembershipHash: state!.membershipHash,
    activeMembers: [owner.member, device.member, broker.member],
  };
  await append("add_broker", addBroker, owner);
  await append(
    "broker_continuity",
    {
      suite: E2EE_SUITE_ID,
      type: "continuity_checkpoint",
      vaultId: FIXED_VAULT_ID,
      membershipHash: state!.membershipHash,
    },
    broker,
  );
  const removeBroker: ControlMembershipCommit = {
    ...addBroker,
    ceremonyId: "ceremony:native-remove-broker",
    ceremonyKind: "remove_broker",
    epoch: 2,
    previousMembershipHash: state!.membershipHash,
    activeMembers: [owner.member, device.member],
    removedEndpointIds: [broker.member.endpointId],
    rotationCompleted: true,
    outstandingJobsResolved: true,
    recoveryWrapHash: await fixtureHash("native recovery wrap epoch 2"),
  };
  await append("remove_broker", removeBroker, owner);
  const addBrokerReplacementCandidate: ControlMembershipCommit = {
    ...removeBroker,
    ceremonyId: "ceremony:native-add-broker-replacement-candidate",
    ceremonyKind: "add_broker",
    previousMembershipHash: state!.membershipHash,
    activeMembers: [
      owner.member,
      device.member,
      brokerReplacementCandidate.member,
    ],
    removedEndpointIds: [],
    rotationCompleted: false,
    outstandingJobsResolved: false,
  };
  await append(
    "add_broker_replacement_candidate",
    addBrokerReplacementCandidate,
    owner,
  );
  const replaceBroker: ControlMembershipCommit = {
    ...addBrokerReplacementCandidate,
    ceremonyId: "ceremony:native-broker-replacement",
    ceremonyKind: "broker_replacement",
    epoch: 3,
    previousMembershipHash: state!.membershipHash,
    activeMembers: [owner.member, device.member, brokerReplacement.member],
    removedEndpointIds: [brokerReplacementCandidate.member.endpointId],
    rotationCompleted: true,
    outstandingJobsResolved: true,
    recoveryWrapHash: await fixtureHash("native recovery wrap epoch 3"),
  };
  await append("broker_replacement", replaceBroker, owner);
  const removeDevice: ControlMembershipCommit = {
    ...replaceBroker,
    ceremonyId: "ceremony:native-remove-device",
    ceremonyKind: "remove_device",
    epoch: 4,
    previousMembershipHash: state!.membershipHash,
    activeMembers: [owner.member, brokerReplacement.member],
    removedEndpointIds: [device.member.endpointId],
    rotationCompleted: true,
    outstandingJobsResolved: false,
    recoveryWrapHash: await fixtureHash("native recovery wrap epoch 4"),
  };
  await append("remove_device", removeDevice, owner);
  const recovery: ControlMembershipCommit = {
    ...removeDevice,
    ceremonyId: "ceremony:native-recovery",
    ceremonyKind: "recovery",
    epoch: 5,
    previousMembershipHash: state!.membershipHash,
    activeMembers: [recovered.member],
    removedEndpointIds: [
      owner.member.endpointId,
      brokerReplacement.member.endpointId,
    ],
    outstandingJobsResolved: true,
    recoverySnapshotHash: await fixtureHash("native recovery snapshot"),
    recoveryAuthorizationHash: await fixtureHash(
      "native recovery authorization",
    ),
    ...replacementAuthority,
  };
  await append("recovery", recovery, recovered);
  await append(
    "continuity",
    {
      suite: E2EE_SUITE_ID,
      type: "continuity_checkpoint",
      vaultId: FIXED_VAULT_ID,
      membershipHash: state!.membershipHash,
    },
    recovered,
  );
  await append(
    "ceremony_abort",
    {
      suite: E2EE_SUITE_ID,
      type: "ceremony_abort",
      vaultId: FIXED_VAULT_ID,
      ceremonyId: "ceremony:native-abort",
      ceremonyKind: "remove_device",
      ceremonyStateHash: await fixtureHash("native abort state"),
      reasonCode: "user_cancelled",
    },
    recovered,
  );
  await append(
    "grant_revocation",
    {
      suite: E2EE_SUITE_ID,
      type: "grant_revocation",
      vaultId: FIXED_VAULT_ID,
      revocationEnvelope: ancV1BytesToHex(
        await sealAncV1GrantRevocation({
          vaultId: new Uint8Array(16).fill(0x01),
          envelopeId: new Uint8Array(16).fill(0x02),
          createdAt: FIXED_AT / 1_000 + 11,
          grantRef: new Uint8Array(32).fill(0x03),
          revocationRef: new Uint8Array(16).fill(0x04),
          revokedAt: FIXED_AT / 1_000 + 11,
          reason: "user_revoked",
          issuerEndpointId: new Uint8Array(16).fill(0x05),
          signingPrivateKey: recovered.privateKey,
        }),
      ),
    },
    recovered,
  );

  const allAuthorization = {
    genesis: true,
    recovery: true,
    recoveryWrapRotation: true,
    ceremonyAbort: true,
    grantRevocation: true,
  } as const;
  const cases: AncV1NativeControlLogCase[] = [];
  const stateByRef = new Map(
    states.map((vector) => [vector.ref, vector.state]),
  );
  const addState = (ref: string, value: ControlLogState) => {
    states.push({ ref, state: value });
    stateByRef.set(ref, value);
  };
  const stateFor = (ref: string) => {
    if (!stateByRef.has(ref)) throw new Error(`Unknown fixture state ${ref}`);
    return stateByRef.get(ref) ?? null;
  };
  const entryHex = (entry: SignedControlLogEntry) =>
    ancV1BytesToHex(encodeSignedControlLogEntry(entry));
  const signedFor = async (input: {
    priorStateRef: string;
    inner: ControlLogInnerEnvelope;
    signer: FixtureIdentity;
    sequence?: number;
    previousHash?: string;
    createdAt?: string;
    vaultId?: string;
    envelopeId?: string;
  }) => {
    const prior = stateFor(input.priorStateRef);
    return createSignedControlLogEntry({
      vaultId: input.vaultId ?? prior?.vaultId ?? FIXED_VAULT_ID,
      createdAt:
        input.createdAt ??
        (prior
          ? new Date(Date.parse(prior.signedAt) + 1_000).toISOString()
          : fixedTimestamp(0)),
      envelopeId:
        input.envelopeId ?? `case:${input.priorStateRef}:${cases.length}`,
      sequence: input.sequence ?? (prior ? prior.sequence + 1 : 0),
      previousHash:
        input.previousHash ?? prior?.headHash ?? CONTROL_LOG_ZERO_HASH,
      innerEnvelope: input.inner,
      signerEndpointId: input.signer.member.endpointId,
      signingPrivateKey: input.signer.privateKey,
    });
  };
  const mutateOuter = (
    sourceHex: string,
    mutate: (map: Map<number, AncV1CanonicalValue>) => void,
  ): string => {
    const decoded = decodeAncV1Canonical(ancV1HexToBytes(sourceHex));
    if (!(decoded instanceof Map))
      throw new Error("Expected outer fixture map");
    const map = new Map(decoded);
    mutate(map);
    return ancV1BytesToHex(encodeAncV1Canonical(map));
  };
  const mutateInner = (
    sourceHex: string,
    mutate: (map: Map<number, AncV1CanonicalValue>) => void,
  ): string =>
    mutateOuter(sourceHex, (outer) => {
      const key = E2EE_ENVELOPE_FIELDS.logEntry.innerEnvelope;
      const innerBytes = outer.get(key);
      if (!(innerBytes instanceof Uint8Array)) {
        throw new Error("Expected inner fixture bytes");
      }
      const decoded = decodeAncV1Canonical(innerBytes);
      if (!(decoded instanceof Map))
        throw new Error("Expected inner fixture map");
      const inner = new Map(decoded);
      mutate(inner);
      outer.set(key, encodeAncV1Canonical(inner));
    });
  const addCase = async (input: {
    name: string;
    matrix: AncV1NativeControlLogCase["matrix"];
    priorStateRef: string;
    entryHex: string;
    expectedStatus: AncV1NativeControlLogCase["expectedStatus"];
    expectedError?: ControlLogFailureCode;
    authorization?: Partial<AncV1NativeControlLogCase["authorization"]>;
    canonicalErrorCategory?: string;
  }) => {
    const authorization = { ...allAuthorization, ...input.authorization };
    let expectedState: ControlLogState | null = null;
    let expectedEntryHashHex: string | null = null;
    try {
      const reduced = await verifyAndReduceControlLogEntry({
        current: stateFor(input.priorStateRef),
        entry: ancV1HexToBytes(input.entryHex),
        verifyGenesisAuthorization: authorization.genesis
          ? async () => true
          : undefined,
        verifyRecoveryAuthorization: authorization.recovery
          ? async () => true
          : undefined,
        verifyRecoveryWrapRotation: authorization.recoveryWrapRotation
          ? async () => true
          : undefined,
        verifyCeremonyAbortAuthorization: authorization.ceremonyAbort
          ? async () => true
          : undefined,
        verifyGrantRevocationAuthorization: authorization.grantRevocation
          ? async () => true
          : undefined,
      });
      if (input.expectedStatus === "reject") {
        throw new Error(`${input.name} unexpectedly verified`);
      }
      if (reduced.idempotent !== (input.expectedStatus === "idempotent")) {
        throw new Error(`${input.name} returned the wrong replay status`);
      }
      expectedState = reduced.state;
      expectedEntryHashHex = reduced.entryHash;
    } catch (error) {
      if (input.expectedStatus !== "reject") throw error;
      if (
        !(error instanceof ControlLogVerificationError) ||
        error.code !== input.expectedError
      ) {
        throw error;
      }
    }
    const fixtureCase: AncV1NativeControlLogCase = {
      name: input.name,
      matrix: input.matrix,
      priorStateRef: input.priorStateRef,
      entryHex: input.entryHex,
      expectedStatus: input.expectedStatus,
      expectedError: input.expectedError ?? null,
      expectedState,
      expectedEntryHashHex,
      authorization,
      canonicalErrorCategory: input.canonicalErrorCategory ?? null,
    };
    cases.push(fixtureCase);
    return fixtureCase;
  };

  const continuityFor = (current: ControlLogState, vaultId = current.vaultId) =>
    ({
      suite: E2EE_SUITE_ID,
      type: "continuity_checkpoint",
      vaultId,
      membershipHash: current.membershipHash,
    }) as const;

  await addCase({
    name: "idempotent_exact_head",
    matrix: "stateful",
    priorStateRef: "step:add_device",
    entryHex: entryHex(stepEntries.get("add_device")!),
    expectedStatus: "idempotent",
  });
  await addCase({
    name: "rollback_old_sequence",
    matrix: "stateful",
    priorStateRef: "step:add_broker",
    entryHex: entryHex(stepEntries.get("add_device")!),
    expectedStatus: "reject",
    expectedError: "rollback",
  });
  const addBrokerState = stateFor("step:add_broker")!;
  await addCase({
    name: "same_sequence_different_hash_fork",
    matrix: "stateful",
    priorStateRef: "step:add_broker",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "step:add_broker",
        inner: continuityFor(addBrokerState),
        signer: owner,
        sequence: addBrokerState.sequence,
        envelopeId: "case:same-sequence-fork",
      }),
    ),
    expectedStatus: "reject",
    expectedError: "fork",
  });
  await addCase({
    name: "wrong_previous_hash_fork",
    matrix: "stateful",
    priorStateRef: "step:add_broker",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "step:add_broker",
        inner: continuityFor(addBrokerState),
        signer: owner,
        previousHash: "a0".repeat(32),
      }),
    ),
    expectedStatus: "reject",
    expectedError: "fork",
  });
  await addCase({
    name: "sequence_gap",
    matrix: "stateful",
    priorStateRef: "step:add_broker",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "step:add_broker",
        inner: continuityFor(addBrokerState),
        signer: owner,
        sequence: addBrokerState.sequence + 2,
      }),
    ),
    expectedStatus: "reject",
    expectedError: "gap",
  });
  await addCase({
    name: "timestamp_reversal",
    matrix: "stateful",
    priorStateRef: "step:add_broker",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "step:add_broker",
        inner: continuityFor(addBrokerState),
        signer: owner,
        createdAt: new Date(
          Date.parse(addBrokerState.signedAt) - 1,
        ).toISOString(),
      }),
    ),
    expectedStatus: "reject",
    expectedError: "invalid_transition",
  });
  await addCase({
    name: "timestamp_equal_boundary",
    matrix: "stateful",
    priorStateRef: "step:add_broker",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "step:add_broker",
        inner: continuityFor(addBrokerState),
        signer: owner,
        createdAt: addBrokerState.signedAt,
      }),
    ),
    expectedStatus: "accept",
  });
  await addCase({
    name: "wrong_vault",
    matrix: "stateful",
    priorStateRef: "step:add_broker",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "step:add_broker",
        inner: continuityFor(addBrokerState, "vault:native-wrong"),
        signer: owner,
        vaultId: "vault:native-wrong",
      }),
    ),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
  });

  await addCase({
    name: "genesis_authorization_missing",
    matrix: "authorization",
    priorStateRef: "none",
    entryHex: entryHex(stepEntries.get("genesis")!),
    expectedStatus: "reject",
    expectedError: "genesis_authorization_required",
    authorization: { genesis: false },
  });
  await addCase({
    name: "recovery_authorization_missing",
    matrix: "authorization",
    priorStateRef: "step:remove_device",
    entryHex: entryHex(stepEntries.get("recovery")!),
    expectedStatus: "reject",
    expectedError: "recovery_authorization_required",
    authorization: { recovery: false },
  });
  await addCase({
    name: "recovery_wrap_rotation_authorization_missing",
    matrix: "authorization",
    priorStateRef: "step:broker_continuity",
    entryHex: entryHex(stepEntries.get("remove_broker")!),
    expectedStatus: "reject",
    expectedError: "recovery_wrap_rotation_required",
    authorization: { recoveryWrapRotation: false },
  });
  await addCase({
    name: "ceremony_abort_authorization_missing",
    matrix: "authorization",
    priorStateRef: "step:continuity",
    entryHex: entryHex(stepEntries.get("ceremony_abort")!),
    expectedStatus: "reject",
    expectedError: "ceremony_abort_authorization_required",
    authorization: { ceremonyAbort: false },
  });
  await addCase({
    name: "grant_revocation_authorization_missing",
    matrix: "authorization",
    priorStateRef: "step:ceremony_abort",
    entryHex: entryHex(stepEntries.get("grant_revocation")!),
    expectedStatus: "reject",
    expectedError: "grant_revocation_authorization_required",
    authorization: { grantRevocation: false },
  });
  await addCase({
    name: "invalid_detached_signature",
    matrix: "authorization",
    priorStateRef: "step:add_broker",
    entryHex: mutateOuter(
      entryHex(stepEntries.get("broker_continuity")!),
      (outer) =>
        outer.set(
          E2EE_ENVELOPE_FIELDS.logEntry.signature,
          new Uint8Array(64).fill(0xff),
        ),
    ),
    expectedStatus: "reject",
    expectedError: "invalid_signature",
  });
  await addCase({
    name: "unenrolled_signer",
    matrix: "authorization",
    priorStateRef: "step:add_broker",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "step:add_broker",
        inner: continuityFor(addBrokerState),
        signer: recovered,
      }),
    ),
    expectedStatus: "reject",
    expectedError: "unauthorized_signer",
  });
  await addCase({
    name: "candidate_self_enrollment",
    matrix: "authorization",
    priorStateRef: "step:genesis",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "step:genesis",
        inner: addDevice,
        signer: device,
      }),
    ),
    expectedStatus: "reject",
    expectedError: "candidate_self_enrollment",
  });
  await addCase({
    name: "broker_cannot_sign_membership_commit",
    matrix: "authorization",
    priorStateRef: "step:broker_continuity",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "step:broker_continuity",
        inner: removeBroker,
        signer: broker,
      }),
    ),
    expectedStatus: "reject",
    expectedError: "unauthorized_signer",
  });

  const syntheticMember = (
    index: number,
    suffix = "boundary",
  ): ControlLogMember => ({
    endpointId: `endpoint:10-${suffix}-${index.toString().padStart(3, "0")}`,
    role: "endpoint",
    unattended: false,
    signingPublicKey: (0x80 + (index % 16)).toString(16).repeat(32),
    keyAgreementPublicKey: (0x90 + (index % 16)).toString(16).repeat(32),
    enrollmentRef: `enrollment:${suffix}-${index.toString().padStart(3, "0")}`,
  });
  const syntheticState = async (input: {
    ref: string;
    activeMembers: ControlLogMember[];
    removedEndpointIds?: string[];
    sequence?: number;
    epoch?: number;
    recoveryGeneration?: number;
  }) => {
    const value: ControlLogState = {
      vaultId: FIXED_VAULT_ID,
      sequence: input.sequence ?? 100,
      headHash: await fixtureHash(`${input.ref}:head`),
      membershipHash: await fixtureHash(`${input.ref}:membership`),
      signedAt: "2026-07-17T13:00:00.000Z",
      activeMembers: input.activeMembers,
      removedEndpointIds: input.removedEndpointIds ?? [],
      epoch: input.epoch ?? 7,
      recoveryGeneration: input.recoveryGeneration ?? 1,
      recoveryId: FIXED_RECOVERY_ID,
      recoverySigningPublicKey: recoveryAuthority.recoverySigningPublicKey,
      recoveryKeyAgreementPublicKey:
        recoveryAuthority.recoveryKeyAgreementPublicKey,
      recoveryWrapHash: recoveryAuthority.recoveryWrapHash,
      freshnessMode: "endpoint_witnessed",
    };
    addState(input.ref, value);
    return value;
  };
  const commitFromState = (
    current: ControlLogState,
    patch: Partial<ControlMembershipCommit> &
      Pick<ControlMembershipCommit, "ceremonyKind" | "activeMembers">,
  ): ControlMembershipCommit => {
    const { ceremonyKind, activeMembers, ...overrides } = patch;
    return {
      suite: E2EE_SUITE_ID,
      type: "membership_commit",
      vaultId: current.vaultId,
      ceremonyId: `ceremony:${ceremonyKind}:${cases.length}`,
      ceremonyKind,
      epoch: current.epoch,
      previousMembershipHash: current.membershipHash,
      activeMembers,
      removedEndpointIds: [],
      rotationCompleted: false,
      outstandingJobsResolved: false,
      recoverySnapshotHash: null,
      recoveryAuthorizationHash: null,
      recoveryGeneration: current.recoveryGeneration,
      recoveryId: current.recoveryId,
      recoverySigningPublicKey: current.recoverySigningPublicKey,
      recoveryKeyAgreementPublicKey: current.recoveryKeyAgreementPublicKey,
      recoveryWrapHash: current.recoveryWrapHash,
      ...overrides,
    };
  };

  const members63 = [
    owner.member,
    ...Array.from({ length: 62 }, (_, index) => syntheticMember(index)),
  ];
  const state63 = await syntheticState({
    ref: "boundary:63-members",
    activeMembers: members63,
  });
  const member64 = syntheticMember(99, "zz-boundary");
  const active64Entry = await signedFor({
    priorStateRef: "boundary:63-members",
    inner: commitFromState(state63, {
      ceremonyKind: "add_device",
      activeMembers: [...members63, member64],
    }),
    signer: owner,
  });
  const active64Case = await addCase({
    name: "active_members_64_accept",
    matrix: "boundary",
    priorStateRef: "boundary:63-members",
    entryHex: entryHex(active64Entry),
    expectedStatus: "accept",
  });
  addState("boundary:64-members", active64Case.expectedState!);
  const member65Canonical: AncV1CanonicalValue = [
    syntheticMember(100, "zzz-boundary").endpointId,
    "endpoint",
    false,
    new Uint8Array(32).fill(0xaa),
    new Uint8Array(32).fill(0xab),
    "enrollment:zzz-boundary-100",
  ];
  await addCase({
    name: "active_members_65_reject",
    matrix: "boundary",
    priorStateRef: "boundary:63-members",
    entryHex: mutateInner(entryHex(active64Entry), (inner) => {
      const key = E2EE_ENVELOPE_FIELDS.controlMembership.activeMembers;
      const members = inner.get(key);
      if (!Array.isArray(members)) throw new Error("Expected member array");
      inner.set(key, [...members, member65Canonical]);
    }),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "limits.active_members_65",
  });

  const victim = await fixtureIdentity(
    0x27,
    "endpoint:99-boundary-victim",
    "endpoint",
  );
  const tombstones4095 = Array.from(
    { length: 4_095 },
    (_, index) => `removed:${index.toString().padStart(4, "0")}`,
  );
  const state4095 = await syntheticState({
    ref: "boundary:4095-tombstones",
    activeMembers: [owner.member, victim.member],
    removedEndpointIds: tombstones4095,
  });
  const removal4096 = commitFromState(state4095, {
    ceremonyKind: "remove_device",
    activeMembers: [owner.member],
    epoch: state4095.epoch + 1,
    removedEndpointIds: [victim.member.endpointId],
    rotationCompleted: true,
    recoveryWrapHash: await fixtureHash("boundary tombstone wrap 4096"),
  });
  const tombstone4096Entry = await signedFor({
    priorStateRef: "boundary:4095-tombstones",
    inner: removal4096,
    signer: owner,
  });
  const tombstone4096Case = await addCase({
    name: "tombstones_4096_accept",
    matrix: "boundary",
    priorStateRef: "boundary:4095-tombstones",
    entryHex: entryHex(tombstone4096Entry),
    expectedStatus: "accept",
  });
  addState("boundary:4096-tombstones", tombstone4096Case.expectedState!);
  const state4096WithVictim = await syntheticState({
    ref: "boundary:4096-tombstones-with-victim",
    activeMembers: [owner.member, victim.member],
    removedEndpointIds: tombstones4095.concat("removed:4095"),
  });
  const removal4097 = commitFromState(state4096WithVictim, {
    ceremonyKind: "remove_device",
    activeMembers: [owner.member],
    epoch: state4096WithVictim.epoch + 1,
    removedEndpointIds: [victim.member.endpointId],
    rotationCompleted: true,
    recoveryWrapHash: await fixtureHash("boundary tombstone wrap 4097"),
  });
  await addCase({
    name: "tombstones_4097_reject",
    matrix: "boundary",
    priorStateRef: "boundary:4096-tombstones-with-victim",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "boundary:4096-tombstones-with-victim",
        inner: removal4097,
        signer: owner,
      }),
    ),
    expectedStatus: "reject",
    expectedError: "invalid_transition",
  });

  const removalMembers64 = [
    owner.member,
    ...Array.from({ length: 63 }, (_, index) =>
      syntheticMember(index, "recovery-boundary"),
    ),
  ];
  const removalState64 = await syntheticState({
    ref: "boundary:64-removal-members",
    activeMembers: removalMembers64,
  });
  const removal64Commit = commitFromState(removalState64, {
    ceremonyKind: "recovery",
    activeMembers: [recovered.member],
    epoch: removalState64.epoch + 1,
    removedEndpointIds: removalMembers64.map((member) => member.endpointId),
    rotationCompleted: true,
    recoverySnapshotHash: await fixtureHash("boundary recovery snapshot 64"),
    recoveryAuthorizationHash: await fixtureHash("boundary recovery auth 64"),
    ...replacementAuthority,
  });
  const removal64Entry = await signedFor({
    priorStateRef: "boundary:64-removal-members",
    inner: removal64Commit,
    signer: recovered,
  });
  await addCase({
    name: "removed_endpoint_ids_64_accept",
    matrix: "boundary",
    priorStateRef: "boundary:64-removal-members",
    entryHex: entryHex(removal64Entry),
    expectedStatus: "accept",
  });
  await addCase({
    name: "removed_endpoint_ids_65_reject",
    matrix: "boundary",
    priorStateRef: "boundary:64-removal-members",
    entryHex: mutateInner(entryHex(removal64Entry), (inner) => {
      const key = E2EE_ENVELOPE_FIELDS.controlMembership.removedEndpointIds;
      const removed = inner.get(key);
      if (!Array.isArray(removed)) throw new Error("Expected removed array");
      inner.set(key, [...removed, "endpoint:zz-extra-removed"]);
    }),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "limits.removed_endpoint_ids_65",
  });

  const maxSequenceState = await syntheticState({
    ref: "boundary:max-sequence-minus-one",
    activeMembers: [owner.member],
    sequence: Number.MAX_SAFE_INTEGER - 1,
  });
  const maxSequenceEntry = await signedFor({
    priorStateRef: "boundary:max-sequence-minus-one",
    inner: continuityFor(maxSequenceState),
    signer: owner,
    sequence: Number.MAX_SAFE_INTEGER,
  });
  await addCase({
    name: "safe_integer_sequence_accept",
    matrix: "boundary",
    priorStateRef: "boundary:max-sequence-minus-one",
    entryHex: entryHex(maxSequenceEntry),
    expectedStatus: "accept",
  });
  await addCase({
    name: "sequence_safe_integer_overflow_reject",
    matrix: "boundary",
    priorStateRef: "boundary:max-sequence-minus-one",
    entryHex: entryHex(maxSequenceEntry).replace(
      "1b001fffffffffffff",
      "1b0020000000000000",
    ),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "limits.sequence_safe_integer_overflow",
  });

  const maxEpochState = await syntheticState({
    ref: "boundary:max-epoch-minus-one",
    activeMembers: [owner.member, victim.member],
    epoch: Number.MAX_SAFE_INTEGER - 1,
  });
  const maxEpochCommit = commitFromState(maxEpochState, {
    ceremonyKind: "remove_device",
    activeMembers: [owner.member],
    epoch: Number.MAX_SAFE_INTEGER,
    removedEndpointIds: [victim.member.endpointId],
    rotationCompleted: true,
    recoveryWrapHash: await fixtureHash("boundary max epoch wrap"),
  });
  const maxEpochEntry = await signedFor({
    priorStateRef: "boundary:max-epoch-minus-one",
    inner: maxEpochCommit,
    signer: owner,
  });
  await addCase({
    name: "safe_integer_epoch_accept",
    matrix: "boundary",
    priorStateRef: "boundary:max-epoch-minus-one",
    entryHex: entryHex(maxEpochEntry),
    expectedStatus: "accept",
  });
  await addCase({
    name: "epoch_safe_integer_overflow_reject",
    matrix: "boundary",
    priorStateRef: "boundary:max-epoch-minus-one",
    entryHex: mutateOuter(entryHex(maxEpochEntry), (outer) => {
      const key = E2EE_ENVELOPE_FIELDS.logEntry.innerEnvelope;
      const inner = outer.get(key) as Uint8Array;
      outer.set(
        key,
        ancV1HexToBytes(
          ancV1BytesToHex(inner).replace(
            "1b001fffffffffffff",
            "1b0020000000000000",
          ),
        ),
      );
    }),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "limits.epoch_safe_integer_overflow",
  });

  const maxRecoveryState = await syntheticState({
    ref: "boundary:max-recovery-generation-minus-one",
    activeMembers: [owner.member],
    recoveryGeneration: Number.MAX_SAFE_INTEGER - 1,
  });
  const maxRecoveryCommit = commitFromState(maxRecoveryState, {
    ceremonyKind: "recovery",
    activeMembers: [recovered.member],
    epoch: maxRecoveryState.epoch + 1,
    removedEndpointIds: [owner.member.endpointId],
    rotationCompleted: true,
    recoverySnapshotHash: await fixtureHash("boundary max recovery snapshot"),
    recoveryAuthorizationHash: await fixtureHash("boundary max recovery auth"),
    recoveryGeneration: Number.MAX_SAFE_INTEGER,
    recoveryId: FIXED_RECOVERY_REPLACEMENT_ID,
    recoverySigningPublicKey: replacementAuthority.recoverySigningPublicKey,
    recoveryKeyAgreementPublicKey:
      replacementAuthority.recoveryKeyAgreementPublicKey,
    recoveryWrapHash: replacementAuthority.recoveryWrapHash,
  });
  const maxRecoveryEntry = await signedFor({
    priorStateRef: "boundary:max-recovery-generation-minus-one",
    inner: maxRecoveryCommit,
    signer: recovered,
  });
  await addCase({
    name: "safe_integer_recovery_generation_accept",
    matrix: "boundary",
    priorStateRef: "boundary:max-recovery-generation-minus-one",
    entryHex: entryHex(maxRecoveryEntry),
    expectedStatus: "accept",
  });
  await addCase({
    name: "recovery_generation_safe_integer_overflow_reject",
    matrix: "boundary",
    priorStateRef: "boundary:max-recovery-generation-minus-one",
    entryHex: mutateOuter(entryHex(maxRecoveryEntry), (outer) => {
      const key = E2EE_ENVELOPE_FIELDS.logEntry.innerEnvelope;
      const inner = outer.get(key) as Uint8Array;
      outer.set(
        key,
        ancV1HexToBytes(
          ancV1BytesToHex(inner).replace(
            "1b001fffffffffffff",
            "1b0020000000000000",
          ),
        ),
      );
    }),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "limits.recovery_generation_safe_integer_overflow",
  });

  const transitionState = stateFor("step:add_device")!;
  const mutatedOwner: ControlLogMember = {
    ...owner.member,
    keyAgreementPublicKey: "dd".repeat(32),
  };
  const transitionCases: readonly {
    name: string;
    priorStateRef: string;
    commit: ControlMembershipCommit;
    signer?: FixtureIdentity;
    expectedError?: ControlLogFailureCode;
  }[] = [
    {
      name: "retained_member_key_mutation",
      priorStateRef: "step:add_device",
      commit: commitFromState(transitionState, {
        ceremonyKind: "add_broker",
        activeMembers: [mutatedOwner, device.member, broker.member],
      }),
    },
    {
      name: "removed_ids_do_not_match_removed_member",
      priorStateRef: "step:add_device",
      commit: commitFromState(transitionState, {
        ceremonyKind: "remove_device",
        activeMembers: [owner.member],
        epoch: transitionState.epoch + 1,
        removedEndpointIds: [],
        rotationCompleted: true,
        recoveryWrapHash: await fixtureHash("negative removed mismatch wrap"),
      }),
    },
    {
      name: "add_device_with_broker_role",
      priorStateRef: "step:add_device",
      commit: commitFromState(transitionState, {
        ceremonyKind: "add_device",
        activeMembers: [owner.member, device.member, broker.member],
      }),
    },
    {
      name: "add_device_adds_two_members",
      priorStateRef: "step:genesis",
      commit: commitFromState(stateFor("step:genesis")!, {
        ceremonyKind: "add_device",
        activeMembers: [owner.member, device.member, syntheticMember(200)],
      }),
    },
    {
      name: "add_device_changes_epoch",
      priorStateRef: "step:genesis",
      commit: commitFromState(stateFor("step:genesis")!, {
        ceremonyKind: "add_device",
        activeMembers: [owner.member, device.member],
        epoch: 2,
        recoveryWrapHash: await fixtureHash("negative add epoch wrap"),
      }),
    },
    {
      name: "add_device_claims_rotation_complete",
      priorStateRef: "step:genesis",
      commit: commitFromState(stateFor("step:genesis")!, {
        ceremonyKind: "add_device",
        activeMembers: [owner.member, device.member],
        rotationCompleted: true,
      }),
    },
    {
      name: "add_device_claims_jobs_resolved",
      priorStateRef: "step:genesis",
      commit: commitFromState(stateFor("step:genesis")!, {
        ceremonyKind: "add_device",
        activeMembers: [owner.member, device.member],
        outstandingJobsResolved: true,
      }),
    },
    {
      name: "wrap_changes_without_epoch_rotation",
      priorStateRef: "step:genesis",
      commit: commitFromState(stateFor("step:genesis")!, {
        ceremonyKind: "add_device",
        activeMembers: [owner.member, device.member],
        recoveryWrapHash: await fixtureHash("negative wrap without epoch"),
      }),
    },
    {
      name: "wrap_unchanged_with_epoch_rotation",
      priorStateRef: "step:add_device",
      commit: commitFromState(transitionState, {
        ceremonyKind: "remove_device",
        activeMembers: [owner.member],
        epoch: transitionState.epoch + 1,
        removedEndpointIds: [device.member.endpointId],
        rotationCompleted: true,
      }),
    },
    {
      name: "non_recovery_changes_recovery_generation",
      priorStateRef: "step:genesis",
      commit: commitFromState(stateFor("step:genesis")!, {
        ceremonyKind: "add_device",
        activeMembers: [owner.member, device.member],
        recoveryGeneration: 2,
      }),
    },
    {
      name: "non_recovery_changes_recovery_id",
      priorStateRef: "step:genesis",
      commit: commitFromState(stateFor("step:genesis")!, {
        ceremonyKind: "add_device",
        activeMembers: [owner.member, device.member],
        recoveryId: FIXED_RECOVERY_REPLACEMENT_ID,
      }),
    },
    {
      name: "non_recovery_changes_recovery_signing_key",
      priorStateRef: "step:genesis",
      commit: commitFromState(stateFor("step:genesis")!, {
        ceremonyKind: "add_device",
        activeMembers: [owner.member, device.member],
        recoverySigningPublicKey: replacementAuthority.recoverySigningPublicKey,
      }),
    },
    {
      name: "non_recovery_changes_recovery_agreement_key",
      priorStateRef: "step:genesis",
      commit: commitFromState(stateFor("step:genesis")!, {
        ceremonyKind: "add_device",
        activeMembers: [owner.member, device.member],
        recoveryKeyAgreementPublicKey:
          replacementAuthority.recoveryKeyAgreementPublicKey,
      }),
    },
    {
      name: "remove_device_targets_broker_role",
      priorStateRef: "step:add_broker",
      commit: commitFromState(addBrokerState, {
        ceremonyKind: "remove_device",
        activeMembers: [owner.member, device.member],
        epoch: addBrokerState.epoch + 1,
        removedEndpointIds: [broker.member.endpointId],
        rotationCompleted: true,
        recoveryWrapHash: await fixtureHash("negative remove broker as device"),
      }),
    },
    {
      name: "remove_broker_without_resolving_jobs",
      priorStateRef: "step:broker_continuity",
      commit: { ...removeBroker, outstandingJobsResolved: false },
    },
    {
      name: "broker_replacement_without_added_broker",
      priorStateRef: "step:add_broker",
      commit: commitFromState(addBrokerState, {
        ceremonyKind: "broker_replacement",
        activeMembers: [owner.member, device.member],
        epoch: addBrokerState.epoch + 1,
        removedEndpointIds: [broker.member.endpointId],
        rotationCompleted: true,
        outstandingJobsResolved: true,
        recoveryWrapHash: await fixtureHash("negative replacement count wrap"),
      }),
    },
    {
      name: "removed_signer_cannot_authorize_own_removal",
      priorStateRef: "step:add_device",
      commit: commitFromState(transitionState, {
        ceremonyKind: "remove_device",
        activeMembers: [owner.member],
        epoch: transitionState.epoch + 1,
        removedEndpointIds: [device.member.endpointId],
        rotationCompleted: true,
        recoveryWrapHash: await fixtureHash("negative removed signer wrap"),
      }),
      signer: device,
      expectedError: "unauthorized_signer",
    },
  ];
  for (const negative of transitionCases) {
    await addCase({
      name: negative.name,
      matrix: "transition",
      priorStateRef: negative.priorStateRef,
      entryHex: entryHex(
        await signedFor({
          priorStateRef: negative.priorStateRef,
          inner: negative.commit,
          signer: negative.signer ?? owner,
        }),
      ),
      expectedStatus: "reject",
      expectedError: negative.expectedError ?? "invalid_transition",
    });
  }

  const resurrectionState = await syntheticState({
    ref: "transition:tombstoned-device",
    activeMembers: [owner.member],
    removedEndpointIds: [device.member.endpointId],
  });
  await addCase({
    name: "tombstoned_endpoint_resurrection",
    matrix: "transition",
    priorStateRef: "transition:tombstoned-device",
    entryHex: entryHex(
      await signedFor({
        priorStateRef: "transition:tombstoned-device",
        inner: commitFromState(resurrectionState, {
          ceremonyKind: "add_device",
          activeMembers: [owner.member, device.member],
        }),
        signer: owner,
      }),
    ),
    expectedStatus: "reject",
    expectedError: "invalid_transition",
  });

  const recoveryPrior = stateFor("step:remove_device")!;
  const recoveryNegatives: readonly [string, ControlMembershipCommit][] = [
    [
      "recovery_keeps_multiple_active_members",
      {
        ...recovery,
        activeMembers: [recovered.member, syntheticMember(250)],
      },
    ],
    [
      "recovery_does_not_remove_every_prior_member",
      { ...recovery, removedEndpointIds: [owner.member.endpointId] },
    ],
    [
      "recovery_epoch_not_incremented",
      { ...recovery, epoch: recoveryPrior.epoch },
    ],
    [
      "recovery_rotation_not_completed",
      { ...recovery, rotationCompleted: false },
    ],
    [
      "recovery_broker_jobs_not_resolved",
      { ...recovery, outstandingJobsResolved: false },
    ],
    [
      "recovery_generation_not_incremented",
      { ...recovery, recoveryGeneration: recoveryPrior.recoveryGeneration },
    ],
    [
      "recovery_id_not_replaced",
      { ...recovery, recoveryId: recoveryPrior.recoveryId },
    ],
    [
      "recovery_signing_key_not_replaced",
      {
        ...recovery,
        recoverySigningPublicKey: recoveryPrior.recoverySigningPublicKey,
      },
    ],
    [
      "recovery_agreement_key_not_replaced",
      {
        ...recovery,
        recoveryKeyAgreementPublicKey:
          recoveryPrior.recoveryKeyAgreementPublicKey,
      },
    ],
    [
      "recovery_wrap_not_replaced",
      { ...recovery, recoveryWrapHash: recoveryPrior.recoveryWrapHash },
    ],
  ];
  for (const [name, commit] of recoveryNegatives) {
    await addCase({
      name,
      matrix: "transition",
      priorStateRef: "step:remove_device",
      entryHex: entryHex(
        await signedFor({
          priorStateRef: "step:remove_device",
          inner: commit,
          signer: recovered,
        }),
      ),
      expectedStatus: "reject",
      expectedError: "invalid_transition",
    });
  }

  const genesisHex = entryHex(stepEntries.get("genesis")!);
  const outerSignature = E2EE_ENVELOPE_FIELDS.logEntry.signature;
  const outerSequence = E2EE_ENVELOPE_FIELDS.logEntry.sequence;
  const basicWireCases = [
    ["non_shortest_integer", "1817", "canonical.non_shortest"],
    ["indefinite_array", "9f01ff", "canonical.indefinite"],
    ["duplicate_map_key", "a201010102", "canonical.duplicate_map_key"],
    ["map_key_order", "a202010101", "canonical.map_key_order"],
    ["unsupported_float", "f93e00", "canonical.unsupported_float"],
    ["invalid_utf8", "61ff", "canonical.invalid_utf8"],
    ["simple_undefined", "f7", "canonical.simple"],
    ["unexpected_break", "ff", "canonical.break"],
    ["truncated_map", "a1", "canonical.truncation"],
    ["trailing_data", `${genesisHex}00`, "canonical.trailing_data"],
  ] as const;
  for (const [name, bytes, category] of basicWireCases) {
    await addCase({
      name,
      matrix: "wire",
      priorStateRef: "none",
      entryHex: bytes,
      expectedStatus: "reject",
      expectedError: "invalid_entry",
      canonicalErrorCategory: category,
    });
  }
  await addCase({
    name: "unknown_outer_field",
    matrix: "wire",
    priorStateRef: "none",
    entryHex: mutateOuter(genesisHex, (map) => map.set(99, "unknown")),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "envelope.unknown_field",
  });
  await addCase({
    name: "missing_outer_signature",
    matrix: "wire",
    priorStateRef: "none",
    entryHex: mutateOuter(genesisHex, (map) => map.delete(outerSignature)),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "envelope.missing_required",
  });
  await addCase({
    name: "outer_sequence_wrong_type",
    matrix: "wire",
    priorStateRef: "none",
    entryHex: mutateOuter(genesisHex, (map) => map.set(outerSequence, "zero")),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "envelope.wrong_type",
  });
  await addCase({
    name: "non_canonical_inner",
    matrix: "wire",
    priorStateRef: "none",
    entryHex: mutateOuter(genesisHex, (map) =>
      map.set(
        E2EE_ENVELOPE_FIELDS.logEntry.innerEnvelope,
        Uint8Array.from([0xa2, 0x02, 0x01, 0x01, 0x01]),
      ),
    ),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "inner.non_canonical",
  });

  const innerMatrixSources = [
    {
      name: "membership",
      source: genesisHex,
      priorStateRef: "none",
      requiredKey: E2EE_ENVELOPE_FIELDS.controlMembership.ceremonyId,
    },
    {
      name: "continuity",
      source: entryHex(stepEntries.get("continuity")!),
      priorStateRef: "step:recovery",
      requiredKey: E2EE_ENVELOPE_FIELDS.controlContinuity.membershipHash,
    },
    {
      name: "abort",
      source: entryHex(stepEntries.get("ceremony_abort")!),
      priorStateRef: "step:continuity",
      requiredKey: E2EE_ENVELOPE_FIELDS.controlCeremonyAbort.ceremonyId,
    },
  ] as const;
  for (const source of innerMatrixSources) {
    for (const mutation of ["unknown", "missing", "wrong_type"] as const) {
      await addCase({
        name: `${source.name}_inner_${mutation}_field`,
        matrix: "wire",
        priorStateRef: source.priorStateRef,
        entryHex: mutateInner(source.source, (inner) => {
          if (mutation === "unknown") inner.set(999, "unknown");
          if (mutation === "missing") inner.delete(source.requiredKey);
          if (mutation === "wrong_type") inner.set(source.requiredKey, false);
        }),
        expectedStatus: "reject",
        expectedError: "invalid_entry",
        canonicalErrorCategory: `inner.${source.name}.${mutation}`,
      });
    }
  }

  const addDeviceHex = entryHex(stepEntries.get("add_device")!);
  const recoveryHex = entryHex(stepEntries.get("recovery")!);
  const membershipMembersKey =
    E2EE_ENVELOPE_FIELDS.controlMembership.activeMembers;
  await addCase({
    name: "non_recovery_binds_recovery_artifacts",
    matrix: "transition",
    priorStateRef: "step:genesis",
    entryHex: mutateInner(addDeviceHex, (inner) => {
      inner.set(
        E2EE_ENVELOPE_FIELDS.controlMembership.recoverySnapshotHash,
        new Uint8Array(32).fill(0x71),
      );
      inner.set(
        E2EE_ENVELOPE_FIELDS.controlMembership.recoveryAuthorizationHash,
        new Uint8Array(32).fill(0x72),
      );
    }),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "transition.non_recovery_artifacts",
  });
  for (const [name, field] of [
    [
      "recovery_missing_snapshot_hash",
      E2EE_ENVELOPE_FIELDS.controlMembership.recoverySnapshotHash,
    ],
    [
      "recovery_missing_authorization_hash",
      E2EE_ENVELOPE_FIELDS.controlMembership.recoveryAuthorizationHash,
    ],
  ] as const) {
    await addCase({
      name,
      matrix: "transition",
      priorStateRef: "step:remove_device",
      entryHex: mutateInner(recoveryHex, (inner) => inner.set(field, null)),
      expectedStatus: "reject",
      expectedError: "invalid_entry",
      canonicalErrorCategory: "transition.recovery_artifact_missing",
    });
  }
  await addCase({
    name: "two_active_brokers",
    matrix: "transition",
    priorStateRef: "step:add_device",
    entryHex: mutateInner(entryHex(stepEntries.get("add_broker")!), (inner) => {
      const members = inner.get(membershipMembersKey);
      if (!Array.isArray(members)) throw new Error("Expected members");
      inner.set(membershipMembersKey, [
        ...members,
        [
          brokerReplacementCandidate.member.endpointId,
          "broker",
          true,
          ancV1HexToBytes(brokerReplacementCandidate.member.signingPublicKey),
          ancV1HexToBytes(
            brokerReplacementCandidate.member.keyAgreementPublicKey,
          ),
          brokerReplacementCandidate.member.enrollmentRef,
        ],
      ]);
    }),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "transition.multiple_brokers",
  });
  await addCase({
    name: "members_out_of_order",
    matrix: "wire",
    priorStateRef: "step:genesis",
    entryHex: mutateInner(addDeviceHex, (inner) => {
      const members = inner.get(membershipMembersKey);
      if (!Array.isArray(members)) throw new Error("Expected members");
      inner.set(membershipMembersKey, [...members].reverse());
    }),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "ordering.members",
  });
  await addCase({
    name: "duplicate_member_id",
    matrix: "wire",
    priorStateRef: "step:genesis",
    entryHex: mutateInner(addDeviceHex, (inner) => {
      const members = inner.get(membershipMembersKey);
      if (!Array.isArray(members)) throw new Error("Expected members");
      inner.set(membershipMembersKey, [members[0]!, members[0]!]);
    }),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "duplicates.members",
  });
  await addCase({
    name: "member_signing_key_wrong_length",
    matrix: "wire",
    priorStateRef: "step:genesis",
    entryHex: mutateInner(addDeviceHex, (inner) => {
      const members = inner.get(membershipMembersKey);
      if (!Array.isArray(members) || !Array.isArray(members[0])) {
        throw new Error("Expected member tuple");
      }
      const member = [...members[0]];
      member[3] = new Uint8Array(31);
      inner.set(membershipMembersKey, [member, members[1]!]);
    }),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "length.member_signing_key",
  });
  await addCase({
    name: "member_role_unattended_mismatch",
    matrix: "wire",
    priorStateRef: "step:genesis",
    entryHex: mutateInner(addDeviceHex, (inner) => {
      const members = inner.get(membershipMembersKey);
      if (!Array.isArray(members) || !Array.isArray(members[1])) {
        throw new Error("Expected member tuple");
      }
      const member = [...members[1]];
      member[2] = true;
      inner.set(membershipMembersKey, [members[0]!, member]);
    }),
    expectedStatus: "reject",
    expectedError: "invalid_entry",
    canonicalErrorCategory: "member.role_unattended_mismatch",
  });

  const recoveryRemovedKey =
    E2EE_ENVELOPE_FIELDS.controlMembership.removedEndpointIds;
  for (const mutation of ["order", "duplicate"] as const) {
    await addCase({
      name: `removed_ids_${mutation}`,
      matrix: "wire",
      priorStateRef: "step:remove_device",
      entryHex: mutateInner(recoveryHex, (inner) => {
        const removed = inner.get(recoveryRemovedKey);
        if (!Array.isArray(removed)) throw new Error("Expected removed IDs");
        inner.set(
          recoveryRemovedKey,
          mutation === "order"
            ? [...removed].reverse()
            : [removed[0]!, removed[0]!],
        );
      }),
      expectedStatus: "reject",
      expectedError: "invalid_entry",
      canonicalErrorCategory: `${mutation === "order" ? "ordering" : "duplicates"}.removed_ids`,
    });
  }

  const structuralWireCases: readonly {
    name: string;
    entryHex: string;
    category: string;
    priorStateRef?: string;
  }[] = [
    {
      name: "outer_vault_id_too_short",
      entryHex: mutateOuter(genesisHex, (outer) =>
        outer.set(E2EE_ENVELOPE_FIELDS.common.vaultId, "short"),
      ),
      category: "id.too_short",
    },
    {
      name: "inner_ceremony_id_too_long",
      entryHex: mutateInner(genesisHex, (inner) =>
        inner.set(
          E2EE_ENVELOPE_FIELDS.controlMembership.ceremonyId,
          `x${"a".repeat(160)}`,
        ),
      ),
      category: "id.too_long",
    },
    {
      name: "invalid_timestamp",
      entryHex: mutateOuter(genesisHex, (outer) =>
        outer.set(E2EE_ENVELOPE_FIELDS.common.createdAt, "not-a-timestamp"),
      ),
      category: "timestamp.invalid",
    },
    {
      name: "previous_hash_wrong_length",
      entryHex: mutateOuter(genesisHex, (outer) =>
        outer.set(
          E2EE_ENVELOPE_FIELDS.logEntry.previousHash,
          new Uint8Array(31),
        ),
      ),
      category: "length.previous_hash",
    },
    {
      name: "signature_wrong_length",
      entryHex: mutateOuter(genesisHex, (outer) =>
        outer.set(outerSignature, new Uint8Array(63)),
      ),
      category: "length.signature",
    },
    {
      name: "continuity_membership_hash_wrong_length",
      priorStateRef: "step:recovery",
      entryHex: mutateInner(entryHex(stepEntries.get("continuity")!), (inner) =>
        inner.set(
          E2EE_ENVELOPE_FIELDS.controlContinuity.membershipHash,
          new Uint8Array(31),
        ),
      ),
      category: "length.membership_hash",
    },
    {
      name: "unknown_inner_type",
      entryHex: mutateInner(genesisHex, (inner) =>
        inner.set(E2EE_ENVELOPE_FIELDS.common.type, "unknown_inner"),
      ),
      category: "inner.unknown_type",
    },
    {
      name: "excessive_canonical_depth",
      entryHex: `${"81".repeat(34)}00`,
      category: "limits.depth",
    },
    {
      name: "non_integer_map_key",
      entryHex: "a1616101",
      category: "canonical.map_key_type",
    },
    {
      name: "negative_map_key",
      entryHex: "a12001",
      category: "canonical.map_key_negative",
    },
    {
      name: "oversized_log_entry",
      entryHex: ancV1BytesToHex(
        new Uint8Array(E2EE_SIZE_LIMITS.vaultLogEntryBytes + 1),
      ),
      category: "limits.log_entry_bytes",
    },
  ];
  for (const fixture of structuralWireCases) {
    await addCase({
      name: fixture.name,
      matrix: "wire",
      priorStateRef: fixture.priorStateRef ?? "none",
      entryHex: fixture.entryHex,
      expectedStatus: "reject",
      expectedError: "invalid_entry",
      canonicalErrorCategory: fixture.category,
    });
  }

  return {
    schema: ANC_V1_NATIVE_CONTROL_LOG_CORPUS_SCHEMA,
    suite: E2EE_SUITE_ID,
    encoding: "hex",
    generator: ANC_V1_NATIVE_CONTROL_LOG_GENERATOR,
    protocolBaseCommit: provenance.protocolBaseCommit,
    sourceAnchors: provenance.sources.map((source) => ({ ...source })),
    domains: ["signature", "entry_hash", "membership_hash"].map(
      (operation) => ({
        operation: operation as "signature" | "entry_hash" | "membership_hash",
        tag: "log-entry" as const,
        escaped: "anc/v1/log-entry\\u0000" as const,
        utf8Hex: ancV1BytesToHex(e2eeDomainSeparationPrefix("log-entry")),
      }),
    ),
    identities: {
      owner: owner.member,
      device: device.member,
      broker: broker.member,
      brokerReplacementCandidate: brokerReplacementCandidate.member,
      brokerReplacement: brokerReplacement.member,
      recovered: recovered.member,
    },
    states,
    steps,
    cases,
  };
}

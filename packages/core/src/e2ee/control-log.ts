import { z } from "zod";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";
import { ceremonyKindSchema } from "./ceremonies.js";
import {
  boundedProtocolTokenSchema,
  opaqueIdSchema,
  protocolTimestampSchema,
} from "./contracts.js";
import {
  ancV1Hash,
  ancV1SignDetached,
  ancV1VerifyDetached,
} from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_LIFETIME_LIMITS_SECONDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
} from "./suite.js";

const ZERO_HASH = "00".repeat(32);
const MAX_CONTROL_LOG_TOMBSTONES = 4_096;
const lowerHex = (bytes: number) =>
  z
    .string()
    .length(bytes * 2)
    .regex(/^[0-9a-f]+$/);
const hashSchema = lowerHex(32);
const publicKeySchema = lowerHex(32);
const signatureSchema = lowerHex(64);
const safeSequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const controlLogMemberSchema = z
  .object({
    endpointId: opaqueIdSchema,
    role: z.enum(["endpoint", "broker"]),
    unattended: z.boolean(),
    signingPublicKey: publicKeySchema,
    keyAgreementPublicKey: publicKeySchema,
    enrollmentRef: opaqueIdSchema,
  })
  .strict()
  .superRefine((member, ctx) => {
    if (member.role === "endpoint" && member.unattended) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unattended"],
        message: "Only a broker may be unattended",
      });
    }
    if (member.role === "broker" && !member.unattended) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unattended"],
        message: "A broker must bind unattended authority",
      });
    }
  });

export type ControlLogMember = z.infer<typeof controlLogMemberSchema>;

const membershipCeremonyKindSchema = z.enum([
  "first_device",
  "add_device",
  "add_broker",
  "remove_device",
  "remove_broker",
  "broker_replacement",
  "recovery",
]);

const sortedMembersSchema = z
  .array(controlLogMemberSchema)
  .min(1)
  .max(64)
  .superRefine((members, ctx) => {
    const ids = members.map((member) => member.endpointId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active endpoint IDs must be unique",
      });
    }
    if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active members must be strictly sorted by endpoint ID",
      });
    }
    if (members.filter((member) => member.role === "broker").length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At most one active broker is allowed",
      });
    }
  });

const sortedRemovedIdsSchema = z
  .array(opaqueIdSchema)
  .max(64)
  .superRefine((ids, ctx) => {
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id, index) => index > 0 && ids[index - 1]! >= id)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Removed endpoint IDs must be unique and strictly sorted",
      });
    }
  });

const accumulatedRemovedIdsSchema = z
  .array(opaqueIdSchema)
  .max(MAX_CONTROL_LOG_TOMBSTONES)
  .superRefine((ids, ctx) => {
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id, index) => index > 0 && ids[index - 1]! >= id)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Removed endpoint tombstones must be unique and sorted",
      });
    }
  });

export const controlMembershipCommitSchema = z
  .object({
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("membership_commit"),
    vaultId: opaqueIdSchema,
    ceremonyId: opaqueIdSchema,
    ceremonyKind: membershipCeremonyKindSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    previousMembershipHash: hashSchema.nullable(),
    activeMembers: sortedMembersSchema,
    removedEndpointIds: sortedRemovedIdsSchema,
    rotationCompleted: z.boolean(),
    outstandingJobsResolved: z.boolean(),
    recoverySnapshotHash: hashSchema.nullable(),
    recoveryAuthorizationHash: hashSchema.nullable(),
    recoveryGeneration: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    recoveryId: opaqueIdSchema,
    recoverySigningPublicKey: publicKeySchema,
    recoveryKeyAgreementPublicKey: publicKeySchema,
    recoveryWrapHash: hashSchema,
  })
  .strict()
  .superRefine((commit, ctx) => {
    const active = new Set(
      commit.activeMembers.map((member) => member.endpointId),
    );
    if (commit.removedEndpointIds.some((id) => active.has(id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["removedEndpointIds"],
        message: "An endpoint cannot be both active and removed",
      });
    }
    const recovery = commit.ceremonyKind === "recovery";
    const hasRecoverySnapshot = commit.recoverySnapshotHash !== null;
    const hasRecoveryAuthorization = commit.recoveryAuthorizationHash !== null;
    if (
      (recovery && (!hasRecoverySnapshot || !hasRecoveryAuthorization)) ||
      (!recovery && (hasRecoverySnapshot || hasRecoveryAuthorization))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recovery must bind both snapshot and authorization hashes",
      });
    }
  });

export const controlContinuityCheckpointSchema = z
  .object({
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("continuity_checkpoint"),
    vaultId: opaqueIdSchema,
    membershipHash: hashSchema,
  })
  .strict();

export const controlCeremonyAbortSchema = z
  .object({
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("ceremony_abort"),
    vaultId: opaqueIdSchema,
    ceremonyId: opaqueIdSchema,
    ceremonyKind: ceremonyKindSchema,
    ceremonyStateHash: hashSchema,
    reasonCode: boundedProtocolTokenSchema.max(120),
  })
  .strict();

export const controlLogInnerEnvelopeSchema = z.discriminatedUnion("type", [
  controlMembershipCommitSchema,
  controlContinuityCheckpointSchema,
  controlCeremonyAbortSchema,
]);

export type ControlMembershipCommit = z.infer<
  typeof controlMembershipCommitSchema
>;
export type ControlContinuityCheckpoint = z.infer<
  typeof controlContinuityCheckpointSchema
>;
export type ControlCeremonyAbort = z.infer<typeof controlCeremonyAbortSchema>;
export type ControlLogInnerEnvelope = z.infer<
  typeof controlLogInnerEnvelopeSchema
>;

export const unsignedControlLogEntrySchema = z
  .object({
    suite: z.literal(E2EE_SUITE_ID),
    type: z.literal("log-entry"),
    vaultId: opaqueIdSchema,
    createdAt: protocolTimestampSchema,
    envelopeId: opaqueIdSchema,
    sequence: safeSequenceSchema,
    previousHash: hashSchema,
    innerEnvelope: controlLogInnerEnvelopeSchema,
    signerEndpointId: opaqueIdSchema,
  })
  .strict();

export const signedControlLogEntrySchema = unsignedControlLogEntrySchema
  .extend({ signature: signatureSchema })
  .strict();

export type UnsignedControlLogEntry = z.infer<
  typeof unsignedControlLogEntrySchema
>;
export type SignedControlLogEntry = z.infer<typeof signedControlLogEntrySchema>;

export const controlLogStateSchema = z
  .object({
    vaultId: opaqueIdSchema,
    sequence: safeSequenceSchema,
    headHash: hashSchema,
    membershipHash: hashSchema,
    signedAt: protocolTimestampSchema,
    activeMembers: sortedMembersSchema,
    removedEndpointIds: accumulatedRemovedIdsSchema,
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    recoveryGeneration: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    recoveryId: opaqueIdSchema,
    recoverySigningPublicKey: publicKeySchema,
    recoveryKeyAgreementPublicKey: publicKeySchema,
    recoveryWrapHash: hashSchema,
    freshnessMode: z.enum(["endpoint_witnessed", "eventual_fork_detection"]),
  })
  .strict()
  .superRefine((state, ctx) => {
    const activeIds = new Set(
      state.activeMembers.map((member) => member.endpointId),
    );
    if (state.removedEndpointIds.some((id) => activeIds.has(id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["removedEndpointIds"],
        message: "An active endpoint cannot also be tombstoned",
      });
    }
  });

export type ControlLogState = z.infer<typeof controlLogStateSchema>;

export type ControlLogFailureCode =
  | "invalid_entry"
  | "invalid_signature"
  | "invalid_genesis"
  | "invalid_transition"
  | "unauthorized_signer"
  | "candidate_self_enrollment"
  | "rollback"
  | "gap"
  | "fork"
  | "stale_head"
  | "future_head"
  | "genesis_authorization_required"
  | "recovery_authorization_required"
  | "recovery_wrap_rotation_required"
  | "ceremony_abort_authorization_required";

export class ControlLogVerificationError extends Error {
  constructor(readonly code: ControlLogFailureCode) {
    super("Control log verification failed");
    this.name = "ControlLogVerificationError";
  }
}

function mapGet<T extends AncV1CanonicalValue>(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
  guard: (value: AncV1CanonicalValue) => value is T,
): T {
  const value = map.get(key);
  if (value === undefined || !guard(value)) {
    throw new ControlLogVerificationError("invalid_entry");
  }
  return value;
}

const isString = (value: AncV1CanonicalValue): value is string =>
  typeof value === "string";
const isNumber = (value: AncV1CanonicalValue): value is number =>
  typeof value === "number";
const isBoolean = (value: AncV1CanonicalValue): value is boolean =>
  typeof value === "boolean";
const isBytes = (value: AncV1CanonicalValue): value is Uint8Array =>
  value instanceof Uint8Array;
const isArray = (
  value: AncV1CanonicalValue,
): value is readonly AncV1CanonicalValue[] => Array.isArray(value);

function memberToCanonical(member: ControlLogMember): AncV1CanonicalValue {
  return [
    member.endpointId,
    member.role,
    member.unattended,
    ancV1HexToBytes(member.signingPublicKey),
    ancV1HexToBytes(member.keyAgreementPublicKey),
    member.enrollmentRef,
  ];
}

function memberFromCanonical(value: AncV1CanonicalValue): ControlLogMember {
  if (!Array.isArray(value) || value.length !== 6) {
    throw new ControlLogVerificationError("invalid_entry");
  }
  const [
    endpointId,
    role,
    unattended,
    signingKey,
    agreementKey,
    enrollmentRef,
  ] = value;
  if (
    typeof endpointId !== "string" ||
    (role !== "endpoint" && role !== "broker") ||
    typeof unattended !== "boolean" ||
    !(signingKey instanceof Uint8Array) ||
    !(agreementKey instanceof Uint8Array) ||
    typeof enrollmentRef !== "string"
  ) {
    throw new ControlLogVerificationError("invalid_entry");
  }
  return controlLogMemberSchema.parse({
    endpointId,
    role,
    unattended,
    signingPublicKey: ancV1BytesToHex(signingKey),
    keyAgreementPublicKey: ancV1BytesToHex(agreementKey),
    enrollmentRef,
  });
}

function encodeInnerMap(innerInput: ControlLogInnerEnvelope) {
  const inner = controlLogInnerEnvelopeSchema.parse(innerInput);
  const common = new Map<number, AncV1CanonicalValue>([
    [E2EE_ENVELOPE_FIELDS.common.suite, inner.suite],
    [E2EE_ENVELOPE_FIELDS.common.vaultId, inner.vaultId],
    [E2EE_ENVELOPE_FIELDS.common.type, inner.type],
  ]);
  if (inner.type === "continuity_checkpoint") {
    common.set(
      E2EE_ENVELOPE_FIELDS.controlContinuity.membershipHash,
      ancV1HexToBytes(inner.membershipHash),
    );
    return common;
  }
  if (inner.type === "ceremony_abort") {
    const fields = E2EE_ENVELOPE_FIELDS.controlCeremonyAbort;
    common.set(fields.ceremonyId, inner.ceremonyId);
    common.set(fields.ceremonyKind, inner.ceremonyKind);
    common.set(
      fields.ceremonyStateHash,
      ancV1HexToBytes(inner.ceremonyStateHash),
    );
    common.set(fields.reasonCode, inner.reasonCode);
    return common;
  }
  const fields = E2EE_ENVELOPE_FIELDS.controlMembership;
  common.set(fields.ceremonyId, inner.ceremonyId);
  common.set(fields.ceremonyKind, inner.ceremonyKind);
  common.set(fields.epoch, inner.epoch);
  common.set(
    fields.previousMembershipHash,
    inner.previousMembershipHash === null
      ? null
      : ancV1HexToBytes(inner.previousMembershipHash),
  );
  common.set(fields.activeMembers, inner.activeMembers.map(memberToCanonical));
  common.set(fields.removedEndpointIds, inner.removedEndpointIds);
  common.set(fields.rotationCompleted, inner.rotationCompleted);
  common.set(fields.outstandingJobsResolved, inner.outstandingJobsResolved);
  common.set(
    fields.recoverySnapshotHash,
    inner.recoverySnapshotHash === null
      ? null
      : ancV1HexToBytes(inner.recoverySnapshotHash),
  );
  common.set(
    fields.recoveryAuthorizationHash,
    inner.recoveryAuthorizationHash === null
      ? null
      : ancV1HexToBytes(inner.recoveryAuthorizationHash),
  );
  const recovery = E2EE_ENVELOPE_FIELDS.controlMembership;
  common.set(recovery.recoveryGeneration, inner.recoveryGeneration);
  common.set(recovery.recoveryId, inner.recoveryId);
  common.set(
    recovery.recoverySigningPublicKey,
    ancV1HexToBytes(inner.recoverySigningPublicKey),
  );
  common.set(
    recovery.recoveryKeyAgreementPublicKey,
    ancV1HexToBytes(inner.recoveryKeyAgreementPublicKey),
  );
  common.set(
    recovery.recoveryWrapHash,
    ancV1HexToBytes(inner.recoveryWrapHash),
  );
  return common;
}

export function encodeControlLogInnerEnvelope(
  inner: ControlLogInnerEnvelope,
): Uint8Array {
  return encodeAncV1Canonical(encodeInnerMap(inner));
}

function nullableHash(value: AncV1CanonicalValue): string | null {
  if (value === null) return null;
  if (!(value instanceof Uint8Array)) {
    throw new ControlLogVerificationError("invalid_entry");
  }
  return ancV1BytesToHex(value);
}

function requiredValue(
  map: ReadonlyMap<number, AncV1CanonicalValue>,
  key: number,
): AncV1CanonicalValue {
  if (!map.has(key)) {
    throw new ControlLogVerificationError("invalid_entry");
  }
  return map.get(key)!;
}

export function decodeControlLogInnerEnvelope(
  bytes: Uint8Array,
): ControlLogInnerEnvelope {
  const commonKeys = [...Object.values(E2EE_ENVELOPE_FIELDS.common)];
  const initial = decodeAncV1Envelope(
    bytes,
    [
      ...commonKeys,
      ...Object.values(E2EE_ENVELOPE_FIELDS.controlMembership),
      ...Object.values(E2EE_ENVELOPE_FIELDS.controlContinuity),
      ...Object.values(E2EE_ENVELOPE_FIELDS.controlCeremonyAbort),
    ],
    {
      maxBytes: E2EE_SIZE_LIMITS.controlEnvelopeBytes,
    },
  );
  const type = mapGet(initial, E2EE_ENVELOPE_FIELDS.common.type, isString);
  const typeFields =
    type === "continuity_checkpoint"
      ? E2EE_ENVELOPE_FIELDS.controlContinuity
      : type === "membership_commit"
        ? E2EE_ENVELOPE_FIELDS.controlMembership
        : type === "ceremony_abort"
          ? E2EE_ENVELOPE_FIELDS.controlCeremonyAbort
          : null;
  if (!typeFields) {
    throw new ControlLogVerificationError("invalid_entry");
  }
  const map = decodeAncV1Envelope(
    bytes,
    [...commonKeys, ...Object.values(typeFields)],
    {
      maxBytes: E2EE_SIZE_LIMITS.controlEnvelopeBytes,
    },
  );
  const suite = mapGet(map, E2EE_ENVELOPE_FIELDS.common.suite, isString);
  const vaultId = mapGet(map, E2EE_ENVELOPE_FIELDS.common.vaultId, isString);
  if (type === "continuity_checkpoint") {
    return controlContinuityCheckpointSchema.parse({
      suite,
      type,
      vaultId,
      membershipHash: ancV1BytesToHex(
        mapGet(
          map,
          E2EE_ENVELOPE_FIELDS.controlContinuity.membershipHash,
          isBytes,
        ),
      ),
    });
  }
  if (type === "ceremony_abort") {
    const fields = E2EE_ENVELOPE_FIELDS.controlCeremonyAbort;
    return controlCeremonyAbortSchema.parse({
      suite,
      type,
      vaultId,
      ceremonyId: mapGet(map, fields.ceremonyId, isString),
      ceremonyKind: mapGet(map, fields.ceremonyKind, isString),
      ceremonyStateHash: ancV1BytesToHex(
        mapGet(map, fields.ceremonyStateHash, isBytes),
      ),
      reasonCode: mapGet(map, fields.reasonCode, isString),
    });
  }
  if (type !== "membership_commit") {
    throw new ControlLogVerificationError("invalid_entry");
  }
  const fields = E2EE_ENVELOPE_FIELDS.controlMembership;
  const recovery = E2EE_ENVELOPE_FIELDS.controlMembership;
  const members = mapGet(map, fields.activeMembers, isArray).map(
    memberFromCanonical,
  );
  const removed = mapGet(map, fields.removedEndpointIds, isArray);
  if (!removed.every((value): value is string => typeof value === "string")) {
    throw new ControlLogVerificationError("invalid_entry");
  }
  return controlMembershipCommitSchema.parse({
    suite,
    type,
    vaultId,
    ceremonyId: mapGet(map, fields.ceremonyId, isString),
    ceremonyKind: mapGet(map, fields.ceremonyKind, isString),
    epoch: mapGet(map, fields.epoch, isNumber),
    previousMembershipHash: nullableHash(
      requiredValue(map, fields.previousMembershipHash),
    ),
    activeMembers: members,
    removedEndpointIds: removed,
    rotationCompleted: mapGet(map, fields.rotationCompleted, isBoolean),
    outstandingJobsResolved: mapGet(
      map,
      fields.outstandingJobsResolved,
      isBoolean,
    ),
    recoverySnapshotHash: nullableHash(
      requiredValue(map, fields.recoverySnapshotHash),
    ),
    recoveryAuthorizationHash: nullableHash(
      requiredValue(map, fields.recoveryAuthorizationHash),
    ),
    recoveryGeneration: mapGet(map, recovery.recoveryGeneration, isNumber),
    recoveryId: mapGet(map, recovery.recoveryId, isString),
    recoverySigningPublicKey: ancV1BytesToHex(
      mapGet(map, recovery.recoverySigningPublicKey, isBytes),
    ),
    recoveryKeyAgreementPublicKey: ancV1BytesToHex(
      mapGet(map, recovery.recoveryKeyAgreementPublicKey, isBytes),
    ),
    recoveryWrapHash: ancV1BytesToHex(
      mapGet(map, recovery.recoveryWrapHash, isBytes),
    ),
  });
}

export function encodeUnsignedControlLogEntry(
  entryInput: UnsignedControlLogEntry,
): Uint8Array {
  const entry = unsignedControlLogEntrySchema.parse(entryInput);
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [E2EE_ENVELOPE_FIELDS.common.suite, entry.suite],
      [E2EE_ENVELOPE_FIELDS.common.vaultId, entry.vaultId],
      [E2EE_ENVELOPE_FIELDS.common.type, entry.type],
      [E2EE_ENVELOPE_FIELDS.common.createdAt, entry.createdAt],
      [E2EE_ENVELOPE_FIELDS.common.envelopeId, entry.envelopeId],
      [E2EE_ENVELOPE_FIELDS.logEntry.sequence, entry.sequence],
      [
        E2EE_ENVELOPE_FIELDS.logEntry.previousHash,
        ancV1HexToBytes(entry.previousHash),
      ],
      [
        E2EE_ENVELOPE_FIELDS.logEntry.innerEnvelope,
        encodeControlLogInnerEnvelope(entry.innerEnvelope),
      ],
      [E2EE_ENVELOPE_FIELDS.logEntry.signerEndpointId, entry.signerEndpointId],
    ]),
  );
}

export function encodeSignedControlLogEntry(
  entryInput: SignedControlLogEntry,
): Uint8Array {
  const entry = signedControlLogEntrySchema.parse(entryInput);
  const { signature, ...unsigned } = entry;
  const unsignedMap = decodeAncV1Envelope(
    encodeUnsignedControlLogEntry(unsigned),
    [
      ...Object.values(E2EE_ENVELOPE_FIELDS.common),
      ...Object.values(E2EE_ENVELOPE_FIELDS.logEntry),
    ],
  );
  return encodeAncV1Canonical(
    new Map([
      ...unsignedMap,
      [E2EE_ENVELOPE_FIELDS.logEntry.signature, ancV1HexToBytes(signature)],
    ]),
  );
}

export function decodeSignedControlLogEntry(
  bytes: Uint8Array,
): SignedControlLogEntry {
  const map = decodeAncV1Envelope(
    bytes,
    [
      ...Object.values(E2EE_ENVELOPE_FIELDS.common),
      ...Object.values(E2EE_ENVELOPE_FIELDS.logEntry),
    ],
    { maxBytes: E2EE_SIZE_LIMITS.vaultLogEntryBytes },
  );
  const innerBytes = mapGet(
    map,
    E2EE_ENVELOPE_FIELDS.logEntry.innerEnvelope,
    isBytes,
  );
  return signedControlLogEntrySchema.parse({
    suite: mapGet(map, E2EE_ENVELOPE_FIELDS.common.suite, isString),
    type: mapGet(map, E2EE_ENVELOPE_FIELDS.common.type, isString),
    vaultId: mapGet(map, E2EE_ENVELOPE_FIELDS.common.vaultId, isString),
    createdAt: mapGet(map, E2EE_ENVELOPE_FIELDS.common.createdAt, isString),
    envelopeId: mapGet(map, E2EE_ENVELOPE_FIELDS.common.envelopeId, isString),
    sequence: mapGet(map, E2EE_ENVELOPE_FIELDS.logEntry.sequence, isNumber),
    previousHash: ancV1BytesToHex(
      mapGet(map, E2EE_ENVELOPE_FIELDS.logEntry.previousHash, isBytes),
    ),
    innerEnvelope: decodeControlLogInnerEnvelope(innerBytes),
    signerEndpointId: mapGet(
      map,
      E2EE_ENVELOPE_FIELDS.logEntry.signerEndpointId,
      isString,
    ),
    signature: ancV1BytesToHex(
      mapGet(map, E2EE_ENVELOPE_FIELDS.logEntry.signature, isBytes),
    ),
  });
}

export async function createSignedControlLogEntry(input: {
  vaultId: string;
  createdAt: string;
  envelopeId: string;
  sequence: number;
  previousHash: string;
  innerEnvelope: ControlLogInnerEnvelope;
  signerEndpointId: string;
  signingPrivateKey: Uint8Array;
}): Promise<SignedControlLogEntry> {
  const unsigned = unsignedControlLogEntrySchema.parse({
    suite: E2EE_SUITE_ID,
    type: "log-entry",
    vaultId: input.vaultId,
    createdAt: input.createdAt,
    envelopeId: input.envelopeId,
    sequence: input.sequence,
    previousHash: input.previousHash,
    innerEnvelope: input.innerEnvelope,
    signerEndpointId: input.signerEndpointId,
  });
  if (unsigned.innerEnvelope.vaultId !== unsigned.vaultId) {
    throw new ControlLogVerificationError("invalid_entry");
  }
  const signature = await ancV1SignDetached(
    "log-entry",
    encodeUnsignedControlLogEntry(unsigned),
    input.signingPrivateKey,
  );
  return signedControlLogEntrySchema.parse({
    ...unsigned,
    signature: ancV1BytesToHex(signature),
  });
}

async function membershipHash(
  commit: ControlMembershipCommit,
): Promise<string> {
  return ancV1BytesToHex(
    await ancV1Hash("log-entry", encodeControlLogInnerEnvelope(commit)),
  );
}

async function entryHash(entry: SignedControlLogEntry): Promise<string> {
  return ancV1BytesToHex(
    await ancV1Hash("log-entry", encodeSignedControlLogEntry(entry)),
  );
}

function memberMap(members: readonly ControlLogMember[]) {
  return new Map(members.map((member) => [member.endpointId, member]));
}

function sameMember(left: ControlLogMember, right: ControlLogMember): boolean {
  return (
    left.endpointId === right.endpointId &&
    left.role === right.role &&
    left.unattended === right.unattended &&
    left.signingPublicKey === right.signingPublicKey &&
    left.keyAgreementPublicKey === right.keyAgreementPublicKey &&
    left.enrollmentRef === right.enrollmentRef
  );
}

function changedMembers(
  current: readonly ControlLogMember[],
  next: readonly ControlLogMember[],
) {
  const before = memberMap(current);
  const after = memberMap(next);
  return {
    added: next.filter((member) => !before.has(member.endpointId)),
    removed: current.filter((member) => !after.has(member.endpointId)),
    mutated: next.filter((member) => {
      const previous = before.get(member.endpointId);
      return previous !== undefined && !sameMember(previous, member);
    }),
  };
}

function transitionValid(
  current: ControlLogState,
  commit: ControlMembershipCommit,
): boolean {
  const change = changedMembers(current.activeMembers, commit.activeMembers);
  if (change.mutated.length > 0) return false;
  if (
    change.added.some((member) =>
      current.removedEndpointIds.includes(member.endpointId),
    )
  ) {
    return false;
  }
  if (
    commit.previousMembershipHash !== current.membershipHash ||
    commit.removedEndpointIds.join("\0") !==
      change.removed
        .map((member) => member.endpointId)
        .sort()
        .join("\0")
  ) {
    return false;
  }
  const brokersBefore = current.activeMembers.filter(
    (member) => member.role === "broker",
  );
  const brokersAfter = commit.activeMembers.filter(
    (member) => member.role === "broker",
  );
  const sameRecoveryAuthority =
    commit.recoveryGeneration === current.recoveryGeneration &&
    commit.recoveryId === current.recoveryId &&
    commit.recoverySigningPublicKey === current.recoverySigningPublicKey &&
    commit.recoveryKeyAgreementPublicKey ===
      current.recoveryKeyAgreementPublicKey;
  const recoveryAuthorityTransitionValid =
    commit.ceremonyKind === "recovery"
      ? commit.recoveryGeneration === current.recoveryGeneration + 1 &&
        commit.recoveryId !== current.recoveryId &&
        commit.recoverySigningPublicKey !== current.recoverySigningPublicKey &&
        commit.recoveryKeyAgreementPublicKey !==
          current.recoveryKeyAgreementPublicKey &&
        commit.recoveryWrapHash !== current.recoveryWrapHash
      : sameRecoveryAuthority &&
        (commit.epoch === current.epoch
          ? commit.recoveryWrapHash === current.recoveryWrapHash
          : commit.recoveryWrapHash !== current.recoveryWrapHash);
  if (!recoveryAuthorityTransitionValid) return false;
  if (
    commit.ceremonyKind !== "broker_replacement" &&
    commit.ceremonyKind !== "remove_broker" &&
    commit.ceremonyKind !== "recovery" &&
    commit.outstandingJobsResolved
  ) {
    return false;
  }
  switch (commit.ceremonyKind) {
    case "first_device":
      return false;
    case "add_device":
      return (
        change.added.length === 1 &&
        change.added[0]!.role === "endpoint" &&
        change.removed.length === 0 &&
        commit.epoch === current.epoch &&
        !commit.rotationCompleted
      );
    case "add_broker":
      return (
        brokersBefore.length === 0 &&
        brokersAfter.length === 1 &&
        change.added.length === 1 &&
        change.added[0]!.role === "broker" &&
        change.removed.length === 0 &&
        commit.epoch === current.epoch &&
        !commit.rotationCompleted
      );
    case "remove_device":
      return (
        change.added.length === 0 &&
        change.removed.length === 1 &&
        change.removed[0]!.role === "endpoint" &&
        commit.epoch === current.epoch + 1 &&
        commit.rotationCompleted
      );
    case "remove_broker":
      return (
        brokersBefore.length === 1 &&
        brokersAfter.length === 0 &&
        change.added.length === 0 &&
        change.removed.length === 1 &&
        change.removed[0]!.role === "broker" &&
        commit.epoch === current.epoch + 1 &&
        commit.rotationCompleted &&
        commit.outstandingJobsResolved
      );
    case "broker_replacement":
      return (
        brokersBefore.length === 1 &&
        brokersAfter.length === 1 &&
        change.added.length === 1 &&
        change.added[0]!.role === "broker" &&
        change.removed.length === 1 &&
        change.removed[0]!.role === "broker" &&
        commit.epoch === current.epoch + 1 &&
        commit.rotationCompleted &&
        commit.outstandingJobsResolved
      );
    case "recovery":
      return (
        change.added.length === 1 &&
        change.added[0]!.role === "endpoint" &&
        change.removed.length === current.activeMembers.length &&
        commit.activeMembers.length === 1 &&
        commit.epoch === current.epoch + 1 &&
        commit.rotationCompleted &&
        commit.outstandingJobsResolved === (brokersBefore.length === 1) &&
        commit.recoverySnapshotHash !== null &&
        commit.recoveryAuthorizationHash !== null
      );
  }
}

export interface VerifyAndReduceControlLogInput {
  /**
   * Must be the output of authenticated durable transcript replay (or an
   * equivalently authenticated endpoint snapshot), never caller-invented
   * hosted state. The reducer validates the next signed edge, not snapshot
   * provenance.
   */
  readonly current: ControlLogState | null;
  readonly entry: SignedControlLogEntry | Uint8Array;
  readonly verifyGenesisAuthorization?: (input: {
    commit: ControlMembershipCommit;
    entry: SignedControlLogEntry;
  }) => Promise<boolean>;
  readonly verifyRecoveryAuthorization?: (input: {
    commit: ControlMembershipCommit;
    entry: SignedControlLogEntry;
    current: ControlLogState;
  }) => Promise<boolean>;
  readonly verifyRecoveryWrapRotation?: (input: {
    commit: ControlMembershipCommit;
    entry: SignedControlLogEntry;
    current: ControlLogState;
  }) => Promise<boolean>;
  readonly verifyCeremonyAbortAuthorization?: (input: {
    abort: ControlCeremonyAbort;
    entry: SignedControlLogEntry;
    current: ControlLogState;
  }) => Promise<boolean>;
}

export async function verifyAndReduceControlLogEntry(
  input: VerifyAndReduceControlLogInput,
): Promise<{ state: ControlLogState; entryHash: string; idempotent: boolean }> {
  let entry: SignedControlLogEntry;
  try {
    entry =
      input.entry instanceof Uint8Array
        ? decodeSignedControlLogEntry(input.entry)
        : signedControlLogEntrySchema.parse(input.entry);
  } catch {
    throw new ControlLogVerificationError("invalid_entry");
  }
  if (entry.innerEnvelope.vaultId !== entry.vaultId) {
    throw new ControlLogVerificationError("invalid_entry");
  }
  const hash = await entryHash(entry);
  const current = input.current
    ? controlLogStateSchema.parse(input.current)
    : null;
  if (current) {
    if (entry.vaultId !== current.vaultId) {
      throw new ControlLogVerificationError("invalid_entry");
    }
    if (entry.sequence < current.sequence) {
      throw new ControlLogVerificationError("rollback");
    }
    if (entry.sequence === current.sequence) {
      if (hash === current.headHash) {
        return { state: current, entryHash: hash, idempotent: true };
      }
      throw new ControlLogVerificationError("fork");
    }
    if (entry.sequence > current.sequence + 1) {
      throw new ControlLogVerificationError("gap");
    }
    if (entry.previousHash !== current.headHash) {
      throw new ControlLogVerificationError("fork");
    }
    if (Date.parse(entry.createdAt) < Date.parse(current.signedAt)) {
      throw new ControlLogVerificationError("invalid_transition");
    }
  } else if (entry.sequence !== 0 || entry.previousHash !== ZERO_HASH) {
    throw new ControlLogVerificationError("invalid_genesis");
  }

  const inner = entry.innerEnvelope;
  let signer: ControlLogMember | undefined;
  if (!current) {
    if (
      inner.type !== "membership_commit" ||
      inner.ceremonyKind !== "first_device" ||
      inner.epoch !== 1 ||
      inner.previousMembershipHash !== null ||
      inner.activeMembers.length !== 1 ||
      inner.activeMembers[0]!.role !== "endpoint" ||
      inner.activeMembers.some((member) => member.role === "broker") ||
      inner.removedEndpointIds.length !== 0 ||
      inner.rotationCompleted ||
      inner.outstandingJobsResolved ||
      inner.recoverySnapshotHash !== null ||
      inner.recoveryAuthorizationHash !== null ||
      inner.recoveryGeneration !== 1 ||
      entry.signerEndpointId !== inner.activeMembers[0]!.endpointId
    ) {
      throw new ControlLogVerificationError("invalid_genesis");
    }
    signer = inner.activeMembers[0];
  } else {
    signer = current.activeMembers.find(
      (member) => member.endpointId === entry.signerEndpointId,
    );
    const recoveryCandidate =
      inner.type === "membership_commit" &&
      inner.ceremonyKind === "recovery" &&
      inner.activeMembers.find(
        (member) => member.endpointId === entry.signerEndpointId,
      );
    if (!signer && recoveryCandidate) signer = recoveryCandidate;
    if (!signer) {
      if (
        inner.type === "membership_commit" &&
        inner.activeMembers.some(
          (member) => member.endpointId === entry.signerEndpointId,
        )
      ) {
        throw new ControlLogVerificationError("candidate_self_enrollment");
      }
      throw new ControlLogVerificationError("unauthorized_signer");
    }
    if (
      inner.type === "membership_commit" &&
      inner.ceremonyKind !== "recovery" &&
      !current.activeMembers.some(
        (member) => member.endpointId === entry.signerEndpointId,
      )
    ) {
      throw new ControlLogVerificationError("candidate_self_enrollment");
    }
    if (inner.type === "membership_commit" && signer.role !== "endpoint") {
      throw new ControlLogVerificationError("unauthorized_signer");
    }
  }

  const { signature, ...unsigned } = entry;
  let validSignature = false;
  try {
    validSignature = await ancV1VerifyDetached(
      "log-entry",
      encodeUnsignedControlLogEntry(unsigned),
      ancV1HexToBytes(signature),
      ancV1HexToBytes(signer.signingPublicKey),
    );
  } catch {
    validSignature = false;
  }
  if (!validSignature) {
    throw new ControlLogVerificationError("invalid_signature");
  }

  if (!current) {
    const commit = inner as ControlMembershipCommit;
    if (
      !input.verifyGenesisAuthorization ||
      !(await input.verifyGenesisAuthorization({
        commit: controlMembershipCommitSchema.parse(commit),
        entry: signedControlLogEntrySchema.parse(entry),
      }))
    ) {
      throw new ControlLogVerificationError("genesis_authorization_required");
    }
    return {
      state: controlLogStateSchema.parse({
        vaultId: entry.vaultId,
        sequence: entry.sequence,
        headHash: hash,
        membershipHash: await membershipHash(commit),
        signedAt: entry.createdAt,
        activeMembers: commit.activeMembers,
        removedEndpointIds: commit.removedEndpointIds,
        epoch: commit.epoch,
        recoveryGeneration: commit.recoveryGeneration,
        recoveryId: commit.recoveryId,
        recoverySigningPublicKey: commit.recoverySigningPublicKey,
        recoveryKeyAgreementPublicKey: commit.recoveryKeyAgreementPublicKey,
        recoveryWrapHash: commit.recoveryWrapHash,
        freshnessMode: "endpoint_witnessed",
      }),
      entryHash: hash,
      idempotent: false,
    };
  }

  if (inner.type === "continuity_checkpoint") {
    if (inner.membershipHash !== current.membershipHash) {
      throw new ControlLogVerificationError("invalid_transition");
    }
    return {
      state: {
        ...current,
        sequence: entry.sequence,
        headHash: hash,
        signedAt: entry.createdAt,
        freshnessMode:
          signer.role === "endpoint"
            ? "endpoint_witnessed"
            : "eventual_fork_detection",
      },
      entryHash: hash,
      idempotent: false,
    };
  }

  if (inner.type === "ceremony_abort") {
    if (
      signer.role !== "endpoint" ||
      !input.verifyCeremonyAbortAuthorization ||
      !(await input.verifyCeremonyAbortAuthorization({
        abort: controlCeremonyAbortSchema.parse(inner),
        entry: signedControlLogEntrySchema.parse(entry),
        current: controlLogStateSchema.parse(current),
      }))
    ) {
      throw new ControlLogVerificationError(
        "ceremony_abort_authorization_required",
      );
    }
    return {
      state: controlLogStateSchema.parse({
        ...current,
        sequence: entry.sequence,
        headHash: hash,
        signedAt: entry.createdAt,
        freshnessMode: "endpoint_witnessed",
      }),
      entryHash: hash,
      idempotent: false,
    };
  }

  if (!transitionValid(current, inner)) {
    throw new ControlLogVerificationError("invalid_transition");
  }
  if (
    inner.ceremonyKind !== "recovery" &&
    !inner.activeMembers.some(
      (member) => member.endpointId === entry.signerEndpointId,
    )
  ) {
    throw new ControlLogVerificationError("unauthorized_signer");
  }
  if (
    inner.ceremonyKind !== "recovery" &&
    inner.activeMembers.some(
      (member) =>
        !current.activeMembers.some(
          (existing) => existing.endpointId === member.endpointId,
        ) && member.endpointId === entry.signerEndpointId,
    )
  ) {
    throw new ControlLogVerificationError("candidate_self_enrollment");
  }
  if (
    inner.ceremonyKind !== "recovery" &&
    inner.epoch === current.epoch + 1 &&
    (!input.verifyRecoveryWrapRotation ||
      !(await input.verifyRecoveryWrapRotation({
        commit: controlMembershipCommitSchema.parse(inner),
        entry: signedControlLogEntrySchema.parse(entry),
        current: controlLogStateSchema.parse(current),
      })))
  ) {
    throw new ControlLogVerificationError("recovery_wrap_rotation_required");
  }
  if (inner.ceremonyKind === "recovery") {
    if (
      !input.verifyRecoveryAuthorization ||
      !(await input.verifyRecoveryAuthorization({
        commit: controlMembershipCommitSchema.parse(inner),
        entry: signedControlLogEntrySchema.parse(entry),
        current: controlLogStateSchema.parse(current),
      }))
    ) {
      throw new ControlLogVerificationError("recovery_authorization_required");
    }
  }
  const removedEndpointIds = Array.from(
    new Set([...current.removedEndpointIds, ...inner.removedEndpointIds]),
  ).sort();
  if (removedEndpointIds.length > MAX_CONTROL_LOG_TOMBSTONES) {
    throw new ControlLogVerificationError("invalid_transition");
  }
  return {
    state: controlLogStateSchema.parse({
      vaultId: current.vaultId,
      sequence: entry.sequence,
      headHash: hash,
      membershipHash: await membershipHash(inner),
      signedAt: entry.createdAt,
      activeMembers: inner.activeMembers,
      removedEndpointIds,
      epoch: inner.epoch,
      recoveryGeneration: inner.recoveryGeneration,
      recoveryId: inner.recoveryId,
      recoverySigningPublicKey: inner.recoverySigningPublicKey,
      recoveryKeyAgreementPublicKey: inner.recoveryKeyAgreementPublicKey,
      recoveryWrapHash: inner.recoveryWrapHash,
      freshnessMode: "endpoint_witnessed",
    }),
    entryHash: hash,
    idempotent: false,
  };
}

export function assertFreshControlLogHead(
  stateInput: ControlLogState,
  now: Date,
): ControlLogState {
  const state = controlLogStateSchema.parse(stateInput);
  const nowMs = now.getTime();
  const signedAtMs = Date.parse(state.signedAt);
  if (!Number.isFinite(nowMs) || signedAtMs > nowMs + 30_000) {
    throw new ControlLogVerificationError("future_head");
  }
  if (
    nowMs - signedAtMs >=
    E2EE_LIFETIME_LIMITS_SECONDS.brokerAuthorizationFreshness * 1000
  ) {
    throw new ControlLogVerificationError("stale_head");
  }
  return state;
}

export function resolveControlLogEndpointAuthorization(
  stateInput: ControlLogState,
  endpointId: string,
  now: Date,
): {
  vaultId: string;
  endpointId: string;
  role: "broker";
  state: "active";
  signingPublicKey: Uint8Array;
  authenticatedControlHead: {
    sequence: number;
    hash: string;
    signedAt: string;
    freshnessMode: "endpoint_witnessed" | "eventual_fork_detection";
  };
} | null {
  const state = assertFreshControlLogHead(stateInput, now);
  const member = state.activeMembers.find(
    (candidate) => candidate.endpointId === endpointId,
  );
  if (!member || member.role !== "broker" || !member.unattended) return null;
  return {
    vaultId: state.vaultId,
    endpointId: member.endpointId,
    role: "broker",
    state: "active",
    signingPublicKey: ancV1HexToBytes(member.signingPublicKey),
    authenticatedControlHead: {
      sequence: state.sequence,
      hash: state.headHash,
      signedAt: state.signedAt,
      freshnessMode: state.freshnessMode,
    },
  };
}

export const CONTROL_LOG_ZERO_HASH = ZERO_HASH;

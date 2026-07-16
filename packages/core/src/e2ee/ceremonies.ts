import { z } from "zod";

import {
  E2EE_CONTRACT_VERSION,
  boundedProtocolTokenSchema,
  opaqueIdSchema,
  protocolTimestampSchema,
} from "./contracts.js";

export const ceremonyKindSchema = z.enum([
  "first_device",
  "add_device",
  "remove_device",
  "rotate_epoch",
  "recovery",
  "broker_replacement",
  "grant_issue",
  "grant_revoke",
  "direct_external_disclosure",
  "vault_deletion",
]);
export type CeremonyKind = z.infer<typeof ceremonyKindSchema>;

export const ceremonyStatusSchema = z.enum([
  "active",
  "incomplete",
  "alert",
  "committed",
  "aborted",
]);
export type CeremonyStatus = z.infer<typeof ceremonyStatusSchema>;

const ceremonyActorSchema = z.enum([
  "endpoint",
  "broker",
  "recovery",
  "server",
]);

export const ceremonyStepSchema = z.enum([
  "endpoint_keys_generated",
  "recovery_secret_generated",
  "recovery_secret_confirmed",
  "epoch_created",
  "candidate_keys_generated",
  "sas_verified",
  "endpoint_enrollment_signed",
  "broker_enrollment_signed",
  "epoch_key_boxed",
  "removal_signed",
  "rotation_started",
  "live_deks_rewrapped",
  "remaining_endpoints_acknowledged",
  "old_epoch_destroyed",
  "recovery_secret_unsealed",
  "prior_endpoints_removed",
  "recovery_secret_replaced",
  "outstanding_jobs_resolved",
  "old_broker_removal_signed",
  "broker_uniqueness_verified",
  "control_log_head_verified",
  "grant_scope_verified",
  "grant_signed",
  "revocation_signed",
  "disclosure_grant_verified",
  "broker_provider_direct_connected",
  "scoped_plaintext_released",
  "plaintext_destroyed",
  "disclosure_event_signed",
  "deletion_confirmed",
  "tombstone_signed",
  "live_dek_wraps_destroyed",
  "hosted_ciphertext_delete_requested",
  "signed_log_committed",
]);
export type CeremonyStep = z.infer<typeof ceremonyStepSchema>;

const STEP_SEQUENCES: Record<CeremonyKind, readonly CeremonyStep[]> = {
  first_device: [
    "endpoint_keys_generated",
    "recovery_secret_generated",
    "recovery_secret_confirmed",
    "epoch_created",
    "endpoint_enrollment_signed",
    "signed_log_committed",
  ],
  add_device: [
    "candidate_keys_generated",
    "sas_verified",
    "endpoint_enrollment_signed",
    "epoch_key_boxed",
    "signed_log_committed",
  ],
  remove_device: [
    "removal_signed",
    "rotation_started",
    "live_deks_rewrapped",
    "remaining_endpoints_acknowledged",
    "old_epoch_destroyed",
    "signed_log_committed",
  ],
  rotate_epoch: [
    "rotation_started",
    "live_deks_rewrapped",
    "remaining_endpoints_acknowledged",
    "old_epoch_destroyed",
    "signed_log_committed",
  ],
  recovery: [
    "recovery_secret_unsealed",
    "candidate_keys_generated",
    "endpoint_enrollment_signed",
    "prior_endpoints_removed",
    "rotation_started",
    "live_deks_rewrapped",
    "remaining_endpoints_acknowledged",
    "old_epoch_destroyed",
    "recovery_secret_replaced",
    "signed_log_committed",
  ],
  broker_replacement: [
    "candidate_keys_generated",
    "sas_verified",
    "broker_enrollment_signed",
    "epoch_key_boxed",
    "outstanding_jobs_resolved",
    "old_broker_removal_signed",
    "rotation_started",
    "live_deks_rewrapped",
    "remaining_endpoints_acknowledged",
    "old_epoch_destroyed",
    "broker_uniqueness_verified",
    "signed_log_committed",
  ],
  grant_issue: [
    "control_log_head_verified",
    "grant_scope_verified",
    "grant_signed",
    "signed_log_committed",
  ],
  grant_revoke: [
    "control_log_head_verified",
    "revocation_signed",
    "signed_log_committed",
  ],
  direct_external_disclosure: [
    "control_log_head_verified",
    "disclosure_grant_verified",
    "broker_provider_direct_connected",
    "scoped_plaintext_released",
    "plaintext_destroyed",
    "disclosure_event_signed",
    "signed_log_committed",
  ],
  vault_deletion: [
    "deletion_confirmed",
    "tombstone_signed",
    "live_dek_wraps_destroyed",
    "hosted_ciphertext_delete_requested",
    "rotation_started",
    "old_epoch_destroyed",
    "signed_log_committed",
  ],
};

const ADD_BROKER_STEPS: readonly CeremonyStep[] = [
  "candidate_keys_generated",
  "sas_verified",
  "broker_enrollment_signed",
  "epoch_key_boxed",
  "broker_uniqueness_verified",
  "signed_log_committed",
];

const SIGNED_STEPS = new Set<CeremonyStep>([
  "endpoint_enrollment_signed",
  "broker_enrollment_signed",
  "removal_signed",
  "prior_endpoints_removed",
  "old_broker_removal_signed",
  "grant_signed",
  "revocation_signed",
  "disclosure_event_signed",
  "tombstone_signed",
]);

const BROKER_SIGNED_STEPS = new Set<CeremonyStep>(["disclosure_event_signed"]);

function stepsFor(
  kind: CeremonyKind,
  targetRole: "device" | "broker" | null,
): readonly CeremonyStep[] {
  if (kind === "add_device" && targetRole === "broker") {
    return ADD_BROKER_STEPS;
  }
  return STEP_SEQUENCES[kind];
}

const previousHeadSchema = z
  .object({
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    headRef: opaqueIdSchema,
  })
  .strict();

const enrolledSignerSchema = z
  .object({
    id: opaqueIdSchema,
    role: z.enum(["endpoint", "broker"]),
  })
  .strict();

const enrolledSignersSchema = z
  .array(enrolledSignerSchema)
  .max(64)
  .superRefine((values, ctx) => {
    if (new Set(values.map((value) => value.id)).size !== values.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enrolled signer IDs must be unique across roles",
      });
    }
  });

export const ceremonyStartSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    ceremonyId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    kind: ceremonyKindSchema,
    initiatorActor: ceremonyActorSchema,
    initiatorId: opaqueIdSchema,
    targetRole: z.enum(["device", "broker"]).nullable(),
    activeBrokerCount: z.number().int().nonnegative().max(1),
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    recoverySecretGeneration: z.number().int().nonnegative(),
    expectedHead: previousHeadSchema,
    enrolledSigners: enrolledSignersSchema,
    expectedSasTranscriptRef: opaqueIdSchema.nullable(),
    expectedPriorEndpointSnapshotRef: opaqueIdSchema.nullable(),
    expectedLiveDekWrapSetRef: opaqueIdSchema.nullable(),
    startedAt: protocolTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.initiatorActor === "recovery" && value.kind !== "recovery") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["initiatorActor"],
        message: "Recovery authority may start only recovery ceremonies",
      });
    }
    if (
      value.initiatorActor === "broker" &&
      value.kind !== "direct_external_disclosure"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["initiatorActor"],
        message: "Broker may start only direct disclosure ceremonies",
      });
    }
    if (value.kind !== "first_device" && value.enrolledSigners.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enrolledSigners"],
        message: "Non-genesis ceremonies require an enrolled signer",
      });
    }
    if (
      value.kind !== "first_device" &&
      !value.enrolledSigners.some((signer) => signer.role === "endpoint")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enrolledSigners"],
        message: "Non-genesis ceremonies require an enrolled endpoint signer",
      });
    }
    if (
      value.kind === "direct_external_disclosure" &&
      !value.enrolledSigners.some((signer) => signer.role === "broker")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enrolledSigners"],
        message: "Direct disclosure requires an enrolled broker signer",
      });
    }
    if (
      value.enrolledSigners.filter((signer) => signer.role === "broker")
        .length !== value.activeBrokerCount
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeBrokerCount"],
        message: "Active broker count must match enrolled broker authority",
      });
    }
    if (value.kind === "add_device" && value.targetRole === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetRole"],
        message: "Add-device ceremonies must declare device or broker role",
      });
    }
    if (
      value.kind === "first_device" &&
      (value.epoch !== 1 ||
        value.activeBrokerCount !== 0 ||
        value.enrolledSigners.length !== 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["epoch"],
        message:
          "First-device genesis requires epoch 1, no broker, and no enrolled signer",
      });
    }
    if (value.kind === "broker_replacement" && value.targetRole !== "broker") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetRole"],
        message: "Broker replacement must target the broker role",
      });
    }
    if (
      value.kind === "add_device" &&
      value.targetRole === "broker" &&
      value.activeBrokerCount !== 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeBrokerCount"],
        message: "A first broker may be enrolled only when no broker is active",
      });
    }
    if (value.kind === "broker_replacement" && value.activeBrokerCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activeBrokerCount"],
        message: "Broker replacement requires exactly one active old broker",
      });
    }
    if (
      value.kind !== "add_device" &&
      value.kind !== "broker_replacement" &&
      value.targetRole !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetRole"],
        message: "This ceremony does not accept a target role",
      });
    }
    const expectsSas = ["add_device", "broker_replacement"].includes(
      value.kind,
    );
    if (expectsSas !== (value.expectedSasTranscriptRef !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedSasTranscriptRef"],
        message: "Expected SAS reference must match the ceremony transcript",
      });
    }
    if (
      (value.kind === "recovery") !==
      (value.expectedPriorEndpointSnapshotRef !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedPriorEndpointSnapshotRef"],
        message: "Recovery requires exactly one expected endpoint snapshot",
      });
    }
    if (
      (value.kind === "vault_deletion") !==
      (value.expectedLiveDekWrapSetRef !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedLiveDekWrapSetRef"],
        message: "Deletion requires exactly one expected live-wrap set",
      });
    }
  });
export type CeremonyStart = z.infer<typeof ceremonyStartSchema>;

export const ceremonyEvidenceSchema = z
  .object({
    endpointSignatureVerified: z.literal(true).optional(),
    brokerSignatureVerified: z.literal(true).optional(),
    previousHeadVerified: z.literal(true).optional(),
    signerId: opaqueIdSchema.optional(),
    previousHead: previousHeadSchema.optional(),
    recoverySecretEchoVerified: z.literal(true).optional(),
    sasMatched: z.literal(true).optional(),
    sasTranscriptRef: opaqueIdSchema.optional(),
    serverAuthorized: z.literal(false).optional(),
    brokerUnattendedRoleVerified: z.literal(true).optional(),
    generatedEndpointId: opaqueIdSchema.optional(),
    createdEpoch: z.number().int().positive().optional(),
    rotationTargetEpoch: z.number().int().positive().optional(),
    epochKeyBoxedToRecipient: z.literal(true).optional(),
    recipientId: opaqueIdSchema.optional(),
    recoverySecretGenerationConsumed: z.number().int().nonnegative().optional(),
    forcedRotation: z.literal(true).optional(),
    allLiveDeksRewrapped: z.literal(true).optional(),
    allRemainingEndpointsAcknowledged: z.literal(true).optional(),
    oldEpochKeyDestroyed: z.literal(true).optional(),
    destroyedEpoch: z.number().int().positive().optional(),
    recoverySecretReplaced: z.literal(true).optional(),
    priorEndpointSnapshotRemoved: z.literal(true).optional(),
    priorEndpointSnapshotRef: opaqueIdSchema.optional(),
    liveDekWrapsDestroyed: z.literal(true).optional(),
    liveDekWrapSetRef: opaqueIdSchema.optional(),
    removedSignerId: opaqueIdSchema.optional(),
    outstandingJobs: z.enum(["drained", "expired"]).optional(),
    activeBrokerCountAfter: z.number().int().nonnegative().max(1).optional(),
    logHeadAgeSeconds: z.number().int().nonnegative().max(900).optional(),
    providerPath: z.literal("broker_direct_tls").optional(),
    plaintextFallback: z.literal(false).optional(),
    plaintextRetained: z.literal(false).optional(),
    scopedResourcesVerified: z.literal(true).optional(),
    userConfirmed: z.literal(true).optional(),
    hostedDeleteRequested: z.literal(true).optional(),
  })
  .strict();
export type CeremonyEvidence = z.infer<typeof ceremonyEvidenceSchema>;

const signedLifecycleEvidenceSchema = z
  .object({
    endpointSignatureVerified: z.literal(true),
    previousHeadVerified: z.literal(true),
    signerId: opaqueIdSchema,
    previousHead: previousHeadSchema,
  })
  .strict();

const eventBindingFields = {
  ceremonyId: opaqueIdSchema,
  vaultId: opaqueIdSchema,
  epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  at: protocolTimestampSchema,
};

const completeStepEventSchema = z
  .object({
    ...eventBindingFields,
    type: z.literal("complete_step"),
    step: ceremonyStepSchema,
    actor: ceremonyActorSchema,
    actorId: opaqueIdSchema,
    evidence: ceremonyEvidenceSchema,
  })
  .strict();

export const ceremonyEventSchema = z.discriminatedUnion("type", [
  completeStepEventSchema,
  z
    .object({
      ...eventBindingFields,
      type: z.literal("pause"),
      actor: z.enum(["endpoint", "recovery"]),
      actorId: opaqueIdSchema,
      evidence: signedLifecycleEvidenceSchema,
      reasonCode: boundedProtocolTokenSchema,
    })
    .strict(),
  z
    .object({
      ...eventBindingFields,
      type: z.literal("resume"),
      actor: z.enum(["endpoint", "recovery"]),
      actorId: opaqueIdSchema,
      evidence: signedLifecycleEvidenceSchema,
    })
    .strict(),
  z
    .object({
      ...eventBindingFields,
      type: z.literal("acknowledge_alert"),
      actor: z.enum(["endpoint", "recovery"]),
      actorId: opaqueIdSchema,
      evidence: signedLifecycleEvidenceSchema,
    })
    .strict(),
  z
    .object({
      ...eventBindingFields,
      type: z.literal("abort"),
      actor: z.enum(["endpoint", "recovery"]),
      actorId: opaqueIdSchema,
      reasonCode: boundedProtocolTokenSchema,
      evidence: signedLifecycleEvidenceSchema,
    })
    .strict(),
  z
    .object({
      ...eventBindingFields,
      type: z.literal("security_alert"),
      actor: ceremonyActorSchema,
      actorId: opaqueIdSchema,
      alertCode: boundedProtocolTokenSchema,
    })
    .strict(),
  z
    .object({
      ...eventBindingFields,
      type: z.literal("plaintext_fallback_attempted"),
      actor: ceremonyActorSchema,
      actorId: opaqueIdSchema,
    })
    .strict(),
]);
export type CeremonyEvent = z.infer<typeof ceremonyEventSchema>;

export const ceremonyStateSchema = z
  .object({
    version: z.literal(E2EE_CONTRACT_VERSION),
    ceremonyId: opaqueIdSchema,
    vaultId: opaqueIdSchema,
    kind: ceremonyKindSchema,
    initiatorActor: ceremonyActorSchema,
    initiatorId: opaqueIdSchema,
    status: ceremonyStatusSchema,
    targetRole: z.enum(["device", "broker"]).nullable(),
    completedSteps: z.array(ceremonyStepSchema).max(48),
    nextStep: ceremonyStepSchema.nullable(),
    alertCode: boundedProtocolTokenSchema.nullable(),
    alertOrigin: z.enum(["server", "local"]).nullable(),
    incompleteReason: boundedProtocolTokenSchema.nullable(),
    abortLogged: z.boolean(),
    abortReason: boundedProtocolTokenSchema.nullable(),
    signedLogCommitted: z.boolean(),
    plaintextFallbackUsed: z.literal(false),
    plaintextOutstanding: z.boolean(),
    activeBrokerCount: z.number().int().nonnegative().max(1),
    epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    recoverySecretGeneration: z.number().int().nonnegative(),
    expectedHead: previousHeadSchema,
    enrolledSigners: enrolledSignersSchema,
    removedSignerIds: z.array(opaqueIdSchema).max(64),
    expectedSasTranscriptRef: opaqueIdSchema.nullable(),
    expectedPriorEndpointSnapshotRef: opaqueIdSchema.nullable(),
    expectedLiveDekWrapSetRef: opaqueIdSchema.nullable(),
    generatedEndpointId: opaqueIdSchema.nullable(),
    updatedAt: protocolTimestampSchema,
  })
  .strict();
export type CeremonyState = z.infer<typeof ceremonyStateSchema>;

export class CeremonyTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CeremonyTransitionError";
  }
}

function alert(
  state: CeremonyState,
  code: string,
  at: string,
  origin: "server" | "local" = state.alertOrigin ?? "local",
): CeremonyState {
  return ceremonyStateSchema.parse({
    ...state,
    status: "alert",
    alertCode: code,
    alertOrigin: origin,
    incompleteReason: null,
    updatedAt: at,
  });
}

export function startCeremony(input: CeremonyStart): CeremonyState {
  const start = ceremonyStartSchema.parse(input);
  const steps = stepsFor(start.kind, start.targetRole);
  if (start.initiatorActor === "server") {
    return ceremonyStateSchema.parse({
      version: E2EE_CONTRACT_VERSION,
      ceremonyId: start.ceremonyId,
      vaultId: start.vaultId,
      kind: start.kind,
      initiatorActor: start.initiatorActor,
      initiatorId: start.initiatorId,
      status: "alert",
      targetRole: start.targetRole,
      completedSteps: [],
      nextStep: steps[0] ?? null,
      alertCode: "server_cannot_initiate_ceremony",
      alertOrigin: "server",
      incompleteReason: null,
      abortLogged: false,
      abortReason: null,
      signedLogCommitted: false,
      plaintextFallbackUsed: false,
      plaintextOutstanding: false,
      activeBrokerCount: start.activeBrokerCount,
      epoch: start.epoch,
      recoverySecretGeneration: start.recoverySecretGeneration,
      expectedHead: start.expectedHead,
      enrolledSigners: start.enrolledSigners,
      removedSignerIds: [],
      expectedSasTranscriptRef: start.expectedSasTranscriptRef,
      expectedPriorEndpointSnapshotRef: start.expectedPriorEndpointSnapshotRef,
      expectedLiveDekWrapSetRef: start.expectedLiveDekWrapSetRef,
      generatedEndpointId: null,
      updatedAt: start.startedAt,
    });
  }
  return ceremonyStateSchema.parse({
    version: E2EE_CONTRACT_VERSION,
    ceremonyId: start.ceremonyId,
    vaultId: start.vaultId,
    kind: start.kind,
    initiatorActor: start.initiatorActor,
    initiatorId: start.initiatorId,
    status: "active",
    targetRole: start.targetRole,
    completedSteps: [],
    nextStep: steps[0] ?? null,
    alertCode: null,
    alertOrigin: null,
    incompleteReason: null,
    abortLogged: false,
    abortReason: null,
    signedLogCommitted: false,
    plaintextFallbackUsed: false,
    plaintextOutstanding: false,
    activeBrokerCount: start.activeBrokerCount,
    epoch: start.epoch,
    recoverySecretGeneration: start.recoverySecretGeneration,
    expectedHead: start.expectedHead,
    enrolledSigners: start.enrolledSigners,
    removedSignerIds: [],
    expectedSasTranscriptRef: start.expectedSasTranscriptRef,
    expectedPriorEndpointSnapshotRef: start.expectedPriorEndpointSnapshotRef,
    expectedLiveDekWrapSetRef: start.expectedLiveDekWrapSetRef,
    generatedEndpointId: null,
    updatedAt: start.startedAt,
  });
}

function evidenceFailure(
  state: CeremonyState,
  step: CeremonyStep,
  evidence: CeremonyEvidence,
  actor: z.infer<typeof ceremonyActorSchema>,
  actorId: string,
): string | null {
  const signerRole = state.enrolledSigners.find(
    (signer) => signer.id === evidence.signerId,
  )?.role;
  if (
    SIGNED_STEPS.has(step) &&
    !BROKER_SIGNED_STEPS.has(step) &&
    evidence.endpointSignatureVerified !== true
  ) {
    return "endpoint_signature_required";
  }
  if (
    BROKER_SIGNED_STEPS.has(step) &&
    evidence.brokerSignatureVerified !== true
  ) {
    return "broker_signature_required";
  }
  if (SIGNED_STEPS.has(step) && evidence.previousHeadVerified !== true) {
    return "signed_step_previous_head_required";
  }
  if (
    SIGNED_STEPS.has(step) &&
    (!evidence.signerId || !evidence.previousHead)
  ) {
    return "signed_step_binding_required";
  }
  if (SIGNED_STEPS.has(step) && evidence.signerId !== actorId) {
    return "signed_step_signer_mismatch";
  }
  if (
    SIGNED_STEPS.has(step) &&
    (evidence.previousHead?.sequence !== state.expectedHead.sequence ||
      evidence.previousHead?.headRef !== state.expectedHead.headRef)
  ) {
    return "signed_step_head_mismatch";
  }
  const genesisEnrollment =
    state.kind === "first_device" &&
    step === "endpoint_enrollment_signed" &&
    evidence.signerId === state.generatedEndpointId;
  if (
    ["endpoint_enrollment_signed", "broker_enrollment_signed"].includes(step) &&
    state.kind !== "first_device" &&
    evidence.signerId === state.generatedEndpointId
  ) {
    return "candidate_self_enrollment_forbidden";
  }
  if (
    SIGNED_STEPS.has(step) &&
    !genesisEnrollment &&
    (!evidence.signerId || !signerRole)
  ) {
    return "signer_not_enrolled";
  }
  if (
    SIGNED_STEPS.has(step) &&
    !genesisEnrollment &&
    signerRole !== (BROKER_SIGNED_STEPS.has(step) ? "broker" : "endpoint")
  ) {
    return "signer_role_mismatch";
  }
  if (
    ["endpoint_keys_generated", "candidate_keys_generated"].includes(step) &&
    !evidence.generatedEndpointId
  ) {
    return "generated_endpoint_binding_required";
  }
  if (
    ["endpoint_keys_generated", "candidate_keys_generated"].includes(step) &&
    state.enrolledSigners.some(
      (signer) => signer.id === evidence.generatedEndpointId,
    )
  ) {
    return "candidate_id_collision";
  }
  if (step === "epoch_created" && evidence.createdEpoch !== state.epoch) {
    return "created_epoch_binding_required";
  }
  if (
    ["endpoint_enrollment_signed", "broker_enrollment_signed"].includes(step) &&
    evidence.serverAuthorized !== false
  ) {
    return "server_cannot_enroll_endpoint";
  }
  if (
    step === "broker_enrollment_signed" &&
    evidence.brokerUnattendedRoleVerified !== true
  ) {
    return "broker_role_binding_required";
  }
  if (
    step === "recovery_secret_confirmed" &&
    evidence.recoverySecretEchoVerified !== true
  ) {
    return "recovery_secret_confirmation_required";
  }
  if (
    step === "sas_verified" &&
    (evidence.sasMatched !== true ||
      evidence.sasTranscriptRef !== state.expectedSasTranscriptRef)
  ) {
    return "sas_verification_required";
  }
  if (
    step === "epoch_key_boxed" &&
    (evidence.epochKeyBoxedToRecipient !== true ||
      evidence.recipientId !== state.generatedEndpointId)
  ) {
    return "epoch_key_box_binding_required";
  }
  if (
    step === "recovery_secret_unsealed" &&
    evidence.recoverySecretGenerationConsumed !== state.recoverySecretGeneration
  ) {
    return "recovery_secret_generation_mismatch";
  }
  if (
    step === "rotation_started" &&
    evidence.rotationTargetEpoch !== state.epoch + 1
  ) {
    return "rotation_target_epoch_required";
  }
  if (
    step === "rotation_started" &&
    [
      "remove_device",
      "recovery",
      "broker_replacement",
      "vault_deletion",
    ].includes(state.kind) &&
    evidence.forcedRotation !== true
  ) {
    return "forced_rotation_required";
  }
  if (
    step === "live_deks_rewrapped" &&
    evidence.allLiveDeksRewrapped !== true
  ) {
    return "dek_rewrap_incomplete";
  }
  if (
    step === "remaining_endpoints_acknowledged" &&
    evidence.allRemainingEndpointsAcknowledged !== true
  ) {
    return "endpoint_acknowledgements_incomplete";
  }
  if (
    step === "old_epoch_destroyed" &&
    evidence.oldEpochKeyDestroyed !== true
  ) {
    return "old_epoch_not_destroyed";
  }
  if (
    step === "old_epoch_destroyed" &&
    evidence.destroyedEpoch !== state.epoch
  ) {
    return "destroyed_epoch_binding_required";
  }
  if (
    step === "prior_endpoints_removed" &&
    (evidence.priorEndpointSnapshotRemoved !== true ||
      evidence.priorEndpointSnapshotRef !==
        state.expectedPriorEndpointSnapshotRef)
  ) {
    return "prior_endpoint_snapshot_removal_required";
  }
  if (["removal_signed", "old_broker_removal_signed"].includes(step)) {
    const removedSigner = state.enrolledSigners.find(
      (signer) => signer.id === evidence.removedSignerId,
    );
    if (!removedSigner || evidence.removedSignerId === evidence.signerId) {
      return "removed_signer_binding_required";
    }
    const expectedRemovedRole =
      step === "old_broker_removal_signed" ? "broker" : "endpoint";
    if (removedSigner.role !== expectedRemovedRole) {
      return "removed_signer_role_mismatch";
    }
  }
  if (
    step === "live_dek_wraps_destroyed" &&
    (evidence.liveDekWrapsDestroyed !== true ||
      evidence.liveDekWrapSetRef !== state.expectedLiveDekWrapSetRef)
  ) {
    return "live_dek_wrap_destruction_required";
  }
  if (
    step === "recovery_secret_replaced" &&
    evidence.recoverySecretReplaced !== true
  ) {
    return "recovery_secret_replacement_required";
  }
  if (step === "outstanding_jobs_resolved" && !evidence.outstandingJobs) {
    return "broker_jobs_unresolved";
  }
  if (
    step === "broker_uniqueness_verified" &&
    evidence.activeBrokerCountAfter !== 1
  ) {
    return "broker_uniqueness_violation";
  }
  if (
    step === "control_log_head_verified" &&
    (typeof evidence.logHeadAgeSeconds !== "number" ||
      evidence.previousHeadVerified !== true ||
      evidence.previousHead?.sequence !== state.expectedHead.sequence ||
      evidence.previousHead?.headRef !== state.expectedHead.headRef)
  ) {
    return "fresh_log_head_required";
  }
  if (
    ["grant_scope_verified", "disclosure_grant_verified"].includes(step) &&
    evidence.scopedResourcesVerified !== true
  ) {
    return "scope_verification_required";
  }
  if (
    step === "broker_provider_direct_connected" &&
    evidence.providerPath !== "broker_direct_tls"
  ) {
    return "hosted_plaintext_relay_forbidden";
  }
  if (
    step === "scoped_plaintext_released" &&
    evidence.plaintextFallback !== false
  ) {
    return "plaintext_fallback_forbidden";
  }
  if (step === "plaintext_destroyed" && evidence.plaintextRetained !== false) {
    return "plaintext_retention_forbidden";
  }
  if (step === "deletion_confirmed" && evidence.userConfirmed !== true) {
    return "deletion_confirmation_required";
  }
  if (
    step === "hosted_ciphertext_delete_requested" &&
    evidence.hostedDeleteRequested !== true
  ) {
    return "hosted_delete_not_requested";
  }
  if (
    step === "signed_log_committed" &&
    ((actor === "broker"
      ? evidence.brokerSignatureVerified !== true
      : evidence.endpointSignatureVerified !== true) ||
      evidence.previousHeadVerified !== true ||
      !evidence.signerId ||
      !evidence.previousHead ||
      evidence.previousHead.sequence !== state.expectedHead.sequence ||
      evidence.previousHead.headRef !== state.expectedHead.headRef ||
      !state.enrolledSigners.some(
        (signer) =>
          signer.id === evidence.signerId &&
          signer.role === (actor === "broker" ? "broker" : "endpoint"),
      ))
  ) {
    return "signed_log_commit_required";
  }
  if (step === "signed_log_committed" && evidence.signerId !== actorId) {
    return "signed_log_signer_mismatch";
  }
  return null;
}

function assertStateSequence(state: CeremonyState): void {
  const targetRoleValid =
    state.kind === "add_device"
      ? state.targetRole !== null
      : state.kind === "broker_replacement"
        ? state.targetRole === "broker"
        : state.targetRole === null;
  const initiatorValid =
    state.initiatorActor !== "recovery"
      ? state.initiatorActor !== "broker" ||
        state.kind === "direct_external_disclosure"
      : state.kind === "recovery";
  const referenceShapeValid =
    ["add_device", "broker_replacement"].includes(state.kind) ===
      (state.expectedSasTranscriptRef !== null) &&
    (state.kind === "recovery") ===
      (state.expectedPriorEndpointSnapshotRef !== null) &&
    (state.kind === "vault_deletion") ===
      (state.expectedLiveDekWrapSetRef !== null);
  const signerRoleShapeValid =
    state.kind === "first_device" ||
    (state.enrolledSigners.some((signer) => signer.role === "endpoint") &&
      (state.kind !== "direct_external_disclosure" ||
        state.enrolledSigners.some((signer) => signer.role === "broker")));
  if (
    !targetRoleValid ||
    !initiatorValid ||
    !referenceShapeValid ||
    !signerRoleShapeValid
  ) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }

  const steps = stepsFor(state.kind, state.targetRole);
  const exactPrefix = state.completedSteps.every(
    (step, index) => steps[index] === step,
  );
  if (!exactPrefix || state.completedSteps.length > steps.length) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }

  const isAlert = state.status === "alert";
  const hasCompleteAlert =
    state.alertCode !== null && state.alertOrigin !== null;
  const hasPartialAlert =
    (state.alertCode === null) !== (state.alertOrigin === null);
  if (
    hasPartialAlert ||
    (isAlert && !hasCompleteAlert) ||
    (!isAlert && state.status !== "aborted" && hasCompleteAlert)
  ) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }
  if (
    (state.status === "incomplete") !== (state.incompleteReason !== null) ||
    (state.status === "active" &&
      (state.alertCode !== null ||
        state.alertOrigin !== null ||
        state.incompleteReason !== null))
  ) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }

  const expectedNext = steps[state.completedSteps.length] ?? null;
  if (state.status === "aborted") {
    if (
      state.nextStep !== null ||
      !state.abortLogged ||
      !state.abortReason ||
      state.signedLogCommitted
    ) {
      throw new CeremonyTransitionError("state_sequence_forged");
    }
  } else if (state.status === "committed") {
    if (
      expectedNext !== null ||
      state.nextStep !== null ||
      !state.signedLogCommitted ||
      state.abortLogged
    ) {
      throw new CeremonyTransitionError("state_sequence_forged");
    }
  } else if (
    state.nextStep !== expectedNext ||
    state.signedLogCommitted ||
    state.abortLogged ||
    state.abortReason !== null
  ) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }

  const releaseIndex = state.completedSteps.indexOf(
    "scoped_plaintext_released",
  );
  const destroyIndex = state.completedSteps.indexOf("plaintext_destroyed");
  const expectedPlaintextOutstanding =
    releaseIndex !== -1 && destroyIndex === -1;
  if (state.plaintextOutstanding !== expectedPlaintextOutstanding) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }

  const generationCompleted = state.completedSteps.some((step) =>
    ["endpoint_keys_generated", "candidate_keys_generated"].includes(step),
  );
  if (generationCompleted !== (state.generatedEndpointId !== null)) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }
  const enrollmentCompleted = state.completedSteps.some((step) =>
    ["endpoint_enrollment_signed", "broker_enrollment_signed"].includes(step),
  );
  if (
    enrollmentCompleted &&
    (!state.generatedEndpointId ||
      !state.enrolledSigners.some(
        (signer) => signer.id === state.generatedEndpointId,
      ))
  ) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }
  if (
    state.kind === "first_device" &&
    ((!enrollmentCompleted && state.enrolledSigners.length !== 0) ||
      (enrollmentCompleted &&
        (state.enrolledSigners.length !== 1 ||
          state.enrolledSigners[0]?.id !== state.generatedEndpointId ||
          state.enrolledSigners[0]?.role !== "endpoint")))
  ) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }
  if (
    new Set(state.removedSignerIds).size !== state.removedSignerIds.length ||
    state.removedSignerIds.some((removedId) =>
      state.enrolledSigners.some((signer) => signer.id === removedId),
    )
  ) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }
  const completedSingularRemovalCount = state.completedSteps.filter((step) =>
    ["removal_signed", "old_broker_removal_signed"].includes(step),
  ).length;
  const recoverySnapshotRemoved = state.completedSteps.includes(
    "prior_endpoints_removed",
  );
  if (
    (!recoverySnapshotRemoved &&
      completedSingularRemovalCount !== state.removedSignerIds.length) ||
    (recoverySnapshotRemoved &&
      state.removedSignerIds.length < completedSingularRemovalCount)
  ) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }
  if (
    recoverySnapshotRemoved &&
    state.kind === "recovery" &&
    state.enrolledSigners.some(
      (signer) =>
        signer.role === "endpoint" &&
        signer.id !== state.initiatorId &&
        signer.id !== state.generatedEndpointId,
    )
  ) {
    throw new CeremonyTransitionError("state_sequence_forged");
  }
}

function lifecycleEvidenceFailure(
  state: CeremonyState,
  evidence: z.infer<typeof signedLifecycleEvidenceSchema>,
  actorId: string,
): string | null {
  if (evidence.signerId !== actorId) return "lifecycle_signer_mismatch";
  if (
    evidence.previousHead.sequence !== state.expectedHead.sequence ||
    evidence.previousHead.headRef !== state.expectedHead.headRef
  ) {
    return "lifecycle_head_mismatch";
  }
  const genesisInitiator =
    state.kind === "first_device" && evidence.signerId === state.initiatorId;
  const enrolledEndpoint = state.enrolledSigners.some(
    (signer) => signer.id === evidence.signerId && signer.role === "endpoint",
  );
  if (!genesisInitiator && !enrolledEndpoint) {
    return "lifecycle_signer_not_authorized";
  }
  return null;
}

export function applyCeremonyEvent(
  stateInput: CeremonyState,
  eventInput: CeremonyEvent,
): CeremonyState {
  const state = ceremonyStateSchema.parse(stateInput);
  const event = ceremonyEventSchema.parse(eventInput);
  assertStateSequence(state);
  if (["committed", "aborted"].includes(state.status)) {
    throw new CeremonyTransitionError("Terminal ceremony state is immutable");
  }
  if (Date.parse(event.at) < Date.parse(state.updatedAt)) {
    return alert(state, "non_monotonic_timestamp", state.updatedAt);
  }
  if (
    event.ceremonyId !== state.ceremonyId ||
    event.vaultId !== state.vaultId ||
    event.epoch !== state.epoch
  ) {
    return alert(
      state,
      "event_ceremony_binding_mismatch",
      event.at,
      event.actor === "server" ? "server" : "local",
    );
  }
  if (event.actor === "recovery" && state.kind !== "recovery") {
    return alert(state, "recovery_actor_not_authorized", event.at);
  }
  if (
    event.type === "acknowledge_alert" &&
    state.status === "alert" &&
    state.alertOrigin === "server"
  ) {
    return alert(state, "server_alert_not_resumable", event.at, "server");
  }
  if (
    event.type === "pause" ||
    event.type === "resume" ||
    event.type === "acknowledge_alert" ||
    event.type === "abort"
  ) {
    const lifecycleFailure = lifecycleEvidenceFailure(
      state,
      event.evidence,
      event.actorId,
    );
    if (lifecycleFailure) return alert(state, lifecycleFailure, event.at);
  }
  if (event.type === "plaintext_fallback_attempted") {
    return alert(
      state,
      "plaintext_fallback_forbidden",
      event.at,
      event.actor === "server" ? "server" : "local",
    );
  }
  if (event.type === "security_alert") {
    return alert(
      state,
      event.alertCode,
      event.at,
      event.actor === "server" ? "server" : "local",
    );
  }
  if (event.type === "abort") {
    if (state.plaintextOutstanding) {
      return alert(state, "plaintext_destruction_required_first", event.at);
    }
    return ceremonyStateSchema.parse({
      ...state,
      status: "aborted",
      incompleteReason: null,
      abortLogged: true,
      abortReason: event.reasonCode,
      signedLogCommitted: false,
      nextStep: null,
      updatedAt: event.at,
    });
  }
  if (event.type === "pause") {
    if (state.plaintextOutstanding) {
      return alert(state, "plaintext_destruction_required_first", event.at);
    }
    if (state.status !== "active") {
      return alert(state, "invalid_pause_transition", event.at);
    }
    return ceremonyStateSchema.parse({
      ...state,
      status: "incomplete",
      incompleteReason: event.reasonCode,
      updatedAt: event.at,
    });
  }
  if (event.type === "acknowledge_alert") {
    if (state.status !== "alert") {
      return alert(state, "invalid_alert_acknowledgement", event.at);
    }
    if (state.alertOrigin === "server") {
      return alert(state, "server_alert_not_resumable", event.at, "server");
    }
    return ceremonyStateSchema.parse({
      ...state,
      status: "incomplete",
      alertCode: null,
      alertOrigin: null,
      incompleteReason: "alert_acknowledged",
      updatedAt: event.at,
    });
  }
  if (event.type === "resume") {
    if (state.status !== "incomplete") {
      return alert(state, "invalid_resume_transition", event.at);
    }
    return ceremonyStateSchema.parse({
      ...state,
      status: "active",
      incompleteReason: null,
      updatedAt: event.at,
    });
  }
  if (event.actor === "server") {
    return alert(state, "server_cannot_complete_ceremony", event.at, "server");
  }
  if (
    state.kind === "direct_external_disclosure" &&
    (event.actor !== "broker" ||
      !state.enrolledSigners.some(
        (signer) => signer.id === event.actorId && signer.role === "broker",
      ))
  ) {
    return alert(state, "broker_actor_required", event.at);
  }
  if (state.kind !== "direct_external_disclosure" && event.actor === "broker") {
    return alert(state, "broker_actor_not_authorized", event.at);
  }
  const destructionWhileStopped =
    event.step === "plaintext_destroyed" &&
    state.plaintextOutstanding &&
    ["alert", "incomplete"].includes(state.status);
  if (state.status !== "active" && !destructionWhileStopped) {
    return alert(state, "ceremony_not_active", event.at);
  }
  if (event.step !== state.nextStep) {
    return alert(state, "unexpected_ceremony_step", event.at);
  }
  const failure = evidenceFailure(
    state,
    event.step,
    event.evidence,
    event.actor,
    event.actorId,
  );
  if (failure) return alert(state, failure, event.at);

  const completedSteps = [...state.completedSteps, event.step];
  const steps = stepsFor(state.kind, state.targetRole);
  const nextStep = steps[completedSteps.length] ?? null;
  const committed = event.step === "signed_log_committed";
  const nextStatus = committed
    ? "committed"
    : destructionWhileStopped
      ? state.status
      : "active";
  const enrollmentCompletedNow = [
    "endpoint_enrollment_signed",
    "broker_enrollment_signed",
  ].includes(event.step);
  const singularRemovalCompletedNow = [
    "removal_signed",
    "old_broker_removal_signed",
  ].includes(event.step);
  const recoverySnapshotRemovalCompletedNow =
    event.step === "prior_endpoints_removed";
  const enrolledRole =
    state.targetRole === "broker" || state.kind === "broker_replacement"
      ? "broker"
      : "endpoint";
  const recoveryPrunedSignerIds = recoverySnapshotRemovalCompletedNow
    ? state.enrolledSigners
        .filter(
          (signer) =>
            signer.role === "endpoint" &&
            signer.id !== state.initiatorId &&
            signer.id !== state.generatedEndpointId,
        )
        .map((signer) => signer.id)
    : [];
  const enrolledSigners = recoverySnapshotRemovalCompletedNow
    ? state.enrolledSigners.filter(
        (signer) => !recoveryPrunedSignerIds.includes(signer.id),
      )
    : singularRemovalCompletedNow
      ? state.enrolledSigners.filter(
          (signer) => signer.id !== event.evidence.removedSignerId,
        )
      : enrollmentCompletedNow &&
          state.generatedEndpointId &&
          !state.enrolledSigners.some(
            (signer) => signer.id === state.generatedEndpointId,
          )
        ? [
            ...state.enrolledSigners,
            { id: state.generatedEndpointId, role: enrolledRole },
          ]
        : state.enrolledSigners;
  return ceremonyStateSchema.parse({
    ...state,
    status: nextStatus,
    completedSteps,
    nextStep,
    alertCode: destructionWhileStopped ? state.alertCode : null,
    alertOrigin: destructionWhileStopped ? state.alertOrigin : null,
    incompleteReason: destructionWhileStopped ? state.incompleteReason : null,
    signedLogCommitted: committed,
    generatedEndpointId: [
      "endpoint_keys_generated",
      "candidate_keys_generated",
    ].includes(event.step)
      ? event.evidence.generatedEndpointId!
      : state.generatedEndpointId,
    enrolledSigners,
    removedSignerIds: recoverySnapshotRemovalCompletedNow
      ? [...state.removedSignerIds, ...recoveryPrunedSignerIds]
      : singularRemovalCompletedNow
        ? [...state.removedSignerIds, event.evidence.removedSignerId!]
        : state.removedSignerIds,
    plaintextOutstanding:
      event.step === "scoped_plaintext_released"
        ? true
        : event.step === "plaintext_destroyed"
          ? false
          : state.plaintextOutstanding,
    activeBrokerCount:
      event.step === "broker_uniqueness_verified"
        ? event.evidence.activeBrokerCountAfter!
        : state.activeBrokerCount,
    epoch: event.step === "old_epoch_destroyed" ? state.epoch + 1 : state.epoch,
    recoverySecretGeneration:
      event.step === "recovery_secret_replaced"
        ? state.recoverySecretGeneration + 1
        : state.recoverySecretGeneration,
    updatedAt: event.at,
  });
}

export function replayCeremonyTranscript(
  start: CeremonyStart,
  events: readonly CeremonyEvent[],
): CeremonyState {
  return events.reduce(applyCeremonyEvent, startCeremony(start));
}

export function ceremonySteps(
  kind: CeremonyKind,
  targetRole: "device" | "broker" | null = null,
): readonly CeremonyStep[] {
  return stepsFor(
    ceremonyKindSchema.parse(kind),
    z.enum(["device", "broker"]).nullable().parse(targetRole),
  );
}

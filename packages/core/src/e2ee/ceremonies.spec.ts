import { describe, expect, it } from "vitest";

import {
  CeremonyTransitionError,
  applyCeremonyEvent,
  ceremonyEventSchema,
  ceremonyEvidenceSchema,
  ceremonyKindSchema,
  ceremonyStateSchema,
  ceremonySteps,
  ceremonyStartSchema,
  startCeremony,
  type CeremonyEvidence,
  type CeremonyKind,
  type CeremonyStart,
  type CeremonyState,
  type CeremonyStep,
} from "./ceremonies.js";

const now = "2026-07-16T12:00:00.000Z";

function startInput(
  kind: CeremonyKind,
  overrides: Partial<CeremonyStart> = {},
): CeremonyStart {
  const targetRole =
    overrides.targetRole ??
    (kind === "broker_replacement"
      ? "broker"
      : kind === "add_device"
        ? "device"
        : null);
  const firstBroker = kind === "add_device" && targetRole === "broker";
  const hasBroker = kind !== "first_device" && !firstBroker;
  return ceremonyStartSchema.parse({
    version: 1,
    ceremonyId: `ceremony:${kind}`,
    vaultId: "vault:fixture-01",
    kind,
    initiatorActor: kind === "recovery" ? "recovery" : "endpoint",
    initiatorId:
      kind === "recovery" ? "recovery:fixture-01" : "endpoint:fixture-01",
    targetRole,
    activeBrokerCount: hasBroker ? 1 : 0,
    epoch: kind === "first_device" ? 1 : 3,
    recoverySecretGeneration: 2,
    expectedHead: { sequence: 4, headRef: "head:fixture-04" },
    enrolledSigners:
      kind === "first_device"
        ? []
        : [
            { id: "endpoint:fixture-01", role: "endpoint" },
            { id: "endpoint:secondary-01", role: "endpoint" },
            ...(hasBroker
              ? [{ id: "endpoint:broker-01", role: "broker" as const }]
              : []),
            { id: "recovery:fixture-01", role: "endpoint" },
          ],
    expectedSasTranscriptRef: ["add_device", "broker_replacement"].includes(
      kind,
    )
      ? "sas:fixture-01"
      : null,
    expectedPriorEndpointSnapshotRef:
      kind === "recovery" ? "snapshot:pre-recovery-01" : null,
    expectedLiveDekWrapSetRef:
      kind === "vault_deletion" ? "wrap-set:fixture-01" : null,
    startedAt: now,
    ...overrides,
  });
}

function actorFor(state: CeremonyState) {
  if (state.kind === "direct_external_disclosure") {
    return { actor: "broker" as const, actorId: "endpoint:broker-01" };
  }
  if (state.kind === "recovery") {
    return { actor: "recovery" as const, actorId: "recovery:fixture-01" };
  }
  return { actor: "endpoint" as const, actorId: "endpoint:fixture-01" };
}

function binding(state: CeremonyState) {
  return {
    ceremonyId: state.ceremonyId,
    vaultId: state.vaultId,
    epoch: state.epoch,
    at: now,
  };
}

function signedEvidence(
  signerId: string,
  brokerSigned = false,
): CeremonyEvidence {
  return {
    ...(brokerSigned
      ? { brokerSignatureVerified: true as const }
      : { endpointSignatureVerified: true as const }),
    previousHeadVerified: true,
    signerId,
    previousHead: { sequence: 4, headRef: "head:fixture-04" },
  };
}

function candidateIdFor(state: CeremonyState): string {
  if (state.kind === "first_device") return state.initiatorId;
  if (state.kind === "recovery") return "endpoint:recovered-01";
  if (state.kind === "broker_replacement" || state.targetRole === "broker") {
    return "endpoint:broker-candidate-01";
  }
  return "endpoint:candidate-01";
}

function evidenceFor(
  step: CeremonyStep,
  state: CeremonyState,
  actorId: string,
): CeremonyEvidence {
  switch (step) {
    case "endpoint_keys_generated":
    case "candidate_keys_generated":
      return { generatedEndpointId: candidateIdFor(state) };
    case "endpoint_enrollment_signed":
      return {
        ...signedEvidence(actorId),
        serverAuthorized: false,
      };
    case "broker_enrollment_signed":
      return {
        ...signedEvidence(actorId),
        serverAuthorized: false,
        brokerUnattendedRoleVerified: true,
      };
    case "removal_signed":
      return {
        ...signedEvidence(actorId),
        removedSignerId: "endpoint:secondary-01",
      };
    case "old_broker_removal_signed":
      return {
        ...signedEvidence(actorId),
        removedSignerId: "endpoint:broker-01",
      };
    case "grant_signed":
    case "revocation_signed":
    case "tombstone_signed":
      return signedEvidence(actorId);
    case "disclosure_event_signed":
      return signedEvidence(actorId, true);
    case "recovery_secret_confirmed":
      return { recoverySecretEchoVerified: true };
    case "sas_verified":
      return {
        sasMatched: true,
        sasTranscriptRef: state.expectedSasTranscriptRef!,
      };
    case "epoch_created":
      return { createdEpoch: state.epoch };
    case "epoch_key_boxed":
      return {
        epochKeyBoxedToRecipient: true,
        recipientId: state.generatedEndpointId!,
      };
    case "recovery_secret_unsealed":
      return {
        recoverySecretGenerationConsumed: state.recoverySecretGeneration,
      };
    case "rotation_started":
      return { forcedRotation: true, rotationTargetEpoch: state.epoch + 1 };
    case "live_deks_rewrapped":
      return { allLiveDeksRewrapped: true };
    case "remaining_endpoints_acknowledged":
      return { allRemainingEndpointsAcknowledged: true };
    case "old_epoch_destroyed":
      return { oldEpochKeyDestroyed: true, destroyedEpoch: state.epoch };
    case "prior_endpoints_removed":
      return {
        ...signedEvidence(actorId),
        priorEndpointSnapshotRemoved: true,
        priorEndpointSnapshotRef: state.expectedPriorEndpointSnapshotRef!,
      };
    case "live_dek_wraps_destroyed":
      return {
        liveDekWrapsDestroyed: true,
        liveDekWrapSetRef: state.expectedLiveDekWrapSetRef!,
      };
    case "recovery_secret_replaced":
      return { recoverySecretReplaced: true };
    case "outstanding_jobs_resolved":
      return { outstandingJobs: "drained" };
    case "broker_uniqueness_verified":
      return { activeBrokerCountAfter: 1 };
    case "control_log_head_verified":
      return {
        logHeadAgeSeconds: 30,
        previousHeadVerified: true,
        previousHead: state.expectedHead,
      };
    case "grant_scope_verified":
    case "disclosure_grant_verified":
      return { scopedResourcesVerified: true };
    case "broker_provider_direct_connected":
      return { providerPath: "broker_direct_tls" };
    case "scoped_plaintext_released":
      return { plaintextFallback: false };
    case "plaintext_destroyed":
      return { plaintextRetained: false };
    case "deletion_confirmed":
      return { userConfirmed: true };
    case "hosted_ciphertext_delete_requested":
      return { hostedDeleteRequested: true };
    case "signed_log_committed":
      return signedEvidence(
        actorId,
        state.kind === "direct_external_disclosure",
      );
    default:
      return {};
  }
}

function complete(state: CeremonyState, evidence?: CeremonyEvidence) {
  if (!state.nextStep) throw new Error("No step remains");
  const actor = actorFor(state);
  return applyCeremonyEvent(state, {
    ...binding(state),
    type: "complete_step",
    step: state.nextStep,
    ...actor,
    evidence: evidence ?? evidenceFor(state.nextStep, state, actor.actorId),
  });
}

function completeAll(start: CeremonyStart): CeremonyState {
  let state = startCeremony(start);
  while (state.nextStep) {
    state = complete(state);
    if (state.status === "alert") {
      throw new Error(`Unexpected ceremony alert: ${state.alertCode}`);
    }
  }
  return state;
}

describe("E2EE ceremony transcripts", () => {
  it.each(ceremonyKindSchema.options)(
    "commits a complete, signed %s transcript",
    (kind) => {
      const result = completeAll(startInput(kind));
      expect(result.status).toBe("committed");
      expect(result.nextStep).toBeNull();
      expect(result.signedLogCommitted).toBe(true);
      expect(result.plaintextFallbackUsed).toBe(false);
      expect(result.completedSteps.at(-1)).toBe("signed_log_committed");
    },
  );

  it("uses distinct device and first-broker enrollment transcripts", () => {
    expect(ceremonySteps("add_device", "device")).toContain(
      "endpoint_enrollment_signed",
    );
    expect(ceremonySteps("add_device", "broker")).toEqual([
      "candidate_keys_generated",
      "sas_verified",
      "broker_enrollment_signed",
      "epoch_key_boxed",
      "broker_uniqueness_verified",
      "signed_log_committed",
    ]);
    expect(
      completeAll(
        startInput("add_device", {
          targetRole: "broker",
          activeBrokerCount: 0,
        }),
      ).activeBrokerCount,
    ).toBe(1);
  });

  it("requires first-device genesis to begin at epoch 1 with no broker", () => {
    expect(
      ceremonyStartSchema.safeParse({
        ...startInput("first_device"),
        epoch: 2,
      }).success,
    ).toBe(false);
    expect(
      ceremonyStartSchema.safeParse({
        ...startInput("first_device"),
        activeBrokerCount: 1,
      }).success,
    ).toBe(false);
    expect(
      ceremonyStartSchema.safeParse({
        ...startInput("first_device"),
        enrolledSigners: [{ id: "endpoint:fixture-01", role: "endpoint" }],
      }).success,
    ).toBe(false);
  });

  it("refuses broker enrollment or replacement from an invalid active count", () => {
    expect(
      ceremonyStartSchema.safeParse({
        ...startInput("add_device"),
        targetRole: "broker",
        activeBrokerCount: 1,
      }).success,
    ).toBe(false);
    expect(
      ceremonyStartSchema.safeParse({
        ...startInput("broker_replacement"),
        activeBrokerCount: 0,
      }).success,
    ).toBe(false);
  });

  it("blocks server initiation and server-completed enrollment", () => {
    const serverStart = startCeremony(
      startInput("first_device", {
        initiatorActor: "server",
        initiatorId: "server:fixture-01",
      }),
    );
    expect(serverStart.status).toBe("alert");
    expect(serverStart.alertCode).toBe("server_cannot_initiate_ceremony");
    const acknowledgedServerStart = applyCeremonyEvent(serverStart, {
      ...binding(serverStart),
      type: "acknowledge_alert",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      at: now,
      evidence: { ...signedEvidence("endpoint:fixture-01") },
    });
    expect(acknowledgedServerStart.status).toBe("alert");
    expect(acknowledgedServerStart.alertCode).toBe(
      "server_alert_not_resumable",
    );

    let state = startCeremony(startInput("first_device"));
    state = complete(state);
    state = complete(state);
    state = complete(state);
    state = complete(state);
    const attemptedEnrollment = applyCeremonyEvent(state, {
      ...binding(state),
      type: "complete_step",
      step: "endpoint_enrollment_signed",
      actor: "server",
      actorId: "server:fixture-01",
      at: now,
      evidence: {
        ...signedEvidence("server:fixture-01"),
        serverAuthorized: false,
      },
    });
    expect(attemptedEnrollment.status).toBe("alert");
    expect(attemptedEnrollment.alertCode).toBe(
      "server_cannot_complete_ceremony",
    );
  });

  it("is resumable and preserves the exact next step", () => {
    const initial = startCeremony(startInput("rotate_epoch"));
    const paused = applyCeremonyEvent(initial, {
      ...binding(initial),
      type: "pause",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      at: now,
      evidence: { ...signedEvidence("endpoint:fixture-01") },
      reasonCode: "device_offline",
    });
    expect(paused.status).toBe("incomplete");
    expect(paused.nextStep).toBe("rotation_started");
    const resumed = applyCeremonyEvent(paused, {
      ...binding(paused),
      type: "resume",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      at: now,
      evidence: { ...signedEvidence("endpoint:fixture-01") },
    });
    expect(resumed.status).toBe("active");
    expect(resumed.nextStep).toBe("rotation_started");
  });

  it("turns an out-of-order step into an explicit, recoverable alert", () => {
    const initial = startCeremony(startInput("grant_issue"));
    const alerted = applyCeremonyEvent(initial, {
      ...binding(initial),
      type: "complete_step",
      step: "grant_signed",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      at: now,
      evidence: { ...signedEvidence("endpoint:fixture-01") },
    });
    expect(alerted.status).toBe("alert");
    expect(alerted.alertCode).toBe("unexpected_ceremony_step");
    const acknowledged = applyCeremonyEvent(alerted, {
      ...binding(alerted),
      type: "acknowledge_alert",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      evidence: { ...signedEvidence("endpoint:fixture-01") },
      at: now,
    });
    expect(acknowledged.status).toBe("incomplete");
    expect(acknowledged.nextStep).toBe("control_log_head_verified");
  });

  it("requires a signed abort linked to the previous log head", () => {
    const aborted = applyCeremonyEvent(
      startCeremony(startInput("add_device")),
      {
        ...binding(startCeremony(startInput("add_device"))),
        type: "abort",
        actor: "endpoint",
        actorId: "endpoint:fixture-01",
        at: now,
        reasonCode: "sas_mismatch",
        evidence: {
          endpointSignatureVerified: true,
          previousHeadVerified: true,
          signerId: "endpoint:fixture-01",
          previousHead: { sequence: 4, headRef: "head:fixture-04" },
        },
      },
    );
    expect(aborted.status).toBe("aborted");
    expect(aborted.signedLogCommitted).toBe(false);
    expect(aborted.abortLogged).toBe(true);
    expect(aborted.abortReason).toBe("sas_mismatch");
    expect(aborted.nextStep).toBeNull();
    expect(
      ceremonyEventSchema.safeParse({
        ceremonyId: "ceremony:add_device",
        vaultId: "vault:fixture-01",
        epoch: 3,
        type: "abort",
        actor: "endpoint",
        actorId: "endpoint:fixture-01",
        at: now,
        reasonCode: "sas_mismatch",
        evidence: { endpointSignatureVerified: true },
      }).success,
    ).toBe(false);
  });

  it("will not report success without a verified signed-log commit", () => {
    let state = startCeremony(startInput("grant_revoke"));
    state = complete(state);
    state = complete(state);
    const result = complete(state, {});
    expect(result.status).toBe("alert");
    expect(result.alertCode).toBe("signed_log_commit_required");
    expect(result.signedLogCommitted).toBe(false);
  });

  it.each([
    "remove_device",
    "recovery",
    "broker_replacement",
    "vault_deletion",
  ] as const)("requires forced rotation during %s", (kind) => {
    let state = startCeremony(startInput(kind));
    while (state.nextStep !== "rotation_started") state = complete(state);
    const result = complete(state, { rotationTargetEpoch: state.epoch + 1 });
    expect(result.status).toBe("alert");
    expect(result.alertCode).toBe("forced_rotation_required");
  });

  it("requires evidence for the recovery snapshot and deleted live wraps", () => {
    let recovery = startCeremony(startInput("recovery"));
    while (recovery.nextStep !== "prior_endpoints_removed") {
      recovery = complete(recovery);
    }
    const missingSnapshot = complete(recovery, {
      ...signedEvidence("recovery:fixture-01"),
    });
    expect(missingSnapshot.alertCode).toBe(
      "prior_endpoint_snapshot_removal_required",
    );

    let deletion = startCeremony(startInput("vault_deletion"));
    while (deletion.nextStep !== "live_dek_wraps_destroyed") {
      deletion = complete(deletion);
    }
    const missingWrapDestruction = complete(deletion, {});
    expect(missingWrapDestruction.alertCode).toBe(
      "live_dek_wrap_destruction_required",
    );
  });

  it("makes every server-originated alert non-resumable", () => {
    const initial = startCeremony(startInput("grant_issue"));
    const serverAlert = applyCeremonyEvent(initial, {
      ...binding(initial),
      type: "security_alert",
      actor: "server",
      actorId: "server:fixture-01",
      alertCode: "host_reported_fault",
    });
    expect(serverAlert.alertOrigin).toBe("server");
    const acknowledged = applyCeremonyEvent(serverAlert, {
      ...binding(serverAlert),
      type: "acknowledge_alert",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      evidence: { ...signedEvidence("endpoint:fixture-01") },
    });
    expect(acknowledged.status).toBe("alert");
    expect(acknowledged.alertCode).toBe("server_alert_not_resumable");
    expect(acknowledged.alertOrigin).toBe("server");
  });

  it("logs abort separately from commit and preserves the triggering alert", () => {
    const initial = startCeremony(startInput("grant_issue"));
    const locallyAlerted = applyCeremonyEvent(initial, {
      ...binding(initial),
      type: "security_alert",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      alertCode: "local_integrity_failure",
    });
    const aborted = applyCeremonyEvent(locallyAlerted, {
      ...binding(locallyAlerted),
      type: "abort",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      reasonCode: "user_aborted_after_alert",
      evidence: {
        ...signedEvidence("endpoint:fixture-01"),
      },
    });
    expect(aborted.status).toBe("aborted");
    expect(aborted.abortLogged).toBe(true);
    expect(aborted.abortReason).toBe("user_aborted_after_alert");
    expect(aborted.signedLogCommitted).toBe(false);
    expect(aborted.alertCode).toBe("local_integrity_failure");
  });

  it("rejects cross-ceremony, cross-vault, or cross-epoch events", () => {
    const initial = startCeremony(startInput("grant_issue"));
    for (const badBinding of [
      { ceremonyId: "ceremony:other" },
      { vaultId: "vault:other" },
      { epoch: initial.epoch + 1 },
    ]) {
      const result = applyCeremonyEvent(initial, {
        ...binding(initial),
        ...badBinding,
        type: "pause",
        actor: "endpoint",
        actorId: "endpoint:fixture-01",
        evidence: { ...signedEvidence("endpoint:fixture-01") },
        reasonCode: "fixture_pause",
      });
      expect(result.alertCode).toBe("event_ceremony_binding_mismatch");
    }
  });

  it("requires bound signer, head, SAS, and destroyed-epoch references", () => {
    let grant = startCeremony(startInput("grant_issue"));
    grant = complete(grant);
    grant = complete(grant);
    expect(
      complete(grant, {
        endpointSignatureVerified: true,
        previousHeadVerified: true,
      }).alertCode,
    ).toBe("signed_step_binding_required");

    let addDevice = startCeremony(startInput("add_device"));
    addDevice = complete(addDevice);
    expect(complete(addDevice, { sasMatched: true }).alertCode).toBe(
      "sas_verification_required",
    );

    let rotation = startCeremony(startInput("rotate_epoch"));
    while (rotation.nextStep !== "old_epoch_destroyed") {
      rotation = complete(rotation);
    }
    expect(complete(rotation, { oldEpochKeyDestroyed: true }).alertCode).toBe(
      "destroyed_epoch_binding_required",
    );
  });

  it("cannot pause or abort while disclosed plaintext is outstanding", () => {
    function outstandingState() {
      let state = startCeremony(startInput("direct_external_disclosure"));
      while (state.nextStep !== "plaintext_destroyed") state = complete(state);
      expect(state.plaintextOutstanding).toBe(true);
      return state;
    }

    const beforePause = outstandingState();
    const paused = applyCeremonyEvent(beforePause, {
      ...binding(beforePause),
      type: "pause",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      evidence: { ...signedEvidence("endpoint:fixture-01") },
      reasonCode: "fixture_pause",
    });
    expect(paused.status).toBe("alert");
    expect(paused.alertCode).toBe("plaintext_destruction_required_first");

    const beforeAbort = outstandingState();
    const aborted = applyCeremonyEvent(beforeAbort, {
      ...binding(beforeAbort),
      type: "abort",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      reasonCode: "fixture_abort",
      evidence: { ...signedEvidence("endpoint:fixture-01") },
    });
    expect(aborted.status).toBe("alert");
    expect(aborted.alertCode).toBe("plaintext_destruction_required_first");
    expect(aborted.plaintextOutstanding).toBe(true);
  });

  it("rejects regressing timestamps without regressing state time", () => {
    const initial = startCeremony(startInput("grant_issue"));
    const result = applyCeremonyEvent(initial, {
      ...binding(initial),
      at: "2026-07-16T11:59:59.000Z",
      type: "pause",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      evidence: { ...signedEvidence("endpoint:fixture-01") },
      reasonCode: "fixture_pause",
    });
    expect(result.alertCode).toBe("non_monotonic_timestamp");
    expect(result.updatedAt).toBe(initial.updatedAt);
  });

  it("restricts recovery authority to the recovery ceremony", () => {
    const initial = startCeremony(startInput("grant_issue"));
    const result = applyCeremonyEvent(initial, {
      ...binding(initial),
      type: "pause",
      actor: "recovery",
      actorId: "recovery:fixture-01",
      evidence: { ...signedEvidence("recovery:fixture-01") },
      reasonCode: "fixture_pause",
    });
    expect(result.alertCode).toBe("recovery_actor_not_authorized");
  });

  it("rejects forged completed-step prefixes and forged next steps", () => {
    const initial = startCeremony(startInput("rotate_epoch"));
    const forged = ceremonyStateSchema.parse({
      ...initial,
      completedSteps: ["rotation_started"],
      nextStep: "signed_log_committed",
    });
    expect(() =>
      applyCeremonyEvent(forged, {
        ...binding(forged),
        type: "security_alert",
        actor: "endpoint",
        actorId: "endpoint:fixture-01",
        alertCode: "fixture_alert",
      }),
    ).toThrowError("state_sequence_forged");
  });

  it("requires epoch-box and recovery-unseal bindings", () => {
    let addDevice = startCeremony(startInput("add_device"));
    while (addDevice.nextStep !== "epoch_key_boxed") {
      addDevice = complete(addDevice);
    }
    expect(complete(addDevice, {}).alertCode).toBe(
      "epoch_key_box_binding_required",
    );

    const recovery = startCeremony(startInput("recovery"));
    expect(
      complete(recovery, {
        recoverySecretGenerationConsumed: recovery.recoverySecretGeneration + 1,
      }).alertCode,
    ).toBe("recovery_secret_generation_mismatch");
  });

  it("equality-binds signed and control-log evidence to the expected head", () => {
    const initial = startCeremony(startInput("grant_issue"));
    const wrongHead = {
      sequence: initial.expectedHead.sequence,
      headRef: "head:different-fork",
    };
    expect(
      complete(initial, {
        logHeadAgeSeconds: 30,
        previousHeadVerified: true,
        previousHead: wrongHead,
      }).alertCode,
    ).toBe("fresh_log_head_required");

    let grant = complete(initial);
    grant = complete(grant);
    expect(
      complete(grant, {
        ...signedEvidence("endpoint:fixture-01"),
        previousHead: wrongHead,
      }).alertCode,
    ).toBe("signed_step_head_mismatch");

    const aborted = applyCeremonyEvent(initial, {
      ...binding(initial),
      type: "abort",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      reasonCode: "fixture_abort",
      evidence: {
        ...signedEvidence("endpoint:fixture-01"),
        previousHead: wrongHead,
      },
    });
    expect(aborted.alertCode).toBe("lifecycle_head_mismatch");
  });

  it("requires enrolled authorization and rejects candidate self-enrollment", () => {
    let state = startCeremony(startInput("add_device"));
    state = complete(state);
    state = complete(state);
    expect(state.generatedEndpointId).toBe("endpoint:candidate-01");

    const candidateAttempt = applyCeremonyEvent(state, {
      ...binding(state),
      type: "complete_step",
      step: "endpoint_enrollment_signed",
      actor: "endpoint",
      actorId: state.generatedEndpointId!,
      evidence: {
        ...signedEvidence(state.generatedEndpointId!),
        serverAuthorized: false,
      },
    });
    expect(candidateAttempt.alertCode).toBe(
      "candidate_self_enrollment_forbidden",
    );

    const unknownSigner = applyCeremonyEvent(state, {
      ...binding(state),
      type: "complete_step",
      step: "endpoint_enrollment_signed",
      actor: "endpoint",
      actorId: "endpoint:unknown-01",
      evidence: {
        ...signedEvidence("endpoint:unknown-01"),
        serverAuthorized: false,
      },
    });
    expect(unknownSigner.alertCode).toBe("signer_not_enrolled");
  });

  it("equality-binds SAS, epoch recipient, recovery snapshot, and wrap set", () => {
    let device = startCeremony(startInput("add_device"));
    device = complete(device);
    expect(
      complete(device, {
        sasMatched: true,
        sasTranscriptRef: "sas:different-transcript",
      }).alertCode,
    ).toBe("sas_verification_required");
    device = complete(device);
    device = complete(device);
    expect(
      complete(device, {
        epochKeyBoxedToRecipient: true,
        recipientId: "endpoint:not-the-candidate",
      }).alertCode,
    ).toBe("epoch_key_box_binding_required");

    let recovery = startCeremony(startInput("recovery"));
    while (recovery.nextStep !== "prior_endpoints_removed") {
      recovery = complete(recovery);
    }
    expect(
      complete(recovery, {
        ...signedEvidence("recovery:fixture-01"),
        priorEndpointSnapshotRemoved: true,
        priorEndpointSnapshotRef: "snapshot:different",
      }).alertCode,
    ).toBe("prior_endpoint_snapshot_removal_required");

    let deletion = startCeremony(startInput("vault_deletion"));
    while (deletion.nextStep !== "live_dek_wraps_destroyed") {
      deletion = complete(deletion);
    }
    expect(
      complete(deletion, {
        liveDekWrapsDestroyed: true,
        liveDekWrapSetRef: "wrap-set:different",
      }).alertCode,
    ).toBe("live_dek_wrap_destruction_required");
  });

  it("permits plaintext destruction while a server alert remains terminal", () => {
    let state = startCeremony(startInput("direct_external_disclosure"));
    while (state.nextStep !== "plaintext_destroyed") state = complete(state);
    const serverAlert = applyCeremonyEvent(state, {
      ...binding(state),
      type: "security_alert",
      actor: "server",
      actorId: "server:fixture-01",
      alertCode: "host_reported_fault",
    });
    expect(serverAlert.plaintextOutstanding).toBe(true);

    const destroyed = complete(serverAlert);
    expect(destroyed.status).toBe("alert");
    expect(destroyed.alertOrigin).toBe("server");
    expect(destroyed.alertCode).toBe("host_reported_fault");
    expect(destroyed.plaintextOutstanding).toBe(false);
    expect(destroyed.nextStep).toBe("disclosure_event_signed");

    const aborted = applyCeremonyEvent(destroyed, {
      ...binding(destroyed),
      type: "abort",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      reasonCode: "abort_after_plaintext_cleanup",
      evidence: { ...signedEvidence("endpoint:fixture-01") },
    });
    expect(aborted.status).toBe("aborted");
  });

  it("restricts recovery and broker start authority by ceremony kind", () => {
    expect(
      ceremonyStartSchema.safeParse({
        ...startInput("grant_issue"),
        initiatorActor: "recovery",
        initiatorId: "recovery:fixture-01",
      }).success,
    ).toBe(false);
    expect(
      ceremonyStartSchema.safeParse({
        ...startInput("vault_deletion"),
        initiatorActor: "broker",
        initiatorId: "endpoint:broker-01",
      }).success,
    ).toBe(false);
    expect(
      ceremonyStartSchema.safeParse({
        ...startInput("direct_external_disclosure"),
        initiatorActor: "broker",
        initiatorId: "endpoint:broker-01",
      }).success,
    ).toBe(true);
  });

  it("rejects forged status fields and forbidden kind-role state", () => {
    const initial = startCeremony(startInput("grant_issue"));
    const forgedStates = [
      ceremonyStateSchema.parse({
        ...initial,
        alertCode: "forged_alert",
        alertOrigin: "local",
      }),
      ceremonyStateSchema.parse({
        ...initial,
        status: "alert",
      }),
      ceremonyStateSchema.parse({
        ...initial,
        kind: "add_device",
        targetRole: null,
      }),
    ];
    for (const forged of forgedStates) {
      expect(() =>
        applyCeremonyEvent(forged, {
          ...binding(forged),
          type: "security_alert",
          actor: "endpoint",
          actorId: "endpoint:fixture-01",
          alertCode: "fixture_alert",
        }),
      ).toThrowError("state_sequence_forged");
    }
  });

  it("requires broker-key evidence for broker-signed disclosure events", () => {
    let state = startCeremony(startInput("direct_external_disclosure"));
    while (state.nextStep !== "disclosure_event_signed") {
      state = complete(state);
    }
    const endpointFlagOnly = complete(state, {
      ...signedEvidence("endpoint:broker-01"),
    });
    expect(endpointFlagOnly.alertCode).toBe("broker_signature_required");

    const brokerSigned = complete(state, {
      ...signedEvidence("endpoint:broker-01", true),
    });
    expect(brokerSigned.status).toBe("active");
    expect(brokerSigned.nextStep).toBe("signed_log_committed");
  });

  it("requires enrolled, signed, head-bound pause, acknowledgement, and resume", () => {
    const initial = startCeremony(startInput("grant_issue"));
    expect(
      ceremonyEventSchema.safeParse({
        ...binding(initial),
        type: "pause",
        actor: "endpoint",
        actorId: "endpoint:fixture-01",
        reasonCode: "fixture_pause",
      }).success,
    ).toBe(false);

    const wrongHeadPause = applyCeremonyEvent(initial, {
      ...binding(initial),
      type: "pause",
      actor: "endpoint",
      actorId: "endpoint:fixture-01",
      reasonCode: "fixture_pause",
      evidence: {
        ...signedEvidence("endpoint:fixture-01"),
        previousHead: { sequence: 4, headRef: "head:forged-branch" },
      },
    });
    expect(wrongHeadPause.alertCode).toBe("lifecycle_head_mismatch");

    const unknownSignerPause = applyCeremonyEvent(initial, {
      ...binding(initial),
      type: "pause",
      actor: "endpoint",
      actorId: "endpoint:unknown-01",
      reasonCode: "fixture_pause",
      evidence: { ...signedEvidence("endpoint:unknown-01") },
    });
    expect(unknownSignerPause.alertCode).toBe(
      "lifecycle_signer_not_authorized",
    );
  });

  it("prunes removed principals and prevents them from committing removal", () => {
    let state = startCeremony(startInput("remove_device"));
    const selfRemoval = applyCeremonyEvent(state, {
      ...binding(state),
      type: "complete_step",
      step: "removal_signed",
      actor: "endpoint",
      actorId: "endpoint:secondary-01",
      evidence: {
        ...signedEvidence("endpoint:secondary-01"),
        removedSignerId: "endpoint:secondary-01",
      },
    });
    expect(selfRemoval.alertCode).toBe("removed_signer_binding_required");

    state = complete(state);
    expect(state.removedSignerIds).toContain("endpoint:secondary-01");
    expect(
      state.enrolledSigners.some(
        (signer) => signer.id === "endpoint:secondary-01",
      ),
    ).toBe(false);
    while (state.nextStep !== "signed_log_committed") state = complete(state);
    const removedCommit = applyCeremonyEvent(state, {
      ...binding(state),
      type: "complete_step",
      step: "signed_log_committed",
      actor: "endpoint",
      actorId: "endpoint:secondary-01",
      evidence: { ...signedEvidence("endpoint:secondary-01") },
    });
    expect(removedCommit.status).toBe("alert");
    expect(removedCommit.alertCode).toBe("signed_log_commit_required");
  });

  it("prunes every pre-recovery endpoint before rotation or commit", () => {
    let state = startCeremony(startInput("recovery"));
    while (state.nextStep !== "prior_endpoints_removed")
      state = complete(state);
    state = complete(state);

    const oldEndpointIds = ["endpoint:fixture-01", "endpoint:secondary-01"];
    expect(state.removedSignerIds).toEqual(
      expect.arrayContaining(oldEndpointIds),
    );
    expect(
      state.enrolledSigners.filter((signer) => signer.role === "endpoint"),
    ).toEqual([
      { id: "recovery:fixture-01", role: "endpoint" },
      { id: "endpoint:recovered-01", role: "endpoint" },
    ]);

    for (const oldEndpointId of oldEndpointIds) {
      const forgedPause = applyCeremonyEvent(state, {
        ...binding(state),
        type: "pause",
        actor: "endpoint",
        actorId: oldEndpointId,
        reasonCode: "old_endpoint_pause",
        evidence: { ...signedEvidence(oldEndpointId) },
      });
      expect(forgedPause.alertCode).toBe("lifecycle_signer_not_authorized");
    }

    while (state.nextStep !== "signed_log_committed") state = complete(state);
    for (const oldEndpointId of oldEndpointIds) {
      const forgedCommit = applyCeremonyEvent(state, {
        ...binding(state),
        type: "complete_step",
        step: "signed_log_committed",
        actor: "endpoint",
        actorId: oldEndpointId,
        evidence: { ...signedEvidence(oldEndpointId) },
      });
      expect(forgedCommit.alertCode).toBe("signed_log_commit_required");
    }
  });

  it("rejects endpoint-broker role substitution", () => {
    const disclosure = startCeremony(startInput("direct_external_disclosure"));
    const endpointAsBroker = applyCeremonyEvent(disclosure, {
      ...binding(disclosure),
      type: "complete_step",
      step: "control_log_head_verified",
      actor: "broker",
      actorId: "endpoint:fixture-01",
      evidence: evidenceFor(
        "control_log_head_verified",
        disclosure,
        "endpoint:fixture-01",
      ),
    });
    expect(endpointAsBroker.alertCode).toBe("broker_actor_required");

    let grant = startCeremony(startInput("grant_issue"));
    grant = complete(grant);
    grant = complete(grant);
    const brokerAsEndpoint = applyCeremonyEvent(grant, {
      ...binding(grant),
      type: "complete_step",
      step: "grant_signed",
      actor: "endpoint",
      actorId: "endpoint:broker-01",
      evidence: { ...signedEvidence("endpoint:broker-01") },
    });
    expect(brokerAsEndpoint.alertCode).toBe("signer_role_mismatch");
  });

  it("rejects generated candidate aliases across every enrolled role", () => {
    for (const enrolledId of ["endpoint:fixture-01", "endpoint:broker-01"]) {
      const initial = startCeremony(startInput("add_device"));
      const collision = complete(initial, {
        generatedEndpointId: enrolledId,
      });
      expect(collision.alertCode).toBe("candidate_id_collision");
      expect(collision.generatedEndpointId).toBeNull();
    }
  });

  it("rotates away old endpoints and replaces the recovery secret", () => {
    const result = completeAll(startInput("recovery"));
    expect(result.epoch).toBe(4);
    expect(result.recoverySecretGeneration).toBe(3);
    expect(result.completedSteps).toContain("prior_endpoints_removed");
    expect(result.completedSteps).toContain("old_epoch_destroyed");
  });

  it("alerts on any plaintext fallback or hosted relay path", () => {
    const fallback = applyCeremonyEvent(
      startCeremony(startInput("direct_external_disclosure")),
      {
        ...binding(startCeremony(startInput("direct_external_disclosure"))),
        type: "plaintext_fallback_attempted",
        actor: "broker",
        actorId: "endpoint:broker-01",
        at: now,
      },
    );
    expect(fallback.status).toBe("alert");
    expect(fallback.alertCode).toBe("plaintext_fallback_forbidden");

    let state = startCeremony(startInput("direct_external_disclosure"));
    state = complete(state);
    state = complete(state);
    const missingDirectPath = complete(state, {});
    expect(missingDirectPath.status).toBe("alert");
    expect(missingDirectPath.alertCode).toBe(
      "hosted_plaintext_relay_forbidden",
    );
  });

  it("keeps evidence and state content-free through strict schemas", () => {
    expect(
      ceremonyEvidenceSchema.safeParse({ plaintext: "fixture secret" }).success,
    ).toBe(false);
    expect(
      ceremonyStateSchema.safeParse({
        ...startCeremony(startInput("first_device")),
        documentTitle: "fixture title",
      }).success,
    ).toBe(false);
  });

  it("makes committed and aborted transcripts immutable", () => {
    const committed = completeAll(startInput("grant_issue"));
    expect(() =>
      applyCeremonyEvent(committed, {
        ...binding(committed),
        type: "security_alert",
        actor: "server",
        actorId: "server:fixture-01",
        at: now,
        alertCode: "late_alert",
      }),
    ).toThrow(CeremonyTransitionError);
  });
});

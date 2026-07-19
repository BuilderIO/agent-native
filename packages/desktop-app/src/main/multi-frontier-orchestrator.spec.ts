import { describe, expect, it, vi } from "vitest";

import {
  MultiFrontierOrchestrator,
  isConsequentialFinding,
  isOptionalHelperQuotaStop,
  type MultiFrontierArtifact,
  type MultiFrontierCoordinatorFacade,
  type MultiFrontierHelperPolicy,
  type MultiFrontierTrustedCoordinatorSnapshot,
  type MultiFrontierTurnRequest,
  type MultiFrontierTurnResult,
} from "./multi-frontier-orchestrator.js";

const HELPER_POLICY: MultiFrontierHelperPolicy = {
  delegationAvailable: true,
  requestedModel: "gpt-5.6-terra",
  effectiveModel: "gpt-5.6-terra",
  readOnlyDefault: true,
  maxDepth: 1,
  maxTasks: 4,
  maxTurns: 8,
};

function createCoordinator(
  options: {
    autoContinue?: boolean;
    initialSnapshot?: Partial<MultiFrontierTrustedCoordinatorSnapshot>;
    order?: string[];
  } = {},
) {
  const calls: string[] = [];
  const turns: Array<Parameters<MultiFrontierCoordinatorFacade["runTurn"]>[0]> =
    [];
  let state: MultiFrontierTrustedCoordinatorSnapshot = {
    schemaVersion: 1,
    collaborationId: "collaboration-1",
    phase: "proposing",
    round: 1,
    approval: "not_required",
    autoContinueAfterAgreement: options.autoContinue === true,
    checkpointIds: [],
    driver: null,
    ...options.initialSnapshot,
  };
  const coordinator: MultiFrontierCoordinatorFacade = {
    readTrustedSnapshot: async () => structuredClone(state),
    runTurn: async (input) => {
      turns.push(input);
    },
    beginCrossReview: async () => {
      calls.push("cross_review");
      state = { ...state, phase: "cross_review" };
    },
    beginConvergence: async () => {
      calls.push("converging");
      state = { ...state, phase: "converging" };
    },
    beginNextRound: async () => {
      calls.push("next_round");
      state = { ...state, phase: "proposing", round: state.round + 1 };
    },
    requestGo: async (synthesisArtifactId) => {
      calls.push("request_go");
      state = {
        ...state,
        phase: "awaiting_go",
        approval: "pending",
        currentSynthesisArtifactId: synthesisArtifactId,
        driver: state.driver
          ? { ...state.driver, leaseState: "revoked" }
          : null,
      };
    },
    approveGo: async (participantId) => {
      calls.push(`approve_go:${participantId}`);
      state = {
        ...state,
        phase: "implementing",
        approval: "approved",
        approvedSynthesisArtifactId: state.currentSynthesisArtifactId,
        driver: {
          participantId,
          generation: 7,
          leaseState: "active",
        },
      };
      return { generation: 7 };
    },
    checkpoint: async (checkpointId) => {
      calls.push(`checkpoint:${checkpointId}`);
      options.order?.push("coordinator-checkpoint");
      state = {
        ...state,
        phase: "checkpoint_review",
        approval: "pending",
        checkpointIds: [...new Set([...state.checkpointIds, checkpointId])],
        driver: state.driver
          ? { ...state.driver, leaseState: "revoked" }
          : null,
      };
    },
    pause: async () => {
      calls.push("pause");
      state = { ...state, phase: "paused" };
    },
    complete: async () => {
      calls.push("complete");
      state = { ...state, phase: "completed" };
    },
    swapDriverRole: async (input) => {
      calls.push(`swap:${input.fromParticipantId}:${input.toParticipantId}`);
      const generation = input.expectedGeneration + 1;
      state = {
        ...state,
        driver: {
          participantId: input.toParticipantId,
          generation,
          leaseState: "revoked",
        },
      };
      return { generation };
    },
  };
  return { coordinator, calls, coordinatorTurns: turns };
}

function createHarness(
  options: {
    captureTurnResult?: (
      request: MultiFrontierTurnRequest,
    ) => Promise<MultiFrontierTurnResult>;
    helperPolicy?: MultiFrontierHelperPolicy;
    initialArtifacts?: MultiFrontierArtifact[];
    appendArtifact?: (artifact: MultiFrontierArtifact) => void;
    autoContinue?: boolean;
    initialSnapshot?: Partial<MultiFrontierTrustedCoordinatorSnapshot>;
    order?: string[];
  } = {},
) {
  const { coordinator, calls, coordinatorTurns } = createCoordinator(options);
  const artifacts: MultiFrontierArtifact[] = [];
  const snapshots: unknown[] = [];
  const notices: string[] = [];
  const captures: MultiFrontierTurnRequest[] = [];
  const captureTurnResult = async (request: MultiFrontierTurnRequest) => {
    captures.push(request);
    return options.captureTurnResult
      ? options.captureTurnResult(request)
      : {
          text: `${request.stage} by ${request.participantId}`,
          ...(request.stage === "synthesis" ? { agreed: true } : {}),
        };
  };
  const orchestrator = new MultiFrontierOrchestrator({
    collaborationId: "collaboration-1",
    participants: ["codex", "claude"],
    coordinator,
    captureTurnResult,
    appendArtifact: (artifact) => {
      options.appendArtifact?.(artifact);
      artifacts.push(artifact);
    },
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot);
    },
    onAutoAdvanceNotice: (notice) => {
      notices.push(notice);
    },
    helperPolicy: options.helperPolicy ?? HELPER_POLICY,
    initialArtifacts: options.initialArtifacts,
  });
  return {
    orchestrator,
    coordinator,
    artifacts,
    snapshots,
    notices,
    captures,
    calls,
    coordinatorTurns,
  };
}

describe("MultiFrontierOrchestrator", () => {
  it("routes every participant turn through the coordinator and namespaces duplicate findings", async () => {
    const activeByStage = new Map<string, number>();
    const maxActiveByStage = new Map<string, number>();
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const harness = createHarness({
      captureTurnResult: async (request) => {
        const active = (activeByStage.get(request.stage) ?? 0) + 1;
        activeByStage.set(request.stage, active);
        maxActiveByStage.set(
          request.stage,
          Math.max(maxActiveByStage.get(request.stage) ?? 0, active),
        );
        if (request.stage === "proposal" || request.stage === "cross_review") {
          let gate = gates.get(request.stage);
          if (!gate) {
            gate = deferred();
            gates.set(request.stage, gate);
          }
          if (active === 2) gate.resolve();
          await gate.promise;
        }
        activeByStage.set(request.stage, active - 1);
        return {
          text: `${request.stage} by ${request.participantId}`,
          ...(request.stage === "cross_review"
            ? {
                requiresRevision: true,
                findings: [
                  {
                    id: "1",
                    category: "reversible_technical" as const,
                    summary: "Choose the smaller reversible change.",
                  },
                ],
              }
            : {}),
          ...(request.stage === "synthesis" ? { agreed: true } : {}),
        };
      },
    });

    const result = await harness.orchestrator.runPlanning({
      operationId: "plan-op-1",
      request: "Implement multi-frontier mode.",
      repositoryEvidence: "The coordinator fences the writer.",
      driverParticipantId: "codex",
    });

    expect(result).toMatchObject({ status: "awaiting_go", round: 1 });
    expect(maxActiveByStage.get("proposal")).toBe(2);
    expect(maxActiveByStage.get("cross_review")).toBe(2);
    expect(
      harness.captures.filter((turn) => turn.stage === "revision"),
    ).toHaveLength(2);
    expect(harness.coordinatorTurns).toHaveLength(harness.captures.length);
    expect(harness.coordinatorTurns.map((turn) => turn.kind)).toContain(
      "convergence",
    );
    expect(
      new Set(harness.coordinatorTurns.map((turn) => turn.turnId)).size,
    ).toBe(harness.coordinatorTurns.length);
    const findings = harness.artifacts
      .filter((artifact) => artifact.kind === "cross_review")
      .flatMap(
        (artifact) =>
          (artifact.metadata?.findings as Array<{
            id: string;
            rawFindingId: string;
          }>) ?? [],
      );
    expect(new Set(findings.map((finding) => finding.id)).size).toBe(2);
    expect(findings.map((finding) => finding.rawFindingId)).toEqual(["1", "1"]);
  });

  it("keeps first-round proposal prompts independent of sibling proposal output", async () => {
    const harness = createHarness({
      captureTurnResult: async (request) => ({
        text:
          request.stage === "proposal"
            ? `${request.participantId}-private-proposal-body`
            : `${request.stage} complete`,
        ...(request.stage === "synthesis" ? { agreed: true } : {}),
      }),
    });
    await harness.orchestrator.runPlanning({
      operationId: "plan-op-independent-proposals",
      request: "Compare bounded alternatives.",
      repositoryEvidence: "Both participants begin read-only.",
      driverParticipantId: "codex",
    });

    const proposalInstructions = harness.coordinatorTurns
      .filter((turn) => turn.kind === "proposal")
      .map((turn) => turn.instruction);
    expect(proposalInstructions).toHaveLength(2);
    for (const instruction of proposalInstructions) {
      expect(instruction).not.toContain("codex-private-proposal-body");
      expect(instruction).not.toContain("claude-private-proposal-body");
      expect(instruction).not.toContain("mfproposal.");
    }
  });

  it("redacts credential-like text before persisting artifact bodies and metadata", async () => {
    const fakeToken = "sk-test_credential_value_123";
    const harness = createHarness({
      captureTurnResult: async (request) => ({
        text: `Provider output includes api_key=${fakeToken}.`,
        ...(request.stage === "cross_review"
          ? {
              findings: [
                {
                  id: `finding-${request.participantId}`,
                  category: "security_or_privacy" as const,
                  summary: `Do not persist ${fakeToken}.`,
                },
              ],
            }
          : {}),
        ...(request.stage === "synthesis" ? { agreed: true } : {}),
      }),
    });
    await harness.orchestrator.runPlanning({
      operationId: "plan-op-redaction",
      request: "Preserve credential boundaries.",
      repositoryEvidence: "Providers own their credentials.",
      driverParticipantId: "codex",
    });

    const persisted = JSON.stringify(harness.artifacts);
    expect(persisted).not.toContain(fakeToken);
    expect(persisted).toContain("[redacted]");
  });

  it("pauses consequential disagreement even when trusted auto-continue is enabled", async () => {
    const harness = createHarness({
      autoContinue: true,
      captureTurnResult: async (request) => ({
        text: "Review complete.",
        ...(request.stage === "cross_review"
          ? {
              findings: [
                {
                  id: `security-${request.participantId}`,
                  category: "security_or_privacy" as const,
                  summary: "Credential boundary changed.",
                },
              ],
            }
          : {}),
        ...(request.stage === "synthesis" ? { agreed: true } : {}),
      }),
    });

    await expect(
      harness.orchestrator.runPlanning({
        operationId: "plan-op-2",
        request: "Change credentials.",
        repositoryEvidence: "Credentials remain provider-owned.",
        driverParticipantId: "codex",
      }),
    ).resolves.toEqual({
      status: "paused",
      round: 1,
      pauseReason: "consequential_disagreement",
    });
    expect(harness.calls.at(-1)).toBe("pause");
    expect(
      harness.captures.some((capture) => capture.stage === "synthesis"),
    ).toBe(false);
  });

  it("caps at three rounds and only accepts a complete reversible comparator", async () => {
    const paused = createHarness({
      captureTurnResult: async (request) => ({
        text: `${request.stage} ${request.round}`,
        ...(request.stage === "synthesis" ? { agreed: false } : {}),
      }),
    });
    await expect(
      paused.orchestrator.runPlanning({
        operationId: "plan-op-3",
        request: "Choose an implementation.",
        repositoryEvidence: "Both remain viable.",
        driverParticipantId: "codex",
      }),
    ).resolves.toMatchObject({ status: "paused", round: 3 });

    const invalid = createHarness({
      captureTurnResult: async (request) => ({
        text: `${request.stage} ${request.round}`,
        ...(request.stage === "synthesis"
          ? {
              agreed: false,
              reversibleResolution: {
                alternatives: ["A", "B"],
                comparator: "smallest diff",
                selected: "C",
                reversibility: "adapter swap",
              },
            }
          : {}),
      }),
    });
    await expect(
      invalid.orchestrator.runPlanning({
        operationId: "plan-op-invalid",
        request: "Choose an adapter.",
        repositoryEvidence: "Both are reversible.",
        driverParticipantId: "codex",
      }),
    ).rejects.toThrow("complete comparator record");
  });

  it("uses only trusted auto policy and approved synthesis references", async () => {
    const explicit = createHarness();
    await expect(
      explicit.orchestrator.runPlanning({
        operationId: "plan-op-explicit",
        request: "Plan the change.",
        repositoryEvidence: "It is bounded.",
        driverParticipantId: "codex",
      }),
    ).resolves.toMatchObject({ status: "awaiting_go" });
    expect(explicit.notices).toEqual([]);

    const automatic = createHarness({ autoContinue: true });
    const approved = await automatic.orchestrator.runPlanning({
      operationId: "plan-op-auto",
      request: "Plan the change.",
      repositoryEvidence: "It is bounded.",
      driverParticipantId: "claude",
    });
    expect(approved).toMatchObject({
      status: "auto_approved",
      driverGeneration: 7,
    });
    expect(automatic.notices).toHaveLength(1);
    expect(automatic.snapshots).not.toContainEqual(
      expect.objectContaining({ stage: "awaiting_go" }),
    );
  });

  it("revokes at the coordinator before snapshotting and persists no raw request", async () => {
    const order: string[] = [];
    const harness = createHarness({
      order,
      initialSnapshot: implementationSnapshot("plan-1"),
      captureTurnResult: async (request) => ({
        text: "Checkpoint reviewed.",
        ...(request.stage === "watchdog_review" ? { findings: [] } : {}),
      }),
    });
    const result = await harness.orchestrator.runCheckpoint({
      operationId: "checkpoint-op-1",
      round: 2,
      requestSummary: "Implement the accepted bounded plan.",
      requestRef: "request-1",
      acceptedPlanArtifactId: "plan-1",
      driverParticipantId: "codex",
      driverSummary: "Runtime slice complete.",
      openRisks: ["Installed smoke remains."],
      snapshotWorkspace: async () => {
        order.push("snapshot-workspace");
        return {
          contentRef: "snapshots/checkpoint-1.diff",
          contentHash: "a".repeat(64),
          testOutput: "Focused tests passed.",
        };
      },
    });

    expect(order).toEqual(["coordinator-checkpoint", "snapshot-workspace"]);
    expect(result.status).toBe("awaiting_go");
    expect(result.checkpointArtifact.metadata).not.toHaveProperty("request");
    expect(result.checkpointArtifact.metadata?.bundle).toMatchObject({
      requestSummary: "Implement the accepted bounded plan.",
      contentHash: "a".repeat(64),
    });
    expect(harness.coordinatorTurns.at(-1)).toMatchObject({
      participantId: "claude",
      kind: "checkpoint_review",
    });
  });

  it("pauses a consequential checkpoint finding even with trusted auto-continue", async () => {
    const harness = createHarness({
      autoContinue: true,
      initialSnapshot: implementationSnapshot("plan-1"),
      captureTurnResult: async (request) => ({
        text: "Checkpoint review complete.",
        ...(request.stage === "watchdog_review"
          ? {
              findings: [
                {
                  id: "checkpoint-privacy",
                  category: "security_or_privacy" as const,
                  summary: "Credential isolation changed.",
                },
              ],
            }
          : {}),
      }),
    });
    await expect(
      harness.orchestrator.runCheckpoint({
        operationId: "checkpoint-op-consequential",
        round: 2,
        requestSummary: "Checkpoint.",
        acceptedPlanArtifactId: "plan-1",
        driverParticipantId: "codex",
        driverSummary: "Ready for review.",
        openRisks: [],
        snapshotWorkspace: async () => ({
          contentRef: "snapshots/consequential.diff",
          contentHash: "f".repeat(64),
          testOutput: "1 passed",
        }),
      }),
    ).resolves.toMatchObject({ status: "paused" });
    expect(harness.calls).toContain("pause");
    expect(harness.calls).not.toContain("request_go");
  });

  it("makes checkpoint artifact retries stable and idempotent", async () => {
    const harness = createHarness({
      initialSnapshot: implementationSnapshot("plan-1"),
      captureTurnResult: async () => ({ text: "No findings.", findings: [] }),
    });
    const input = {
      operationId: "checkpoint-op-retry",
      round: 2,
      requestSummary: "Bounded checkpoint.",
      acceptedPlanArtifactId: "plan-1",
      driverParticipantId: "codex",
      driverSummary: "No changes after retry.",
      openRisks: [] as string[],
      snapshotWorkspace: async () => ({
        contentRef: "snapshots/checkpoint.diff",
        contentHash: "b".repeat(64),
        testOutput: "1 passed",
      }),
    };
    const first = await harness.orchestrator.runCheckpoint(input);
    const second = await harness.orchestrator.runCheckpoint(input);
    expect(second.checkpointArtifact.id).toBe(first.checkpointArtifact.id);
    expect(second.reviewArtifact.id).toBe(first.reviewArtifact.id);
    expect(harness.artifacts).toHaveLength(2);
  });

  it("caps distinct durable checkpoints within one round", async () => {
    const snapshotWorkspace = vi.fn(async () => ({
      contentRef: "snapshots/checkpoint-cap.diff",
      contentHash: "b".repeat(64),
      testOutput: "1 passed",
    }));
    const harness = createHarness({
      initialSnapshot: implementationSnapshot("plan-1"),
      captureTurnResult: async () => ({ text: "No findings.", findings: [] }),
    });
    const checkpoint = (index: number) =>
      harness.orchestrator.runCheckpoint({
        operationId: `checkpoint-op-cap-${index}`,
        round: 2,
        requestSummary: "Bounded checkpoint.",
        acceptedPlanArtifactId: "plan-1",
        driverParticipantId: "codex",
        driverSummary: `Checkpoint ${index}.`,
        openRisks: [],
        snapshotWorkspace,
      });

    for (const index of [1, 2, 3]) {
      await checkpoint(index);
      await harness.coordinator.approveGo("codex");
    }
    await expect(checkpoint(4)).rejects.toThrow("limited to 3 checkpoints");
    expect(snapshotWorkspace).toHaveBeenCalledTimes(3);
  });

  it("fails closed when a watchdog result omits structured findings", async () => {
    const harness = createHarness({
      initialSnapshot: implementationSnapshot("plan-1"),
      captureTurnResult: async () => ({ text: "Review completed." }),
    });
    await expect(
      harness.orchestrator.runCheckpoint({
        operationId: "checkpoint-op-missing-findings",
        round: 2,
        requestSummary: "Bounded checkpoint.",
        acceptedPlanArtifactId: "plan-1",
        driverParticipantId: "codex",
        driverSummary: "Ready for review.",
        openRisks: [],
        snapshotWorkspace: async () => ({
          contentRef: "snapshots/missing-findings.diff",
          contentHash: "e".repeat(64),
          testOutput: "1 passed",
        }),
      }),
    ).rejects.toThrow("must report structured findings");
  });

  it("recovers a checkpoint persisted before its watchdog review without re-snapshotting", async () => {
    const durableArtifacts: MultiFrontierArtifact[] = [];
    const input = {
      operationId: "checkpoint-op-crash-window",
      round: 2,
      requestSummary: "Bounded checkpoint.",
      acceptedPlanArtifactId: "plan-1",
      driverParticipantId: "codex",
      driverSummary: "Checkpoint persisted before crash.",
      openRisks: [] as string[],
      snapshotWorkspace: async () => ({
        contentRef: "snapshots/checkpoint-crash.diff",
        contentHash: "d".repeat(64),
        testOutput: "1 passed",
      }),
    };
    const interrupted = createHarness({
      initialSnapshot: implementationSnapshot("plan-1"),
      captureTurnResult: async () => ({ text: "No findings.", findings: [] }),
      appendArtifact: (artifact) => {
        if (artifact.kind === "watchdog_review") {
          throw new Error("simulated process crash");
        }
        durableArtifacts.push(artifact);
      },
    });
    await expect(interrupted.orchestrator.runCheckpoint(input)).rejects.toThrow(
      "simulated process crash",
    );
    expect(durableArtifacts).toHaveLength(1);

    const snapshotWorkspace = vi.fn(async () => {
      throw new Error("recovery must not re-snapshot");
    });
    const recovered = createHarness({
      initialArtifacts: durableArtifacts,
      initialSnapshot: {
        ...implementationSnapshot("plan-1"),
        phase: "checkpoint_review",
        approval: "pending",
        checkpointIds: [durableArtifacts[0]!.id],
        driver: {
          participantId: "codex",
          generation: 7,
          leaseState: "revoked",
        },
      },
      captureTurnResult: async () => ({ text: "No findings.", findings: [] }),
    });
    const result = await recovered.orchestrator.runCheckpoint({
      ...input,
      snapshotWorkspace,
    });

    expect(result.status).toBe("awaiting_go");
    expect(snapshotWorkspace).not.toHaveBeenCalled();
    expect(recovered.calls.some((call) => call.startsWith("checkpoint:"))).toBe(
      false,
    );
    expect(recovered.artifacts).toHaveLength(1);
    expect(recovered.artifacts[0]?.kind).toBe("watchdog_review");
  });

  it("resolves dispositions from the stored namespaced review only", async () => {
    const harness = createHarness({
      initialSnapshot: implementationSnapshot("plan-1"),
      captureTurnResult: async (request) => {
        if (request.stage === "watchdog_review") {
          return {
            text: "One finding.",
            findings: [
              {
                id: "1",
                category: "reversible_technical",
                summary: "Add one assertion.",
              },
            ],
          };
        }
        if (request.stage === "finding_disposition") {
          const review = harness.artifacts.find(
            (artifact) => artifact.kind === "watchdog_review",
          )!;
          const findingId = (
            review.metadata?.findings as Array<{ id: string }>
          )[0]!.id;
          return {
            text: "Finding addressed.",
            dispositions: [
              {
                findingId,
                disposition: "addressed",
                reason: "Added the focused assertion.",
              },
            ],
          };
        }
        return { text: "Unexpected." };
      },
    });
    const checkpoint = await harness.orchestrator.runCheckpoint({
      operationId: "checkpoint-op-findings",
      round: 2,
      requestSummary: "Checkpoint.",
      acceptedPlanArtifactId: "plan-1",
      driverParticipantId: "codex",
      driverSummary: "Ready for review.",
      openRisks: [],
      snapshotWorkspace: async () => ({
        contentRef: "snapshots/findings.diff",
        contentHash: "c".repeat(64),
        testOutput: "1 passed",
      }),
    });

    await expect(
      harness.orchestrator.runDriverFindingDispositions({
        operationId: "disposition-op-1",
        driverParticipantId: "codex",
        generation: 7,
        reviewArtifactId: "caller-invented-review",
        instruction: "Address findings.",
      }),
    ).rejects.toThrow("persisted watchdog review");
    const disposition = await harness.orchestrator.runDriverFindingDispositions(
      {
        operationId: "disposition-op-1",
        driverParticipantId: "codex",
        generation: 7,
        reviewArtifactId: checkpoint.reviewArtifact.id,
        instruction: "Address findings.",
      },
    );
    expect(disposition.attribution.sourceArtifactIds).toEqual([
      checkpoint.reviewArtifact.id,
    ]);
    expect(harness.coordinatorTurns.at(-1)).toMatchObject({
      kind: "implementation",
      generation: 7,
    });
  });

  it("blocks completion on pending findings or failed tests and records proof", async () => {
    const pending = createHarness({ initialArtifacts: [watchdogArtifact()] });
    await expect(
      pending.orchestrator.completeWithEvidence({
        operationId: "complete-pending",
        round: 2,
        tests: [{ name: "focused", status: "passed", evidence: "1 passed" }],
        proofRefs: ["proof-1"],
        remainingRisks: [],
      }),
    ).rejects.toThrow("undispositioned watchdog findings");

    const clear = createHarness();
    await expect(
      clear.orchestrator.completeWithEvidence({
        operationId: "complete-failed",
        round: 1,
        tests: [{ name: "focused", status: "failed", evidence: "1 failed" }],
        proofRefs: ["proof-1"],
        remainingRisks: [],
      }),
    ).rejects.toThrow("test is failing");
    await expect(
      clear.orchestrator.completeWithEvidence({
        operationId: "complete-pass",
        round: 1,
        tests: [{ name: "focused", status: "passed", evidence: "12 passed" }],
        proofRefs: ["proof-1"],
        remainingRisks: [],
      }),
    ).resolves.toMatchObject({ kind: "completion" });
  });

  it("resumes only an approved trusted synthesis and follows durable auto policy", async () => {
    const restored = synthesisArtifact("mf.synthesis.shared.restored");
    const explicit = createHarness({
      initialArtifacts: [restored],
      initialSnapshot: {
        phase: "awaiting_go",
        round: 2,
        approval: "pending",
        currentSynthesisArtifactId: restored.id,
      },
    });
    await expect(
      explicit.orchestrator.resumeApprovedPlan({
        synthesisArtifactId: restored.id,
        driverParticipantId: "codex",
      }),
    ).resolves.toMatchObject({ status: "awaiting_go" });
    expect(explicit.captures).toEqual([]);

    const automatic = createHarness({
      autoContinue: true,
      initialArtifacts: [restored],
      initialSnapshot: {
        phase: "awaiting_go",
        round: 2,
        approval: "pending",
        autoContinueAfterAgreement: true,
        currentSynthesisArtifactId: restored.id,
      },
    });
    await expect(
      automatic.orchestrator.resumeApprovedPlan({
        synthesisArtifactId: restored.id,
        driverParticipantId: "claude",
      }),
    ).resolves.toMatchObject({ status: "auto_approved", generation: 7 });

    const mismatched = createHarness({
      initialArtifacts: [restored],
      initialSnapshot: {
        phase: "awaiting_go",
        round: 2,
        approval: "pending",
        currentSynthesisArtifactId: "different-synthesis",
      },
    });
    await expect(
      mismatched.orchestrator.resumeApprovedPlan({
        synthesisArtifactId: restored.id,
        driverParticipantId: "codex",
      }),
    ).rejects.toThrow("trusted coordinator state");
  });

  it("enforces a trusted role-swap contract and rejects stale swaps", async () => {
    const synthesis = synthesisArtifact("mf.synthesis.shared.swap");
    const valid = createHarness({
      initialArtifacts: [synthesis],
      initialSnapshot: {
        ...awaitingGoSnapshot(synthesis.id),
        round: 2,
      },
    });
    await expect(
      valid.orchestrator.swapDriverRole({
        fromParticipantId: "codex",
        toParticipantId: "claude",
        expectedGeneration: 7,
        synthesisArtifactId: synthesis.id,
      }),
    ).resolves.toEqual({ generation: 8 });

    const stale = createHarness({
      initialArtifacts: [synthesis],
      initialSnapshot: {
        ...awaitingGoSnapshot(synthesis.id),
        round: 2,
      },
    });
    await expect(
      stale.orchestrator.swapDriverRole({
        fromParticipantId: "codex",
        toParticipantId: "claude",
        expectedGeneration: 6,
        synthesisArtifactId: synthesis.id,
      }),
    ).rejects.toThrow("stale role swap");
    expect(stale.calls.some((call) => call.startsWith("swap:"))).toBe(false);
  });

  it("strictly bounds metadata, checkpoint references, prompts, and helper policy", async () => {
    expect(() =>
      createHarness({
        helperPolicy: { ...HELPER_POLICY, effectiveModel: null },
      }),
    ).toThrow("requested and effective models");
    expect(() =>
      createHarness({
        initialArtifacts: [
          {
            ...synthesisArtifact("mf.synthesis.shared.extra"),
            metadata: {
              agreed: true,
              deterministicallyResolved: false,
              email: "x@example.test",
            },
          },
        ],
      }),
    ).toThrow("unsupported fields");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      createHarness({
        initialArtifacts: [
          {
            ...synthesisArtifact("mf.synthesis.shared.cyclic"),
            metadata: cyclic,
          },
        ],
      }),
    ).toThrow();

    const harness = createHarness();
    await expect(
      harness.orchestrator.runPlanning({
        operationId: "oversized-op",
        request: "界".repeat(4_097),
        repositoryEvidence: "Evidence.",
        driverParticipantId: "codex",
      }),
    ).rejects.toThrow("request exceeds its byte limit");
    await expect(
      harness.orchestrator.runPlanning({
        operationId: "controls-op",
        request: "\u0001",
        repositoryEvidence: "Evidence.",
        driverParticipantId: "codex",
      }),
    ).rejects.toThrow("non-empty request");

    const checkpoint = createHarness({
      initialSnapshot: implementationSnapshot("plan-1"),
    });
    await expect(
      checkpoint.orchestrator.runCheckpoint({
        operationId: "bad-ref-op",
        round: 2,
        requestSummary: "Checkpoint.",
        acceptedPlanArtifactId: "plan-1",
        driverParticipantId: "codex",
        driverSummary: "Summary.",
        openRisks: [],
        snapshotWorkspace: async () => ({
          contentRef: "../secret",
          contentHash: "not-a-hash",
          testOutput: "1 passed",
        }),
      }),
    ).rejects.toThrow("content reference is invalid");
  });

  it("records effective helper policy only in coordinator-owned instructions", async () => {
    const policy: MultiFrontierHelperPolicy = {
      ...HELPER_POLICY,
      quotaAdvisory: {
        source: "provider-reported",
        observedAt: "2026-07-19T18:00:00.000Z",
        usedPercent: 85,
        stopOptionalAtPercent: 80,
      },
    };
    const harness = createHarness({ helperPolicy: policy });
    await harness.orchestrator.runPlanning({
      operationId: "helper-op",
      request: "Plan the bounded change.",
      repositoryEvidence: "No usage is inferred.",
      driverParticipantId: "codex",
    });
    expect(harness.coordinatorTurns[0]?.instruction).toContain(
      '"requestedModel":"gpt-5.6-terra"',
    );
    expect(harness.coordinatorTurns[0]?.instruction).toContain(
      '"allowOptionalHelpers":false',
    );
    expect(isOptionalHelperQuotaStop(policy)).toBe(true);
    expect(
      isConsequentialFinding({
        id: "privacy-1",
        category: "security_or_privacy",
        summary: "Credential boundary.",
      }),
    ).toBe(true);
  });
});

function implementationSnapshot(
  synthesisArtifactId: string,
): Partial<MultiFrontierTrustedCoordinatorSnapshot> {
  return {
    phase: "implementing",
    round: 2,
    approval: "approved",
    currentSynthesisArtifactId: synthesisArtifactId,
    approvedSynthesisArtifactId: synthesisArtifactId,
    driver: {
      participantId: "codex",
      generation: 7,
      leaseState: "active",
    },
  };
}

function awaitingGoSnapshot(
  synthesisArtifactId: string,
): Partial<MultiFrontierTrustedCoordinatorSnapshot> {
  return {
    phase: "awaiting_go",
    round: 2,
    approval: "pending",
    currentSynthesisArtifactId: synthesisArtifactId,
    driver: {
      participantId: "codex",
      generation: 7,
      leaseState: "revoked",
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function synthesisArtifact(id: string): MultiFrontierArtifact {
  return {
    id,
    kind: "synthesis",
    round: 2,
    text: "Restored accepted proposal.",
    attribution: {
      participantIds: ["codex", "claude"],
      sourceArtifactIds: [],
    },
    metadata: { agreed: true, deterministicallyResolved: false },
  };
}

function watchdogArtifact(): MultiFrontierArtifact {
  return {
    id: "mf.watchdog_review.claude.restored",
    kind: "watchdog_review",
    round: 2,
    participantId: "claude",
    text: "One finding remains.",
    attribution: { participantIds: ["claude"], sourceArtifactIds: [] },
    metadata: {
      findings: [
        {
          id: "finding.restored",
          rawFindingId: "1",
          reviewerParticipantId: "claude",
          category: "reversible_technical",
          summary: "Add the assertion.",
        },
      ],
    },
  };
}

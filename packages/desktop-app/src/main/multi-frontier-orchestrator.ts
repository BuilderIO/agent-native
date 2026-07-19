import { createHash } from "node:crypto";

import {
  MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES,
  MULTI_FRONTIER_IPC_MAX_PAYLOAD_BYTES,
  MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES,
  redactMultiFrontierSensitiveText,
} from "../../shared/multi-frontier-ipc.js";

const MAX_ROUNDS = 3;
const MAX_CHECKPOINTS_PER_ROUND = 3;
const MAX_FINDINGS = 40;
const MAX_HELPER_DEPTH = 2;
const MAX_HELPER_TASKS = 8;
const MAX_HELPER_TURNS = 20;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const SAFE_CONTENT_REF = /^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,511}$/;
const SHA256 = /^[a-f0-9]{64}$/i;

export type MultiFrontierOrchestrationStage =
  | "proposal"
  | "cross_review"
  | "revision"
  | "synthesis"
  | "watchdog_review"
  | "finding_disposition";

export type MultiFrontierFindingCategory =
  | "reversible_technical"
  | "intent_or_scope"
  | "destructive_action"
  | "security_or_privacy"
  | "outward_effect"
  | "meaningful_cost_expansion"
  | "irreversible_architecture";

export interface MultiFrontierFinding {
  id: string;
  category: MultiFrontierFindingCategory;
  summary: string;
}

export interface MultiFrontierFindingDisposition {
  findingId: string;
  disposition: "addressed" | "rejected" | "deferred";
  reason: string;
}

export interface MultiFrontierHelperPolicy {
  delegationAvailable: boolean;
  requestedModel: string | null;
  effectiveModel: string | null;
  readOnlyDefault: true;
  maxDepth: number;
  maxTasks: number;
  maxTurns: number;
  quotaAdvisory?: {
    source: "provider-reported";
    observedAt: string;
    usedPercent: number;
    stopOptionalAtPercent: number;
  };
}

export interface MultiFrontierTurnRequest {
  collaborationId: string;
  participantId: string;
  turnId: string;
  stage: MultiFrontierOrchestrationStage;
  round: number;
  signal: AbortSignal;
}

export interface MultiFrontierTurnResult {
  text: string;
  agreed?: boolean;
  requiresRevision?: boolean;
  findings?: MultiFrontierFinding[];
  dispositions?: MultiFrontierFindingDisposition[];
  reversibleResolution?: MultiFrontierSynthesisResult["reversibleResolution"];
}

export interface MultiFrontierSynthesisRequest {
  collaborationId: string;
  round: number;
  request: string;
  sourceArtifacts: readonly MultiFrontierArtifact[];
  findings: readonly MultiFrontierFinding[];
  helperPolicy: MultiFrontierHelperPolicy & { allowOptionalHelpers: boolean };
}

export interface MultiFrontierSynthesisResult {
  text: string;
  agreed: boolean;
  reversibleResolution?: {
    alternatives: string[];
    comparator: string;
    selected: string;
    reversibility: string;
  };
}

export interface MultiFrontierCheckpointBundle {
  requestSummary: string;
  requestRef?: string;
  acceptedPlanArtifactId: string;
  contentRef: string;
  contentHash: string;
  testOutput: string;
  driverSummary: string;
  openRisks: string[];
  unresolvedFindingIds: string[];
}

export interface MultiFrontierArtifact {
  readonly id: string;
  readonly kind:
    | "proposal"
    | "cross_review"
    | "revision"
    | "synthesis"
    | "checkpoint"
    | "watchdog_review"
    | "finding_disposition"
    | "completion";
  readonly round: number;
  readonly participantId?: string;
  readonly text: string;
  readonly supersedesArtifactId?: string;
  readonly attribution: {
    readonly participantIds: readonly string[];
    readonly sourceArtifactIds: readonly string[];
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MultiFrontierOrchestrationSnapshot {
  collaborationId: string;
  stage:
    | MultiFrontierOrchestrationStage
    | "paused"
    | "awaiting_go"
    | "implementing"
    | "completed";
  round: number;
  artifactIds: string[];
  notice?: string;
}

export interface MultiFrontierCoordinatorFacade {
  readTrustedSnapshot():
    | Promise<MultiFrontierTrustedCoordinatorSnapshot>
    | MultiFrontierTrustedCoordinatorSnapshot;
  runTurn(input: {
    participantId: string;
    turnId: string;
    kind:
      | "proposal"
      | "cross_review"
      | "convergence"
      | "checkpoint_review"
      | "implementation";
    instruction: string;
    generation?: number;
  }): Promise<void>;
  beginCrossReview(): Promise<unknown>;
  beginConvergence(): Promise<unknown>;
  beginNextRound(): Promise<unknown>;
  requestGo(synthesisArtifactId: string): Promise<unknown>;
  approveGo(participantId: string): Promise<{ generation: number }>;
  checkpoint(checkpointId: string): Promise<unknown>;
  pause(): Promise<unknown>;
  complete(): Promise<unknown>;
  swapDriverRole(input: {
    fromParticipantId: string;
    toParticipantId: string;
    expectedGeneration: number;
    synthesisArtifactId: string;
  }): Promise<{ generation: number }>;
}

export interface MultiFrontierTrustedCoordinatorSnapshot {
  schemaVersion: 1;
  collaborationId: string;
  phase:
    | "proposing"
    | "cross_review"
    | "converging"
    | "awaiting_go"
    | "implementing"
    | "checkpoint_review"
    | "paused"
    | "completed"
    | "failed"
    | "canceled";
  round: number;
  approval: "not_required" | "pending" | "approved" | "rejected";
  autoContinueAfterAgreement: boolean;
  currentSynthesisArtifactId?: string;
  approvedSynthesisArtifactId?: string;
  checkpointIds: string[];
  driver: {
    participantId: string;
    generation: number;
    leaseState: "inactive" | "active" | "revoked";
  } | null;
}

export interface MultiFrontierOrchestratorOptions {
  collaborationId: string;
  participants: readonly [string, string];
  coordinator: MultiFrontierCoordinatorFacade;
  captureTurnResult: (
    request: MultiFrontierTurnRequest,
  ) => Promise<MultiFrontierTurnResult>;
  appendArtifact: (artifact: MultiFrontierArtifact) => Promise<void> | void;
  onSnapshot?: (
    snapshot: MultiFrontierOrchestrationSnapshot,
  ) => Promise<void> | void;
  onAutoAdvanceNotice?: (notice: string) => Promise<void> | void;
  helperPolicy: MultiFrontierHelperPolicy;
  initialArtifacts?: readonly MultiFrontierArtifact[];
}

export interface RunPlanningInput {
  operationId: string;
  request: string;
  repositoryEvidence: string;
  driverParticipantId: string;
}

export interface RunPlanningResult {
  status: "awaiting_go" | "auto_approved" | "paused";
  round: number;
  synthesisArtifact?: MultiFrontierArtifact;
  pauseReason?: "consequential_disagreement" | "round_cap";
  driverGeneration?: number;
}

export interface RunCheckpointInput {
  operationId: string;
  round: number;
  requestSummary: string;
  requestRef?: string;
  acceptedPlanArtifactId: string;
  driverParticipantId: string;
  driverSummary: string;
  openRisks: string[];
  snapshotWorkspace: () => Promise<{
    contentRef: string;
    contentHash: string;
    testOutput: string;
  }>;
}

export interface RunCheckpointResult {
  status: "awaiting_go" | "paused";
  checkpointArtifact: MultiFrontierArtifact;
  reviewArtifact: MultiFrontierArtifact;
  findings: MultiFrontierFinding[];
}

export class MultiFrontierOrchestrator {
  readonly #options: MultiFrontierOrchestratorOptions;
  readonly #participantIds: readonly [string, string];
  readonly #artifacts: MultiFrontierArtifact[] = [];
  readonly #artifactIds = new Set<string>();
  readonly #pendingFindingIds = new Set<string>();

  constructor(options: MultiFrontierOrchestratorOptions) {
    assertSafeId(options.collaborationId, "collaboration id");
    if (
      options.participants.length !== 2 ||
      new Set(options.participants).size !== 2 ||
      options.participants.some((participantId) => !SAFE_ID.test(participantId))
    ) {
      throw new Error(
        "Multi-frontier orchestration requires two participants.",
      );
    }
    validateHelperPolicy(options.helperPolicy);
    this.#options = options;
    this.#participantIds = [...options.participants];
    for (const artifact of options.initialArtifacts ?? []) {
      const validated = validateInitialArtifact(artifact);
      if (this.#artifactIds.has(validated.id)) {
        throw new Error("Initial artifact ids must be unique.");
      }
      this.#artifactIds.add(validated.id);
      this.#artifacts.push(validated);
    }
    rehydratePendingFindingIds(this.#artifacts, this.#pendingFindingIds);
  }

  get artifacts(): readonly MultiFrontierArtifact[] {
    return this.#artifacts.map((artifact) => immutableClone(artifact));
  }

  async resumeApprovedPlan(input: {
    synthesisArtifactId: string;
    driverParticipantId: string;
  }): Promise<{
    status: "awaiting_go" | "auto_approved";
    generation?: number;
    synthesisArtifact: MultiFrontierArtifact;
  }> {
    assertSafeId(input.synthesisArtifactId, "synthesis artifact id");
    if (!this.#participantIds.includes(input.driverParticipantId)) {
      throw new Error(
        "The resumed driver must be a collaboration participant.",
      );
    }
    const synthesisArtifact = this.#artifacts.find(
      (artifact) =>
        artifact.id === input.synthesisArtifactId &&
        artifact.kind === "synthesis",
    );
    if (!synthesisArtifact) {
      throw new Error("The approved synthesis artifact is unavailable.");
    }
    assertApprovedSynthesisArtifact(synthesisArtifact);
    let trusted = await this.#trustedSnapshot();
    if (
      trusted.currentSynthesisArtifactId !== synthesisArtifact.id &&
      trusted.approvedSynthesisArtifactId !== synthesisArtifact.id
    ) {
      throw new Error(
        "The restored synthesis does not match the trusted coordinator state.",
      );
    }
    if (trusted.phase !== "awaiting_go") {
      await this.#options.coordinator.requestGo(synthesisArtifact.id);
      trusted = await this.#trustedSnapshot();
    }
    assertAwaitingTrustedSynthesis(trusted, synthesisArtifact.id);
    if (!trusted.autoContinueAfterAgreement) {
      await this.#snapshot("awaiting_go", synthesisArtifact.round);
      return {
        status: "awaiting_go",
        synthesisArtifact: immutableClone(synthesisArtifact),
      };
    }
    const lease = await this.#options.coordinator.approveGo(
      input.driverParticipantId,
    );
    assertTrustedImplementation(
      await this.#trustedSnapshot(),
      synthesisArtifact.id,
      input.driverParticipantId,
      lease.generation,
    );
    const notice =
      "Approved proposal restored. Continuing with the selected driver under a fresh generation.";
    await this.#options.onAutoAdvanceNotice?.(notice);
    await this.#snapshot("implementing", synthesisArtifact.round, notice);
    return {
      status: "auto_approved",
      generation: lease.generation,
      synthesisArtifact: immutableClone(synthesisArtifact),
    };
  }

  async runPlanning(input: RunPlanningInput): Promise<RunPlanningResult> {
    const request = boundedText(
      input.request,
      "request",
      MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES,
    );
    assertSafeId(input.operationId, "planning operation id");
    const repositoryEvidence = boundedText(
      input.repositoryEvidence,
      "repository evidence",
      MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES,
    );
    if (!this.#participantIds.includes(input.driverParticipantId)) {
      throw new Error(
        "The planning driver must be a collaboration participant.",
      );
    }
    const initialSnapshot = await this.#trustedSnapshot();
    if (initialSnapshot.phase !== "proposing") {
      throw new Error("Planning requires the trusted proposing phase.");
    }

    let previousRoundArtifacts: MultiFrontierArtifact[] = [];
    for (let round = initialSnapshot.round; round <= MAX_ROUNDS; round += 1) {
      const proposals = await Promise.all(
        this.#participantIds.map(async (participantId) => {
          const result = await this.#executeReadOnly({
            operationId: input.operationId,
            participantId,
            stage: "proposal",
            round,
            prompt: planningPrompt(
              request,
              repositoryEvidence,
              previousRoundArtifacts,
            ),
            artifactIds: previousRoundArtifacts.map((artifact) => artifact.id),
          });
          return this.#storeArtifact({
            artifactId: this.#operationArtifactId(
              input.operationId,
              "proposal",
              round,
              participantId,
            ),
            kind: "proposal",
            round,
            participantId,
            text: result.text,
            sourceArtifacts: previousRoundArtifacts,
          });
        }),
      );

      await this.#options.coordinator.beginCrossReview();
      await this.#snapshot("cross_review", round);
      const reviews = await Promise.all(
        this.#participantIds.map(async (participantId, index) => {
          const own = proposals[index]!;
          const other = proposals[index === 0 ? 1 : 0]!;
          const result = await this.#executeReadOnly({
            operationId: input.operationId,
            participantId,
            stage: "cross_review",
            round,
            prompt: crossReviewPrompt(request, own, other),
            artifactIds: [own.id, other.id],
          });
          const artifactId = this.#operationArtifactId(
            input.operationId,
            "cross_review",
            round,
            participantId,
          );
          const findings = namespaceFindings(
            result.findings,
            artifactId,
            participantId,
          );
          const artifact = await this.#storeArtifact({
            artifactId,
            kind: "cross_review",
            round,
            participantId,
            text: result.text,
            sourceArtifacts: [own, other],
            metadata: { findings },
          });
          return { artifact, result: { ...result, findings } };
        }),
      );

      const revisions = await Promise.all(
        this.#participantIds.map(async (participantId, index) => {
          const own = proposals[index]!;
          const relevantReview = reviews[index === 0 ? 1 : 0]!;
          if (relevantReview.result.requiresRevision !== true) return own;
          const result = await this.#executeReadOnly({
            operationId: input.operationId,
            participantId,
            stage: "revision",
            round,
            prompt: revisionPrompt(request, own, relevantReview.artifact),
            artifactIds: [own.id, relevantReview.artifact.id],
          });
          return this.#storeArtifact({
            artifactId: this.#operationArtifactId(
              input.operationId,
              "revision",
              round,
              participantId,
            ),
            kind: "revision",
            round,
            participantId,
            text: result.text,
            sourceArtifacts: [own, relevantReview.artifact],
            supersedesArtifactId: own.id,
          });
        }),
      );

      const findings = normalizeFindings(
        reviews.flatMap((review) => review.result.findings ?? []),
      );
      if (findings.some(isConsequentialFinding)) {
        await this.#options.coordinator.pause();
        await this.#snapshot(
          "paused",
          round,
          "Consequential disagreement requires human direction.",
        );
        return {
          status: "paused",
          round,
          pauseReason: "consequential_disagreement",
        };
      }

      await this.#options.coordinator.beginConvergence();
      const synthesis = validateSynthesisResult(
        await this.#executeSynthesis({
          operationId: input.operationId,
          participantId: input.driverParticipantId,
          round,
          prompt: synthesisPrompt(request, revisions, findings),
          artifactIds: revisions.map((artifact) => artifact.id),
        }),
      );
      const synthesisArtifact = await this.#storeArtifact({
        artifactId: this.#operationArtifactId(
          input.operationId,
          "synthesis",
          round,
          "shared",
        ),
        kind: "synthesis",
        round,
        text: synthesis.text,
        sourceArtifacts: [
          ...proposals,
          ...reviews.map((review) => review.artifact),
          ...revisions,
        ],
        participantIds: [...this.#participantIds],
        metadata: {
          agreed: synthesis.agreed,
          deterministicallyResolved:
            !synthesis.agreed &&
            round === MAX_ROUNDS &&
            synthesis.reversibleResolution !== undefined,
          ...(synthesis.reversibleResolution
            ? { reversibleResolution: synthesis.reversibleResolution }
            : {}),
        },
      });

      const converged =
        synthesis.agreed ||
        (round === MAX_ROUNDS && synthesis.reversibleResolution !== undefined);
      if (converged) {
        await this.#options.coordinator.requestGo(synthesisArtifact.id);
        const trusted = await this.#trustedSnapshot();
        assertAwaitingTrustedSynthesis(trusted, synthesisArtifact.id);
        if (trusted.autoContinueAfterAgreement) {
          const notice =
            "Agreement reached. Continuing with the selected driver under the existing write lease rules.";
          const lease = await this.#options.coordinator.approveGo(
            input.driverParticipantId,
          );
          assertTrustedImplementation(
            await this.#trustedSnapshot(),
            synthesisArtifact.id,
            input.driverParticipantId,
            lease.generation,
          );
          await this.#options.onAutoAdvanceNotice?.(notice);
          await this.#snapshot("implementing", round, notice);
          return {
            status: "auto_approved",
            round,
            synthesisArtifact,
            driverGeneration: lease.generation,
          };
        }
        await this.#snapshot("awaiting_go", round);
        return { status: "awaiting_go", round, synthesisArtifact };
      }

      previousRoundArtifacts = [synthesisArtifact, ...revisions];
      if (round < MAX_ROUNDS) {
        await this.#options.coordinator.beginNextRound();
        continue;
      }
      await this.#options.coordinator.pause();
      await this.#snapshot(
        "paused",
        round,
        "The convergence round cap was reached without agreement.",
      );
      return { status: "paused", round, pauseReason: "round_cap" };
    }
    throw new Error("Unreachable multi-frontier convergence state.");
  }

  async runCheckpoint(input: RunCheckpointInput): Promise<RunCheckpointResult> {
    assertSafeId(input.operationId, "checkpoint operation id");
    if (
      !Number.isSafeInteger(input.round) ||
      input.round < 1 ||
      input.round > MAX_ROUNDS
    ) {
      throw new Error("A valid collaboration round is required.");
    }
    const requestSummary = boundedPlainText(
      input.requestSummary,
      "request summary",
    );
    if (input.requestRef) assertSafeId(input.requestRef, "request reference");
    assertSafeId(input.acceptedPlanArtifactId, "accepted plan artifact id");
    if (!this.#participantIds.includes(input.driverParticipantId)) {
      throw new Error(
        "The checkpoint driver must be a collaboration participant.",
      );
    }
    const watchdogParticipantId = this.#participantIds.find(
      (participantId) => participantId !== input.driverParticipantId,
    )!;
    const checkpointArtifactId = this.#operationArtifactId(
      input.operationId,
      "checkpoint",
      input.round,
      input.driverParticipantId,
    );
    const reviewArtifactId = this.#operationArtifactId(
      input.operationId,
      "watchdog_review",
      input.round,
      watchdogParticipantId,
    );
    const existingCheckpoint = this.#artifacts.find(
      (artifact) => artifact.id === checkpointArtifactId,
    );
    const existingReview = this.#artifacts.find(
      (artifact) => artifact.id === reviewArtifactId,
    );
    if (
      !existingCheckpoint &&
      this.#artifacts.filter(
        (artifact) =>
          artifact.kind === "checkpoint" && artifact.round === input.round,
      ).length >= MAX_CHECKPOINTS_PER_ROUND
    ) {
      throw new Error(
        `A collaboration round is limited to ${MAX_CHECKPOINTS_PER_ROUND} checkpoints.`,
      );
    }
    const retryInput = {
      requestSummary,
      requestRef: input.requestRef,
      acceptedPlanArtifactId: input.acceptedPlanArtifactId,
      driverSummary: input.driverSummary,
      openRisks: input.openRisks,
    };
    if (existingReview) {
      if (!existingCheckpoint) {
        throw new Error(
          "The checkpoint retry has a review without its checkpoint artifact.",
        );
      }
      assertCheckpointRetryMatches(existingCheckpoint, retryInput);
      const trusted = await this.#trustedSnapshot();
      if (!trusted.checkpointIds.includes(checkpointArtifactId)) {
        throw new Error("The checkpoint retry is absent from trusted state.");
      }
      const findings = findingsFromReviewArtifact(existingReview);
      return {
        status: trusted.phase === "paused" ? "paused" : "awaiting_go",
        checkpointArtifact: immutableClone(existingCheckpoint),
        reviewArtifact: immutableClone(existingReview),
        findings,
      };
    }
    let checkpointArtifact: MultiFrontierArtifact;
    if (existingCheckpoint) {
      assertCheckpointRetryMatches(existingCheckpoint, retryInput);
      const trusted = await this.#trustedSnapshot();
      if (
        trusted.phase !== "checkpoint_review" ||
        !trusted.checkpointIds.includes(checkpointArtifactId)
      ) {
        throw new Error("The checkpoint retry is absent from trusted state.");
      }
      checkpointArtifact = existingCheckpoint;
    } else {
      const beforeCheckpoint = await this.#trustedSnapshot();
      if (beforeCheckpoint.round !== input.round) {
        throw new Error("The checkpoint round does not match trusted state.");
      }
      if (!beforeCheckpoint.checkpointIds.includes(checkpointArtifactId)) {
        if (beforeCheckpoint.phase !== "implementing") {
          throw new Error(
            "A new checkpoint requires trusted implementation state.",
          );
        }
        await this.#options.coordinator.checkpoint(checkpointArtifactId);
      }
      const checkpointState = await this.#trustedSnapshot();
      if (
        checkpointState.phase !== "checkpoint_review" ||
        !checkpointState.checkpointIds.includes(checkpointArtifactId)
      ) {
        throw new Error(
          "The coordinator did not durably revoke at checkpoint.",
        );
      }
      const workspace = await input.snapshotWorkspace();
      const bundle = immutableClone({
        requestSummary,
        ...(input.requestRef ? { requestRef: input.requestRef } : {}),
        acceptedPlanArtifactId: input.acceptedPlanArtifactId,
        contentRef: validateContentRef(workspace.contentRef),
        contentHash: validateContentHash(workspace.contentHash),
        testOutput: boundedPlainText(workspace.testOutput, "test output"),
        driverSummary: boundedPlainText(input.driverSummary, "driver summary"),
        openRisks: input.openRisks.map((risk) =>
          boundedPlainText(risk, "open risk"),
        ),
        unresolvedFindingIds: [...this.#pendingFindingIds].sort(),
      } satisfies MultiFrontierCheckpointBundle);
      assertBoundedPayload(bundle, "checkpoint bundle");
      checkpointArtifact = await this.#storeArtifact({
        artifactId: checkpointArtifactId,
        kind: "checkpoint",
        round: input.round,
        participantId: input.driverParticipantId,
        text: input.driverSummary,
        sourceArtifacts: [],
        participantIds: [input.driverParticipantId],
        metadata: { bundle },
      });
    }
    const checkpointBundle = checkpointBundleFromArtifact(checkpointArtifact);
    const review = await this.#executeReadOnly({
      operationId: input.operationId,
      participantId: watchdogParticipantId,
      stage: "watchdog_review",
      round: input.round,
      prompt: checkpointReviewPrompt(checkpointBundle),
      artifactIds: [checkpointArtifact.id],
    });
    const findings = namespaceFindings(
      review.findings,
      reviewArtifactId,
      watchdogParticipantId,
    );
    const reviewArtifact = await this.#storeArtifact({
      artifactId: reviewArtifactId,
      kind: "watchdog_review",
      round: input.round,
      participantId: watchdogParticipantId,
      text: review.text,
      sourceArtifacts: [checkpointArtifact],
      metadata: { findings },
    });
    for (const finding of findings) this.#pendingFindingIds.add(finding.id);
    if (findings.some(isConsequentialFinding)) {
      await this.#options.coordinator.pause();
      await this.#snapshot(
        "paused",
        input.round,
        "A consequential checkpoint finding requires human direction.",
      );
      return { status: "paused", checkpointArtifact, reviewArtifact, findings };
    }
    await this.#options.coordinator.requestGo(input.acceptedPlanArtifactId);
    assertAwaitingTrustedSynthesis(
      await this.#trustedSnapshot(),
      input.acceptedPlanArtifactId,
    );
    await this.#snapshot("awaiting_go", input.round);
    return {
      status: "awaiting_go",
      checkpointArtifact,
      reviewArtifact,
      findings,
    };
  }

  async runDriverFindingDispositions(input: {
    operationId: string;
    driverParticipantId: string;
    generation: number;
    reviewArtifactId: string;
    instruction: string;
  }): Promise<MultiFrontierArtifact> {
    assertSafeId(input.operationId, "disposition operation id");
    if (!this.#participantIds.includes(input.driverParticipantId)) {
      throw new Error(
        "The disposition driver must be a collaboration participant.",
      );
    }
    if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
      throw new Error("A current driver generation is required.");
    }
    assertSafeId(input.reviewArtifactId, "watchdog review artifact id");
    const reviewArtifact = this.#artifacts.find(
      (artifact) =>
        artifact.id === input.reviewArtifactId &&
        artifact.kind === "watchdog_review",
    );
    if (!reviewArtifact) {
      throw new Error("The persisted watchdog review is unavailable.");
    }
    const findings = findingsFromReviewArtifact(reviewArtifact);
    if (
      findings.length === 0 ||
      findings.some((finding) => !this.#pendingFindingIds.has(finding.id))
    ) {
      throw new Error("The watchdog review has no exact pending finding set.");
    }
    const result = await this.#executeTurn({
      operationId: input.operationId,
      participantId: input.driverParticipantId,
      stage: "finding_disposition",
      round: reviewArtifact.round,
      generation: input.generation,
      prompt: dispositionPrompt(input.instruction, reviewArtifact, findings),
      artifactIds: [reviewArtifact.id],
    });
    const dispositions = normalizeDispositions(result.dispositions, findings);
    const artifact = await this.#storeArtifact({
      artifactId: this.#operationArtifactId(
        input.operationId,
        "finding_disposition",
        reviewArtifact.round,
        input.driverParticipantId,
      ),
      kind: "finding_disposition",
      round: reviewArtifact.round,
      participantId: input.driverParticipantId,
      text: result.text,
      sourceArtifacts: [reviewArtifact],
      metadata: { dispositions },
    });
    for (const disposition of dispositions) {
      this.#pendingFindingIds.delete(disposition.findingId);
    }
    return artifact;
  }

  async swapDriverRole(input: {
    fromParticipantId: string;
    toParticipantId: string;
    expectedGeneration: number;
    synthesisArtifactId: string;
  }): Promise<{ generation: number }> {
    if (
      input.fromParticipantId === input.toParticipantId ||
      !this.#participantIds.includes(input.fromParticipantId) ||
      !this.#participantIds.includes(input.toParticipantId)
    ) {
      throw new Error("A role swap requires both distinct participants.");
    }
    if (
      !Number.isSafeInteger(input.expectedGeneration) ||
      input.expectedGeneration < 1
    ) {
      throw new Error("A role swap requires the current driver generation.");
    }
    assertSafeId(input.synthesisArtifactId, "synthesis artifact id");
    const synthesisArtifact = this.#artifacts.find(
      (artifact) =>
        artifact.id === input.synthesisArtifactId &&
        artifact.kind === "synthesis",
    );
    if (!synthesisArtifact) {
      throw new Error("The role-swap synthesis artifact is unavailable.");
    }
    assertApprovedSynthesisArtifact(synthesisArtifact);
    const before = await this.#trustedSnapshot();
    if (
      !["awaiting_go", "checkpoint_review"].includes(before.phase) ||
      before.approval !== "pending" ||
      before.currentSynthesisArtifactId !== input.synthesisArtifactId ||
      before.driver?.leaseState !== "revoked" ||
      before.driver.participantId !== input.fromParticipantId ||
      before.driver.generation !== input.expectedGeneration
    ) {
      throw new Error("The trusted coordinator refused a stale role swap.");
    }
    const lease = await this.#options.coordinator.swapDriverRole(input);
    const after = await this.#trustedSnapshot();
    if (
      !["awaiting_go", "checkpoint_review"].includes(after.phase) ||
      after.driver?.leaseState !== "revoked" ||
      after.driver.participantId !== input.toParticipantId ||
      after.driver.generation !== lease.generation ||
      lease.generation <= input.expectedGeneration
    ) {
      throw new Error("The coordinator returned an invalid role-swap lease.");
    }
    return { generation: lease.generation };
  }

  async completeWithEvidence(input: {
    operationId: string;
    round: number;
    tests: Array<{
      name: string;
      status: "passed" | "failed" | "skipped";
      evidence: string;
    }>;
    proofRefs: string[];
    remainingRisks: string[];
  }): Promise<MultiFrontierArtifact> {
    assertSafeId(input.operationId, "completion operation id");
    assertRound(input.round);
    if (this.#pendingFindingIds.size > 0) {
      throw new Error(
        "Completion is blocked by undispositioned watchdog findings.",
      );
    }
    if (input.tests.some((test) => test.status === "failed")) {
      throw new Error(
        "Completion is blocked while a recorded test is failing.",
      );
    }
    if (
      !input.tests.some(
        (test) => test.status === "passed" && test.evidence.trim(),
      )
    ) {
      throw new Error(
        "Completion requires evidence from at least one passing test.",
      );
    }
    if (
      input.proofRefs.length === 0 ||
      input.proofRefs.some((ref) => !ref.trim())
    ) {
      throw new Error("Completion requires at least one proof reference.");
    }
    const metadata = immutableClone({
      tests: input.tests.map((test) => ({
        name: boundedPlainText(test.name, "test name"),
        status: test.status,
        evidence: boundedPlainText(test.evidence, "test evidence"),
      })),
      proofRefs: input.proofRefs.map((ref) =>
        boundedPlainText(ref, "proof reference"),
      ),
      remainingRisks: input.remainingRisks.map((risk) =>
        boundedPlainText(risk, "remaining risk"),
      ),
    });
    assertBoundedPayload(metadata, "completion evidence");
    const artifact = await this.#storeArtifact({
      artifactId: this.#operationArtifactId(
        input.operationId,
        "completion",
        input.round,
        "shared",
      ),
      kind: "completion",
      round: input.round,
      text: "Implementation completed with recorded test and proof evidence.",
      sourceArtifacts: this.#artifacts.filter(
        (candidate) => candidate.kind === "finding_disposition",
      ),
      metadata,
    });
    await this.#options.coordinator.complete();
    await this.#snapshot("completed", input.round);
    return artifact;
  }

  async #executeReadOnly(input: {
    operationId: string;
    participantId: string;
    stage: "proposal" | "cross_review" | "revision" | "watchdog_review";
    round: number;
    prompt: string;
    artifactIds: string[];
  }): Promise<MultiFrontierTurnResult> {
    return this.#executeTurn(input);
  }

  async #executeSynthesis(input: {
    operationId: string;
    participantId: string;
    round: number;
    prompt: string;
    artifactIds: string[];
  }): Promise<MultiFrontierSynthesisResult> {
    const result = await this.#executeTurn({ ...input, stage: "synthesis" });
    if (typeof result.agreed !== "boolean") {
      throw new Error("A synthesis turn must report whether it agreed.");
    }
    return {
      text: result.text,
      agreed: result.agreed,
      ...(result.reversibleResolution
        ? { reversibleResolution: result.reversibleResolution }
        : {}),
    };
  }

  async #executeTurn(input: {
    operationId: string;
    participantId: string;
    stage: MultiFrontierOrchestrationStage;
    round: number;
    generation?: number;
    prompt: string;
    artifactIds: string[];
  }): Promise<MultiFrontierTurnResult> {
    assertBoundedText(
      input.prompt,
      "turn prompt",
      MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES,
    );
    assertSafeId(input.operationId, "turn operation id");
    assertRound(input.round);
    for (const artifactId of input.artifactIds) {
      assertSafeId(artifactId, "turn artifact id");
    }
    const turnId = operationScopedId(
      "mfturn",
      this.#options.collaborationId,
      input.operationId,
      input.stage,
      String(input.round),
      input.participantId,
    );
    const controller = new AbortController();
    const capture = this.#options.captureTurnResult({
      collaborationId: this.#options.collaborationId,
      participantId: input.participantId,
      turnId,
      stage: input.stage,
      round: input.round,
      signal: controller.signal,
    });
    void capture.catch(() => undefined);
    try {
      await this.#options.coordinator.runTurn({
        participantId: input.participantId,
        turnId,
        kind: coordinatorTurnKind(input.stage),
        instruction: turnInstruction(
          input.prompt,
          input.artifactIds,
          this.#helperPolicyForTurn(),
        ),
        ...(input.generation !== undefined
          ? { generation: input.generation }
          : {}),
      });
    } catch (error) {
      controller.abort();
      throw error;
    }
    const result = await capture;
    if (input.stage === "watchdog_review" && result.findings === undefined) {
      throw new Error(
        "A watchdog review turn must report structured findings.",
      );
    }
    if (
      input.stage === "finding_disposition" &&
      result.dispositions === undefined
    ) {
      throw new Error(
        "A finding disposition turn must report structured dispositions.",
      );
    }
    return {
      ...result,
      text: boundedPlainText(result.text, "turn result"),
      findings: normalizeFindings(result.findings),
    };
  }

  #helperPolicyForTurn(): MultiFrontierHelperPolicy & {
    allowOptionalHelpers: boolean;
  } {
    const policy = immutableClone(this.#options.helperPolicy);
    return {
      ...policy,
      allowOptionalHelpers:
        policy.delegationAvailable &&
        policy.requestedModel !== null &&
        policy.effectiveModel !== null &&
        policy.maxTasks > 0 &&
        policy.maxTurns > 0 &&
        !isOptionalHelperQuotaStop(policy),
    };
  }

  async #storeArtifact(input: {
    artifactId?: string;
    kind: MultiFrontierArtifact["kind"];
    round: number;
    text: string;
    participantId?: string;
    participantIds?: string[];
    sourceArtifacts: readonly MultiFrontierArtifact[];
    supersedesArtifactId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<MultiFrontierArtifact> {
    assertRound(input.round);
    const metadata = input.metadata
      ? redactArtifactMetadata(input.metadata)
      : undefined;
    validateArtifactMetadata(input.kind, metadata);
    const artifact = immutableClone({
      id:
        input.artifactId ??
        this.#operationArtifactId(
          "fallback",
          input.kind,
          input.round,
          input.participantId ?? "shared",
        ),
      kind: input.kind,
      round: input.round,
      ...(input.participantId ? { participantId: input.participantId } : {}),
      text: boundedPlainText(
        redactMultiFrontierSensitiveText(input.text),
        `${input.kind} artifact`,
      ),
      ...(input.supersedesArtifactId
        ? { supersedesArtifactId: input.supersedesArtifactId }
        : {}),
      attribution: {
        participantIds:
          input.participantIds ??
          (input.participantId ? [input.participantId] : []),
        sourceArtifactIds: input.sourceArtifacts.map((artifact) => artifact.id),
      },
      ...(metadata ? { metadata: immutableClone(metadata) } : {}),
    } satisfies MultiFrontierArtifact);
    assertBoundedPayload(artifact, `${input.kind} artifact`);
    if (this.#artifactIds.has(artifact.id)) {
      const existing = this.#artifacts.find(
        (candidate) => candidate.id === artifact.id,
      )!;
      if (JSON.stringify(existing) !== JSON.stringify(artifact)) {
        throw new Error("An artifact retry changed immutable content.");
      }
      return immutableClone(existing);
    }
    await this.#options.appendArtifact(artifact);
    this.#artifactIds.add(artifact.id);
    this.#artifacts.push(artifact);
    return immutableClone(artifact);
  }

  #operationArtifactId(
    operationId: string,
    kind: string,
    round: number,
    participantId: string,
  ): string {
    return operationScopedId(
      `mf.${kind}.${participantId}`,
      this.#options.collaborationId,
      operationId,
      kind,
      String(round),
      participantId,
    );
  }

  async #trustedSnapshot(): Promise<MultiFrontierTrustedCoordinatorSnapshot> {
    const snapshot = immutableClone(
      await this.#options.coordinator.readTrustedSnapshot(),
    );
    if (
      snapshot.schemaVersion !== 1 ||
      snapshot.collaborationId !== this.#options.collaborationId
    ) {
      throw new Error("The coordinator returned an untrusted snapshot.");
    }
    assertRound(snapshot.round);
    if (!Array.isArray(snapshot.checkpointIds)) {
      throw new Error("The coordinator snapshot is incomplete.");
    }
    for (const id of snapshot.checkpointIds) {
      assertSafeId(id, "trusted checkpoint id");
    }
    return snapshot;
  }

  async #snapshot(
    stage: MultiFrontierOrchestrationSnapshot["stage"],
    round: number,
    notice?: string,
  ): Promise<void> {
    await this.#options.onSnapshot?.({
      collaborationId: this.#options.collaborationId,
      stage,
      round,
      artifactIds: this.#artifacts.map((artifact) => artifact.id),
      ...(notice ? { notice } : {}),
    });
  }
}

export function isConsequentialFinding(finding: MultiFrontierFinding): boolean {
  return finding.category !== "reversible_technical";
}

export function isOptionalHelperQuotaStop(
  policy: MultiFrontierHelperPolicy,
): boolean {
  const quota = policy.quotaAdvisory;
  return Boolean(quota && quota.usedPercent >= quota.stopOptionalAtPercent);
}

function validateHelperPolicy(policy: MultiFrontierHelperPolicy): void {
  if (
    policy.readOnlyDefault !== true ||
    !Number.isSafeInteger(policy.maxDepth) ||
    policy.maxDepth < 0 ||
    policy.maxDepth > MAX_HELPER_DEPTH ||
    !Number.isSafeInteger(policy.maxTasks) ||
    policy.maxTasks < 0 ||
    policy.maxTasks > MAX_HELPER_TASKS ||
    !Number.isSafeInteger(policy.maxTurns) ||
    policy.maxTurns < 0 ||
    policy.maxTurns > MAX_HELPER_TURNS
  ) {
    throw new Error("Invalid bounded helper policy.");
  }
  if (
    policy.delegationAvailable &&
    (!policy.requestedModel?.trim() || !policy.effectiveModel?.trim())
  ) {
    throw new Error(
      "Available helpers require requested and effective models.",
    );
  }
  if (
    policy.quotaAdvisory &&
    (policy.quotaAdvisory.source !== "provider-reported" ||
      !Number.isFinite(policy.quotaAdvisory.usedPercent) ||
      policy.quotaAdvisory.usedPercent < 0 ||
      policy.quotaAdvisory.usedPercent > 100 ||
      !Number.isFinite(policy.quotaAdvisory.stopOptionalAtPercent) ||
      policy.quotaAdvisory.stopOptionalAtPercent < 0 ||
      policy.quotaAdvisory.stopOptionalAtPercent > 100 ||
      Number.isNaN(Date.parse(policy.quotaAdvisory.observedAt)))
  ) {
    throw new Error("Invalid provider-reported quota advisory.");
  }
}

function normalizeFindings(
  findings: readonly MultiFrontierFinding[] | undefined,
): MultiFrontierFinding[] {
  if (!findings) return [];
  if (findings.length > MAX_FINDINGS)
    throw new Error("Too many review findings.");
  const ids = new Set<string>();
  return findings.map((finding) => {
    assertSafeId(finding.id, "finding id");
    if (ids.has(finding.id))
      throw new Error("Review finding ids must be unique.");
    ids.add(finding.id);
    if (
      ![
        "reversible_technical",
        "intent_or_scope",
        "destructive_action",
        "security_or_privacy",
        "outward_effect",
        "meaningful_cost_expansion",
        "irreversible_architecture",
      ].includes(finding.category)
    ) {
      throw new Error("Invalid review finding category.");
    }
    return {
      id: finding.id,
      category: finding.category,
      summary: boundedPlainText(finding.summary, "finding summary"),
    };
  });
}

function namespaceFindings(
  findings: readonly MultiFrontierFinding[] | undefined,
  reviewArtifactId: string,
  reviewerParticipantId: string,
): Array<
  MultiFrontierFinding & {
    rawFindingId: string;
    reviewerParticipantId: string;
  }
> {
  return normalizeFindings(findings).map((finding) => ({
    ...finding,
    id: `finding.${createHash("sha256")
      .update(`${reviewArtifactId}\0${finding.id}`)
      .digest("hex")
      .slice(0, 20)}`,
    rawFindingId: finding.id,
    reviewerParticipantId,
  }));
}

function normalizeDispositions(
  dispositions: readonly MultiFrontierFindingDisposition[] | undefined,
  findings: readonly MultiFrontierFinding[],
): MultiFrontierFindingDisposition[] {
  if (!dispositions)
    throw new Error("The driver must disposition every finding.");
  const expected = new Set(findings.map((finding) => finding.id));
  const seen = new Set<string>();
  const normalized = dispositions.map((disposition) => {
    if (
      !expected.has(disposition.findingId) ||
      seen.has(disposition.findingId)
    ) {
      throw new Error("Finding dispositions must match the watchdog findings.");
    }
    seen.add(disposition.findingId);
    if (
      !["addressed", "rejected", "deferred"].includes(disposition.disposition)
    ) {
      throw new Error("Invalid finding disposition.");
    }
    return {
      findingId: disposition.findingId,
      disposition: disposition.disposition,
      reason: boundedPlainText(disposition.reason, "disposition reason"),
    };
  });
  if (seen.size !== expected.size) {
    throw new Error("The driver must disposition every finding.");
  }
  return normalized;
}

function validateSynthesisResult(
  result: MultiFrontierSynthesisResult,
): MultiFrontierSynthesisResult {
  const normalized = {
    ...result,
    text: boundedPlainText(result.text, "synthesis"),
  };
  if (result.reversibleResolution) {
    const resolution = result.reversibleResolution;
    if (
      resolution.alternatives.length < 2 ||
      resolution.alternatives.some((alternative) => !alternative.trim()) ||
      !resolution.comparator.trim() ||
      !resolution.selected.trim() ||
      !resolution.reversibility.trim() ||
      !resolution.alternatives.includes(resolution.selected)
    ) {
      throw new Error(
        "A reversible resolution requires a complete comparator record.",
      );
    }
  }
  return normalized;
}

function assertApprovedSynthesisArtifact(
  artifact: MultiFrontierArtifact,
): void {
  const metadata = asRecord(artifact.metadata);
  if (
    metadata?.agreed !== true &&
    metadata?.deterministicallyResolved !== true
  ) {
    throw new Error(
      "Only an agreed or deterministically resolved synthesis can be approved.",
    );
  }
}

function assertAwaitingTrustedSynthesis(
  snapshot: MultiFrontierTrustedCoordinatorSnapshot,
  synthesisArtifactId: string,
): void {
  if (
    snapshot.phase !== "awaiting_go" ||
    snapshot.approval !== "pending" ||
    snapshot.currentSynthesisArtifactId !== synthesisArtifactId
  ) {
    throw new Error("The trusted coordinator did not record the pending plan.");
  }
}

function assertTrustedImplementation(
  snapshot: MultiFrontierTrustedCoordinatorSnapshot,
  synthesisArtifactId: string,
  participantId: string,
  generation: number,
): void {
  if (
    snapshot.phase !== "implementing" ||
    snapshot.approval !== "approved" ||
    snapshot.approvedSynthesisArtifactId !== synthesisArtifactId ||
    snapshot.driver?.participantId !== participantId ||
    snapshot.driver.generation !== generation ||
    snapshot.driver.leaseState !== "active"
  ) {
    throw new Error("The trusted coordinator did not approve implementation.");
  }
}

function findingsFromReviewArtifact(
  artifact: MultiFrontierArtifact,
): MultiFrontierFinding[] {
  const metadata = asRecord(artifact.metadata);
  if (!Array.isArray(metadata?.findings)) {
    throw new Error("The persisted watchdog review has no findings.");
  }
  return metadata.findings.map((value) => {
    const finding = asRecord(value);
    if (
      typeof finding?.id !== "string" ||
      typeof finding.category !== "string" ||
      typeof finding.summary !== "string"
    ) {
      throw new Error("The persisted watchdog findings are invalid.");
    }
    return normalizeFindings([
      {
        id: finding.id,
        category: finding.category as MultiFrontierFindingCategory,
        summary: finding.summary,
      },
    ])[0]!;
  });
}

function assertCheckpointRetryMatches(
  artifact: MultiFrontierArtifact,
  input: {
    requestSummary: string;
    requestRef?: string;
    acceptedPlanArtifactId: string;
    driverSummary: string;
    openRisks: string[];
  },
): void {
  const bundle = asRecord(asRecord(artifact.metadata)?.bundle);
  if (
    bundle?.requestSummary !== input.requestSummary ||
    bundle.requestRef !== input.requestRef ||
    bundle.acceptedPlanArtifactId !== input.acceptedPlanArtifactId ||
    bundle.driverSummary !== input.driverSummary ||
    JSON.stringify(bundle.openRisks) !== JSON.stringify(input.openRisks)
  ) {
    throw new Error("A checkpoint retry changed immutable operation input.");
  }
}

function checkpointBundleFromArtifact(
  artifact: MultiFrontierArtifact,
): MultiFrontierCheckpointBundle {
  if (artifact.kind !== "checkpoint") {
    throw new Error("The persisted checkpoint artifact is invalid.");
  }
  const metadata = requireRecord(artifact.metadata, "checkpoint metadata");
  validateArtifactMetadata("checkpoint", metadata);
  return immutableClone(metadata.bundle as MultiFrontierCheckpointBundle);
}

function synthesisPrompt(
  request: string,
  sources: readonly MultiFrontierArtifact[],
  findings: readonly MultiFrontierFinding[],
): string {
  return boundedPrompt(
    `Synthesize a bounded attributed proposal for this request:\n${request}\n\nSources:\n${sources
      .map((artifact) => `[${artifact.id}] ${artifact.text}`)
      .join("\n")}\n\nFindings:\n${JSON.stringify(findings)}`,
  );
}

function coordinatorTurnKind(
  stage: MultiFrontierOrchestrationStage,
):
  | "proposal"
  | "cross_review"
  | "convergence"
  | "checkpoint_review"
  | "implementation" {
  if (stage === "proposal") return "proposal";
  if (stage === "cross_review" || stage === "revision") {
    return "cross_review";
  }
  if (stage === "synthesis") return "convergence";
  if (stage === "watchdog_review") return "checkpoint_review";
  return "implementation";
}

function turnInstruction(
  prompt: string,
  artifactIds: readonly string[],
  helperPolicy: MultiFrontierHelperPolicy & { allowOptionalHelpers: boolean },
): string {
  return boundedPrompt(
    `${prompt}\n\nArtifact references: ${artifactIds.join(", ") || "none"}\nHelper policy: ${JSON.stringify(helperPolicy)}`,
  );
}

function operationScopedId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}.${digest}`;
}

function validateContentRef(value: string): string {
  const normalized = boundedPlainText(value, "content reference");
  if (!SAFE_CONTENT_REF.test(normalized) || normalized.includes("..")) {
    throw new Error("The checkpoint content reference is invalid.");
  }
  return normalized;
}

function validateContentHash(value: string): string {
  const normalized = boundedPlainText(value, "content hash");
  if (!SHA256.test(normalized)) {
    throw new Error("The checkpoint content hash must be a SHA-256 digest.");
  }
  return normalized.toLowerCase();
}

function assertRound(round: number): void {
  if (!Number.isSafeInteger(round) || round < 1 || round > MAX_ROUNDS) {
    throw new Error("A valid collaboration round is required.");
  }
}

function planningPrompt(
  request: string,
  evidence: string,
  previous: readonly MultiFrontierArtifact[],
): string {
  return boundedPrompt(
    `Request:\n${request}\n\nRepository evidence:\n${evidence}\n\nPrior round summaries:\n${
      previous
        .map((artifact) => `[${artifact.id}] ${artifact.text}`)
        .join("\n") || "None"
    }`,
  );
}

function crossReviewPrompt(
  request: string,
  own: MultiFrontierArtifact,
  other: MultiFrontierArtifact,
): string {
  return boundedPrompt(
    `Request:\n${request}\n\nYour proposal [${own.id}]:\n${own.text}\n\nOther proposal [${other.id}]:\n${other.text}\n\nClassify each finding by consequence.`,
  );
}

function revisionPrompt(
  request: string,
  proposal: MultiFrontierArtifact,
  review: MultiFrontierArtifact,
): string {
  return boundedPrompt(
    `Request:\n${request}\n\nProposal [${proposal.id}]:\n${proposal.text}\n\nCross-review [${review.id}]:\n${review.text}\n\nPublish at most this one revision for the round.`,
  );
}

function checkpointReviewPrompt(bundle: MultiFrontierCheckpointBundle): string {
  return boundedPrompt(
    `Review this immutable checkpoint read-only.\n\n${JSON.stringify(bundle)}`,
  );
}

function dispositionPrompt(
  instruction: string,
  review: MultiFrontierArtifact,
  findings: readonly MultiFrontierFinding[],
): string {
  return boundedPrompt(
    `${instruction}\n\nReview [${review.id}]:\n${review.text}\n\nFindings:\n${JSON.stringify(findings)}\n\nAddress, reject, or defer every finding with a reason.`,
  );
}

function boundedPrompt(value: string): string {
  return boundedText(value, "turn prompt", MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES);
}

function redactArtifactMetadata(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return redactArtifactValue(value) as Record<string, unknown>;
}

function redactArtifactValue(value: unknown): unknown {
  if (typeof value === "string") return redactMultiFrontierSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactArtifactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        redactArtifactValue(nested),
      ]),
    );
  }
  return value;
}

function boundedPlainText(value: string, label: string): string {
  return boundedText(
    value,
    label,
    MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES,
  );
}

function boundedText(value: string, label: string, maxBytes: number): string {
  const sanitized = value.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    "",
  );
  assertBoundedText(sanitized, label, maxBytes);
  return sanitized;
}

function assertBoundedText(
  value: string,
  label: string,
  maxBytes: number,
): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`A non-empty ${label} is required.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`The ${label} exceeds its byte limit.`);
  }
}

function assertBoundedPayload(value: unknown, label: string): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`The ${label} is not serializable.`);
  }
  if (
    Buffer.byteLength(serialized, "utf8") > MULTI_FRONTIER_IPC_MAX_PAYLOAD_BYTES
  ) {
    throw new Error(`The ${label} exceeds its payload limit.`);
  }
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`Invalid ${label}.`);
}

function validateArtifactMetadata(
  kind: MultiFrontierArtifact["kind"],
  metadata: Record<string, unknown> | undefined,
): void {
  if (kind === "proposal" || kind === "revision") {
    if (metadata !== undefined) {
      throw new Error(`${kind} artifacts do not accept metadata.`);
    }
    return;
  }
  if (!metadata) throw new Error(`${kind} artifact metadata is required.`);
  if (kind === "cross_review" || kind === "watchdog_review") {
    assertExactKeys(metadata, ["findings"]);
    if (!Array.isArray(metadata.findings)) {
      throw new Error("Review artifact findings must be an array.");
    }
    for (const value of metadata.findings) {
      const finding = requireRecord(value, "review finding");
      assertExactKeys(finding, [
        "id",
        "rawFindingId",
        "reviewerParticipantId",
        "category",
        "summary",
      ]);
      if (
        typeof finding.id !== "string" ||
        typeof finding.rawFindingId !== "string" ||
        typeof finding.reviewerParticipantId !== "string" ||
        typeof finding.category !== "string" ||
        typeof finding.summary !== "string"
      ) {
        throw new Error("Review artifact finding fields are invalid.");
      }
      assertSafeId(finding.rawFindingId, "raw finding id");
      assertSafeId(finding.reviewerParticipantId, "reviewer participant id");
      normalizeFindings([
        {
          id: finding.id,
          category: finding.category as MultiFrontierFindingCategory,
          summary: finding.summary,
        },
      ]);
    }
    return;
  }
  if (kind === "synthesis") {
    assertAllowedKeys(
      metadata,
      ["agreed", "deterministicallyResolved", "reversibleResolution"],
      ["agreed", "deterministicallyResolved"],
    );
    if (
      typeof metadata.agreed !== "boolean" ||
      typeof metadata.deterministicallyResolved !== "boolean"
    ) {
      throw new Error("Synthesis metadata flags are invalid.");
    }
    if (metadata.reversibleResolution !== undefined) {
      const resolution = requireRecord(
        metadata.reversibleResolution,
        "reversible resolution",
      );
      assertExactKeys(resolution, [
        "alternatives",
        "comparator",
        "selected",
        "reversibility",
      ]);
      validateSynthesisResult({
        text: "validated synthesis",
        agreed: metadata.agreed,
        reversibleResolution: resolution as unknown as NonNullable<
          MultiFrontierSynthesisResult["reversibleResolution"]
        >,
      });
    }
    return;
  }
  if (kind === "checkpoint") {
    assertExactKeys(metadata, ["bundle"]);
    const bundle = requireRecord(metadata.bundle, "checkpoint bundle");
    assertAllowedKeys(
      bundle,
      [
        "requestSummary",
        "requestRef",
        "acceptedPlanArtifactId",
        "contentRef",
        "contentHash",
        "testOutput",
        "driverSummary",
        "openRisks",
        "unresolvedFindingIds",
      ],
      [
        "requestSummary",
        "acceptedPlanArtifactId",
        "contentRef",
        "contentHash",
        "testOutput",
        "driverSummary",
        "openRisks",
        "unresolvedFindingIds",
      ],
    );
    for (const key of [
      "requestSummary",
      "acceptedPlanArtifactId",
      "contentRef",
      "contentHash",
      "testOutput",
      "driverSummary",
    ] as const) {
      if (typeof bundle[key] !== "string") {
        throw new Error("Checkpoint bundle text fields are invalid.");
      }
    }
    boundedPlainText(bundle.requestSummary as string, "request summary");
    assertSafeId(
      bundle.acceptedPlanArtifactId as string,
      "accepted plan artifact id",
    );
    if (bundle.requestRef !== undefined) {
      if (typeof bundle.requestRef !== "string") {
        throw new Error("Checkpoint request reference is invalid.");
      }
      assertSafeId(bundle.requestRef, "request reference");
    }
    validateContentRef(bundle.contentRef as string);
    validateContentHash(bundle.contentHash as string);
    validateTextArray(bundle.openRisks, "open risks");
    validateIdArray(bundle.unresolvedFindingIds, "unresolved finding ids");
    return;
  }
  if (kind === "finding_disposition") {
    assertExactKeys(metadata, ["dispositions"]);
    if (!Array.isArray(metadata.dispositions)) {
      throw new Error("Finding dispositions must be an array.");
    }
    for (const value of metadata.dispositions) {
      const disposition = requireRecord(value, "finding disposition");
      assertExactKeys(disposition, ["findingId", "disposition", "reason"]);
      if (
        typeof disposition.findingId !== "string" ||
        typeof disposition.disposition !== "string" ||
        typeof disposition.reason !== "string" ||
        !["addressed", "rejected", "deferred"].includes(disposition.disposition)
      ) {
        throw new Error("Finding disposition fields are invalid.");
      }
      assertSafeId(disposition.findingId, "disposition finding id");
      boundedPlainText(disposition.reason, "disposition reason");
    }
    return;
  }
  assertExactKeys(metadata, ["tests", "proofRefs", "remainingRisks"]);
  if (!Array.isArray(metadata.tests)) {
    throw new Error("Completion tests must be an array.");
  }
  for (const value of metadata.tests) {
    const test = requireRecord(value, "completion test");
    assertExactKeys(test, ["name", "status", "evidence"]);
    if (
      typeof test.name !== "string" ||
      typeof test.status !== "string" ||
      typeof test.evidence !== "string" ||
      !["passed", "failed", "skipped"].includes(test.status)
    ) {
      throw new Error("Completion test fields are invalid.");
    }
    boundedPlainText(test.name, "test name");
    boundedPlainText(test.evidence, "test evidence");
  }
  validateTextArray(metadata.proofRefs, "proof references");
  validateTextArray(metadata.remainingRisks, "remaining risks");
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw new Error(`The ${label} must be an object.`);
  return record;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  assertAllowedKeys(value, keys, keys);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): void {
  const actual = Object.keys(value);
  if (
    actual.some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error("Artifact metadata contains unsupported fields.");
  }
}

function validateTextArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`The ${label} must be a text array.`);
  }
  for (const item of value) boundedPlainText(item, label);
}

function validateIdArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`The ${label} must be an id array.`);
  }
  for (const item of value) assertSafeId(item, label);
}

function validateInitialArtifact(
  artifact: MultiFrontierArtifact,
): MultiFrontierArtifact {
  assertSafeId(artifact.id, "initial artifact id");
  if (
    ![
      "proposal",
      "cross_review",
      "revision",
      "synthesis",
      "checkpoint",
      "watchdog_review",
      "finding_disposition",
      "completion",
    ].includes(artifact.kind) ||
    !Number.isSafeInteger(artifact.round) ||
    artifact.round < 1 ||
    artifact.round > MAX_ROUNDS
  ) {
    throw new Error("Invalid initial artifact shape.");
  }
  if (artifact.participantId) {
    assertSafeId(artifact.participantId, "initial artifact participant id");
  }
  if (artifact.supersedesArtifactId) {
    assertSafeId(
      artifact.supersedesArtifactId,
      "initial superseded artifact id",
    );
  }
  validateArtifactMetadata(
    artifact.kind,
    artifact.metadata ? { ...artifact.metadata } : undefined,
  );
  if (
    artifact.attribution.participantIds.length > 2 ||
    artifact.attribution.sourceArtifactIds.length > 40
  ) {
    throw new Error("Initial artifact attribution is unbounded.");
  }
  for (const participantId of artifact.attribution.participantIds) {
    assertSafeId(participantId, "initial attribution participant id");
  }
  for (const sourceArtifactId of artifact.attribution.sourceArtifactIds) {
    assertSafeId(sourceArtifactId, "initial source artifact id");
  }
  const validated = immutableClone({
    ...artifact,
    text: boundedPlainText(artifact.text, "initial artifact"),
    attribution: {
      participantIds: [...artifact.attribution.participantIds],
      sourceArtifactIds: [...artifact.attribution.sourceArtifactIds],
    },
    ...(artifact.metadata
      ? { metadata: immutableClone(artifact.metadata) }
      : {}),
  });
  assertBoundedPayload(validated, "initial artifact");
  return validated;
}

function rehydratePendingFindingIds(
  artifacts: readonly MultiFrontierArtifact[],
  target: Set<string>,
): void {
  const reviewed = new Set<string>();
  const dispositioned = new Set<string>();
  for (const artifact of artifacts) {
    const metadata = asRecord(artifact.metadata);
    if (
      artifact.kind === "watchdog_review" &&
      Array.isArray(metadata?.findings)
    ) {
      for (const value of metadata.findings) {
        const finding = asRecord(value);
        if (typeof finding?.id !== "string") {
          throw new Error("Restored watchdog findings are invalid.");
        }
        assertSafeId(finding.id, "restored finding id");
        reviewed.add(finding.id);
      }
    }
    if (
      artifact.kind === "finding_disposition" &&
      Array.isArray(metadata?.dispositions)
    ) {
      for (const value of metadata.dispositions) {
        const disposition = asRecord(value);
        if (typeof disposition?.findingId !== "string") {
          throw new Error("Restored finding dispositions are invalid.");
        }
        assertSafeId(disposition.findingId, "restored disposition finding id");
        dispositioned.add(disposition.findingId);
      }
    }
  }
  for (const findingId of reviewed) {
    if (!dispositioned.has(findingId)) target.add(findingId);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function immutableClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

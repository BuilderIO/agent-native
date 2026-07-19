import { randomUUID } from "node:crypto";

import {
  appendMultiFrontierArtifact,
  getMultiFrontierRun,
  listMultiFrontierArtifacts,
  listMultiFrontierRuns,
  type MultiFrontierOrchestrationArtifact,
  type MultiFrontierStoredRun,
} from "../../../core/src/cli/multi-frontier-runs.js";
import {
  MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES,
  MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES,
  type MultiFrontierCollaborationIdRequest,
  type MultiFrontierCollaborationResult,
  type MultiFrontierCreateCollaborationRequest,
  type MultiFrontierIpcEvent,
  type MultiFrontierRendererState,
  type MultiFrontierRoleSwapRequest,
} from "../../shared/multi-frontier-ipc.js";
import {
  createMultiFrontierOrchestratorBridge,
  MultiFrontierCoordinator,
  type LocalFrontierParticipant,
} from "./multi-frontier-coordinator.js";
import {
  MultiFrontierOrchestrator,
  type MultiFrontierArtifact,
  type MultiFrontierHelperPolicy,
  type RunCheckpointResult,
} from "./multi-frontier-orchestrator.js";
import {
  ClaudeLocalFrontierParticipant,
  CodexLocalFrontierParticipant,
  CoreMultiFrontierCoordinatorStore,
  persistMultiFrontierParticipantSessionRef,
} from "./multi-frontier-runtime.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const TERMINAL_PHASES = new Set(["completed", "failed", "canceled"]);

export interface MultiFrontierManagerOptions {
  resolveWorkspaceCwd(workspaceId: string): Promise<string | null>;
  /** Main-owned subscription admission. An unavailable provider never falls back to an API key. */
  isSubscriptionConnected(providerId: "codex" | "claude"): Promise<boolean>;
  readRepositoryEvidence?(cwd: string): Promise<string>;
  createParticipants?(input: {
    collaborationId: string;
    cwd: string;
    participants: MultiFrontierCreateCollaborationRequest["participants"];
    sessionRefs: Readonly<Record<string, string>>;
  }): readonly [LocalFrontierParticipant, LocalFrontierParticipant];
  helperPolicy?: MultiFrontierHelperPolicy;
  createId?(): string;
  now?(): string;
  snapshotWorkspace?(input: { cwd: string; workspaceId: string }): Promise<{
    contentRef: string;
    contentHash: string;
    testOutput: string;
  }>;
}

interface ManagedCollaboration {
  collaborationId: string;
  workspaceId: string;
  cwd: string;
  request?: string;
  driverParticipantId: string;
  participants: readonly [LocalFrontierParticipant, LocalFrontierParticipant];
  coordinator: MultiFrontierCoordinator;
  orchestrator: MultiFrontierOrchestrator;
  listeners: Set<(event: MultiFrontierIpcEvent) => void>;
  sequence: number;
}

/**
 * The concrete main-process backend. It is intentionally the only place that
 * creates the coordinator and its orchestrator bridge for a live run.
 */
export class MultiFrontierManager {
  readonly #options: Required<
    Pick<
      MultiFrontierManagerOptions,
      "readRepositoryEvidence" | "createId" | "now" | "snapshotWorkspace"
    >
  > &
    Omit<
      MultiFrontierManagerOptions,
      "readRepositoryEvidence" | "createId" | "now" | "snapshotWorkspace"
    >;
  readonly #sessions = new Map<string, ManagedCollaboration>();
  readonly #sessionLoads = new Map<
    string,
    Promise<ManagedCollaboration | null>
  >();

  constructor(options: MultiFrontierManagerOptions) {
    this.#options = {
      ...options,
      readRepositoryEvidence:
        options.readRepositoryEvidence ??
        (async () => "Repository evidence was not supplied for this run."),
      createId: options.createId ?? randomUUID,
      now: options.now ?? (() => new Date().toISOString()),
      snapshotWorkspace:
        options.snapshotWorkspace ??
        (async ({ workspaceId }) => ({
          contentRef: `workspace:${workspaceId}`,
          contentHash: "0".repeat(64),
          testOutput: "Workspace checkpoint captured without a test command.",
        })),
    };
  }

  async list(): Promise<MultiFrontierRendererState[]> {
    const runs = listMultiFrontierRuns();
    await Promise.all(
      runs
        .filter(
          (run) =>
            run.phase === "paused" &&
            run.workspaceId !== undefined &&
            !this.#sessions.has(run.collaborationId),
        )
        .map(async (run) => {
          await this.#sessionFor(run.collaborationId).catch(() => null);
        }),
    );
    return runs
      .map((run) => this.#snapshotForStoredRun(run))
      .filter(
        (snapshot): snapshot is MultiFrontierRendererState => snapshot !== null,
      );
  }

  async create(
    request: MultiFrontierCreateCollaborationRequest,
  ): Promise<MultiFrontierCollaborationResult> {
    if (!this.#isValidCreate(request)) return this.#error(request.requestId);
    if (
      !(await this.#options.isSubscriptionConnected("codex")) ||
      !(await this.#options.isSubscriptionConnected("claude"))
    ) {
      return this.#error(
        request.requestId,
        "Both subscription-native providers must be connected before starting a collaboration.",
      );
    }
    const cwd = await this.#options.resolveWorkspaceCwd(request.workspaceId);
    if (!cwd)
      return this.#error(
        request.requestId,
        "The selected workspace is unavailable.",
      );
    const collaborationId = `mf-${this.#options.createId()}`;
    if (
      !SAFE_ID.test(collaborationId) ||
      getMultiFrontierRun(collaborationId)
    ) {
      return this.#error(
        request.requestId,
        "Unable to allocate a collaboration id.",
      );
    }
    const session = this.#createSession({
      collaborationId,
      workspaceId: request.workspaceId,
      cwd,
      request: request.prompt,
      participants: request.participants,
      sessionRefs: {},
      autoContinueAfterAgreement: request.autoContinueAfterAgreement === true,
    });
    await session.coordinator.begin();
    this.#sessions.set(collaborationId, session);
    await this.#emitSnapshot(session);
    return this.#result(request.requestId, session);
  }

  async start(
    request: MultiFrontierCollaborationIdRequest,
  ): Promise<MultiFrontierCollaborationResult> {
    const session = await this.#sessionFor(request.collaborationId);
    if (!session) return this.#notFound(request.requestId);
    if (!session.request) {
      return this.#error(
        request.requestId,
        "This recovered planning run requires its request to be entered again; no prompt was persisted.",
      );
    }
    const state = session.coordinator.state;
    if (state?.phase !== "proposing")
      return this.#error(request.requestId, "Planning has already started.");
    const outcome = await session.orchestrator.runPlanning({
      operationId: "planning-1",
      request: session.request,
      repositoryEvidence: await this.#options.readRepositoryEvidence(
        session.cwd,
      ),
      driverParticipantId: session.driverParticipantId,
    });
    await this.#emitNotice(
      session,
      outcome.status === "paused"
        ? "Planning paused for a consequential disagreement."
        : outcome.status === "auto_approved"
          ? "The participants agreed; implementation can continue under the selected driver."
          : "The participants agreed; approval is ready.",
    );
    if (
      outcome.status === "auto_approved" &&
      outcome.synthesisArtifact &&
      outcome.driverGeneration
    ) {
      this.#startImplementationCycle(
        session,
        outcome.synthesisArtifact.id,
        outcome.driverGeneration,
      );
    }
    await this.#emitSnapshot(session);
    return this.#result(request.requestId, session);
  }

  async go(
    request: MultiFrontierCollaborationIdRequest,
  ): Promise<MultiFrontierCollaborationResult> {
    if (!(await this.#hasConnectedSubscriptions())) {
      return this.#subscriptionRequired(request.requestId);
    }
    const session = await this.#sessionFor(request.collaborationId);
    if (!session) return this.#notFound(request.requestId);
    const trusted = await session.coordinator.readTrustedSnapshot();
    if (
      trusted.phase !== "awaiting_go" ||
      trusted.approval !== "pending" ||
      !trusted.currentSynthesisArtifactId
    ) {
      return this.#error(
        request.requestId,
        "A converged plan is not awaiting approval.",
      );
    }
    const lease = await session.coordinator.approveGo(
      trusted.driver?.participantId ?? session.driverParticipantId,
    );
    await this.#emitNotice(
      session,
      "Approval granted; the driver lease is active.",
    );
    await this.#emitSnapshot(session);
    this.#startImplementationCycle(
      session,
      trusted.currentSynthesisArtifactId,
      lease.generation,
    );
    return this.#result(request.requestId, session);
  }

  async pause(
    request: MultiFrontierCollaborationIdRequest,
  ): Promise<MultiFrontierCollaborationResult> {
    const session = await this.#sessionFor(request.collaborationId);
    if (!session) return this.#notFound(request.requestId);
    await session.coordinator.pause();
    await this.#emitSnapshot(session);
    return this.#result(request.requestId, session);
  }

  async resume(
    request: MultiFrontierCollaborationIdRequest,
  ): Promise<MultiFrontierCollaborationResult> {
    if (!(await this.#hasConnectedSubscriptions())) {
      return this.#subscriptionRequired(request.requestId);
    }
    const session = await this.#sessionFor(request.collaborationId);
    if (!session) return this.#notFound(request.requestId);
    await session.coordinator.resume();
    // Recovery reconnects read-only sessions only. It intentionally neither
    // replays a turn nor auto-approves an auto-continue policy.
    await this.#emitSnapshot(session);
    return this.#result(request.requestId, session);
  }

  async cancel(
    request: MultiFrontierCollaborationIdRequest,
  ): Promise<MultiFrontierCollaborationResult> {
    const session = await this.#sessionFor(request.collaborationId);
    if (!session) return this.#notFound(request.requestId);
    await session.coordinator.cancel();
    await this.#emitSnapshot(session);
    return this.#result(request.requestId, session);
  }

  async roleSwap(
    request: MultiFrontierRoleSwapRequest,
  ): Promise<MultiFrontierCollaborationResult> {
    const session = await this.#sessionFor(request.collaborationId);
    if (!session) return this.#notFound(request.requestId);
    const trusted = await session.coordinator.readTrustedSnapshot();
    if (!trusted.driver || !trusted.currentSynthesisArtifactId) {
      return this.#error(
        request.requestId,
        "A revoked driver lease is required for role swap.",
      );
    }
    await session.orchestrator.swapDriverRole({
      fromParticipantId: trusted.driver.participantId,
      toParticipantId: request.nextDriverParticipantId,
      expectedGeneration: trusted.driver.generation,
      synthesisArtifactId: trusted.currentSynthesisArtifactId,
    });
    session.driverParticipantId = request.nextDriverParticipantId;
    await this.#emitSnapshot(session);
    return this.#result(request.requestId, session);
  }

  subscribe(
    collaborationId: string,
    listener: (event: unknown) => void,
  ): () => void {
    const session = this.#sessions.get(collaborationId);
    if (!session) return () => undefined;
    const typed = listener as (event: MultiFrontierIpcEvent) => void;
    session.listeners.add(typed);
    void this.#emitSnapshot(session, typed);
    return () => session.listeners.delete(typed);
  }

  async runCheckpoint(input: {
    collaborationId: string;
    operationId: string;
    requestSummary: string;
    acceptedPlanArtifactId: string;
    driverSummary: string;
    openRisks: string[];
    snapshotWorkspace: () => Promise<{
      contentRef: string;
      contentHash: string;
      testOutput: string;
    }>;
  }): Promise<void> {
    const session = await this.#sessionFor(input.collaborationId);
    if (!session) throw new Error("The collaboration is unavailable.");
    const state = session.coordinator.state;
    const trusted = await session.coordinator.readTrustedSnapshot();
    if (!state?.driver || trusted.phase !== "implementing") {
      throw new Error("A live driver lease is required for checkpointing.");
    }
    const checkpoint = await session.orchestrator.runCheckpoint({
      ...input,
      round: trusted.round,
      driverParticipantId: state.driver.participantId,
    });
    await this.#completeCleanCheckpoint(session, checkpoint);
    await this.#emitSnapshot(session);
  }

  async completeWithEvidence(input: {
    collaborationId: string;
    operationId: string;
    tests: Array<{
      name: string;
      status: "passed" | "failed" | "skipped";
      evidence: string;
    }>;
    proofRefs: string[];
    remainingRisks: string[];
  }): Promise<void> {
    const session = await this.#sessionFor(input.collaborationId);
    if (!session) throw new Error("The collaboration is unavailable.");
    await session.orchestrator.completeWithEvidence({
      ...input,
      round: (await session.coordinator.readTrustedSnapshot()).round,
    });
    await this.#emitSnapshot(session);
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.#sessions.values()].map(async (session) => {
        await session.coordinator.dispose();
        session.listeners.clear();
      }),
    );
    this.#sessions.clear();
  }

  #createSession(input: {
    collaborationId: string;
    workspaceId: string;
    cwd: string;
    request?: string;
    participants: MultiFrontierCreateCollaborationRequest["participants"];
    sessionRefs: Readonly<Record<string, string>>;
    autoContinueAfterAgreement: boolean;
  }): ManagedCollaboration {
    const participants = this.#options.createParticipants
      ? this.#options.createParticipants(input)
      : this.#defaultParticipants(input);
    const coordinator = new MultiFrontierCoordinator({
      collaborationId: input.collaborationId,
      participants,
      store: new CoreMultiFrontierCoordinatorStore({
        workspaceId: input.workspaceId,
      }),
      autoContinueAfterAgreement: input.autoContinueAfterAgreement,
    });
    const bridge = createMultiFrontierOrchestratorBridge(coordinator);
    const session: ManagedCollaboration = {
      collaborationId: input.collaborationId,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      ...(input.request ? { request: input.request } : {}),
      driverParticipantId: participants[0].participantId,
      participants,
      coordinator,
      orchestrator: undefined as never,
      listeners: new Set(),
      sequence: 0,
    };
    session.orchestrator = new MultiFrontierOrchestrator({
      collaborationId: input.collaborationId,
      participants: [
        participants[0].participantId,
        participants[1].participantId,
      ],
      coordinator: bridge.coordinator,
      captureTurnResult: bridge.captureTurnResult,
      appendArtifact: async (artifact) =>
        this.#appendArtifact(session, artifact),
      onSnapshot: async () => this.#emitSnapshot(session),
      onAutoAdvanceNotice: async (notice) => this.#emitNotice(session, notice),
      helperPolicy: this.#options.helperPolicy ?? defaultHelperPolicy(),
      initialArtifacts: this.#readOrchestratorArtifacts(input.collaborationId),
    });
    return session;
  }

  #defaultParticipants(input: {
    collaborationId: string;
    cwd: string;
    participants: MultiFrontierCreateCollaborationRequest["participants"];
    sessionRefs: Readonly<Record<string, string>>;
  }): readonly [LocalFrontierParticipant, LocalFrontierParticipant] {
    const codex = input.participants.find(
      (participant) => participant.providerId === "codex",
    )!;
    const claude = input.participants.find(
      (participant) => participant.providerId === "claude",
    )!;
    return [
      new CodexLocalFrontierParticipant({
        participantId: codex.participantId,
        cwd: input.cwd,
        ...(codex.model ? { model: codex.model } : {}),
        ...(input.sessionRefs[codex.participantId]
          ? { sessionRef: input.sessionRefs[codex.participantId] }
          : {}),
        onSessionRef: (sessionRef) => {
          persistMultiFrontierParticipantSessionRef(
            input.collaborationId,
            codex.participantId,
            sessionRef,
          );
        },
      }),
      new ClaudeLocalFrontierParticipant({
        participantId: claude.participantId,
        cwd: input.cwd,
        ...(claude.model ? { model: claude.model } : {}),
        ...(input.sessionRefs[claude.participantId]
          ? {
              session: {
                resumeSessionId: input.sessionRefs[claude.participantId],
              },
            }
          : {}),
      }),
    ];
  }

  async #sessionFor(
    collaborationId: string,
  ): Promise<ManagedCollaboration | null> {
    const existing = this.#sessions.get(collaborationId);
    if (existing) return existing;
    const pending = this.#sessionLoads.get(collaborationId);
    if (pending) return pending;
    const load = this.#loadSession(collaborationId);
    this.#sessionLoads.set(collaborationId, load);
    try {
      return await load;
    } finally {
      if (this.#sessionLoads.get(collaborationId) === load) {
        this.#sessionLoads.delete(collaborationId);
      }
    }
  }

  async #loadSession(
    collaborationId: string,
  ): Promise<ManagedCollaboration | null> {
    const existing = this.#sessions.get(collaborationId);
    if (existing) return existing;
    const stored = getMultiFrontierRun(collaborationId);
    if (!stored || TERMINAL_PHASES.has(stored.phase)) return null;
    if (!stored.workspaceId) return null;
    const cwd = await this.#options.resolveWorkspaceCwd(stored.workspaceId);
    if (!cwd) return null;
    const participants = stored.participants.map((participant) => ({
      participantId: participant.participantId,
      providerId: participant.provider === "codex" ? "codex" : "claude",
      ...(participant.model ? { model: participant.model } : {}),
    })) as MultiFrontierCreateCollaborationRequest["participants"];
    const sessionRefs = Object.fromEntries(
      stored.participants.flatMap((participant) =>
        participant.sessionRef
          ? [[participant.participantId, participant.sessionRef]]
          : [],
      ),
    );
    const session = this.#createSession({
      collaborationId,
      workspaceId: stored.workspaceId,
      cwd,
      participants,
      sessionRefs,
      autoContinueAfterAgreement: stored.autoContinueAfterAgreement,
    });
    this.#sessions.set(collaborationId, session);
    return session;
  }

  #readOrchestratorArtifacts(collaborationId: string): MultiFrontierArtifact[] {
    return listMultiFrontierArtifacts(collaborationId).flatMap((artifact) =>
      artifact.orchestration
        ? [fromPersistedOrchestrationArtifact(artifact.orchestration)]
        : [],
    );
  }

  async #appendArtifact(
    session: ManagedCollaboration,
    artifact: MultiFrontierArtifact,
  ): Promise<void> {
    const result = appendMultiFrontierArtifact({
      id: artifact.id,
      collaborationId: session.collaborationId,
      kind:
        artifact.kind === "proposal"
          ? "proposal"
          : artifact.kind === "checkpoint"
            ? "checkpoint"
            : "review",
      createdAt: this.#options.now(),
      ...(artifact.participantId
        ? { participantId: artifact.participantId }
        : {}),
      title: artifact.kind.replaceAll("_", " "),
      summary: artifact.text,
      ...(artifact.supersedesArtifactId
        ? { supersedesArtifactId: artifact.supersedesArtifactId }
        : {}),
      orchestration: toPersistedOrchestrationArtifact(artifact),
    });
    if (!result.accepted)
      throw new Error(
        `Unable to persist ${artifact.kind} artifact: ${result.reason}`,
      );
    await this.#emitEvent(session, {
      kind: "artifact",
      text: artifact.text,
      artifact: {
        id: artifact.id,
        kind:
          artifact.kind === "proposal"
            ? "proposal"
            : artifact.kind === "checkpoint"
              ? "checkpoint"
              : "review",
        summary: artifact.text,
        ...(artifact.participantId
          ? { participantId: artifact.participantId }
          : {}),
      },
    });
  }

  #startImplementationCycle(
    session: ManagedCollaboration,
    acceptedPlanArtifactId: string,
    generation: number,
  ): void {
    void this.#runImplementationCycle(
      session,
      acceptedPlanArtifactId,
      generation,
    ).catch(async () => {
      try {
        await session.coordinator.pause();
        await this.#emitNotice(
          session,
          "Implementation stopped and is available for explicit recovery.",
        );
        await this.#emitSnapshot(session);
      } catch {
        // The coordinator's durable lifecycle fence remains authoritative.
      }
    });
  }

  async #runImplementationCycle(
    session: ManagedCollaboration,
    acceptedPlanArtifactId: string,
    generation: number,
  ): Promise<void> {
    const synthesis = session.orchestrator.artifacts.find(
      (artifact) =>
        artifact.id === acceptedPlanArtifactId && artifact.kind === "synthesis",
    );
    if (!synthesis)
      throw new Error("The approved synthesis artifact is unavailable.");
    await this.#emitNotice(
      session,
      "The selected driver is implementing the agreed plan.",
    );
    const result = await session.orchestrator.runImplementationTurn({
      operationId: `implementation-${generation}`,
      driverParticipantId: session.driverParticipantId,
      generation,
      acceptedPlanArtifactId,
      instruction: `Implement the approved plan [${synthesis.id}]: ${synthesis.text}`,
    });
    await this.#emitNotice(
      session,
      "Driver turn finished; creating an immutable checkpoint for review.",
    );
    const checkpoint = await session.orchestrator.runCheckpoint({
      operationId: `checkpoint-${generation}`,
      round: (await session.coordinator.readTrustedSnapshot()).round,
      requestSummary: "Approved multi-frontier implementation plan.",
      acceptedPlanArtifactId,
      driverParticipantId: session.driverParticipantId,
      driverSummary: result.text,
      openRisks: [],
      snapshotWorkspace: () =>
        this.#options.snapshotWorkspace({
          cwd: session.cwd,
          workspaceId: session.workspaceId,
        }),
    });
    await this.#completeCleanCheckpoint(session, checkpoint);
    await this.#emitSnapshot(session);
  }

  async #completeCleanCheckpoint(
    session: ManagedCollaboration,
    checkpoint: RunCheckpointResult,
  ): Promise<void> {
    if (checkpoint.status !== "awaiting_go" || checkpoint.findings.length > 0)
      return;
    const evidence = completionEvidenceFromCheckpoint(checkpoint);
    if (!evidence) {
      await this.#emitNotice(
        session,
        "Checkpoint review passed, but no machine-verifiable passing test evidence was recorded.",
      );
      return;
    }
    await session.orchestrator.completeWithEvidence({
      operationId: `completion-${checkpoint.checkpointArtifact.id}`,
      round: checkpoint.checkpointArtifact.round,
      ...evidence,
    });
    await this.#emitNotice(
      session,
      "Checkpoint review and recorded test evidence completed the collaboration.",
    );
  }

  #snapshotForStoredRun(
    run: MultiFrontierStoredRun,
  ): MultiFrontierRendererState | null {
    const participants = run.participants.map((participant) => ({
      participantId: participant.participantId,
      providerId: participant.provider === "codex" ? "codex" : "claude",
      ...(participant.model ? { model: participant.model } : {}),
      role: participant.role,
      permission: participant.permission,
      status: participant.status,
      capabilities:
        participant.capabilities?.filter(
          (
            capability,
          ): capability is MultiFrontierRendererState["participants"][number]["capabilities"][number] =>
            [
              "login",
              "usage",
              "live-usage",
              "read-only",
              "workspace-write",
              "session-resume",
            ].includes(capability),
        ) ?? [],
    }));
    if (participants.length !== 2) return null;
    return {
      rendererStateIsAuthoritative: false,
      collaborationId: run.collaborationId,
      phase: run.phase,
      round: run.round,
      autoContinueAfterAgreement: run.autoContinueAfterAgreement,
      participants: participants as MultiFrontierRendererState["participants"],
      ...(run.phase === "implementing" && run.driver?.leaseState === "active"
        ? {
            driverParticipantId: run.driver.participantId,
            driverGeneration: run.driver.generation,
          }
        : {}),
      approvalState: run.approval.state,
      artifacts: listMultiFrontierArtifacts(run.collaborationId)
        .slice(-12)
        .map((artifact) => ({
          id: artifact.id,
          kind:
            artifact.kind === "proposal"
              ? "proposal"
              : artifact.kind === "checkpoint"
                ? "checkpoint"
                : "review",
          summary: artifact.summary,
          ...(artifact.participantId
            ? { participantId: artifact.participantId }
            : {}),
        })),
      subscriptions: {},
    };
  }

  async #emitSnapshot(
    session: ManagedCollaboration,
    soleListener?: (event: MultiFrontierIpcEvent) => void,
  ): Promise<void> {
    const state =
      session.coordinator.state ?? getMultiFrontierRun(session.collaborationId);
    if (!state) return;
    const snapshot = this.#snapshotForStoredRun(
      getMultiFrontierRun(session.collaborationId) ??
        (state as MultiFrontierStoredRun),
    );
    if (!snapshot) return;
    const event: MultiFrontierIpcEvent = {
      schemaVersion: 1,
      type: "snapshot",
      collaborationId: session.collaborationId,
      sequence: ++session.sequence,
      snapshot,
    };
    if (soleListener) soleListener(event);
    else for (const listener of session.listeners) listener(event);
  }

  async #emitNotice(
    session: ManagedCollaboration,
    text: string,
  ): Promise<void> {
    await this.#emitEvent(session, { kind: "notice", text: bound(text) });
  }

  async #emitEvent(
    session: ManagedCollaboration,
    event: NonNullable<MultiFrontierIpcEvent["event"]>,
  ): Promise<void> {
    const envelope: MultiFrontierIpcEvent = {
      schemaVersion: 1,
      type: "event",
      collaborationId: session.collaborationId,
      sequence: ++session.sequence,
      event,
    };
    for (const listener of session.listeners) listener(envelope);
  }

  #result(
    requestId: string,
    session: ManagedCollaboration,
  ): MultiFrontierCollaborationResult {
    const snapshot = this.#snapshotForStoredRun(
      getMultiFrontierRun(session.collaborationId)!,
    );
    return { schemaVersion: 1, requestId, ...(snapshot ? { snapshot } : {}) };
  }

  #notFound(requestId: string): MultiFrontierCollaborationResult {
    return {
      schemaVersion: 1,
      requestId,
      error: {
        code: "not-found",
        message: "The collaboration is unavailable.",
      },
    };
  }

  #error(
    requestId: string,
    message = "The collaboration request is invalid.",
  ): MultiFrontierCollaborationResult {
    return {
      schemaVersion: 1,
      requestId,
      error: { code: "operation-failed", message },
    };
  }

  #subscriptionRequired(requestId: string): MultiFrontierCollaborationResult {
    return this.#error(
      requestId,
      "Both subscription-native providers must be connected before recovering a collaboration.",
    );
  }

  async #hasConnectedSubscriptions(): Promise<boolean> {
    const [codex, claude] = await Promise.all([
      this.#options.isSubscriptionConnected("codex"),
      this.#options.isSubscriptionConnected("claude"),
    ]);
    return codex && claude;
  }

  #isValidCreate(request: MultiFrontierCreateCollaborationRequest): boolean {
    return (
      request.action === "create" &&
      SAFE_ID.test(request.requestId) &&
      SAFE_ID.test(request.workspaceId) &&
      typeof request.prompt === "string" &&
      request.prompt.trim().length > 0 &&
      Buffer.byteLength(request.prompt, "utf8") <=
        MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES &&
      request.participants.length === 2 &&
      new Set(request.participants.map((participant) => participant.providerId))
        .size === 2 &&
      new Set(
        request.participants.map((participant) => participant.participantId),
      ).size === 2 &&
      request.participants.every((participant) =>
        SAFE_ID.test(participant.participantId),
      )
    );
  }
}

function defaultHelperPolicy(): MultiFrontierHelperPolicy {
  return {
    delegationAvailable: false,
    requestedModel: null,
    effectiveModel: null,
    readOnlyDefault: true,
    maxDepth: 0,
    maxTasks: 0,
    maxTurns: 0,
  };
}

function bound(value: string): string {
  return Buffer.from(value, "utf8")
    .subarray(0, MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES)
    .toString("utf8");
}

function completionEvidenceFromCheckpoint(checkpoint: RunCheckpointResult): {
  tests: Array<{
    name: string;
    status: "passed";
    evidence: string;
  }>;
  proofRefs: string[];
  remainingRisks: string[];
} | null {
  const bundle = checkpoint.checkpointArtifact.metadata?.bundle;
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return null;
  }
  const record = bundle as Record<string, unknown>;
  const testOutput = record.testOutput;
  const contentRef = record.contentRef;
  const openRisks = record.openRisks;
  if (
    typeof testOutput !== "string" ||
    typeof contentRef !== "string" ||
    !hasRecordedPassingTest(testOutput)
  ) {
    return null;
  }
  return {
    tests: [
      {
        name: "Checkpoint test output",
        status: "passed",
        evidence: testOutput,
      },
    ],
    proofRefs: [contentRef],
    remainingRisks: Array.isArray(openRisks)
      ? openRisks.filter((risk): risk is string => typeof risk === "string")
      : [],
  };
}

function hasRecordedPassingTest(output: string): boolean {
  return (
    /\b(?:tests?\s*:?\s*)?[1-9]\d*\s+passed\b/i.test(output) &&
    !/\b[1-9]\d*\s+failed\b/i.test(output)
  );
}

function toPersistedOrchestrationArtifact(
  artifact: MultiFrontierArtifact,
): MultiFrontierOrchestrationArtifact {
  return {
    id: artifact.id,
    kind: artifact.kind,
    round: artifact.round,
    ...(artifact.participantId
      ? { participantId: artifact.participantId }
      : {}),
    text: artifact.text,
    attribution: {
      participantIds: [...artifact.attribution.participantIds],
      sourceArtifactIds: [...artifact.attribution.sourceArtifactIds],
    },
    ...(artifact.supersedesArtifactId
      ? { supersedesArtifactId: artifact.supersedesArtifactId }
      : {}),
    ...(artifact.metadata
      ? { metadata: structuredClone(artifact.metadata) }
      : {}),
  };
}

function fromPersistedOrchestrationArtifact(
  artifact: MultiFrontierOrchestrationArtifact,
): MultiFrontierArtifact {
  return {
    id: artifact.id,
    kind: artifact.kind,
    round: artifact.round,
    ...(artifact.participantId
      ? { participantId: artifact.participantId }
      : {}),
    text: artifact.text,
    attribution: {
      participantIds: [...artifact.attribution.participantIds],
      sourceArtifactIds: [...artifact.attribution.sourceArtifactIds],
    },
    ...(artifact.supersedesArtifactId
      ? { supersedesArtifactId: artifact.supersedesArtifactId }
      : {}),
    ...(artifact.metadata
      ? { metadata: structuredClone(artifact.metadata) }
      : {}),
  };
}

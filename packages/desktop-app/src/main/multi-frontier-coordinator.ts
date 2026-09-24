import {
  MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES,
  MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES,
} from "../../shared/multi-frontier-ipc.js";
import type {
  MultiFrontierCoordinatorFacade,
  MultiFrontierTrustedCoordinatorSnapshot,
  MultiFrontierTurnRequest,
  MultiFrontierTurnResult,
} from "./multi-frontier-orchestrator.js";

export type LocalFrontierPermission = "read_only" | "workspace_write";
export type LocalFrontierPhase =
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
export type LocalFrontierParticipantStatus =
  | "idle"
  | "running"
  | "waiting"
  | "failed"
  | "completed";
export type LocalFrontierRecoveryReason =
  | "main_process_restarted"
  | "driver_crashed"
  | "watchdog_crashed"
  | "app_quit"
  | "canceled";

export interface LocalFrontierParticipantState {
  participantId: string;
  provider: string;
  runtime: string;
  model?: string;
  capabilities?: string[];
  sessionRef?: string;
  role: "driver" | "watchdog";
  permission: LocalFrontierPermission;
  status: LocalFrontierParticipantStatus;
}

export interface LocalFrontierDriverLease {
  participantId: string;
  generation: number;
  leaseState: "inactive" | "active" | "revoked";
}

export interface LocalFrontierCoordinatorState {
  schemaVersion: 1;
  collaborationId: string;
  phase: LocalFrontierPhase;
  participants: LocalFrontierParticipantState[];
  driver: LocalFrontierDriverLease | null;
  approval: "not_required" | "pending" | "approved" | "rejected";
  currentSynthesisArtifactId?: string;
  approvedSynthesisArtifactId?: string;
  checkpointIds: string[];
  round: number;
  autoContinueAfterAgreement: boolean;
  recovery?: {
    reason: LocalFrontierRecoveryReason;
    resumablePhase: LocalFrontierPhase;
    /** Retained from durable state so a later coordinator write cannot erase it. */
    recoveredAt?: string;
    checkpointId?: string;
  };
}

export interface LocalFrontierParticipantEvent {
  id: string;
  participantId: string;
  permission: LocalFrontierPermission;
  generation?: number;
  kind: "progress" | "status" | "crash";
  status?: LocalFrontierParticipantStatus;
  payload?: unknown;
}

export interface LocalFrontierParticipant {
  readonly participantId: string;
  readonly provider: string;
  readonly runtime: string;
  readonly model?: string;
  readonly capabilities?: readonly string[];
  readonly sessionRef?: string;
  start(input: LocalFrontierSessionInput): Promise<void>;
  resume?(input: LocalFrontierSessionInput): Promise<void>;
  runTurn(input: LocalFrontierTurnInput): Promise<LocalFrontierTurnResult>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
  onEvent(listener: (event: LocalFrontierParticipantEvent) => void): () => void;
}

export type LocalFrontierTurnResult = MultiFrontierTurnResult;

/** This is deliberately the entire child-process surface; it has no store writer. */
export interface LocalFrontierSessionInput {
  collaborationId: string;
  permission: "read_only";
  round: number;
}

export interface LocalFrontierTurnInput {
  collaborationId: string;
  turnId: string;
  round: number;
  phase:
    | "proposing"
    | "cross_review"
    | "converging"
    | "checkpoint_review"
    | "implementing";
  permission: LocalFrontierPermission;
  generation?: number;
  instruction: string;
}

export interface LocalFrontierCoordinatorStore {
  create(state: LocalFrontierCoordinatorState): Promise<void> | void;
  read(
    collaborationId: string,
  ):
    | Promise<LocalFrontierCoordinatorState | null>
    | LocalFrontierCoordinatorState
    | null;
  write(state: LocalFrontierCoordinatorState): Promise<void> | void;
  appendEvent(
    event: LocalFrontierParticipantEvent & { collaborationId: string },
  ):
    | Promise<{
        accepted: boolean;
        deduplicated: boolean;
        state?: LocalFrontierCoordinatorState;
      }>
    | {
        accepted: boolean;
        deduplicated: boolean;
        state?: LocalFrontierCoordinatorState;
      };
}

export interface LocalFrontierCoordinatorOptions {
  collaborationId: string;
  participants: readonly [LocalFrontierParticipant, LocalFrontierParticipant];
  store: LocalFrontierCoordinatorStore;
  autoContinueAfterAgreement?: boolean;
  maxEventBytes?: number;
  maxRememberedEventIds?: number;
  onEventIngestionError?: (input: {
    participantId: string;
    error: unknown;
  }) => void;
}

export type LocalFrontierEventIngestionResult =
  | { accepted: true; deduplicated: boolean }
  | {
      accepted: false;
      reason:
        | "invalid-event"
        | "oversized-event"
        | "stale-generation"
        | "store-rejected";
    };

const DEFAULT_MAX_EVENT_BYTES = 64 * 1024;
const DEFAULT_MAX_REMEMBERED_EVENT_IDS = 1_000;
const MAX_ROUNDS = 3;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const REQUIRED_RUNTIME_ROSTER = new Set([
  "codex/codex-cli",
  "claude/claude-code",
]);

/**
 * Main-process-only coordinator for a two-participant local collaboration.
 * Participants receive a turn capability, never a durable-state writer.
 */
export class MultiFrontierCoordinator {
  readonly #participants = new Map<string, LocalFrontierParticipant>();
  readonly #store: LocalFrontierCoordinatorStore;
  readonly #collaborationId: string;
  readonly #maxEventBytes: number;
  readonly #maxRememberedEventIds: number;
  readonly #onEventIngestionError?: LocalFrontierCoordinatorOptions["onEventIngestionError"];
  readonly #autoContinueAfterAgreement: boolean;
  readonly #seenEventIds = new Set<string>();
  readonly #eventIdsInOrder: string[] = [];
  readonly #activeTurnParticipantIds = new Set<string>();
  readonly #activeTurnPromises = new Set<Promise<LocalFrontierTurnResult>>();
  #hasActiveWorkspaceWriteTurn = false;
  #mutationQueue: Promise<void> = Promise.resolve();
  #state: LocalFrontierCoordinatorState | null = null;
  #unsubscribe: Array<() => void> = [];
  #lifecycleFence: "cancel" | "pause" | "dispose" | null = null;
  #resumePromise: Promise<LocalFrontierCoordinatorState> | null = null;
  #disposed = false;

  constructor(options: LocalFrontierCoordinatorOptions) {
    if (!SAFE_ID.test(options.collaborationId)) {
      throw new Error("A safe collaboration id is required.");
    }
    const participantIds = options.participants.map(
      (participant) => participant.participantId,
    );
    if (
      participantIds.some((participantId) => !SAFE_ID.test(participantId)) ||
      options.participants.some(
        (participant) =>
          !participant.provider.trim() ||
          !participant.runtime.trim() ||
          (participant.model !== undefined && !participant.model.trim()) ||
          (participant.sessionRef !== undefined &&
            !participant.sessionRef.trim()) ||
          (participant.capabilities !== undefined &&
            participant.capabilities.some((capability) => !capability.trim())),
      ) ||
      new Set(participantIds).size !== 2 ||
      !hasRequiredRuntimeRoster(options.participants)
    ) {
      throw new Error(
        "Multi-frontier requires exactly two distinct participants.",
      );
    }
    this.#collaborationId = options.collaborationId;
    this.#store = options.store;
    this.#autoContinueAfterAgreement =
      options.autoContinueAfterAgreement === true;
    this.#maxEventBytes = positiveInteger(
      options.maxEventBytes,
      DEFAULT_MAX_EVENT_BYTES,
    );
    this.#maxRememberedEventIds = positiveInteger(
      options.maxRememberedEventIds,
      DEFAULT_MAX_REMEMBERED_EVENT_IDS,
    );
    this.#onEventIngestionError = options.onEventIngestionError;
    for (const participant of options.participants) {
      this.#participants.set(participant.participantId, participant);
    }
  }

  get state(): LocalFrontierCoordinatorState | null {
    return this.#state ? cloneState(this.#state) : null;
  }

  async begin(): Promise<LocalFrontierCoordinatorState> {
    this.#assertUsable();
    if (this.#state) throw new Error("The collaboration has already begun.");
    const state = this.#newState();
    await this.#store.create(cloneState(state));
    this.#state = state;
    this.#attachParticipantEvents();
    try {
      await Promise.all(
        [...this.#participants.values()].map((participant) =>
          participant.start(this.#readOnlySessionInput()),
        ),
      );
      return this.#update((current) => ({
        ...current,
        participants: current.participants.map((participant) => ({
          ...participant,
          status: "waiting",
        })),
      }));
    } catch (error) {
      await this.#persistPause("watchdog_crashed");
      throw error;
    }
  }

  /** Reconnects read-only sessions only. It never replays a prior turn. */
  resume(): Promise<LocalFrontierCoordinatorState> {
    this.#assertUsable();
    if (this.#lifecycleFence) {
      throw new Error("A lifecycle transition is already in progress.");
    }
    if (this.#resumePromise) {
      throw new Error("The collaboration is already resuming.");
    }
    const resumePromise = this.#resumePersistedCollaboration();
    this.#resumePromise = resumePromise;
    void resumePromise.then(
      () => {
        if (this.#resumePromise === resumePromise) this.#resumePromise = null;
      },
      () => {
        if (this.#resumePromise === resumePromise) this.#resumePromise = null;
      },
    );
    return resumePromise;
  }

  async #resumePersistedCollaboration(): Promise<LocalFrontierCoordinatorState> {
    const persisted = await this.#store.read(this.#collaborationId);
    if (!persisted || persisted.phase !== "paused") {
      throw new Error("Only a paused collaboration can be resumed.");
    }
    this.#assertPersistedParticipants(persisted);
    const resumablePhase = persisted.recovery?.resumablePhase ?? "proposing";
    const restartPlanning = [
      "proposing",
      "cross_review",
      "converging",
    ].includes(resumablePhase);
    const returnToApproval = ["implementing", "checkpoint_review"].includes(
      resumablePhase,
    );
    const state: LocalFrontierCoordinatorState = {
      ...cloneState(persisted),
      phase: restartPlanning
        ? "proposing"
        : returnToApproval
          ? "awaiting_go"
          : resumablePhase,
      approval: restartPlanning
        ? "not_required"
        : returnToApproval
          ? "pending"
          : persisted.approval,
      participants: readOnlyParticipants(persisted.participants),
      driver: revokeDriver(persisted.driver),
      recovery: undefined,
    };
    this.#attachParticipantEvents();
    try {
      await Promise.all(
        [...this.#participants.values()].map((participant) =>
          participant.resume
            ? participant.resume({
                collaborationId: this.#collaborationId,
                permission: "read_only",
                round: state.round,
              })
            : participant.start({
                collaborationId: this.#collaborationId,
                permission: "read_only",
                round: state.round,
              }),
        ),
      );
      if (this.#lifecycleFence || this.#disposed) {
        throw new Error("The collaboration stopped while resuming.");
      }
      const resumed = {
        ...state,
        participants: state.participants.map((participant) => ({
          ...participant,
          status: "waiting" as const,
        })),
      };
      await this.#serializeMutation(async () => {
        if (this.#lifecycleFence || this.#disposed) {
          throw new Error("The collaboration stopped while resuming.");
        }
        await this.#store.write(cloneState(resumed));
        this.#state = resumed;
      });
      return cloneState(resumed);
    } catch (error) {
      if (!this.#lifecycleFence && !this.#disposed) {
        await this.#persistPause("watchdog_crashed");
      }
      throw error;
    }
  }

  async requestGo(
    synthesisArtifactId: string,
  ): Promise<LocalFrontierCoordinatorState> {
    this.#assertStableBoundary();
    if (!SAFE_ID.test(synthesisArtifactId)) {
      throw new Error("A safe synthesis artifact id is required.");
    }
    return this.#update((current) => {
      if (
        ![
          "proposing",
          "cross_review",
          "converging",
          "checkpoint_review",
        ].includes(current.phase)
      ) {
        throw new Error(
          "GO can only be requested at a planning or checkpoint boundary.",
        );
      }
      return {
        ...current,
        phase: "awaiting_go",
        approval: "pending",
        currentSynthesisArtifactId: synthesisArtifactId,
        approvedSynthesisArtifactId: undefined,
        participants: readOnlyParticipants(current.participants),
        driver: revokeDriver(current.driver),
      };
    });
  }

  async beginCrossReview(): Promise<LocalFrontierCoordinatorState> {
    this.#assertStableBoundary();
    return this.#advanceReadOnlyPhase("proposing", "cross_review");
  }

  async beginConvergence(): Promise<LocalFrontierCoordinatorState> {
    this.#assertStableBoundary();
    return this.#advanceReadOnlyPhase("cross_review", "converging");
  }

  /** Explicit GO is the only path that creates a workspace-write capability. */
  async approveGo(
    driverParticipantId: string,
  ): Promise<LocalFrontierDriverLease> {
    this.#assertStableBoundary();
    this.#requireParticipant(driverParticipantId);
    const next = await this.#update((current) => {
      if (current.phase !== "awaiting_go" || current.approval !== "pending") {
        throw new Error(
          "An explicit pending GO is required before implementation.",
        );
      }
      const generation = (current.driver?.generation ?? 0) + 1;
      return {
        ...current,
        phase: "implementing",
        approval: "approved",
        approvedSynthesisArtifactId: current.currentSynthesisArtifactId,
        driver: {
          participantId: driverParticipantId,
          generation,
          leaseState: "active",
        },
        participants: current.participants.map((participant) => ({
          ...participant,
          role:
            participant.participantId === driverParticipantId
              ? "driver"
              : "watchdog",
          permission:
            participant.participantId === driverParticipantId
              ? "workspace_write"
              : "read_only",
        })),
      };
    });
    return { ...next.driver! };
  }

  async runTurn(input: {
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
  }): Promise<LocalFrontierTurnResult> {
    this.#assertTurnStartAllowed();
    const participant = this.#requireParticipant(input.participantId);
    if (!SAFE_ID.test(input.turnId))
      throw new Error("A safe turn id is required.");
    if (!input.instruction.trim()) {
      throw new Error("A turn instruction is required.");
    }
    if (
      Buffer.byteLength(input.instruction, "utf8") >
      MULTI_FRONTIER_IPC_MAX_PROMPT_BYTES
    ) {
      throw new Error("The turn instruction exceeds the allowed size.");
    }

    this.#reserveTurn(input.participantId, input.kind);
    const activeTurn = this.#runReservedTurn(input, participant);
    this.#activeTurnPromises.add(activeTurn);
    void activeTurn.then(
      () => this.#activeTurnPromises.delete(activeTurn),
      () => this.#activeTurnPromises.delete(activeTurn),
    );
    return activeTurn;
  }

  async #runReservedTurn(
    input: Parameters<MultiFrontierCoordinator["runTurn"]>[0],
    participant: LocalFrontierParticipant,
  ): Promise<LocalFrontierTurnResult> {
    let participantStarted = false;
    try {
      const turn = await this.#serializeMutation(async () => {
        this.#assertTurnStartAllowed();
        const current = this.#requireState();
        const { permission, phase } = this.#turnCapability(current, input);
        const next: LocalFrontierCoordinatorState = {
          ...current,
          participants: current.participants.map((candidate) =>
            candidate.participantId === input.participantId
              ? { ...candidate, status: "running" }
              : candidate,
          ),
        };
        await this.#store.write(cloneState(next));
        this.#state = next;
        this.#assertTurnStartAllowed();
        return {
          permission,
          phase,
          round: current.round,
        } satisfies Pick<
          LocalFrontierTurnInput,
          "permission" | "phase" | "round"
        >;
      });
      participantStarted = true;
      const result = await participant.runTurn({
        collaborationId: this.#collaborationId,
        turnId: input.turnId,
        round: turn.round,
        phase: turn.phase,
        permission: turn.permission,
        ...(turn.permission === "workspace_write"
          ? { generation: input.generation }
          : {}),
        instruction: input.instruction,
      });
      await this.#updateParticipantStatus(input.participantId, "waiting");
      return boundTurnResult(result);
    } catch (error) {
      if (participantStarted && !this.#lifecycleFence) {
        await this.#pauseForParticipant(input.participantId);
      }
      throw error;
    } finally {
      this.#releaseTurn(input.participantId, input.kind);
    }
  }

  async checkpoint(
    checkpointId: string,
  ): Promise<LocalFrontierCoordinatorState> {
    this.#assertStableBoundary();
    if (!SAFE_ID.test(checkpointId))
      throw new Error("A safe checkpoint id is required.");
    return this.#update((current) => {
      if (current.phase !== "implementing") {
        throw new Error(
          "A checkpoint requires an implementation turn boundary.",
        );
      }
      return {
        ...current,
        phase: "checkpoint_review",
        approval: "pending",
        checkpointIds: [...new Set([...current.checkpointIds, checkpointId])],
        participants: readOnlyParticipants(current.participants),
        driver: revokeDriver(current.driver),
      };
    });
  }

  async swapDriverRole(input: {
    fromParticipantId: string;
    toParticipantId: string;
    expectedGeneration: number;
    synthesisArtifactId: string;
  }): Promise<LocalFrontierDriverLease> {
    this.#assertStableBoundary();
    this.#requireParticipant(input.fromParticipantId);
    this.#requireParticipant(input.toParticipantId);
    if (input.fromParticipantId === input.toParticipantId) {
      throw new Error("A role swap requires distinct participants.");
    }
    if (
      !Number.isSafeInteger(input.expectedGeneration) ||
      input.expectedGeneration < 1
    ) {
      throw new Error("A role swap requires the current driver generation.");
    }
    if (!SAFE_ID.test(input.synthesisArtifactId)) {
      throw new Error("A safe synthesis artifact id is required.");
    }
    const next = await this.#update((current) => {
      if (
        !["awaiting_go", "checkpoint_review"].includes(current.phase) ||
        current.driver?.leaseState !== "revoked" ||
        current.driver.participantId !== input.fromParticipantId ||
        current.driver.generation !== input.expectedGeneration ||
        current.currentSynthesisArtifactId !== input.synthesisArtifactId
      ) {
        throw new Error(
          "A role swap requires the current revoked driver lease.",
        );
      }
      return {
        ...current,
        driver: {
          participantId: input.toParticipantId,
          generation: input.expectedGeneration + 1,
          leaseState: "revoked",
        },
        participants: readOnlyParticipants(current.participants),
      };
    });
    return { ...next.driver! };
  }

  async readTrustedSnapshot(): Promise<MultiFrontierTrustedCoordinatorSnapshot> {
    const persisted = await this.#store.read(this.#collaborationId);
    if (!persisted) {
      throw new Error("The durable collaboration state is unavailable.");
    }
    return toTrustedSnapshot(persisted);
  }

  async beginNextRound(): Promise<LocalFrontierCoordinatorState> {
    this.#assertStableBoundary();
    return this.#update((current) => {
      if (
        !["checkpoint_review", "cross_review", "converging"].includes(
          current.phase,
        )
      ) {
        throw new Error("A new round requires a completed review boundary.");
      }
      if (current.round >= MAX_ROUNDS) {
        throw new Error(`Multi-frontier is limited to ${MAX_ROUNDS} rounds.`);
      }
      return {
        ...current,
        phase: "proposing",
        approval: "not_required",
        round: current.round + 1,
        participants: readOnlyParticipants(current.participants),
        driver: revokeDriver(current.driver),
      };
    });
  }

  async ingestEvent(
    event: LocalFrontierParticipantEvent,
  ): Promise<LocalFrontierEventIngestionResult> {
    if (!isValidEvent(event) || !this.#participants.has(event.participantId)) {
      return { accepted: false, reason: "invalid-event" };
    }
    const eventBytes = serializedEventBytes(event);
    if (eventBytes === null) {
      return { accepted: false, reason: "invalid-event" };
    }
    if (eventBytes > this.#maxEventBytes) {
      return { accepted: false, reason: "oversized-event" };
    }
    const persisted = await this.#serializeMutation(async () => {
      const state = this.#requireState();
      if (!this.#isEventFenced(state, event)) {
        return {
          result: { accepted: false, reason: "stale-generation" } as const,
        };
      }
      if (this.#seenEventIds.has(event.id)) {
        return {
          result: { accepted: true, deduplicated: true } as const,
          wasDriver: state.driver?.participantId === event.participantId,
        };
      }
      const stored = await this.#store.appendEvent({
        ...event,
        collaborationId: this.#collaborationId,
      });
      if (!stored.accepted) {
        return {
          result: { accepted: false, reason: "store-rejected" } as const,
        };
      }
      this.#rememberEventId(event.id);
      if (stored.state) {
        this.#state = cloneState(stored.state);
      } else if (!stored.deduplicated && event.status) {
        this.#state = withParticipantStatus(
          state,
          event.participantId,
          event.status,
        );
      }
      return {
        result: {
          accepted: true,
          deduplicated: stored.deduplicated,
        } as const,
        wasDriver: state.driver?.participantId === event.participantId,
      };
    });
    if (persisted.result.accepted && event.kind === "crash") {
      await this.#persistPause(
        persisted.wasDriver ? "driver_crashed" : "watchdog_crashed",
        event.participantId,
      );
    }
    return persisted.result;
  }

  async cancel(): Promise<LocalFrontierCoordinatorState> {
    if (!this.#state) {
      this.#assertUsable();
      const persisted = await this.#store.read(this.#collaborationId);
      if (!persisted || persisted.phase !== "paused") {
        throw new Error("Only a paused collaboration can be canceled.");
      }
      this.#assertPersistedParticipants(persisted);
      this.#state = cloneState(persisted);
    }
    this.#requireNonTerminalState();
    this.#beginLifecycleFence("cancel");
    await this.#cancelAndSettleOwnedWork();
    return this.#terminate("canceled");
  }

  async pause(): Promise<LocalFrontierCoordinatorState> {
    this.#requireNonTerminalState();
    this.#beginLifecycleFence("pause");
    try {
      await this.#cancelAndSettleOwnedWork();
      return await this.#persistPause("canceled");
    } finally {
      if (this.#lifecycleFence === "pause") this.#lifecycleFence = null;
    }
  }

  async complete(): Promise<LocalFrontierCoordinatorState> {
    this.#assertStableBoundary();
    return this.#terminate("completed");
  }

  async fail(): Promise<LocalFrontierCoordinatorState> {
    this.#assertStableBoundary();
    return this.#terminate("failed");
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#beginLifecycleFence("dispose");
    await this.#cancelAndSettleOwnedWork();
    if (
      this.#state &&
      !isTerminalPhase(this.#state.phase) &&
      this.#state.phase !== "paused"
    ) {
      await this.#persistPause("app_quit");
    }
    this.#disposed = true;
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    await Promise.allSettled(
      [...this.#participants.values()].map((participant) =>
        participant.dispose(),
      ),
    );
  }

  #newState(): LocalFrontierCoordinatorState {
    return {
      schemaVersion: 1,
      collaborationId: this.#collaborationId,
      phase: "proposing",
      participants: [...this.#participants.values()].map((participant) => ({
        participantId: participant.participantId,
        provider: participant.provider,
        runtime: participant.runtime,
        ...(participant.model ? { model: participant.model } : {}),
        ...(participant.capabilities
          ? { capabilities: [...participant.capabilities] }
          : {}),
        ...(participant.sessionRef
          ? { sessionRef: participant.sessionRef }
          : {}),
        role: "watchdog",
        permission: "read_only",
        status: "idle",
      })),
      driver: null,
      approval: "not_required",
      checkpointIds: [],
      round: 1,
      autoContinueAfterAgreement: this.#autoContinueAfterAgreement,
    };
  }

  #readOnlySessionInput(): LocalFrontierSessionInput {
    const state = this.#requireState();
    return {
      collaborationId: this.#collaborationId,
      permission: "read_only",
      round: state.round,
    };
  }

  #turnCapability(
    state: LocalFrontierCoordinatorState,
    input: Parameters<MultiFrontierCoordinator["runTurn"]>[0],
  ): Pick<LocalFrontierTurnInput, "phase" | "permission"> {
    if (input.kind === "proposal")
      return this.#readOnlyTurnCapability(state, "proposing");
    if (input.kind === "cross_review")
      return this.#readOnlyTurnCapability(state, "cross_review");
    if (input.kind === "convergence")
      return this.#readOnlyTurnCapability(state, "converging");
    if (input.kind === "checkpoint_review")
      return this.#readOnlyTurnCapability(state, "checkpoint_review");
    const driver = state.driver;
    if (
      state.phase !== "implementing" ||
      state.approval !== "approved" ||
      driver?.leaseState !== "active" ||
      driver.participantId !== input.participantId ||
      driver.generation !== input.generation
    ) {
      throw new Error(
        "Implementation requires the current explicit driver lease.",
      );
    }
    return { phase: "implementing", permission: "workspace_write" };
  }

  async #persistPause(
    reason: LocalFrontierRecoveryReason,
    failedParticipantId?: string,
  ): Promise<LocalFrontierCoordinatorState> {
    return this.#update((current) =>
      this.#pausedState(current, reason, failedParticipantId),
    );
  }

  async #terminate(
    phase: "completed" | "failed" | "canceled",
  ): Promise<LocalFrontierCoordinatorState> {
    return this.#update((current) => {
      if (isTerminalPhase(current.phase)) {
        throw new Error("A terminal collaboration cannot transition again.");
      }
      return {
        ...current,
        phase,
        approval: phase === "completed" ? "approved" : current.approval,
        participants: readOnlyParticipants(current.participants).map(
          (participant) => ({
            ...participant,
            status: phase === "completed" ? "completed" : participant.status,
          }),
        ),
        driver: revokeDriver(current.driver),
        recovery: undefined,
      };
    });
  }

  #readOnlyTurnCapability(
    state: LocalFrontierCoordinatorState,
    phase: Exclude<LocalFrontierTurnInput["phase"], "implementing">,
  ): Pick<LocalFrontierTurnInput, "phase" | "permission"> {
    if (state.phase !== phase) {
      throw new Error(`${phase} turns are only allowed during ${phase}.`);
    }
    return { phase, permission: "read_only" };
  }

  async #advanceReadOnlyPhase(
    expected: LocalFrontierPhase,
    nextPhase: LocalFrontierPhase,
  ): Promise<LocalFrontierCoordinatorState> {
    return this.#update((current) => {
      if (current.phase !== expected) {
        throw new Error(`Expected ${expected} before ${nextPhase}.`);
      }
      return {
        ...current,
        phase: nextPhase,
        participants: readOnlyParticipants(current.participants),
        driver: revokeDriver(current.driver),
      };
    });
  }

  async #update(
    mutate: (
      state: LocalFrontierCoordinatorState,
    ) => LocalFrontierCoordinatorState,
  ): Promise<LocalFrontierCoordinatorState> {
    return this.#serializeMutation(async () => {
      const current = this.#requireState();
      const next = mutate(cloneState(current));
      await this.#store.write(cloneState(next));
      this.#state = next;
      return cloneState(next);
    });
  }

  async #updateParticipantStatus(
    participantId: string,
    status: LocalFrontierParticipantStatus,
  ): Promise<void> {
    await this.#update((current) => ({
      ...current,
      participants: current.participants.map((participant) =>
        !isTerminalPhase(current.phase) &&
        participant.participantId === participantId &&
        (participant.status === "running" ||
          status === "failed" ||
          status === "completed")
          ? { ...participant, status }
          : participant,
      ),
    }));
  }

  #attachParticipantEvents(): void {
    if (this.#unsubscribe.length > 0) return;
    for (const participant of this.#participants.values()) {
      this.#unsubscribe.push(
        participant.onEvent((event) => {
          void this.#ingestParticipantEvent(participant.participantId, event);
        }),
      );
    }
  }

  async #ingestParticipantEvent(
    participantId: string,
    event: LocalFrontierParticipantEvent,
  ): Promise<void> {
    try {
      await this.ingestEvent(event);
    } catch (error) {
      try {
        await this.#persistPause(
          this.#state?.driver?.participantId === participantId
            ? "driver_crashed"
            : "watchdog_crashed",
          participantId,
        );
      } catch (pauseError) {
        this.#reportEventIngestionError(participantId, pauseError);
      }
      this.#reportEventIngestionError(participantId, error);
    }
  }

  #reportEventIngestionError(participantId: string, error: unknown): void {
    try {
      this.#onEventIngestionError?.({ participantId, error });
    } catch {
      // An observer cannot turn a participant event into an unhandled rejection.
    }
  }

  #isEventFenced(
    state: LocalFrontierCoordinatorState,
    event: LocalFrontierParticipantEvent,
  ): boolean {
    if (
      this.#lifecycleFence ||
      state.phase === "paused" ||
      isTerminalPhase(state.phase)
    ) {
      return false;
    }
    if (event.permission === "read_only") return true;
    const driver = state.driver;
    return Boolean(
      state.phase === "implementing" &&
      driver?.leaseState === "active" &&
      driver.participantId === event.participantId &&
      driver.generation === event.generation,
    );
  }

  #rememberEventId(id: string): void {
    this.#seenEventIds.add(id);
    this.#eventIdsInOrder.push(id);
    if (this.#eventIdsInOrder.length <= this.#maxRememberedEventIds) return;
    const evicted = this.#eventIdsInOrder.shift();
    if (evicted) this.#seenEventIds.delete(evicted);
  }

  #requireState(): LocalFrontierCoordinatorState {
    if (!this.#state)
      throw new Error("Begin or resume the collaboration first.");
    return this.#state;
  }

  #requireNonTerminalState(): LocalFrontierCoordinatorState {
    const state = this.#requireState();
    if (isTerminalPhase(state.phase)) {
      throw new Error("A terminal collaboration cannot transition again.");
    }
    return state;
  }

  #assertTurnStartAllowed(): void {
    this.#assertUsable();
    if (this.#lifecycleFence || this.#resumePromise) {
      throw new Error("The collaboration is not accepting new turns.");
    }
  }

  #assertStableBoundary(): void {
    this.#assertUsable();
    this.#requireNonTerminalState();
    if (
      this.#lifecycleFence ||
      this.#resumePromise ||
      this.#activeTurnParticipantIds.size > 0
    ) {
      throw new Error("This transition requires a stable turn boundary.");
    }
  }

  #beginLifecycleFence(kind: "cancel" | "pause" | "dispose"): void {
    if (this.#lifecycleFence) {
      throw new Error("A lifecycle transition is already in progress.");
    }
    this.#lifecycleFence = kind;
  }

  async #cancelAndSettleOwnedWork(): Promise<void> {
    const resumePromise = this.#resumePromise;
    const activeTurns = [...this.#activeTurnPromises];
    await Promise.allSettled(
      [...this.#participants.values()].map((participant) =>
        participant.cancel(),
      ),
    );
    await Promise.allSettled([
      ...activeTurns,
      ...(resumePromise ? [resumePromise] : []),
    ]);
  }

  #requireParticipant(participantId: string): LocalFrontierParticipant {
    const participant = this.#participants.get(participantId);
    if (!participant) throw new Error("Unknown multi-frontier participant.");
    return participant;
  }

  #reserveTurn(
    participantId: string,
    kind: Parameters<MultiFrontierCoordinator["runTurn"]>[0]["kind"],
  ): void {
    if (this.#activeTurnParticipantIds.has(participantId)) {
      throw new Error("This participant already has an active turn.");
    }
    if (kind === "implementation" && this.#hasActiveWorkspaceWriteTurn) {
      throw new Error("The active driver lease already has a running turn.");
    }
    this.#activeTurnParticipantIds.add(participantId);
    if (kind === "implementation") this.#hasActiveWorkspaceWriteTurn = true;
  }

  #releaseTurn(
    participantId: string,
    kind: Parameters<MultiFrontierCoordinator["runTurn"]>[0]["kind"],
  ): void {
    this.#activeTurnParticipantIds.delete(participantId);
    if (kind === "implementation") this.#hasActiveWorkspaceWriteTurn = false;
  }

  async #pauseForParticipant(
    participantId: string,
  ): Promise<LocalFrontierCoordinatorState> {
    return this.#update((current) =>
      this.#pausedState(
        current,
        current.driver?.participantId === participantId
          ? "driver_crashed"
          : "watchdog_crashed",
        participantId,
      ),
    );
  }

  #pausedState(
    current: LocalFrontierCoordinatorState,
    reason: LocalFrontierRecoveryReason,
    failedParticipantId?: string,
  ): LocalFrontierCoordinatorState {
    if (isTerminalPhase(current.phase) || current.phase === "paused") {
      return current;
    }
    return {
      ...current,
      phase: "paused",
      participants: current.participants.map((participant) => ({
        ...participant,
        role: "watchdog",
        permission: "read_only",
        status:
          participant.participantId === failedParticipantId
            ? "failed"
            : participant.status === "running"
              ? "waiting"
              : participant.status,
      })),
      driver: revokeDriver(current.driver),
      recovery: { reason, resumablePhase: current.phase },
    };
  }

  async #serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationQueue.then(operation);
    this.#mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #assertPersistedParticipants(state: LocalFrontierCoordinatorState): void {
    const ids = state.participants.map(
      (participant) => participant.participantId,
    );
    if (
      ids.length !== 2 ||
      new Set(ids).size !== 2 ||
      ids.some((id) => !this.#participants.has(id))
    ) {
      throw new Error(
        "Stored collaboration participants do not match this coordinator.",
      );
    }
    for (const persisted of state.participants) {
      const participant = this.#participants.get(persisted.participantId)!;
      if (
        participant.provider !== persisted.provider ||
        participant.runtime !== persisted.runtime ||
        participant.model !== persisted.model ||
        participant.sessionRef !== persisted.sessionRef
      ) {
        throw new Error(
          "Stored collaboration runtime identity does not match this coordinator.",
        );
      }
    }
  }

  #assertUsable(): void {
    if (this.#disposed)
      throw new Error("The collaboration coordinator is disposed.");
  }
}

export interface MultiFrontierOrchestratorBridge {
  coordinator: MultiFrontierCoordinatorFacade;
  captureTurnResult(
    request: MultiFrontierTurnRequest,
  ): Promise<MultiFrontierTurnResult>;
}

/**
 * Couples orchestrator capture to the only coordinator-authorized participant
 * turn. Captures subscribe before the coordinator starts the child process.
 */
export function createMultiFrontierOrchestratorBridge(
  coordinator: MultiFrontierCoordinator,
): MultiFrontierOrchestratorBridge {
  const captures = new Map<
    string,
    {
      request: MultiFrontierTurnRequest;
      settle: (result: PromiseSettledResult<MultiFrontierTurnResult>) => void;
    }
  >();
  const captureTurnResult = (
    request: MultiFrontierTurnRequest,
  ): Promise<MultiFrontierTurnResult> => {
    if (request.collaborationId !== coordinator.state?.collaborationId) {
      return Promise.reject(
        new Error("The turn capture has another collaboration."),
      );
    }
    if (captures.has(request.turnId)) {
      return Promise.reject(
        new Error("The turn capture is already registered."),
      );
    }
    return new Promise<MultiFrontierTurnResult>((resolve, reject) => {
      const onAbort = () => {
        captures.delete(request.turnId);
        reject(new Error("The turn capture was canceled."));
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      captures.set(request.turnId, {
        request,
        settle: (result) => {
          request.signal.removeEventListener("abort", onAbort);
          captures.delete(request.turnId);
          if (result.status === "fulfilled") resolve(result.value);
          else reject(result.reason);
        },
      });
    });
  };
  const settleCapture = (
    turnId: string,
    result: PromiseSettledResult<MultiFrontierTurnResult>,
  ) => {
    captures.get(turnId)?.settle(result);
  };
  return {
    captureTurnResult,
    coordinator: {
      readTrustedSnapshot: () => coordinator.readTrustedSnapshot(),
      runTurn: async (input) => {
        const capture = captures.get(input.turnId);
        if (
          capture &&
          (capture.request.participantId !== input.participantId ||
            capture.request.round !== coordinator.state?.round)
        ) {
          settleCapture(
            input.turnId,
            rejectedTurnResult(
              "The coordinator turn did not match its capture.",
            ),
          );
          throw new Error("The coordinator turn did not match its capture.");
        }
        try {
          const result = await coordinator.runTurn(input);
          settleCapture(input.turnId, { status: "fulfilled", value: result });
        } catch (error) {
          settleCapture(input.turnId, rejectedTurnResult(error));
          throw error;
        }
      },
      beginCrossReview: () => coordinator.beginCrossReview(),
      beginConvergence: () => coordinator.beginConvergence(),
      beginNextRound: () => coordinator.beginNextRound(),
      requestGo: (synthesisArtifactId) =>
        coordinator.requestGo(synthesisArtifactId),
      approveGo: async (participantId) => {
        const lease = await coordinator.approveGo(participantId);
        return { generation: lease.generation };
      },
      checkpoint: (checkpointId) => coordinator.checkpoint(checkpointId),
      pause: () => coordinator.pause(),
      complete: () => coordinator.complete(),
      swapDriverRole: async (input) => {
        const lease = await coordinator.swapDriverRole(input);
        return { generation: lease.generation };
      },
    },
  };
}

function isTerminalPhase(phase: LocalFrontierPhase): boolean {
  return phase === "completed" || phase === "failed" || phase === "canceled";
}

function toTrustedSnapshot(
  state: LocalFrontierCoordinatorState,
): MultiFrontierTrustedCoordinatorSnapshot {
  return {
    schemaVersion: 1,
    collaborationId: state.collaborationId,
    phase: state.phase,
    approval: state.approval,
    autoContinueAfterAgreement: state.autoContinueAfterAgreement,
    ...(state.currentSynthesisArtifactId
      ? { currentSynthesisArtifactId: state.currentSynthesisArtifactId }
      : {}),
    ...(state.approvedSynthesisArtifactId
      ? { approvedSynthesisArtifactId: state.approvedSynthesisArtifactId }
      : {}),
    checkpointIds: [...state.checkpointIds],
    driver: state.driver ? { ...state.driver } : null,
    round: state.round,
  };
}

function boundTurnResult(
  result: LocalFrontierTurnResult,
): MultiFrontierTurnResult {
  if (!result || typeof result.text !== "string" || !result.text.trim()) {
    throw new Error("A participant turn must return bounded text.");
  }
  const text = boundText(result.text, "participant turn text");
  const findings = result.findings?.slice(0, 40).map((finding) => ({
    id: boundId(finding.id, "finding id"),
    category: finding.category,
    summary: boundText(finding.summary, "finding summary"),
  }));
  const dispositions = result.dispositions?.slice(0, 40).map((disposition) => ({
    findingId: boundId(disposition.findingId, "finding id"),
    disposition: disposition.disposition,
    reason: boundText(disposition.reason, "finding disposition reason"),
  }));
  const tests = result.tests?.slice(0, 8).map((test) => {
    if (test.status !== "passed" && test.status !== "failed") {
      throw new Error("A participant test status is invalid.");
    }
    return {
      name: boundText(test.name, "test name"),
      status: test.status,
      evidence: boundText(test.evidence, "test evidence"),
    };
  });
  return {
    text,
    ...(typeof result.agreed === "boolean" ? { agreed: result.agreed } : {}),
    ...(typeof result.requiresRevision === "boolean"
      ? { requiresRevision: result.requiresRevision }
      : {}),
    ...(findings ? { findings } : {}),
    ...(dispositions ? { dispositions } : {}),
    ...(tests ? { tests } : {}),
    ...(result.reversibleResolution
      ? {
          reversibleResolution: {
            alternatives: result.reversibleResolution.alternatives
              .slice(0, 8)
              .map((value) => boundText(value, "resolution alternative")),
            comparator: boundText(
              result.reversibleResolution.comparator,
              "resolution comparator",
            ),
            selected: boundText(
              result.reversibleResolution.selected,
              "resolution selection",
            ),
            reversibility: boundText(
              result.reversibleResolution.reversibility,
              "resolution reversibility",
            ),
          },
        }
      : {}),
  };
}

function boundText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`A ${label} is required.`);
  return Buffer.from(trimmed, "utf8")
    .subarray(0, MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES)
    .toString("utf8");
}

function boundId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`A safe ${label} is required.`);
  return value;
}

function rejectedTurnResult(reason: unknown): PromiseRejectedResult {
  return { status: "rejected", reason };
}

function hasRequiredRuntimeRoster(
  participants: readonly LocalFrontierParticipant[],
): boolean {
  const roster = new Set(
    participants.map(
      (participant) => `${participant.provider}/${participant.runtime}`,
    ),
  );
  return (
    roster.size === REQUIRED_RUNTIME_ROSTER.size &&
    [...REQUIRED_RUNTIME_ROSTER].every((entry) => roster.has(entry))
  );
}

function withParticipantStatus(
  state: LocalFrontierCoordinatorState,
  participantId: string,
  status: LocalFrontierParticipantStatus,
): LocalFrontierCoordinatorState {
  return {
    ...state,
    participants: state.participants.map((participant) =>
      participant.participantId === participantId
        ? { ...participant, status }
        : participant,
    ),
  };
}

function isValidEvent(event: LocalFrontierParticipantEvent): boolean {
  return (
    SAFE_ID.test(event.id) &&
    SAFE_ID.test(event.participantId) &&
    (event.permission === "read_only" ||
      event.permission === "workspace_write") &&
    (event.generation === undefined ||
      Number.isSafeInteger(event.generation)) &&
    (event.kind === "progress" ||
      event.kind === "status" ||
      event.kind === "crash") &&
    (event.status === undefined ||
      ["idle", "running", "waiting", "failed", "completed"].includes(
        event.status,
      ))
  );
}

function readOnlyParticipants(
  participants: LocalFrontierParticipantState[],
): LocalFrontierParticipantState[] {
  return participants.map((participant) => ({
    ...participant,
    role: "watchdog",
    permission: "read_only",
    status: participant.status === "running" ? "waiting" : participant.status,
  }));
}

function revokeDriver(
  driver: LocalFrontierDriverLease | null,
): LocalFrontierDriverLease | null {
  return driver ? { ...driver, leaseState: "revoked" } : null;
}

function cloneState(
  state: LocalFrontierCoordinatorState,
): LocalFrontierCoordinatorState {
  return {
    ...state,
    participants: state.participants.map((participant) => ({
      ...participant,
      ...(participant.capabilities
        ? { capabilities: [...participant.capabilities] }
        : {}),
    })),
    driver: state.driver ? { ...state.driver } : null,
    checkpointIds: [...state.checkpointIds],
    ...(state.recovery ? { recovery: { ...state.recovery } } : {}),
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function serializedEventBytes(
  event: LocalFrontierParticipantEvent,
): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(event), "utf8");
  } catch {
    return null;
  }
}

import {
  runClaudeCodeParticipant,
  type ClaudeCodeParticipantSession,
  type RunClaudeCodeParticipantOptions,
} from "../../../core/src/cli/claude-code-participant.js";
import {
  runCodexCliParticipant,
  type RunCodexCliParticipantOptions,
} from "../../../core/src/cli/codex-cli-participant.js";
import {
  appendMultiFrontierParticipantEvent,
  createMultiFrontierRun,
  getMultiFrontierRun,
  listMultiFrontierRuns,
  recoverStoredMultiFrontierRun,
  transitionStoredMultiFrontierRun,
  type MultiFrontierRecoveryReason,
  type MultiFrontierRunState,
  type MultiFrontierStoredRun,
} from "../../../core/src/cli/multi-frontier-runs.js";
import type {
  LocalFrontierCoordinatorState,
  LocalFrontierCoordinatorStore,
  LocalFrontierParticipant,
  LocalFrontierParticipantEvent,
  LocalFrontierSessionInput,
  LocalFrontierTurnInput,
} from "./multi-frontier-coordinator.js";

const TERMINAL_PHASES = new Set(["completed", "failed", "canceled"]);

type CoreRuntimeApi = Pick<
  typeof import("../../../core/src/cli/multi-frontier-runs.js"),
  | "appendMultiFrontierParticipantEvent"
  | "createMultiFrontierRun"
  | "getMultiFrontierRun"
  | "listMultiFrontierRuns"
  | "recoverStoredMultiFrontierRun"
  | "transitionStoredMultiFrontierRun"
>;

const coreRuntimeApi: CoreRuntimeApi = {
  appendMultiFrontierParticipantEvent,
  createMultiFrontierRun,
  getMultiFrontierRun,
  listMultiFrontierRuns,
  recoverStoredMultiFrontierRun,
  transitionStoredMultiFrontierRun,
};

/**
 * The coordinator's only durable-store adapter. It deliberately projects no
 * provider output: core owns event fencing and the durable collaboration file.
 */
export class CoreMultiFrontierCoordinatorStore implements LocalFrontierCoordinatorStore {
  readonly #core: CoreRuntimeApi;
  readonly #now: () => string;

  constructor(
    options: {
      core?: CoreRuntimeApi;
      now?: () => string;
    } = {},
  ) {
    this.#core = options.core ?? coreRuntimeApi;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  create(state: LocalFrontierCoordinatorState): void {
    this.#core.createMultiFrontierRun({
      collaborationId: state.collaborationId,
      phase: state.phase,
      participants: toCoreParticipants(state.participants),
      approval: toCoreApproval(state.approval),
      checkpointIds: [...state.checkpointIds],
      autoContinueAfterAgreement: state.autoContinueAfterAgreement,
    });
  }

  read(collaborationId: string): LocalFrontierCoordinatorState | null {
    const stored = this.#core.getMultiFrontierRun(collaborationId);
    return stored ? toLocalState(stored) : null;
  }

  write(state: LocalFrontierCoordinatorState): void {
    const now = this.#now();
    const result = this.#core.transitionStoredMultiFrontierRun(
      state.collaborationId,
      now,
      (current) => toCoreState(state, current, now),
    );
    if (!result)
      throw new Error("Multi-frontier collaboration no longer exists.");
  }

  appendEvent(
    event: LocalFrontierParticipantEvent & { collaborationId: string },
  ): {
    accepted: boolean;
    deduplicated: boolean;
    state?: LocalFrontierCoordinatorState;
  } {
    const result = this.#core.appendMultiFrontierParticipantEvent({
      id: event.id,
      collaborationId: event.collaborationId,
      participantId: event.participantId,
      permission: event.permission,
      ...(event.generation === undefined
        ? {}
        : { generation: event.generation }),
      ...(event.status === undefined ? {} : { status: event.status }),
      createdAt: this.#now(),
    });
    return result.accepted
      ? {
          accepted: true,
          deduplicated: result.deduplicated,
          state: toLocalState(result.run),
        }
      : { accepted: false, deduplicated: false };
  }
}

export interface CodexLocalFrontierParticipantOptions {
  participantId: string;
  cwd: string;
  model?: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
  sessionRef?: string;
  /** Called only after Codex returns a new opaque resume id. */
  onSessionRef?: (sessionRef: string) => Promise<void> | void;
  run?: typeof runCodexCliParticipant;
}

export class CodexLocalFrontierParticipant implements LocalFrontierParticipant {
  readonly provider = "codex";
  readonly runtime = "codex-cli";
  readonly capabilities = [
    "login",
    "usage",
    "live-usage",
    "read-only",
    "workspace-write",
    "session-resume",
  ];
  readonly #listeners = new Set<
    (event: LocalFrontierParticipantEvent) => void
  >();
  readonly #run: typeof runCodexCliParticipant;
  readonly #options: CodexLocalFrontierParticipantOptions;
  #controller: AbortController | null = null;
  #activeRun: Promise<void> | null = null;
  #sessionRef: string | undefined;

  constructor(options: CodexLocalFrontierParticipantOptions) {
    this.participantId = options.participantId;
    this.#options = options;
    this.#run = options.run ?? runCodexCliParticipant;
    this.#sessionRef = options.sessionRef;
  }

  readonly participantId: string;

  get model(): string | undefined {
    return this.#options.model;
  }

  get sessionRef(): string | undefined {
    return this.#sessionRef;
  }

  async start(_input: LocalFrontierSessionInput): Promise<void> {}

  async resume(_input: LocalFrontierSessionInput): Promise<void> {}

  async runTurn(input: LocalFrontierTurnInput): Promise<void> {
    const controller = new AbortController();
    this.#controller = controller;
    this.#emit(input, "running");
    const activeRun = this.#runTurn(input, controller);
    this.#activeRun = activeRun;
    try {
      await activeRun;
    } finally {
      if (this.#activeRun === activeRun) this.#activeRun = null;
      if (this.#controller === controller) this.#controller = null;
    }
  }

  async #runTurn(
    input: LocalFrontierTurnInput,
    controller: AbortController,
  ): Promise<void> {
    try {
      const result = await this.#run({
        role:
          input.permission === "workspace_write"
            ? "driver"
            : input.phase === "proposing"
              ? "planning"
              : "watchdog",
        prompt: input.instruction,
        cwd: this.#options.cwd,
        ...(this.#options.model ? { model: this.#options.model } : {}),
        ...(this.#options.command ? { command: this.#options.command } : {}),
        ...(this.#options.env ? { env: this.#options.env } : {}),
        ...(this.#sessionRef
          ? { session: { resumeSessionId: this.#sessionRef } }
          : {}),
        allowWorkspaceWrite: input.permission === "workspace_write",
        signal: controller.signal,
      } satisfies RunCodexCliParticipantOptions);
      if (result.resumeSessionId) {
        this.#sessionRef = result.resumeSessionId;
        await this.#options.onSessionRef?.(result.resumeSessionId);
      }
      this.#emit(input, "waiting");
    } catch (error) {
      this.#emit(input, "failed", "crash");
      throw error;
    }
  }

  async cancel(): Promise<void> {
    const activeRun = this.#activeRun;
    this.#controller?.abort();
    await activeRun?.catch(() => undefined);
  }

  async dispose(): Promise<void> {
    await this.cancel();
    this.#listeners.clear();
  }

  onEvent(
    listener: (event: LocalFrontierParticipantEvent) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(
    input: LocalFrontierTurnInput,
    status: LocalFrontierParticipantEvent["status"],
    kind: LocalFrontierParticipantEvent["kind"] = "status",
  ): void {
    const event: LocalFrontierParticipantEvent = {
      id: `${input.turnId}.${kind}.${status ?? "unknown"}`,
      participantId: this.participantId,
      permission: input.permission,
      ...(input.generation === undefined
        ? {}
        : { generation: input.generation }),
      kind,
      ...(status === undefined ? {} : { status }),
    };
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // A renderer observer cannot disrupt a provider-owned turn.
      }
    }
  }
}

export interface ClaudeLocalFrontierParticipantOptions {
  participantId: string;
  cwd: string;
  model?: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
  session?: ClaudeCodeParticipantSession;
  run?: typeof runClaudeCodeParticipant;
}

export class ClaudeLocalFrontierParticipant implements LocalFrontierParticipant {
  readonly provider = "claude";
  readonly runtime = "claude-code";
  readonly capabilities = ["login", "usage", "read-only", "workspace-write"];
  readonly #listeners = new Set<
    (event: LocalFrontierParticipantEvent) => void
  >();
  readonly #run: typeof runClaudeCodeParticipant;
  readonly #options: ClaudeLocalFrontierParticipantOptions;
  #controller: AbortController | null = null;
  #activeRun: Promise<void> | null = null;
  #session: ClaudeCodeParticipantSession | undefined;

  constructor(options: ClaudeLocalFrontierParticipantOptions) {
    this.participantId = options.participantId;
    this.#options = options;
    this.#run = options.run ?? runClaudeCodeParticipant;
    if (options.session?.sessionId && options.session.resumeSessionId) {
      throw new Error(
        "Claude Code accepts either a new session id or a resume id.",
      );
    }
    this.#session = options.session ? { ...options.session } : undefined;
  }

  readonly participantId: string;

  get model(): string | undefined {
    return this.#options.model;
  }

  get sessionRef(): string | undefined {
    return this.#session?.resumeSessionId ?? this.#session?.sessionId;
  }

  async start(_input: LocalFrontierSessionInput): Promise<void> {}

  async resume(_input: LocalFrontierSessionInput): Promise<void> {}

  async runTurn(input: LocalFrontierTurnInput): Promise<void> {
    const controller = new AbortController();
    this.#controller = controller;
    this.#emit(input, "running");
    const activeRun = this.#runTurn(input, controller);
    this.#activeRun = activeRun;
    try {
      await activeRun;
    } finally {
      if (this.#activeRun === activeRun) this.#activeRun = null;
      if (this.#controller === controller) this.#controller = null;
    }
  }

  async #runTurn(
    input: LocalFrontierTurnInput,
    controller: AbortController,
  ): Promise<void> {
    try {
      await this.#run({
        role: input.permission === "workspace_write" ? "driver" : "watchdog",
        prompt: input.instruction,
        cwd: this.#options.cwd,
        ...(this.#options.model ? { model: this.#options.model } : {}),
        ...(this.#options.command ? { command: this.#options.command } : {}),
        ...(this.#options.env ? { env: this.#options.env } : {}),
        ...(this.#session ? { session: { ...this.#session } } : {}),
        signal: controller.signal,
      } satisfies RunClaudeCodeParticipantOptions);
      this.#emit(input, "waiting");
    } catch (error) {
      this.#emit(input, "failed", "crash");
      throw error;
    }
  }

  async cancel(): Promise<void> {
    const activeRun = this.#activeRun;
    this.#controller?.abort();
    await activeRun?.catch(() => undefined);
  }

  async dispose(): Promise<void> {
    await this.cancel();
    this.#listeners.clear();
  }

  onEvent(
    listener: (event: LocalFrontierParticipantEvent) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(
    input: LocalFrontierTurnInput,
    status: LocalFrontierParticipantEvent["status"],
    kind: LocalFrontierParticipantEvent["kind"] = "status",
  ): void {
    const event: LocalFrontierParticipantEvent = {
      id: `${input.turnId}.${kind}.${status ?? "unknown"}`,
      participantId: this.participantId,
      permission: input.permission,
      ...(input.generation === undefined
        ? {}
        : { generation: input.generation }),
      kind,
      ...(status === undefined ? {} : { status }),
    };
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // A renderer observer cannot disrupt a provider-owned turn.
      }
    }
  }
}

/** Startup recovery is intentionally persistence-only: it never creates a CLI child. */
export function pauseRecoveredMultiFrontierRuns(
  options: {
    core?: CoreRuntimeApi;
    now?: () => string;
    reason?: MultiFrontierRecoveryReason;
  } = {},
): MultiFrontierStoredRun[] {
  const core = options.core ?? coreRuntimeApi;
  const now = options.now ?? (() => new Date().toISOString());
  const reason = options.reason ?? "main_process_restarted";
  return core
    .listMultiFrontierRuns()
    .filter((run) => !TERMINAL_PHASES.has(run.phase) && run.phase !== "paused")
    .flatMap((run) => {
      const recovered = core.recoverStoredMultiFrontierRun(
        run.collaborationId,
        {
          now: now(),
          reason,
        },
      );
      return recovered ? [recovered] : [];
    });
}

/** Persists an opaque participant session without accepting renderer state. */
export function persistMultiFrontierParticipantSessionRef(
  collaborationId: string,
  participantId: string,
  sessionRef: string,
  options: { core?: CoreRuntimeApi; now?: () => string } = {},
): MultiFrontierStoredRun | null {
  if (!sessionRef.trim()) {
    throw new Error("A participant session reference is required.");
  }
  const core = options.core ?? coreRuntimeApi;
  const now = options.now ?? (() => new Date().toISOString());
  return core.transitionStoredMultiFrontierRun(
    collaborationId,
    now(),
    (current) => {
      if (
        !current.participants.some(
          (participant) => participant.participantId === participantId,
        )
      ) {
        throw new Error("Unknown multi-frontier participant.");
      }
      return {
        ...current,
        participants: current.participants.map((participant) =>
          participant.participantId === participantId
            ? { ...participant, sessionRef }
            : participant,
        ),
      };
    },
  );
}

function toLocalState(
  run: MultiFrontierStoredRun,
): LocalFrontierCoordinatorState {
  return {
    schemaVersion: 1,
    collaborationId: run.collaborationId,
    phase: run.phase,
    participants: run.participants.map((participant) => ({
      ...participant,
      ...(participant.capabilities
        ? { capabilities: [...participant.capabilities] }
        : {}),
    })),
    driver: run.driver ? { ...run.driver } : null,
    approval: run.approval.state,
    checkpointIds: [...run.checkpointIds],
    round: run.round,
    autoContinueAfterAgreement: run.autoContinueAfterAgreement,
    ...(run.recovery
      ? {
          recovery: {
            reason: run.recovery.reason,
            resumablePhase: run.recovery.resumablePhase,
            recoveredAt: run.recovery.recoveredAt,
            ...(run.recovery.checkpointId
              ? { checkpointId: run.recovery.checkpointId }
              : {}),
          },
        }
      : {}),
  };
}

function toCoreState(
  state: LocalFrontierCoordinatorState,
  current: MultiFrontierStoredRun,
  now: string,
): MultiFrontierRunState {
  return {
    schemaVersion: 1,
    collaborationId: state.collaborationId,
    phase: state.phase,
    participants: toCoreParticipants(state.participants, current),
    driver: state.driver ? { ...state.driver } : null,
    approval: toCoreApproval(state.approval, current),
    checkpointIds: [...state.checkpointIds],
    round: state.round,
    proposalIds: [...current.proposalIds],
    reviewIds: [...current.reviewIds],
    autoContinueAfterAgreement: state.autoContinueAfterAgreement,
    ...(state.recovery
      ? {
          recovery: {
            reason: state.recovery.reason,
            resumablePhase: state.recovery.resumablePhase,
            recoveredAt:
              state.recovery.recoveredAt ??
              (current.recovery?.reason === state.recovery.reason &&
              current.recovery.resumablePhase === state.recovery.resumablePhase
                ? current.recovery.recoveredAt
                : now),
            ...(state.recovery.checkpointId
              ? { checkpointId: state.recovery.checkpointId }
              : current.recovery?.checkpointId
                ? { checkpointId: current.recovery.checkpointId }
                : {}),
          },
        }
      : {}),
  };
}

function toCoreParticipants(
  participants: LocalFrontierCoordinatorState["participants"],
  current?: MultiFrontierStoredRun,
): MultiFrontierRunState["participants"] {
  return participants.map((participant) => {
    const persisted = current?.participants.find(
      (candidate) => candidate.participantId === participant.participantId,
    );
    // Session values advance only through persistMultiFrontierParticipantSessionRef.
    const sessionRef = persisted?.sessionRef ?? participant.sessionRef;
    return {
      ...participant,
      ...(participant.capabilities
        ? { capabilities: [...participant.capabilities] }
        : {}),
      ...(sessionRef ? { sessionRef } : {}),
    };
  });
}

function toCoreApproval(
  state: LocalFrontierCoordinatorState["approval"],
  current?: MultiFrontierStoredRun,
): MultiFrontierRunState["approval"] {
  return {
    state,
    ...(current?.approval.proposalId
      ? { proposalId: current.approval.proposalId }
      : {}),
    ...(current?.approval.reviewPacketId
      ? { reviewPacketId: current.approval.reviewPacketId }
      : {}),
  };
}

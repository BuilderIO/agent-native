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
import {
  MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES,
  redactMultiFrontierSensitiveText,
} from "../../shared/multi-frontier-ipc.js";
import type {
  LocalFrontierCoordinatorState,
  LocalFrontierCoordinatorStore,
  LocalFrontierParticipant,
  LocalFrontierParticipantEvent,
  LocalFrontierSessionInput,
  LocalFrontierTurnInput,
  LocalFrontierTurnResult,
} from "./multi-frontier-coordinator.js";

const TERMINAL_PHASES = new Set(["completed", "failed", "canceled"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const FINDING_CATEGORIES = new Set([
  "reversible_technical",
  "intent_or_scope",
  "destructive_action",
  "security_or_privacy",
  "outward_effect",
  "meaningful_cost_expansion",
  "irreversible_architecture",
]);
const FINDING_DISPOSITIONS = new Set(["addressed", "rejected", "deferred"]);

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
  readonly #workspaceId: string | undefined;

  constructor(
    options: {
      core?: CoreRuntimeApi;
      now?: () => string;
      workspaceId?: string;
    } = {},
  ) {
    this.#core = options.core ?? coreRuntimeApi;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#workspaceId = options.workspaceId;
  }

  create(state: LocalFrontierCoordinatorState): void {
    this.#core.createMultiFrontierRun({
      collaborationId: state.collaborationId,
      ...(this.#workspaceId ? { workspaceId: this.#workspaceId } : {}),
      phase: state.phase,
      participants: toCoreParticipants(state.participants),
      approval: toCoreApproval(state),
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
  #activeRun: Promise<LocalFrontierTurnResult> | null = null;
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

  async runTurn(
    input: LocalFrontierTurnInput,
  ): Promise<LocalFrontierTurnResult> {
    const controller = new AbortController();
    this.#controller = controller;
    this.#emit(input, "running");
    const activeRun = this.#runTurn(input, controller);
    this.#activeRun = activeRun;
    try {
      return await activeRun;
    } finally {
      if (this.#activeRun === activeRun) this.#activeRun = null;
      if (this.#controller === controller) this.#controller = null;
    }
  }

  async #runTurn(
    input: LocalFrontierTurnInput,
    controller: AbortController,
  ): Promise<LocalFrontierTurnResult> {
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
      return turnResultFromProviderEvents(result.events, "Codex");
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
  #activeRun: Promise<LocalFrontierTurnResult> | null = null;
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

  async runTurn(
    input: LocalFrontierTurnInput,
  ): Promise<LocalFrontierTurnResult> {
    const controller = new AbortController();
    this.#controller = controller;
    this.#emit(input, "running");
    const activeRun = this.#runTurn(input, controller);
    this.#activeRun = activeRun;
    try {
      return await activeRun;
    } finally {
      if (this.#activeRun === activeRun) this.#activeRun = null;
      if (this.#controller === controller) this.#controller = null;
    }
  }

  async #runTurn(
    input: LocalFrontierTurnInput,
    controller: AbortController,
  ): Promise<LocalFrontierTurnResult> {
    try {
      const result = await this.#run({
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
      return turnResultFromProviderEvents(result.events, "Claude");
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
    ...(run.approval.proposalId
      ? { currentSynthesisArtifactId: run.approval.proposalId }
      : {}),
    ...(run.approval.state === "approved" && run.approval.proposalId
      ? { approvedSynthesisArtifactId: run.approval.proposalId }
      : {}),
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
    ...(current.workspaceId ? { workspaceId: current.workspaceId } : {}),
    phase: state.phase,
    participants: toCoreParticipants(state.participants, current),
    driver: state.driver ? { ...state.driver } : null,
    approval: toCoreApproval(state, current),
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
  state: LocalFrontierCoordinatorState,
  current?: MultiFrontierStoredRun,
): MultiFrontierRunState["approval"] {
  const synthesisArtifactId =
    state.approvedSynthesisArtifactId ??
    state.currentSynthesisArtifactId ??
    current?.approval.proposalId;
  return {
    state: state.approval,
    ...(synthesisArtifactId ? { proposalId: synthesisArtifactId } : {}),
    ...(current?.approval.reviewPacketId
      ? { reviewPacketId: current.approval.reviewPacketId }
      : {}),
  };
}

function turnResultFromProviderEvents(
  events: readonly unknown[],
  provider: string,
): LocalFrontierTurnResult {
  const tests = verifiedTestEvidenceFromProviderEvents(events);
  for (const event of [...events].reverse()) {
    const text = resultTextFromEvent(event);
    if (!text) continue;
    const structured = parseStructuredTurnResult(text);
    if (structured) {
      return boundRuntimeTurnResult({
        ...structured,
        ...(tests.length > 0 ? { tests } : {}),
      });
    }
    return {
      text: boundRuntimeText(text),
      ...(tests.length > 0 ? { tests } : {}),
    };
  }
  return {
    text: boundRuntimeText(`${provider} completed the requested turn.`),
    ...(tests.length > 0 ? { tests } : {}),
  };
}

function verifiedTestEvidenceFromProviderEvents(
  events: readonly unknown[],
): NonNullable<LocalFrontierTurnResult["tests"]> {
  return events
    .flatMap((event) => {
      const envelope = optionalRecord(event);
      const commandEvent = optionalRecord(envelope?.item) ?? envelope;
      if (!commandEvent || commandEvent.type !== "command_execution") return [];
      const command = optionalString(commandEvent.command);
      const exitCode = commandEvent.exit_code;
      if (!command || typeof exitCode !== "number") return [];
      const runner = testRunnerFromCommand(command);
      if (!runner) return [];
      const output = optionalString(
        commandEvent.aggregated_output ?? commandEvent.output,
      );
      const noTests = output
        ? /\b(?:no tests?(?: found| collected)?|0 tests?\b|0 passed\b)/i.test(
            output,
          )
        : false;
      const status: "passed" | "failed" =
        exitCode === 0 && !noTests ? "passed" : "failed";
      const safeOutput = output
        ? boundRuntimeText(redactMultiFrontierSensitiveText(output))
        : undefined;
      return [
        {
          name: `${runner} test command`,
          status,
          evidence: boundRuntimeText(
            `${runner} exited ${exitCode}.${safeOutput ? ` ${safeOutput}` : ""}`,
          ),
        },
      ];
    })
    .slice(-8);
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function testRunnerFromCommand(command: string): string | null {
  const normalized = command
    .trim()
    .replace(
      /^(?:\/usr\/bin\/env\s+)?(?:\/bin\/(?:zsh|bash|sh)\s+-lc\s+)?["']?/,
      "",
    )
    .replace(/["']$/, "")
    .trim();
  if (/[;&|`\r\n]|\$\(/.test(normalized)) return null;
  const runners: Array<[RegExp, string]> = [
    [/^(?:corepack\s+)?pnpm\b[^\n;&|]*\b(?:test|vitest)\b/i, "pnpm"],
    [/^npm\b[^\n;&|]*\b(?:test|test:|run\s+test)\b/i, "npm"],
    [/^(?:yarn|bun)\b[^\n;&|]*\btest\b/i, "JavaScript"],
    [/^(?:npx\s+)?(?:vitest|jest)\b/i, "JavaScript"],
    [/^(?:python\s+-m\s+)?pytest\b/i, "pytest"],
    [/^cargo\s+test\b/i, "Cargo"],
    [/^go\s+test\b/i, "Go"],
    [/^swift\s+test\b/i, "Swift"],
    [/^xcodebuild\b[^\n;&|]*\btest\b/i, "Xcode"],
    [/^dotnet\s+test\b/i, ".NET"],
    [/^(?:mvn|gradle|\.\/gradlew)\b[^\n;&|]*\btest\b/i, "JVM"],
  ];
  return runners.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function resultTextFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  for (const key of ["result", "text", "summary"] as const) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key];
    }
  }
  const message = record.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" && content.trim() ? content : null;
}

function parseStructuredTurnResult(
  text: string,
): LocalFrontierTurnResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("The provider returned malformed structured turn output.");
  }
  const result = requireRecord(parsed, "structured turn result");
  assertExactKeys(result, [
    "text",
    "agreed",
    "requiresRevision",
    "findings",
    "dispositions",
    "reversibleResolution",
  ]);
  if (typeof result.text !== "string" || !result.text.trim()) {
    throw new Error("Structured turn output requires text.");
  }
  if (result.agreed !== undefined && typeof result.agreed !== "boolean") {
    throw new Error("Structured turn agreement is invalid.");
  }
  if (
    result.requiresRevision !== undefined &&
    typeof result.requiresRevision !== "boolean"
  ) {
    throw new Error("Structured turn revision state is invalid.");
  }
  return {
    text: boundRuntimeText(result.text),
    ...(typeof result.agreed === "boolean" ? { agreed: result.agreed } : {}),
    ...(typeof result.requiresRevision === "boolean"
      ? { requiresRevision: result.requiresRevision }
      : {}),
    ...(result.findings === undefined
      ? {}
      : { findings: parseFindings(result.findings) }),
    ...(result.dispositions === undefined
      ? {}
      : { dispositions: parseDispositions(result.dispositions) }),
    ...(result.reversibleResolution === undefined
      ? {}
      : {
          reversibleResolution: parseReversibleResolution(
            result.reversibleResolution,
          ),
        }),
  };
}

function boundRuntimeTurnResult(
  result: LocalFrontierTurnResult,
): LocalFrontierTurnResult {
  return { ...result, text: boundRuntimeText(result.text) };
}

function boundRuntimeText(value: string): string {
  const text = value.trim();
  if (!text) throw new Error("A participant turn result must include text.");
  return Buffer.from(text, "utf8")
    .subarray(0, MULTI_FRONTIER_IPC_MAX_ARTIFACT_SUMMARY_BYTES)
    .toString("utf8");
}

function parseFindings(
  value: unknown,
): NonNullable<LocalFrontierTurnResult["findings"]> {
  if (!Array.isArray(value) || value.length > 40) {
    throw new Error("Structured turn findings are invalid.");
  }
  return value.map((item) => {
    const finding = requireRecord(item, "structured finding");
    assertExactKeys(finding, ["id", "category", "summary"]);
    if (
      typeof finding.id !== "string" ||
      typeof finding.category !== "string" ||
      typeof finding.summary !== "string" ||
      !SAFE_ID.test(finding.id) ||
      !FINDING_CATEGORIES.has(finding.category)
    ) {
      throw new Error("Structured turn finding is invalid.");
    }
    return {
      id: finding.id,
      category: finding.category as NonNullable<
        LocalFrontierTurnResult["findings"]
      >[number]["category"],
      summary: boundRuntimeText(finding.summary),
    };
  });
}

function parseDispositions(
  value: unknown,
): NonNullable<LocalFrontierTurnResult["dispositions"]> {
  if (!Array.isArray(value) || value.length > 40) {
    throw new Error("Structured turn dispositions are invalid.");
  }
  return value.map((item) => {
    const disposition = requireRecord(item, "structured disposition");
    assertExactKeys(disposition, ["findingId", "disposition", "reason"]);
    if (
      typeof disposition.findingId !== "string" ||
      typeof disposition.disposition !== "string" ||
      typeof disposition.reason !== "string" ||
      !SAFE_ID.test(disposition.findingId) ||
      !FINDING_DISPOSITIONS.has(disposition.disposition)
    ) {
      throw new Error("Structured turn disposition is invalid.");
    }
    return {
      findingId: disposition.findingId,
      disposition: disposition.disposition as NonNullable<
        LocalFrontierTurnResult["dispositions"]
      >[number]["disposition"],
      reason: boundRuntimeText(disposition.reason),
    };
  });
}

function parseReversibleResolution(
  value: unknown,
): NonNullable<LocalFrontierTurnResult["reversibleResolution"]> {
  const resolution = requireRecord(value, "reversible resolution");
  assertExactKeys(resolution, [
    "alternatives",
    "comparator",
    "selected",
    "reversibility",
  ]);
  if (
    !Array.isArray(resolution.alternatives) ||
    resolution.alternatives.length === 0 ||
    resolution.alternatives.length > 8 ||
    resolution.alternatives.some((item) => typeof item !== "string") ||
    typeof resolution.comparator !== "string" ||
    typeof resolution.selected !== "string" ||
    typeof resolution.reversibility !== "string"
  ) {
    throw new Error("Structured reversible resolution is invalid.");
  }
  return {
    alternatives: resolution.alternatives.map((item) => boundRuntimeText(item)),
    comparator: boundRuntimeText(resolution.comparator),
    selected: boundRuntimeText(resolution.selected),
    reversibility: boundRuntimeText(resolution.reversibility),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The ${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new Error("Structured turn output includes unsupported fields.");
  }
}

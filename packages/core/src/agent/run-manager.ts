import { getAppConfig } from "../app-config/index.js";
import {
  BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
  BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
  RUN_NO_PROGRESS_HARD_TIMEOUT_MS,
} from "../app-config/run-lifecycle-invariants.js";
import { captureError } from "../server/capture-error.js";
import {
  isLlmCredentialError,
  LLM_MISSING_CREDENTIALS_ERROR_CODE,
  LLM_MISSING_CREDENTIALS_MESSAGE,
} from "./engine/credential-errors.js";
import {
  classifyTerminalErrorCode,
  describeErrorWithCauses,
  isProviderConnectionError,
} from "./engine/error-detail.js";
import { EngineError } from "./engine/types.js";
import type { EngineRequestShape } from "./engine/types.js";
import {
  insertRun,
  insertRunEvent,
  updateRunStatusIfRunning,
  markRunAborted,
  getRunAbortState,
  getRunStatus,
  getRunEventsSince,
  getCurrentTurnRunEventsForThread,
  getRunById,
  getRunByThread,
  getRunTurnRef,
  markTurnAborted,
  cleanupOldRuns,
  updateRunHeartbeat,
  bumpRunProgress,
  setRunInFlightMarker,
  reapIfStale,
  reapUnclaimedBackgroundRun,
  shouldRedispatchUnclaimedBackgroundRun,
  reconcileTerminalRunFromEvents,
  ensureTerminalRunEvent,
  getLastTerminalRunEvent,
  resolveErroredRunTerminalEvent,
  setRunError,
  setRunTerminalReason,
  persistRunCheckpointEvent,
  recordRunDiagnostic,
  RUN_DIAG_STAGE,
  terminalEventForAbortReason,
  RUN_RECORD_MISSING_ERROR_EVENT,
  RUN_RECORD_MISSING_GRACE_MS,
  RUN_TERMINAL_LOOKUP_FAILED_ERROR_EVENT,
  UNKNOWN_RUN_STATUS_ERROR_EVENT,
} from "./run-store.js";
import { isContinuationTerminalReason } from "./types.js";
import type { AgentChatEvent, RunEvent, RunStatus } from "./types.js";

export interface ActiveRun {
  runId: string;
  threadId: string;
  parentId?: string | null;
  turnId: string;
  events: RunEvent[];
  status: RunStatus;
  subscribers: Set<(event: RunEvent) => void>;
  abort: AbortController;
  abortReason?: string;
  continuationTerminalEvent?: Extract<
    AgentChatEvent,
    { type: "auto_continue" } | { type: "error" }
  >;
  startedAt: number;
}

export interface StartedRun extends ActiveRun {
  finalized: Promise<void>;
}

const activeRuns = new Map<string, ActiveRun>();
const threadToRun = new Map<string, string>();

const CLEANUP_DELAY_MS = 5 * 60 * 1000;

export const DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS = 40_000;

export const HOSTED_SOFT_TIMEOUT_CEILING_MS = 40_000;


export const DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS =
  RUN_NO_PROGRESS_HARD_TIMEOUT_MS;

const FOREGROUND_NO_PROGRESS_SOFT_TIMEOUT_FRACTION = 0.75;

const RUN_TOOL_TIMEOUT_HEADROOM_MS = 5_000;

export function resolveRunToolTimeoutCeilingMs(softTimeoutMs: number): number {
  if (!(softTimeoutMs > 0)) return 0;
  return Math.max(1_000, softTimeoutMs - RUN_TOOL_TIMEOUT_HEADROOM_MS);
}

export function resolveRunNoProgressTimeoutMs(params: {
  softTimeoutMs: number;
  backgroundFunction?: boolean;
  overrideMs?: number;
  backgroundOverrideMs?: number;
}): number {
  const { softTimeoutMs, backgroundFunction } = params;
  const explicit = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : undefined;

  const configured = getAppConfig().agent;

  const budgetCeilingMs = Math.floor(
    softTimeoutMs * FOREGROUND_NO_PROGRESS_SOFT_TIMEOUT_FRACTION,
  );

  if (backgroundFunction === true) {
    const override =
      explicit(params.backgroundOverrideMs) ?? explicit(params.overrideMs);
    if (!(softTimeoutMs > 0)) return override ?? 0;
    if (override !== undefined) {
      return override === 0 ? 0 : Math.min(override, budgetCeilingMs);
    }
    return Math.min(configured.backgroundNoProgressTimeoutMs, budgetCeilingMs);
  }

  const override = explicit(params.overrideMs);
  if (!(softTimeoutMs > 0)) return override ?? 0;

  const ceiling = Math.min(RUN_NO_PROGRESS_HARD_TIMEOUT_MS, budgetCeilingMs);
  if (override === undefined) return ceiling;
  return override === 0 ? 0 : Math.min(override, ceiling);
}

function inFlightWorkDelta(event: AgentChatEvent): -1 | 0 | 1 {
  switch (event.type) {
    case "tool_start":
      return 1;
    case "tool_done":
      return -1;
    case "agent_call":
    case "model_stream":
      return event.status === "start" ? 1 : -1;
    default:
      return 0;
  }
}

export const DEFAULT_COMPLETED_RUN_RETENTION_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_ERRORED_RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const TERMINAL_RUN_RECONNECT_WINDOW_MS = 20 * 60 * 1000;

export const SQL_SUBSCRIPTION_ACTIVE_POLL_MS = 125;

export const SQL_SUBSCRIPTION_IDLE_POLL_MS = 500;

export const SQL_SUBSCRIPTION_ACTIVE_GRACE_MS = 2_000;

export const SQL_SUBSCRIPTION_STATUS_POLL_MS = 500;

/**
 * Consecutive empty polls before the IDLE cadence starts decaying toward
 * `SQL_SUBSCRIPTION_IDLE_MAX_POLL_MS`.
 *
 * The active grace already covers a streaming producer, so decay only ever
 * applies to a subscriber watching a run that is producing nothing: a long tool
 * call, a slow first token, or a wedged producer. Those cost one poll per
 * 500ms each, forever, per subscriber — the single largest source of idle
 * `agent_run_events` reads.
 */
export const SQL_SUBSCRIPTION_IDLE_DECAY_AFTER_POLLS = 4;

export const SQL_SUBSCRIPTION_IDLE_MAX_POLL_MS = 2_000;

export const SQL_SUBSCRIPTION_REAP_POLL_MS = 5_000;

export const SQL_SUBSCRIPTION_RETRY_BASE_MS = 250;

export const IN_MEMORY_TERMINAL_SETTLE_MS = 5_000;

export const SQL_SUBSCRIPTION_MAX_CONSECUTIVE_FAILURES = 4;

export const SQL_SUBSCRIPTION_RETRY_MAX_MS = 2_000;

export function resolveSqlSubscriptionPollMs(
  now: number,
  activePollUntil: number,
  consecutiveEmptyPolls = 0,
): number {
  if (now < activePollUntil) return SQL_SUBSCRIPTION_ACTIVE_POLL_MS;
  const steps = Math.min(
    16,
    Math.max(
      0,
      Math.floor(consecutiveEmptyPolls) -
        SQL_SUBSCRIPTION_IDLE_DECAY_AFTER_POLLS,
    ),
  );
  return Math.min(
    SQL_SUBSCRIPTION_IDLE_MAX_POLL_MS,
    SQL_SUBSCRIPTION_IDLE_POLL_MS * 2 ** steps,
  );
}

export function nextSqlSubscriptionEmptyPolls(
  current: number,
  hadEvents: boolean,
  now: number,
  activePollUntil: number,
): number {
  if (hadEvents) return 0;
  if (now < activePollUntil) return current;
  return current + 1;
}

export function resolveSqlSubscriptionRetryMs(
  consecutiveFailures: number,
): number {
  const retryIndex = Math.max(0, Math.floor(consecutiveFailures) - 1);
  return Math.min(
    SQL_SUBSCRIPTION_RETRY_MAX_MS,
    SQL_SUBSCRIPTION_RETRY_BASE_MS * 2 ** retryIndex,
  );
}

const PROVIDER_RATE_LIMITED_ERROR_CODE = "provider_rate_limited";
const PROVIDER_NETWORK_ERROR_CODE = "provider_network_error";

function isPreparingActionActivityEvent(event: AgentChatEvent): boolean {
  if (event.type !== "activity") return false;
  const label = event.label.trim().toLowerCase();
  return label.startsWith("preparing ") && label.includes(" action");
}

function getRunErrorMessage(err: unknown): string {
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof err.message === "string" &&
    err.message.trim().length > 0
  ) {
    return err.message;
  }
  return "Unknown error";
}

function getRunErrorCode(err: unknown): string | undefined {
  if (err instanceof EngineError) {
    if (err.errorCode) return err.errorCode;
    if (err.statusCode === 429) return PROVIDER_RATE_LIMITED_ERROR_CODE;
  }
  if (isProviderConnectionError(err)) return PROVIDER_NETWORK_ERROR_CODE;
  return classifyTerminalErrorCode(describeErrorWithCauses(err));
}

export function engineRequestShapeTags(
  shape: EngineRequestShape | undefined,
): Record<string, string> {
  if (!shape) return {};
  return {
    engineModel: shape.model,
    enginePayloadBytes: String(shape.payloadBytes),
    engineToolCount: String(shape.toolCount),
    engineMessageCount: String(shape.messageCount),
  };
}

function getEngineRunErrorDetails(err: EngineError): string | undefined {
  if (err.statusCode === 429) return err.message;
  return undefined;
}

function shouldCaptureRunError(err: unknown): boolean {
  const errorCode = getRunErrorCode(err);
  if (isLlmCredentialError(err, errorCode)) return false;
  if (
    err instanceof EngineError &&
    (err.statusCode === 401 || err.statusCode === 403)
  ) {
    return false;
  }
  if (!(err instanceof Error)) return true;
  if (/^40[13] status code\b/i.test(err.message)) return false;
  if (isProviderConnectionError(err)) return false;
  if (!errorCode) return true;
  const normalizedCode = errorCode.toLowerCase();
  return (
    !normalizedCode.startsWith("credits-limit") &&
    normalizedCode !== "builder_gateway_network_error" &&
    normalizedCode !== "builder_gateway_stream_ended" &&
    normalizedCode !== PROVIDER_NETWORK_ERROR_CODE &&
    normalizedCode !== "provider_rate_limited" &&
    normalizedCode !== "rate_limit_exceeded"
  );
}

export interface StartRunOptions {
  waitUntil?: (promise: Promise<unknown>) => void;
  softTimeoutMs?: number;
  useHostedSoftTimeoutDefault?: boolean;
  turnId?: string;
  parentId?: string | null;
  backgroundFunction?: boolean;
  noProgressTimeoutMs?: number;
  backgroundNoProgressTimeoutMs?: number;
  dispatchMode?: "foreground" | "foreground-self-chain" | "background";
  runRowAlreadyInserted?: boolean;
  model?: string;
  engineName?: string;
  userId?: string;
  attemptCount?: number;
  recoverChunkBoundaries?: boolean;
}

export interface RunChunkControl {
  readonly turnSignal: AbortSignal;
  readonly chunkSignal: AbortSignal;
  chunkBoundaryReason(): string | null;
  beginChunk(): AbortSignal;
}

export interface ResolveRunSoftTimeoutOptions {
  useHostedDefault?: boolean;
  backgroundFunction?: boolean;
}

export function isHostedRuntime(): boolean {
  if (process.env.NETLIFY_LOCAL === "true") return false;
  if (process.env.NETLIFY === "false") return false;
  if (process.env.SITE_ID) return true; // guard:allow-env-credential -- Netlify's read-only public site identifier is a runtime host marker, not a user credential.
  if (
    process.env.NETLIFY &&
    process.env.NETLIFY !== "false" &&
    process.env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  if (
    process.env.AWS_LAMBDA_FUNCTION_NAME &&
    process.env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  return Boolean(
    process.env.CF_PAGES ||
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME ||
    process.env.K_SERVICE,
  );
}

export function resolveRunSoftTimeoutMs(
  overrideMs?: number,
  options?: ResolveRunSoftTimeoutOptions,
): number {
  const hosted = isHostedRuntime();
  const background = options?.backgroundFunction === true;
  const ceiling = background
    ? BACKGROUND_SOFT_TIMEOUT_CEILING_MS
    : HOSTED_SOFT_TIMEOUT_CEILING_MS;
  const clampHosted = (ms: number): number =>
    hosted && ms > ceiling ? ceiling : ms;

  if (typeof overrideMs === "number" && Number.isFinite(overrideMs)) {
    return clampHosted(Math.max(0, overrideMs));
  }
  const configured = getAppConfig().agent.runSoftTimeoutMs;
  if (configured !== undefined) return clampHosted(configured);
  if (background) {
    return hosted ? BACKGROUND_SOFT_TIMEOUT_CEILING_MS : 0;
  }
  return options?.useHostedDefault && hosted
    ? DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS
    : 0;
}

export function resolveCompletedRunRetentionMs(): number {
  return (
    getAppConfig().agent.completedRunRetentionMs ??
    DEFAULT_COMPLETED_RUN_RETENTION_MS
  );
}

export function resolveErroredRunRetentionMs(): number {
  return (
    getAppConfig().agent.erroredRunRetentionMs ??
    DEFAULT_ERRORED_RUN_RETENTION_MS
  );
}

export function resolveBackgroundRunHardTimeoutMs(): number {
  return getAppConfig().agent.backgroundRunHardTimeoutMs;
}

/**
 * Chunk budget for a background automation, derived from the runner's OWN hard
 * abort rather than from the durable-chat background ceiling.
 *
 * The shipped build took the 13-minute chat ceiling for a path whose process is
 * killed at 10 minutes, which made the recoverable soft-timeout boundary dead
 * code and left the terminal no-progress backstop as the only boundary an
 * automation could ever reach. Deriving from the hard abort keeps
 * `soft timeout < hard abort` true by construction; the invariant check asserts
 * the headroom still fits.
 */
export function resolveBackgroundAutomationSoftTimeoutMs(
  overrideMs?: number,
): number {
  const budget = Math.max(
    1_000,
    resolveBackgroundRunHardTimeoutMs() -
      BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
  );
  const resolved = resolveRunSoftTimeoutMs(overrideMs, {
    useHostedDefault: true,
    backgroundFunction: true,
  });
  return resolved > 0 ? Math.min(resolved, budget) : 0;
}

function isTerminalRunEvent(event: AgentChatEvent): boolean {
  return (
    event.type === "done" ||
    event.type === "error" ||
    event.type === "missing_api_key" ||
    event.type === "loop_limit" ||
    event.type === "auto_continue"
  );
}

/**
 * A tool result with no later assistant text is an unfinished turn, not a
 * successful terminal response. Keep this predicate beside the run-manager's
 * terminal synthesis so the run-manager and production continuation paths use
 * the same boundary evidence.
 *
 * A FAILED tool result counts too. Skipping it made the verdict depend on
 * whether some earlier call in the same turn happened to succeed: a turn ending
 * on `resources` ok then `web_request` failed continued, while the same turn
 * with both failing terminated as a plain `done`. The client can only render
 * "stopped after these actions ... without sending a final message" for that,
 * so the tool's real error — an expired handoff URL, a missing credential —
 * never reached the user, and typing "continue" by hand was the only way to see
 * it. The model has not read the error yet at this point, which makes a failed
 * tail strictly more unfinished than a successful one.
 */
export function endsAfterToolResultWithoutAssistantFinal(
  run: ActiveRun,
): boolean {
  let toolResultAfterLastAssistantText = false;
  for (const { event } of run.events) {
    if (event.type === "text" && event.text.trim().length > 0) {
      toolResultAfterLastAssistantText = false;
      continue;
    }
    if (event.type === "tool_done") {
      toolResultAfterLastAssistantText =
        event.isError === true ||
        (event.chatUI === undefined && event.mcpApp === undefined);
      continue;
    }
    if (
      event.type === "clear" ||
      event.type === "error" ||
      event.type === "missing_api_key" ||
      event.type === "auto_continue" ||
      event.type === "loop_limit"
    ) {
      toolResultAfterLastAssistantText = false;
    }
  }
  return toolResultAfterLastAssistantText;
}

export function endsDuringActionPreparation(run: ActiveRun): boolean {
  let preparingAction = false;
  for (const { event } of run.events) {
    if (
      isPreparingActionActivityEvent(event) ||
      event.type === "tool_input_start" ||
      event.type === "tool_input_delta"
    ) {
      preparingAction = true;
      continue;
    }
    if (
      (event.type === "text" && event.text.trim().length > 0) ||
      event.type === "tool_start" ||
      event.type === "tool_done" ||
      event.type === "approval_required" ||
      event.type === "clear" ||
      event.type === "error" ||
      event.type === "missing_api_key" ||
      event.type === "auto_continue" ||
      event.type === "loop_limit"
    ) {
      preparingAction = false;
    }
  }
  return preparingAction;
}

function terminalEventForcesErroredStatus(event: AgentChatEvent | null) {
  return event?.type === "error" || event?.type === "missing_api_key";
}

function terminalReasonForRun(
  finalStatus: "completed" | "errored" | "aborted",
  terminalEvent: AgentChatEvent | null,
  abortReason: string | undefined,
  completionError: unknown,
): string {
  if (
    finalStatus !== "aborted" &&
    completionError &&
    terminalEvent?.type === "auto_continue"
  ) {
    return "completion_error";
  }
  if (terminalEvent?.type === "auto_continue") {
    return terminalEvent.reason || "auto_continue";
  }
  if (terminalEvent?.type === "loop_limit") return "loop_limit";
  if (terminalEvent?.type === "missing_api_key") return "missing_api_key";
  if (terminalEvent?.type === "error") {
    return `error:${terminalEvent.errorCode || "unknown"}`;
  }
  if (finalStatus === "aborted") return `aborted:${abortReason ?? "user"}`;
  if (completionError) return "completion_error";
  if (finalStatus === "errored") return "error:unknown";
  return "done";
}

const MAX_RUN_ERROR_DETAIL_LENGTH = 500;

function emitRunBoundaryTrackingEvent(args: {
  runId: string;
  threadId: string;
  reason: string;
  recovered: boolean;
  boundaryIndex: number;
  dispatchMode?: string;
  model?: string;
  engineName?: string;
  userId?: string;
}): void {
  const properties: Record<string, unknown> = {
    source: "agent_run_manager",
    run_id: args.runId,
    thread_id: args.threadId,
    reason: args.reason,
    recovered: args.recovered,
    boundary_index: args.boundaryIndex,
    dispatch_mode: args.dispatchMode,
    model: args.model,
    engine: args.engineName,
  };
  for (const key of Object.keys(properties)) {
    if (properties[key] === undefined) delete properties[key];
  }
  try {
    void Promise.all([
      import("../tracking/registry.js"),
      import("../observability/tracking-identity.js"),
    ])
      .then(([{ track }, { trackingIdentityProperties }]) => {
        track(
          "agent_run_boundary",
          { ...properties, ...trackingIdentityProperties() },
          { userId: args.userId },
        );
      })
      .catch(() => {});
    // coercion-ok: a boundary counter must never affect the run it counts.
  } catch {
    // Tracking must never affect the agent run or its persisted status.
  }
}

function emitRunTerminalTrackingEvent(args: {
  runId: string;
  threadId: string;
  turnId: string;
  status: "completed" | "errored" | "aborted" | "truncated";
  terminalReason: string;
  errorCode?: string;
  errorDetail?: string;
  dispatchMode?: string;
  abortReason?: string;
  durationMs: number;
  model?: string;
  engineName?: string;
  userId?: string;
  attemptCount?: number;
}): void {
  const properties: Record<string, unknown> = {
    source: "agent_run_manager",
    run_id: args.runId,
    thread_id: args.threadId,
    turn_id: args.turnId,
    status: args.status,
    terminal_reason: args.terminalReason,
    error_code: args.errorCode,
    error_detail: args.errorDetail
      ? args.errorDetail.length > MAX_RUN_ERROR_DETAIL_LENGTH
        ? `${args.errorDetail.slice(0, MAX_RUN_ERROR_DETAIL_LENGTH)}…`
        : args.errorDetail
      : undefined,
    dispatch_mode: args.dispatchMode,
    abort_reason: args.abortReason,
    duration_ms: args.durationMs,
    model: args.model,
    engine: args.engineName,
    attempt_count: args.attemptCount,
  };
  for (const key of Object.keys(properties)) {
    if (properties[key] === undefined) delete properties[key];
  }

  try {
    void Promise.all([
      import("../tracking/registry.js"),
      import("../observability/tracking-identity.js"),
    ])
      .then(([{ track }, { trackingIdentityProperties }]) => {
        track(
          "agent_run_terminal",
          { ...properties, ...trackingIdentityProperties() },
          { userId: args.userId },
        );
      })
      .catch(() => {});
  } catch {
    // Tracking must never affect the agent run or its persisted status.
  }
}

function abortInMemoryRun(run: ActiveRun, reason: string = "user") {
  run.abortReason = reason;
  run.status = "aborted";
  if (threadToRun.get(run.threadId) === run.runId) {
    threadToRun.delete(run.threadId);
  }
  run.abort.abort(reason);
  const existingTerminalEvent = [...run.events]
    .reverse()
    .find((event) => isTerminalRunEvent(event.event));
  const terminalRunEvent = existingTerminalEvent ?? {
    seq: run.events.length,
    event: terminalEventForAbortReason(reason),
  };
  if (!existingTerminalEvent) {
    run.events.push(terminalRunEvent);
  }
  for (const subscriber of run.subscribers) {
    try {
      subscriber(terminalRunEvent);
    } catch {
      // ignore — subscriber is being removed below
    }
  }
  run.subscribers.clear();
}

export function startRun(
  runId: string,
  threadId: string,
  runFn: (
    send: (event: AgentChatEvent) => void,
    signal: AbortSignal,
    control: RunChunkControl,
  ) => Promise<void>,
  onComplete?: (run: ActiveRun) => void | Promise<void>,
  options?: StartRunOptions,
): StartedRun {
  const existingRunId = threadToRun.get(threadId);
  if (existingRunId) {
    abortRun(existingRunId);
  }

  const abort = new AbortController();
  const recoverChunkBoundaries = options?.recoverChunkBoundaries === true;
  let chunkAbort: AbortController | null = recoverChunkBoundaries
    ? new AbortController()
    : null;
  let chunkBoundaryReason: string | null = null;
  let chunkSoftTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let armChunkSoftTimeout: () => void = () => {};
  let recoverableRunDeadlineAt: number | null = null;
  let recoveredChunkBoundaries = 0;
  let pendingBoundary: {
    reason: "no_progress" | "run_timeout";
    diagnostic: { silentForMs?: number; lastEventType?: string };
    index: number;
  } | null = null;
  const settleBoundary = (recovered: boolean) => {
    const boundary = pendingBoundary;
    if (!boundary) return;
    pendingBoundary = null;
    recordRunBoundaryDiagnostic(
      boundary.reason,
      boundary.diagnostic,
      recovered ? "recovered" : "terminal",
    );
    emitRunBoundaryTrackingEvent({
      runId,
      threadId,
      reason: boundary.reason,
      recovered,
      boundaryIndex: boundary.index,
      dispatchMode: options?.dispatchMode,
      model: options?.model,
      engineName: options?.engineName,
      userId: options?.userId,
    });
  };
  if (chunkAbort) {
    abort.signal.addEventListener("abort", () => {
      chunkAbort?.abort(abort.signal.reason);
    });
  }
  const runControl: RunChunkControl = {
    get turnSignal() {
      return abort.signal;
    },
    get chunkSignal() {
      return chunkAbort?.signal ?? abort.signal;
    },
    chunkBoundaryReason: () => chunkBoundaryReason,
    beginChunk: () => {
      if (abort.signal.aborted || !chunkAbort) return abort.signal;
      settleBoundary(true);
      chunkBoundaryReason = null;
      if (chunkSoftTimeoutTimer) clearTimeout(chunkSoftTimeoutTimer);
      chunkAbort = new AbortController();
      armChunkSoftTimeout();
      lastRealProgressAt = Date.now();
      return chunkAbort.signal;
    },
  };
  let softTimedOut = false;
  let resolveFinalized: () => void = () => {};
  let rejectFinalized: (reason?: unknown) => void = () => {};
  const finalized = new Promise<void>((resolve, reject) => {
    resolveFinalized = resolve;
    rejectFinalized = reject;
  });
  void finalized.catch(() => {});
  const run: StartedRun = {
    runId,
    threadId,
    ...(options?.parentId !== undefined ? { parentId: options.parentId } : {}),
    turnId: options?.turnId ?? runId,
    events: [],
    status: "running",
    subscribers: new Set(),
    abort,
    startedAt: Date.now(),
    finalized,
  };

  activeRuns.set(runId, run);
  threadToRun.set(threadId, runId);

  const captureRunPersistenceError = (
    error: unknown,
    phase: "insert-run" | "insert-event",
    extra: Record<string, unknown> = {},
  ) => {
    captureError(error, {
      route: "/_agent-native/agent-chat",
      aiTraceId: runId,
      tags: {
        source: "agent-run-manager",
        phase,
        runStatus: run.status,
      },
      extra: {
        runId,
        threadId,
        eventCount: run.events.length,
        startedAt: run.startedAt,
        ...extra,
      },
      contexts: {
        agentRun: {
          runId,
          threadId,
          status: run.status,
          phase,
          eventCount: run.events.length,
          startedAt: run.startedAt,
        },
      },
    });
  };

  // final status cannot race ahead of a slow initial INSERT and then get
  const insertOptions = options?.dispatchMode
    ? { dispatchMode: options.dispatchMode }
    : undefined;
  const insertRunPromise = (
    options?.runRowAlreadyInserted
      ? Promise.resolve()
      : insertOptions
        ? insertRun(runId, threadId, options?.turnId, insertOptions)
        : insertRun(runId, threadId, options?.turnId)
  ).catch((error) => {
    captureRunPersistenceError(error, "insert-run");
  });

  let persistenceChain: Promise<void> = Promise.resolve();

  const PROGRESS_BUMP_INTERVAL_MS = 1_000;
  let lastProgressBumpAt = 0;
  let progressWriteInFlight: Promise<void> | null = null;
  let progressWriteTimer: ReturnType<typeof setTimeout> | null = null;
  let progressWritePending = false;
  let progressWriteAttempts = 0;
  let progressWriteFailures = 0;
  let consecutiveProgressWriteFailures = 0;
  const preparingActivityBytes = new Map<string, number>();
  const preparingActivityTools = new Map<string, string>();
  const preparingActivityRestartHighWater = new Map<string, number>();
  let eventPersistenceErrorCaptured = false;
  const recordProgressWriteFailure = (error: unknown, kind: string) => {
    progressWriteFailures += 1;
    consecutiveProgressWriteFailures += 1;
    if (progressWriteFailures === 1 || progressWriteFailures % 10 === 0) {
      const capturedError =
        error instanceof Error ? error : new Error(String(error));
      console.error(
        `[run-manager] durable progress write ${kind} failed`,
        runId,
        {
          attempts: progressWriteAttempts,
          failures: progressWriteFailures,
          consecutiveFailures: consecutiveProgressWriteFailures,
          eventCount: run.events.length,
        },
        capturedError,
      );
      captureError(capturedError, {
        route: "/_agent-native/agent-chat",
        tags: {
          source: "agent-run-manager",
          phase: "progress",
          kind,
          consecutiveFailures: String(consecutiveProgressWriteFailures),
        },
        aiTraceId: runId,
        extra: {
          runId,
          threadId,
          attempts: progressWriteAttempts,
          failures: progressWriteFailures,
          eventCount: run.events.length,
        },
      });
    }
  };
  const writeProgress = async (): Promise<void> => {
    let updated = await bumpRunProgress(runId);
    if (updated === false) {
      await insertRunPromise;
      updated = await bumpRunProgress(runId);
    }
    if (updated === false) {
      if (run.status !== "running") return;
      recordProgressWriteFailure(
        new Error("Durable progress update affected no running run row"),
        "no-row",
      );
      progressWritePending = true;
      return;
    }
    consecutiveProgressWriteFailures = 0;
  };
  function startProgressWrite(): void {
    if (
      !progressWritePending ||
      progressWriteInFlight ||
      run.status !== "running"
    ) {
      return;
    }
    progressWritePending = false;
    lastProgressBumpAt = Date.now();
    progressWriteAttempts += 1;
    const write = writeProgress()
      .catch((error: unknown) => {
        recordProgressWriteFailure(error, "error");
        progressWritePending = true;
      })
      .finally(() => {
        progressWriteInFlight = null;
        scheduleProgressWrite();
      });
    progressWriteInFlight = write;
  }
  function scheduleProgressWrite(): void {
    if (
      !progressWritePending ||
      progressWriteInFlight ||
      progressWriteTimer ||
      run.status !== "running"
    ) {
      return;
    }
    const delayMs = Math.max(
      0,
      lastProgressBumpAt + PROGRESS_BUMP_INTERVAL_MS - Date.now(),
    );
    if (delayMs === 0) {
      startProgressWrite();
      return;
    }
    progressWriteTimer = setTimeout(() => {
      progressWriteTimer = null;
      startProgressWrite();
    }, delayMs);
  }
  const bumpProgressIfDue = () => {
    progressWritePending = true;
    scheduleProgressWrite();
  };
  const shouldBumpProgressForEvent = (event: AgentChatEvent): boolean => {
    if (event.type === "stream_keepalive") return false;
    if (event.type === "clear") {
      for (const [key, bytes] of preparingActivityBytes) {
        const toolKey = preparingActivityTools.get(key) ?? key;
        preparingActivityRestartHighWater.set(
          toolKey,
          Math.max(preparingActivityRestartHighWater.get(toolKey) ?? 0, bytes),
        );
      }
      preparingActivityBytes.clear();
      preparingActivityTools.clear();
      return false;
    }
    if (event.type === "activity" && isPreparingActionActivityEvent(event)) {
      const toolKey = event.tool?.trim() || event.label.trim();
      const activityKey = `${toolKey}:${event.id?.trim() || "no-id"}`;
      const progressBytes =
        typeof event.progressBytes === "number" &&
        Number.isFinite(event.progressBytes) &&
        event.progressBytes >= 0
          ? Math.floor(event.progressBytes)
          : undefined;
      if (progressBytes === undefined) return false;
      const restartHighWater =
        preparingActivityRestartHighWater.get(toolKey) ?? 0;
      if (!event.id?.trim()) {
        if (progressBytes <= restartHighWater) return false;
        preparingActivityTools.set(activityKey, toolKey);
        preparingActivityBytes.set(
          activityKey,
          Math.max(preparingActivityBytes.get(activityKey) ?? 0, progressBytes),
        );
        if (preparingActivityRestartHighWater.has(toolKey)) {
          preparingActivityRestartHighWater.set(
            toolKey,
            Math.max(restartHighWater, progressBytes),
          );
        }
        return progressBytes > 0;
      }
      const previousBytes = Math.max(
        preparingActivityBytes.get(activityKey) ?? 0,
        restartHighWater,
      );
      if (
        !preparingActivityBytes.has(activityKey) &&
        progressBytes === 0 &&
        !preparingActivityRestartHighWater.has(toolKey)
      ) {
        preparingActivityTools.set(activityKey, toolKey);
        preparingActivityBytes.set(activityKey, 0);
        preparingActivityRestartHighWater.set(toolKey, 0);
        return true;
      }
      if (progressBytes <= previousBytes) {
        preparingActivityTools.set(activityKey, toolKey);
        preparingActivityBytes.set(
          activityKey,
          Math.max(previousBytes, progressBytes),
        );
        return false;
      }
      preparingActivityTools.set(activityKey, toolKey);
      preparingActivityBytes.set(activityKey, progressBytes);
      if (preparingActivityRestartHighWater.has(toolKey)) {
        preparingActivityRestartHighWater.set(
          toolKey,
          Math.max(
            preparingActivityRestartHighWater.get(toolKey) ?? 0,
            progressBytes,
          ),
        );
      }
      return true;
    }
    if (event.type === "tool_start" || event.type === "tool_done") {
      preparingActivityBytes.clear();
      preparingActivityTools.clear();
      preparingActivityRestartHighWater.clear();
    }
    if (event.type === "done" || event.type === "error") {
      preparingActivityBytes.clear();
      preparingActivityTools.clear();
      preparingActivityRestartHighWater.clear();
    }
    return true;
  };

  let lastRealProgressAt = Date.now();
  let inFlightWorkCount = 0;
  let inFlightMarkerSince: number | null = null;
  let inFlightMarkerWrite = Promise.resolve();
  const mirrorInFlightMarker = (inFlight: boolean) => {
    const markerSince = inFlight ? Date.now() : inFlightMarkerSince;
    if (inFlight) {
      inFlightMarkerSince = markerSince;
    } else {
      inFlightMarkerSince = null;
    }
    inFlightMarkerWrite = inFlightMarkerWrite
      .catch(() => undefined)
      .then(() =>
        setRunInFlightMarker(runId, inFlight, markerSince ?? undefined),
      )
      .catch((error: unknown) => {
        console.error(
          `[run-manager] failed to mirror in-flight marker (${inFlight ? "set" : "clear"})`,
          runId,
          error instanceof Error ? error.message : error,
        );
      });
  };
  const trackInFlightWork = (event: AgentChatEvent) => {
    const delta = inFlightWorkDelta(event);
    if (delta === 0) return;
    const wasIdle = inFlightWorkCount === 0;
    inFlightWorkCount = Math.max(0, inFlightWorkCount + delta);
    if (wasIdle && inFlightWorkCount > 0) {
      mirrorInFlightMarker(true);
    } else if (!wasIdle && inFlightWorkCount === 0) {
      mirrorInFlightMarker(false);
    }
  };
  let checkpointAbortInFlight = false;
  const checkpointRunBoundary = async (
    event: AgentChatEvent,
    terminalReason: string,
  ): Promise<void> => {
    if (
      checkpointAbortInFlight ||
      run.status !== "running" ||
      abort.signal.aborted
    )
      return;
    checkpointAbortInFlight = true;
    try {
      await persistRunCheckpointEvent(runId, event, terminalReason);
    } catch {
      // The abort still has to happen if the checkpoint write is rejected; the
      // caller has already reached a server-owned chunk boundary.
    } finally {
      abort.abort(terminalReason);
      checkpointAbortInFlight = false;
    }
  };

  const recordRunBoundaryDiagnostic = (
    reason: string,
    diagnostic: { silentForMs?: number; lastEventType?: string },
    disposition: "recovered" | "terminal",
  ) => {
    void recordRunDiagnostic(
      runId,
      RUN_DIAG_STAGE.runBoundaryReached,
      JSON.stringify({
        reason,
        disposition,
        silentForMs: diagnostic.silentForMs,
        lastEventType: diagnostic.lastEventType,
        inFlightWorkCount,
        eventCount: run.events.length,
        elapsedMs: Date.now() - run.startedAt,
      }),
      // coercion-ok: recordRunDiagnostic already swallows its own failures;
      // this guards only against an unhandled rejection.
    ).catch(() => {});
  };

  const reachRunBoundary = (
    reason: "no_progress" | "run_timeout",
    diagnostic: { silentForMs?: number; lastEventType?: string } = {},
  ) => {
    if (run.status !== "running" || abort.signal.aborted) return;
    const activeChunkAbort = chunkAbort;
    const canRecoverChunk =
      activeChunkAbort !== null &&
      (recoverableRunDeadlineAt === null ||
        Date.now() < recoverableRunDeadlineAt);
    if (canRecoverChunk) {
      if (activeChunkAbort.signal.aborted) return;
      recoveredChunkBoundaries += 1;
      console.warn(
        `[run-manager] chunk boundary (${reason}) — recovering in-invocation`,
        runId,
        diagnostic,
      );
      pendingBoundary = { reason, diagnostic, index: recoveredChunkBoundaries };
      chunkBoundaryReason = reason;
      activeChunkAbort.abort(reason);
      return;
    }
    if (chunkAbort) chunkBoundaryReason = reason;
    softTimedOut = true;
    recordRunBoundaryDiagnostic(reason, diagnostic, "terminal");
    emitRunBoundaryTrackingEvent({
      runId,
      threadId,
      reason,
      recovered: false,
      boundaryIndex: recoveredChunkBoundaries + 1,
      dispatchMode: options?.dispatchMode,
      model: options?.model,
      engineName: options?.engineName,
      userId: options?.userId,
    });
    const event: AgentChatEvent = { type: "auto_continue", reason };
    send(event);
    void checkpointRunBoundary(event, reason);
  };

  const checkNoProgressBackstop = () => {
    if (noProgressTimeoutMs <= 0) return;
    if (run.status !== "running" || abort.signal.aborted) return;
    if (inFlightWorkCount > 0) return;
    const silentForMs = Date.now() - lastRealProgressAt;
    if (silentForMs < noProgressTimeoutMs) return;
    const lastEventType = run.events.at(-1)?.event.type;
    if (!chunkAbort) {
      console.error(
        `[run-manager] no real progress for ${noProgressTimeoutMs}ms with no tool ` +
          `or model stream in flight — ` +
          `checkpointing run for continuation`,
        runId,
      );
      captureError(
        new Error(
          `Agent run checkpointed after ${silentForMs}ms of silence (no_progress)`,
        ),
        {
          route: "/_agent-native/agent-chat",
          aiTraceId: runId,
          tags: {
            source: "agent-run-manager",
            phase: "no-progress-backstop",
            terminalReason: "no_progress",
            lastEventType,
          },
          extra: {
            runId,
            threadId,
            silentForMs,
            noProgressTimeoutMs,
            lastEventType,
            eventCount: run.events.length,
          },
        },
      );
    }
    reachRunBoundary("no_progress", { silentForMs, lastEventType });
  };

  let lastAbortCheck = Date.now() - 3000;
  let consecutiveAbortCheckFailures = 0;
  const checkSqlAbort = () => {
    const now = Date.now();
    if (now - lastAbortCheck < 3000) return;
    lastAbortCheck = now;
    getRunAbortState(runId)
      .then(async (state) => {
        if (state.aborted && !abort.signal.aborted) {
          abortInMemoryRun(run, state.reason ?? "user");
          return;
        }
        if (!abort.signal.aborted) {
          const status = await getRunStatus(runId);
          if (status !== null && status !== "running") {
            abortInMemoryRun(run, "displaced");
          }
        }
      })
      .then(() => {
        consecutiveAbortCheckFailures = 0;
      })
      .catch((error) => {
        consecutiveAbortCheckFailures += 1;
        if (
          consecutiveAbortCheckFailures === 3 ||
          consecutiveAbortCheckFailures % 20 === 0
        ) {
          captureError(error, {
            route: "/_agent-native/agent-chat",
            tags: {
              source: "agent-run-manager",
              phase: "abort-check",
              consecutiveFailures: String(consecutiveAbortCheckFailures),
            },
            aiTraceId: runId,
            extra: {
              runId,
              threadId,
              unreadableForMs: consecutiveAbortCheckFailures * 3000,
            },
          });
        }
      });
  };

  let consecutiveHeartbeatFailures = 0;
  let heartbeatInFlight = false;
  const heartbeatTimer: ReturnType<typeof setInterval> = setInterval(() => {
    if (!heartbeatInFlight) {
      heartbeatInFlight = true;
      updateRunHeartbeat(runId)
        .then(() => {
          consecutiveHeartbeatFailures = 0;
        })
        .catch((error) => {
          consecutiveHeartbeatFailures += 1;
          if (consecutiveHeartbeatFailures >= 3) {
            captureError(error, {
              route: "/_agent-native/agent-chat",
              tags: {
                source: "agent-run-manager",
                phase: "heartbeat",
                consecutiveFailures: String(consecutiveHeartbeatFailures),
              },
              aiTraceId: runId,
              extra: { runId, threadId },
            });
          }
        })
        .finally(() => {
          heartbeatInFlight = false;
        });
    }
    checkSqlAbort();
    checkNoProgressBackstop();
  }, 1500);
  const softTimeoutMs = resolveRunSoftTimeoutMs(options?.softTimeoutMs, {
    useHostedDefault: options?.useHostedSoftTimeoutDefault === true,
    backgroundFunction: options?.backgroundFunction === true,
  });
  const noProgressTimeoutMs = resolveRunNoProgressTimeoutMs({
    softTimeoutMs,
    backgroundFunction: options?.backgroundFunction === true,
    overrideMs: options?.noProgressTimeoutMs,
    backgroundOverrideMs: options?.backgroundNoProgressTimeoutMs,
  });
  const softTimeoutTimer =
    softTimeoutMs > 0 && !recoverChunkBoundaries
      ? setTimeout(() => {
          reachRunBoundary("run_timeout", {
            lastEventType: run.events.at(-1)?.event.type,
          });
        }, softTimeoutMs)
      : null;
  if (recoverChunkBoundaries && softTimeoutMs > 0) {
    const runDeadlineAt = Date.now() + softTimeoutMs;
    recoverableRunDeadlineAt = runDeadlineAt;
    armChunkSoftTimeout = () => {
      if (chunkSoftTimeoutTimer) clearTimeout(chunkSoftTimeoutTimer);
      if (abort.signal.aborted || run.status !== "running") return;
      chunkSoftTimeoutTimer = setTimeout(
        () => {
          chunkSoftTimeoutTimer = null;
          reachRunBoundary("run_timeout", {
            lastEventType: run.events.at(-1)?.event.type,
          });
        },
        Math.max(0, runDeadlineAt - Date.now()),
      );
    };
    armChunkSoftTimeout();
  }
  let pendingTerminalEvent: RunEvent | null = null;

  const captureRunError = (error: unknown, phase: "run" | "completion") => {
    const errorCode = getRunErrorCode(error);
    const engineError = error instanceof EngineError ? error : null;
    captureError(error, {
      route: "/_agent-native/agent-chat",
      aiTraceId: runId,
      tags: {
        source: "agent-run-manager",
        phase,
        runStatus: run.status,
        softTimedOut: softTimedOut ? "true" : "false",
        abortReason: run.abortReason,
        errorCode,
        gatewayRequestId: engineError?.requestId,
        statusCode:
          engineError?.statusCode != null
            ? String(engineError.statusCode)
            : undefined,
        ...engineRequestShapeTags(engineError?.requestShape),
      },
      extra: {
        runId,
        threadId,
        eventCount: run.events.length,
        startedAt: run.startedAt,
        softTimeoutMs,
      },
      contexts: {
        agentRun: {
          runId,
          threadId,
          status: run.status,
          phase,
          eventCount: run.events.length,
          startedAt: run.startedAt,
          softTimeoutMs,
          softTimedOut,
          abortReason: run.abortReason,
        },
      },
    });
  };

  const emitRunEvent = (
    runEvent: RunEvent,
    options?: { surfacePersistenceError?: boolean },
  ): Promise<void> => {
    run.events.push(runEvent);

    for (const subscriber of run.subscribers) {
      try {
        subscriber(runEvent);
      } catch {
        run.subscribers.delete(subscriber);
      }
    }

    trackInFlightWork(runEvent.event);
    if (shouldBumpProgressForEvent(runEvent.event)) {
      lastRealProgressAt = Date.now();
      bumpProgressIfDue();
    }

    const thisInsert = persistenceChain.then(async () => {
      try {
        await insertRunEvent(
          runId,
          runEvent.seq,
          JSON.stringify(runEvent.event),
        );
      } catch (error) {
        if (!eventPersistenceErrorCaptured) {
          eventPersistenceErrorCaptured = true;
          captureRunPersistenceError(error, "insert-event", {
            seq: runEvent.seq,
            eventType: runEvent.event.type,
          });
        }
        await insertRunEvent(
          runId,
          runEvent.seq,
          JSON.stringify(runEvent.event),
        );
      }
    });
    persistenceChain = thisInsert;
    const persistence = thisInsert;
    if (!options?.surfacePersistenceError) {
      persistence.catch(() => {});
    }

    checkSqlAbort();
    return persistence;
  };

  const send = (event: AgentChatEvent) => {
    if (run.status === "aborted" && abort.signal.aborted) return;

    const runEvent: RunEvent = { seq: run.events.length, event };
    if (isTerminalRunEvent(event)) {
      pendingTerminalEvent = runEvent;
      return;
    }

    void emitRunEvent(runEvent);
  };

  const runPromise = runFn(send, runControl.chunkSignal, runControl)
    .then(() => {
      settleBoundary(false);
      if (abort.signal.aborted) {
        run.status = softTimedOut ? "completed" : "aborted";
        return;
      }
      run.status = "completed";
    })
    .catch((err) => {
      settleBoundary(false);
      if (abort.signal.aborted) {
        run.status = softTimedOut ? "completed" : "aborted";
        return;
      }
      run.status = "errored";
      if (shouldCaptureRunError(err)) {
        captureRunError(err, "run");
      }
      const errorMessage = getRunErrorMessage(err);
      const errorCode = getRunErrorCode(err);
      const details =
        err instanceof EngineError ? getEngineRunErrorDetails(err) : undefined;
      send({
        type: "error",
        error: errorMessage,
        ...(errorCode ? { errorCode } : {}),
        ...(details ? { details } : {}),
        ...(err instanceof EngineError && err.upgradeUrl
          ? { upgradeUrl: err.upgradeUrl }
          : {}),
        ...(err instanceof EngineError && err.providerRetryable === true
          ? { providerRetryable: true }
          : {}),
        ...(err instanceof EngineError && err.contextOverflow === true
          ? { contextOverflow: true }
          : {}),
      });
    })
    .finally(async () => {

      let completionError: unknown = null;
      let terminalPersistenceError: unknown = null;
      let eventPersistenceError: unknown = null;
      let runTerminalErrorCode: string | undefined;
      let runTerminalErrorDetail: string | undefined;
      let terminalPersistenceEstablished = false;
      try {
        await persistenceChain;
      } catch (error) {
        eventPersistenceError = error;
        run.status = "errored";
        pendingTerminalEvent = {
          seq: run.events.length,
          event: {
            type: "error",
            error: "Agent run ended unexpectedly",
            errorCode: "run_event_persistence_failed",
          },
        };
      }
      const resolveTerminalEventForCompletion = () => {
        if (eventPersistenceError) return pendingTerminalEvent;
        const continuationTerminalEvent = run.continuationTerminalEvent
          ? {
              seq: run.events.length,
              event: run.continuationTerminalEvent,
            }
          : null;
        return continuationTerminalEvent ?? pendingTerminalEvent;
      };
      let terminalEventForCompletion = resolveTerminalEventForCompletion();
      let terminalEvent = terminalEventForCompletion?.event ?? null;
      if (onComplete) {
        try {
          const completionStatus =
            run.status !== "aborted" &&
            terminalEventForcesErroredStatus(terminalEvent)
              ? "errored"
              : run.status;
          const completionRun: ActiveRun =
            terminalEventForCompletion || completionStatus !== run.status
              ? {
                  ...run,
                  status: completionStatus,
                  events: terminalEventForCompletion
                    ? [...run.events, terminalEventForCompletion]
                    : run.events,
                }
              : run;
          await onComplete(completionRun);
          run.continuationTerminalEvent ??=
            completionRun.continuationTerminalEvent;
        } catch (err) {
          completionError = err;
          captureRunError(err, "completion");
          console.error(
            "[run-manager] onComplete callback error:",
            err instanceof Error ? err.message : err,
          );
        }
      }

      terminalEventForCompletion = resolveTerminalEventForCompletion();
      terminalEvent = terminalEventForCompletion?.event ?? null;

      const finalStatus =
        run.status === "aborted"
          ? "aborted"
          : run.status === "errored" ||
              completionError ||
              terminalEventForcesErroredStatus(terminalEvent)
            ? "errored"
            : "completed";
      run.status = finalStatus;
      const shouldAutoContinueAfterUnfinishedTurn =
        finalStatus === "completed" &&
        (endsAfterToolResultWithoutAssistantFinal(run) ||
          endsDuringActionPreparation(run)) &&
        (!terminalEventForCompletion ||
          (terminalEventForCompletion.event.type === "done" &&
            terminalEventForCompletion.event.reason !== "user"));
      const unfinishedTurnContinuationEvent =
        shouldAutoContinueAfterUnfinishedTurn
          ? ({
              type: "auto_continue" as const,
              reason: "stream_ended" as const,
            } satisfies Extract<AgentChatEvent, { type: "auto_continue" }>)
          : null;
      if (unfinishedTurnContinuationEvent) {
        terminalEvent = unfinishedTurnContinuationEvent;
      }
      const terminalReason = eventPersistenceError
        ? "error:run_event_persistence_failed"
        : terminalReasonForRun(
            finalStatus,
            terminalEvent,
            run.abortReason,
            completionError,
          );
      const persistedStatus =
        finalStatus === "completed" &&
        isContinuationTerminalReason(terminalReason)
          ? "truncated"
          : finalStatus;

      if (finalStatus === "completed" || finalStatus === "errored") {
        const terminalEventToEmit: AgentChatEvent = eventPersistenceError
          ? {
              type: "error",
              error: "Agent run ended unexpectedly",
              errorCode: "run_event_persistence_failed",
            }
          : finalStatus === "completed"
            ? (unfinishedTurnContinuationEvent ??
              terminalEventForCompletion?.event ?? { type: "done" })
            : terminalEventForCompletion?.event.type === "error" ||
                terminalEventForCompletion?.event.type === "missing_api_key"
              ? terminalEventForCompletion.event
              : terminalEventForCompletion?.event.type === "auto_continue" &&
                  run.continuationTerminalEvent
                ?
                  terminalEventForCompletion.event
                : {
                    type: "error",
                    error: completionError
                      ? "Agent response could not be saved."
                      : "Agent run ended unexpectedly",
                  };
        const last = run.events[run.events.length - 1];
        if (!last || !isTerminalRunEvent(last.event)) {
          const terminal: RunEvent = {
            seq: run.events.length,
            event: terminalEventToEmit,
          };
          try {
            await emitRunEvent(terminal, { surfacePersistenceError: true });
          } catch (err) {
            terminalPersistenceError = err;
            captureRunError(err, "completion");
            console.error(
              "[run-manager] terminal event persistence error:",
              err instanceof Error ? err.message : err,
            );
            if (!eventPersistenceError) {
              try {
                await insertRunEvent(
                  runId,
                  terminal.seq,
                  JSON.stringify(terminal.event),
                );
                terminalPersistenceError = null;
              } catch (retryError) {
                terminalPersistenceError = retryError;
                captureRunError(retryError, "completion");
                console.error(
                  "[run-manager] terminal event retry persistence error:",
                  retryError instanceof Error ? retryError.message : retryError,
                );
              }
            }
          }
        }
      }
      for (const subscriber of run.subscribers) {
        run.subscribers.delete(subscriber);
      }

      if (inFlightWorkCount > 0 || inFlightMarkerSince !== null) {
        inFlightWorkCount = 0;
        mirrorInFlightMarker(false);
      }

      try {
        await insertRunPromise;
        if (!terminalPersistenceError || eventPersistenceError) {
          let statusUpdated = false;
          try {
            statusUpdated = await updateRunStatusIfRunning(
              runId,
              persistedStatus,
            );
          } catch {
            statusUpdated = false;
          }
          if (statusUpdated) {
            terminalPersistenceEstablished = !terminalPersistenceError;
            await setRunTerminalReason(runId, terminalReason);
          } else {
            terminalPersistenceEstablished =
              await reconcileTerminalRunFromEvents(runId).catch(() => false);
          }
        }
      } catch {
        // Best-effort — reapIfStale will eventually clean this up via
        // the heartbeat-stale path.
      }

      if (finalStatus === "errored") {
        let errorCode: string | undefined;
        let errorDetail: string | undefined;
        const diagnosticEvents = pendingTerminalEvent
          ? [...run.events, pendingTerminalEvent]
          : run.events;
        for (let i = diagnosticEvents.length - 1; i >= 0; i--) {
          const ev = diagnosticEvents[i].event as {
            type: string;
            error?: string;
            errorCode?: string;
            details?: string;
          };
          if (ev.type === "missing_api_key") {
            errorCode = LLM_MISSING_CREDENTIALS_ERROR_CODE;
            errorDetail = LLM_MISSING_CREDENTIALS_MESSAGE;
            break;
          } else if (ev.type === "error") {
            errorCode = ev.errorCode;
            errorDetail = ev.error ?? ev.details;
            break;
          }
        }
        if (completionError && !errorCode) {
          errorCode = "completion_error";
          errorDetail =
            errorDetail ??
            (completionError instanceof Error
              ? completionError.message
              : String(completionError));
        }
        errorCode ??= classifyTerminalErrorCode(errorDetail);
        runTerminalErrorCode = errorCode ?? "unknown";
        runTerminalErrorDetail = errorDetail;
        await setRunError(runId, errorCode ?? "unknown", errorDetail);
      }

      if (terminalPersistenceError) {
        const reconciled = eventPersistenceError
          ? false
          : await reconcileTerminalRunFromEvents(runId);
        if (!reconciled) throw terminalPersistenceError;
        terminalPersistenceEstablished = true;
      }

      if (terminalPersistenceEstablished) {
        emitRunTerminalTrackingEvent({
          runId,
          threadId,
          turnId: run.turnId,
          status: persistedStatus,
          terminalReason,
          errorCode: runTerminalErrorCode,
          errorDetail: runTerminalErrorDetail,
          dispatchMode: options?.dispatchMode,
          abortReason: run.abortReason,
          durationMs: Date.now() - run.startedAt,
          model: options?.model,
          engineName: options?.engineName,
          userId: options?.userId,
          attemptCount: options?.attemptCount,
        });
      }
    })
    .finally(() => {
      clearInterval(heartbeatTimer);
      if (softTimeoutTimer) clearTimeout(softTimeoutTimer);
      if (chunkSoftTimeoutTimer) clearTimeout(chunkSoftTimeoutTimer);
      if (progressWriteTimer) clearTimeout(progressWriteTimer);
      progressWriteTimer = null;
      progressWritePending = false;
      setTimeout(() => {
        activeRuns.delete(runId);
        if (threadToRun.get(threadId) === runId) {
          threadToRun.delete(threadId);
        }
      }, CLEANUP_DELAY_MS);
      cleanupOldRuns(
        resolveCompletedRunRetentionMs(),
        resolveErroredRunRetentionMs(),
      ).catch(() => {});
    });
  runPromise.then(resolveFinalized, rejectFinalized);

  options?.waitUntil?.(runPromise);

  return run;
}

export function subscribeToRun(
  runId: string,
  fromSeq: number,
): ReadableStream<Uint8Array> | null {
  const run = activeRuns.get(runId);
  if (run) {
    return subscribeInMemory(run, fromSeq);
  }
  return subscribeFromSQL(runId, fromSeq);
}

export async function replayCompletedTurn(
  threadId: string,
  turnId: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const persisted = await getCurrentTurnRunEventsForThread(threadId, turnId);
  if (persisted.length === 0) return null;
  const events = persisted.filter(
    ({ event }) => event.type !== "auto_continue",
  );
  const hasTerminalEvent = events.some(({ event }) =>
    isTerminalRunEvent(event),
  );
  if (!hasTerminalEvent) {
    const last = events.at(-1);
    events.push({
      runId: last?.runId ?? `turn-replay-${turnId}`,
      seq: (last?.seq ?? -1) + 1,
      event: { type: "done" },
    });
  }
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      events.forEach(({ event, runId, seq }, replaySeq) => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              ...event,
              seq: replaySeq,
              eventId: runEventIdentity(runId, seq),
            })}\n\n`,
          ),
        );
      });
      controller.close();
    },
  });
}

function runEventIdentity(runId: string, seq: number): string {
  return `${runId}:${seq}`;
}

function streamRunEvent(
  runId: string,
  runEvent: RunEvent,
): Record<string, unknown> {
  return {
    ...runEvent.event,
    seq: runEvent.seq,
    eventId: runEventIdentity(runId, runEvent.seq),
  };
}

function streamEventWithIdentity(
  runId: string,
  event: AgentChatEvent | Record<string, unknown>,
  seq?: number,
): Record<string, unknown> {
  return seq === undefined
    ? { ...event }
    : { ...event, seq, eventId: runEventIdentity(runId, seq) };
}

function subscribeInMemory(
  run: ActiveRun,
  fromSeq: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let subscriberRef: ((event: RunEvent) => void) | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let terminalSettleTimer: ReturnType<typeof setTimeout> | null = null;

  return new ReadableStream({
    start(controller) {
      const ping = () => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          if (subscriberRef) run.subscribers.delete(subscriberRef);
          if (pingTimer) clearInterval(pingTimer);
          if (terminalSettleTimer) clearTimeout(terminalSettleTimer);
        }
      };
      ping();
      pingTimer = setInterval(ping, 10_000);

      for (let i = fromSeq; i < run.events.length; i++) {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(streamRunEvent(run.runId, run.events[i]!))}\n\n`,
            ),
          );
        } catch {
          return;
        }
      }

      if (run.status !== "running") {
        let bufferedTerminalIndex = -1;
        for (let index = run.events.length - 1; index >= 0; index -= 1) {
          const buffered = run.events[index];
          if (buffered && isTerminalRunEvent(buffered.event)) {
            bufferedTerminalIndex = index;
            break;
          }
        }
        if (bufferedTerminalIndex >= 0) {
          if (bufferedTerminalIndex < fromSeq) {
            const buffered = run.events[bufferedTerminalIndex]!;
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify(streamRunEvent(run.runId, buffered))}\n\n`,
                ),
              );
            } catch {
              if (pingTimer) clearInterval(pingTimer);
              return;
            }
          }
          if (pingTimer) clearInterval(pingTimer);
          controller.close();
          return;
        }
        terminalSettleTimer = setTimeout(() => {
          captureError(
            new Error(
              `Agent run ${run.runId} reached status ${run.status} without emitting a terminal event`,
            ),
            {
              route: "/_agent-native/agent-chat/runs/:id/events",
              aiTraceId: run.runId,
              tags: {
                source: "agent-run-manager",
                phase: "memory-subscription-terminal",
                runStatus: run.status,
              },
              extra: { runId: run.runId, fromSeq },
            },
          );
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(
                  streamEventWithIdentity(
                    run.runId,
                    UNKNOWN_RUN_STATUS_ERROR_EVENT,
                    run.events.length,
                  ),
                )}\n\n`,
              ),
            );
            // coercion-ok: enqueue throws only once the reader is gone; the lost terminal event is already reported by captureError above.
          } catch {}
          if (subscriberRef) run.subscribers.delete(subscriberRef);
          if (pingTimer) clearInterval(pingTimer);
          try {
            controller.close();
            // coercion-ok: closing an already-closed controller is this cleanup's success case, not a failure to report.
          } catch {}
        }, IN_MEMORY_TERMINAL_SETTLE_MS);
      }

      subscriberRef = (event: RunEvent) => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(streamRunEvent(run.runId, event))}\n\n`,
            ),
          );
          if (isTerminalRunEvent(event.event)) {
            run.subscribers.delete(subscriberRef!);
            if (pingTimer) clearInterval(pingTimer);
            if (terminalSettleTimer) clearTimeout(terminalSettleTimer);
            controller.close();
          }
        } catch {
          run.subscribers.delete(subscriberRef!);
        }
      };

      run.subscribers.add(subscriberRef);
    },
    cancel() {
      if (subscriberRef) run.subscribers.delete(subscriberRef);
      if (pingTimer) clearInterval(pingTimer);
      if (terminalSettleTimer) clearTimeout(terminalSettleTimer);
    },
  });
}

function subscribeFromSQL(
  runId: string,
  fromSeq: number,
): ReadableStream<Uint8Array> | null {
  const encoder = new TextEncoder();
  let cancelled = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream({
    async start(controller) {
      let lastSeq = fromSeq;
      const subscriptionStartedAt = Date.now();
      let activePollUntil = 0;
      let lastStatusCheckAt = 0;
      let lastReapCheckAt = 0;
      let consecutivePollFailures = 0;
      let consecutiveEmptyPolls = 0;
      const ping = () => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          cancelled = true;
          if (pingTimer) clearInterval(pingTimer);
        }
      };
      ping();
      pingTimer = setInterval(ping, 10_000);

      const closeStream = () => {
        cancelled = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (pingTimer) clearInterval(pingTimer);
        try {
          controller.close();
        } catch {}
      };

      const failSubscription = (error: unknown) => {
        const event: AgentChatEvent = {
          type: "error",
          error:
            "The live agent connection could not load persisted run progress.",
          errorCode: "run_subscription_poll_failed",
          details:
            "The agent may still be running. Reconnect to resume from the last persisted event.",
          recoverable: true,
        };
        captureError(error, {
          route: "/_agent-native/agent-chat/runs/:id/events",
          aiTraceId: runId,
          tags: {
            source: "agent-run-manager",
            phase: "sql-subscription-poll",
            consecutiveFailures: String(consecutivePollFailures),
          },
          extra: {
            runId,
            fromSeq,
            lastSeq,
            error: getRunErrorMessage(error),
          },
        });
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(streamEventWithIdentity(runId, event))}\n\n`,
            ),
          );
        } catch {}
        closeStream();
      };

      const poll = async () => {
        if (cancelled) return;
        try {
          const events = await getRunEventsSince(runId, lastSeq);
          consecutiveEmptyPolls = nextSqlSubscriptionEmptyPolls(
            consecutiveEmptyPolls,
            events.length > 0,
            Date.now(),
            activePollUntil,
          );
          if (events.length > 0) {
            activePollUntil = Date.now() + SQL_SUBSCRIPTION_ACTIVE_GRACE_MS;
          }
          for (const { seq, eventData } of events) {
            lastSeq = seq + 1;
            let parsed: any;
            try {
              parsed = JSON.parse(eventData);
            } catch {
              continue;
            }
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify(streamEventWithIdentity(runId, parsed, seq))}\n\n`,
                ),
              );
            } catch {
              cancelled = true;
              return;
            }

            if (isTerminalRunEvent(parsed)) {
              if (pingTimer) clearInterval(pingTimer);
              controller.close();
              return;
            }
          }

          if (events.length === 0) {
            const now = Date.now();
            if (now - lastStatusCheckAt < SQL_SUBSCRIPTION_STATUS_POLL_MS) {
              if (!cancelled) {
                consecutivePollFailures = 0;
                const pollMs = resolveSqlSubscriptionPollMs(
                  now,
                  activePollUntil,
                  consecutiveEmptyPolls,
                );
                pollTimer = setTimeout(poll, pollMs);
              }
              return;
            }
            lastStatusCheckAt = now;
            if (now - lastReapCheckAt >= SQL_SUBSCRIPTION_REAP_POLL_MS) {
              lastReapCheckAt = now;
              await reapIfStale(runId).catch(() => {});
            }
            const run = await getRunById(runId);
            if (
              !run &&
              now - subscriptionStartedAt < RUN_RECORD_MISSING_GRACE_MS
            ) {
              if (!cancelled) {
                consecutivePollFailures = 0;
                pollTimer = setTimeout(
                  poll,
                  resolveSqlSubscriptionPollMs(
                    now,
                    activePollUntil,
                    consecutiveEmptyPolls,
                  ),
                );
              }
              return;
            }
            if (!run || run.status !== "running") {
              const finalEvents = await getRunEventsSince(runId, lastSeq);
              for (const { seq, eventData } of finalEvents) {
                lastSeq = seq + 1;
                let parsed: any;
                try {
                  parsed = JSON.parse(eventData);
                } catch {
                  continue;
                }
                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify(streamEventWithIdentity(runId, parsed, seq))}\n\n`,
                    ),
                  );
                } catch {
                  cancelled = true;
                  return;
                }
                if (isTerminalRunEvent(parsed)) {
                  if (pingTimer) clearInterval(pingTimer);
                  controller.close();
                  return;
                }
              }
              if (run?.status === "aborted") {
                const existing = await getLastTerminalRunEvent(runId).catch(
                  () => null,
                );
                const abortReason = run.terminalReason?.startsWith("aborted:")
                  ? run.terminalReason.slice("aborted:".length)
                  : undefined;
                const terminalEvent = existing
                  ? existing.event
                  : terminalEventForAbortReason(abortReason);
                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify(
                        streamEventWithIdentity(
                          runId,
                          terminalEvent,
                          existing?.seq ?? lastSeq,
                        ),
                      )}\n\n`,
                    ),
                  );
                } catch {
                  cancelled = true;
                  return;
                }
              } else if (
                run?.status === "completed" ||
                run?.status === "truncated"
              ) {
                const existing = await getLastTerminalRunEvent(runId).catch(
                  () => null,
                );
                const terminalEvent = existing
                  ? existing.event
                  : isContinuationTerminalReason(run.terminalReason)
                    ? { type: "auto_continue", reason: run.terminalReason }
                    : { type: "done" };
                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify(
                        streamEventWithIdentity(
                          runId,
                          terminalEvent,
                          existing?.seq ?? lastSeq,
                        ),
                      )}\n\n`,
                    ),
                  );
                } catch {
                  cancelled = true;
                  return;
                }
              } else if (run?.status === "errored") {
                const existing = await getLastTerminalRunEvent(runId).catch(
                  () => null,
                );
                const resolved = existing
                  ? { event: existing.event, shouldPersist: false }
                  : resolveErroredRunTerminalEvent(run);
                if (resolved.shouldPersist) {
                  await ensureTerminalRunEvent(runId, resolved.event).catch(
                    () => {},
                  );
                }
                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify(
                        streamEventWithIdentity(
                          runId,
                          resolved.event,
                          existing?.seq ?? lastSeq,
                        ),
                      )}\n\n`,
                    ),
                  );
                } catch {
                  cancelled = true;
                  return;
                }
              } else {
                const lookup = await getLastTerminalRunEvent(runId).then(
                  (event) => ({ read: true as const, event }),
                  () => ({ read: false as const, event: null }),
                );
                const existing = lookup.event;
                const terminalEvent = existing
                  ? existing.event
                  : !lookup.read
                    ? { ...RUN_TERMINAL_LOOKUP_FAILED_ERROR_EVENT }
                    : run
                      ? { ...UNKNOWN_RUN_STATUS_ERROR_EVENT }
                      : { ...RUN_RECORD_MISSING_ERROR_EVENT };
                if (!existing) {
                  captureError(
                    new Error(
                      !lookup.read
                        ? `Agent run ${runId} terminal-event lookup failed; outcome unknown`
                        : run
                          ? `Agent run ${runId} left 'running' with unrecognized status ${run.status}`
                          : `Agent run ${runId} has no agent_runs row and no terminal event`,
                    ),
                    {
                      route: "/_agent-native/agent-chat/runs/:id/events",
                      aiTraceId: runId,
                      tags: {
                        source: "agent-run-manager",
                        phase: "sql-subscription-terminal",
                        runStatus: run?.status ?? "missing",
                        terminalLookup: lookup.read ? "read" : "failed",
                      },
                      extra: { runId, fromSeq, lastSeq },
                    },
                  );
                }
                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify(
                        streamEventWithIdentity(
                          runId,
                          terminalEvent,
                          existing?.seq ?? lastSeq,
                        ),
                      )}\n\n`,
                    ),
                  );
                } catch {
                  cancelled = true;
                  return;
                }
              }
              if (pingTimer) clearInterval(pingTimer);
              controller.close();
              return;
            }
          }

          if (!cancelled) {
            consecutivePollFailures = 0;
            const pollMs = resolveSqlSubscriptionPollMs(
              Date.now(),
              activePollUntil,
              consecutiveEmptyPolls,
            );
            pollTimer = setTimeout(poll, pollMs);
          }
        } catch (error) {
          consecutivePollFailures += 1;
          if (
            consecutivePollFailures >= SQL_SUBSCRIPTION_MAX_CONSECUTIVE_FAILURES
          ) {
            failSubscription(error);
            return;
          }
          pollTimer = setTimeout(
            poll,
            resolveSqlSubscriptionRetryMs(consecutivePollFailures),
          );
        }
      };

      await poll();
    },
    cancel() {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (pingTimer) clearInterval(pingTimer);
    },
  });
}

export function getActiveRunForThread(threadId: string): ActiveRun | null {
  const runId = threadToRun.get(threadId);
  if (runId) {
    const run = activeRuns.get(runId);
    if (run) return run;
  }
  return null;
}

function legacyWireRunStatus(status: string): string {
  return status === "truncated" ? "completed" : status;
}

export async function getActiveRunForThreadAsync(threadId: string): Promise<{
  runId: string;
  threadId: string;
  turnId: string;
  status: string;
  heartbeatAt: number;
  lastProgressAt: number | null;
  dispatchMode?: string | null;
  terminalReason?: string | null;
  diagStage?: string | null;
  /**
   * True exactly when this run is a `chainServerDrivenContinuation` deferral
   * (dispatch_mode === 'background', never claimed) still inside
   * `UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS` — the same condition this
   * function already uses below to skip its own `reapUnclaimedBackgroundRun`.
   * Surfaced on `/runs/active` (agent-chat-plugin.ts) so
   * `agent-chat-adapter.ts`'s follow loop can tell "silently deferred,
   * server-side recovery in progress" apart from "dead" and stop counting the
   * quiet gap against its idle timeout — see the THREE-SITE INVARIANT comment
   * below and in agent-chat-plugin.ts / production-agent.ts. Always false for
   * an in-memory run (that isolate IS the live producer) and for any run that
   * isn't an unclaimed background dispatch.
   */
  awaitingRedispatch: boolean;
  hasInFlightWork: boolean;
} | null> {
  const memRun = getActiveRunForThread(threadId);
  if (memRun && (memRun.status === "running" || memRun.events.length > 0)) {
    const sqlSnapshot = await fetchRunThreadSnapshot(memRun.runId, threadId);

    if (!sqlSnapshot && memRun.status !== "running") {
      const successor = await fetchNewerNonTerminalRunForSameTurn(
        threadId,
        memRun,
      );
      if (successor) {
        return {
          runId: successor.id,
          threadId: successor.threadId,
          turnId: successor.turnId ?? successor.id,
          status: successor.status,
          heartbeatAt: successor.heartbeatAt ?? successor.startedAt,
          lastProgressAt: successor.lastProgressAt,
          dispatchMode: successor.dispatchMode,
          terminalReason: successor.terminalReason,
          diagStage: successor.diagStage,
          awaitingRedispatch: false,
          hasInFlightWork: successor.inFlightSince != null,
        };
      }
    }

    const status = legacyWireRunStatus(sqlSnapshot?.status ?? memRun.status);
    const heartbeatAt =
      status === "running"
        ? Date.now()
        : (sqlSnapshot?.heartbeatAt ?? memRun.startedAt);
    return {
      runId: memRun.runId,
      threadId: memRun.threadId,
      turnId: memRun.turnId,
      status,
      heartbeatAt,
      lastProgressAt: sqlSnapshot?.lastProgressAt ?? null,
      dispatchMode: sqlSnapshot?.dispatchMode ?? null,
      terminalReason: sqlSnapshot?.terminalReason ?? null,
      diagStage: sqlSnapshot?.diagStage ?? null,
      awaitingRedispatch: false,
      hasInFlightWork: sqlSnapshot?.inFlightSince != null,
    };
  }
  try {
    const sqlRun = await getRunByThread(threadId, { includeTerminal: true });
    if (!sqlRun) return null;
    if (sqlRun.status === "running") {
      const isUnclaimedBackgroundDispatch =
        sqlRun.dispatchMode === "background";
      const stillInsideRedispatchBound = shouldRedispatchUnclaimedBackgroundRun(
        { startedAt: sqlRun.startedAt },
      );
      if (isUnclaimedBackgroundDispatch && !stillInsideRedispatchBound) {
        const recovered = await reapUnclaimedBackgroundRun(sqlRun.id).catch(
          () => false,
        );
        if (recovered) return null;
      }
      const reaped = await reapIfStale(sqlRun.id).catch(() => false);
      if (reaped) return null;
      return {
        runId: sqlRun.id,
        threadId: sqlRun.threadId,
        turnId: sqlRun.turnId ?? sqlRun.id,
        status: sqlRun.status,
        heartbeatAt: sqlRun.heartbeatAt ?? sqlRun.startedAt,
        lastProgressAt: sqlRun.lastProgressAt,
        dispatchMode: sqlRun.dispatchMode,
        terminalReason: sqlRun.terminalReason,
        diagStage: sqlRun.diagStage,
        awaitingRedispatch:
          isUnclaimedBackgroundDispatch && stillInsideRedispatchBound,
        hasInFlightWork: sqlRun.inFlightSince != null,
      };
    }
    if (
      sqlRun.status === "completed" ||
      sqlRun.status === "truncated" ||
      sqlRun.status === "errored"
    ) {
      const referenceAt =
        sqlRun.completedAt ?? sqlRun.heartbeatAt ?? sqlRun.startedAt;
      const terminalAge = Date.now() - referenceAt;
      if (terminalAge > TERMINAL_RUN_RECONNECT_WINDOW_MS) return null;
      return {
        runId: sqlRun.id,
        threadId: sqlRun.threadId,
        turnId: sqlRun.turnId ?? sqlRun.id,
        status: legacyWireRunStatus(sqlRun.status),
        heartbeatAt: sqlRun.heartbeatAt ?? sqlRun.startedAt,
        lastProgressAt: sqlRun.lastProgressAt,
        dispatchMode: sqlRun.dispatchMode,
        terminalReason: sqlRun.terminalReason,
        diagStage: sqlRun.diagStage,
        awaitingRedispatch: false,
        hasInFlightWork: false,
      };
    }
  } catch {
    // SQL error — fall through
  }
  return null;
}

async function fetchRunThreadSnapshot(runId: string, threadId: string) {
  try {
    const byThread = await getRunByThread(threadId, {
      includeTerminal: true,
    });
    if (byThread && byThread.id === runId) return byThread;
    return null;
  } catch {
    return null;
  }
}

async function fetchNewerNonTerminalRunForSameTurn(
  threadId: string,
  memRun: ActiveRun,
): Promise<Awaited<ReturnType<typeof getRunByThread>> | null> {
  try {
    const latest = await getRunByThread(threadId, { includeTerminal: true });
    if (
      latest &&
      latest.id !== memRun.runId &&
      latest.status === "running" &&
      latest.startedAt > memRun.startedAt &&
      (latest.turnId ?? latest.id) === memRun.turnId
    ) {
      return latest;
    }
    return null;
  } catch {
    return null;
  }
}

export function getRun(runId: string): ActiveRun | null {
  return activeRuns.get(runId) ?? null;
}

function abortRunInMemory(runId: string, reason: string): boolean {
  const run = activeRuns.get(runId);
  if (run) {
    abortInMemoryRun(run, reason);
  }
  return !!run;
}

export function abortRun(runId: string, reason: string = "user"): boolean {
  const abortedInMemory = abortRunInMemory(runId, reason);
  markRunAborted(runId, reason).catch(() => {});
  return abortedInMemory;
}

/**
 * Abort a run and wait until the cross-isolate SQL state and terminal event
 * are durable. Request handlers that start recovery immediately after aborting
 * must use this path; otherwise the recovery POST can race the old row while
 * it is still marked running.
 */
export async function abortRunDurably(
  runId: string,
  reason: string = "user",
): Promise<boolean> {
  const abortedInMemory = abortRunInMemory(runId, reason);
  try {
    await markRunAborted(runId, reason);
  } catch (error) {
    captureError(error, {
      route: "/_agent-native/agent-chat/runs/:id/abort",
      aiTraceId: runId,
      tags: {
        source: "agent-run-manager",
        phase: "abort-run",
      },
      extra: { runId, reason, abortedInMemory },
    });
    console.error(
      "[run-manager] durable abort persistence failed:",
      error instanceof Error ? error.message : error,
    );
  }
  return abortedInMemory;
}

export async function abortTurnByRefDurably(
  threadId: string,
  turnId: string,
  reason: string = "user",
): Promise<"aborted" | "already_terminal"> {
  for (const run of activeRuns.values()) {
    if (run.threadId === threadId && run.turnId === turnId) {
      abortInMemoryRun(run, reason);
    }
  }
  return markTurnAborted(threadId, turnId, reason);
}

export async function abortTurnDurably(
  runId: string,
  reason: string = "user",
): Promise<void> {
  const memRun = activeRuns.get(runId);
  const ref = memRun
    ? { threadId: memRun.threadId, turnId: memRun.turnId }
    : await getRunTurnRef(runId).catch(() => null);
  if (!ref) return;
  try {
    await abortTurnByRefDurably(ref.threadId, ref.turnId, reason);
  } catch (error) {
    captureError(error, {
      route: "/_agent-native/agent-chat/runs/:id/abort",
      aiTraceId: runId,
      tags: { source: "agent-run-manager", phase: "abort-turn" },
      extra: { runId, reason, ...ref },
    });
  }
}

export { tryClaimRunSlot } from "./run-store.js";

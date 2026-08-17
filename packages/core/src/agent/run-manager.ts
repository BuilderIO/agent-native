import { getAppConfig } from "../app-config/index.js";
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
import {
  insertRun,
  insertRunEvent,
  updateRunStatusIfRunning,
  markRunAborted,
  getRunAbortState,
  getRunStatus,
  getRunEventsSince,
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
  terminalEventForAbortReason,
} from "./run-store.js";
import { isContinuationTerminalReason } from "./types.js";
import type { AgentChatEvent, RunEvent, RunStatus } from "./types.js";

export interface ActiveRun {
  runId: string;
  threadId: string;
  /** Logical-turn identity (see StartRunOptions.turnId). Defaults to runId. */
  turnId: string;
  events: RunEvent[];
  status: RunStatus;
  subscribers: Set<(event: RunEvent) => void>;
  abort: AbortController;
  abortReason?: string;
  /**
   * Terminal event to emit when a server-driven continuation has been handed
   * off successfully. The continuation runs outside this process, so the
   * normal loop-level auto_continue event is not sent through this run's
   * `send` callback.
   */
  continuationTerminalEvent?: Extract<
    AgentChatEvent,
    { type: "auto_continue" }
  >;
  startedAt: number;
}

export interface StartedRun extends ActiveRun {
  /**
   * Resolves after the terminal event and final SQL status have been persisted.
   * Serverless workers must await this before returning or the runtime can
   * freeze the isolate between onComplete and terminalization.
   */
  finalized: Promise<void>;
}

const activeRuns = new Map<string, ActiveRun>();
const threadToRun = new Map<string, string>();

/** How long to keep completed runs in memory before cleanup (5 min) */
const CLEANUP_DELAY_MS = 5 * 60 * 1000;

/**
 * Default run chunk budget for hosted/serverless deploys.
 *
 * This MUST fire before the two upstream hard walls that otherwise kill a run
 * mid-turn with no chance to hand off:
 *   1. The Builder model gateway keeps a 45s cap only for hosted foreground
 *      runs; local and proven background-function runs use longer caps.
 *   2. Serverless functions are hard-killed around 60-65s (the heartbeat then
 *      reaps the row as a stale_run).
 * Production data showed every cutoff landing in the 44-70s window with ZERO
 * auto_continue events ever emitted — i.e. the old 45s default raced the 45s
 * gateway and lost, and per-template overrides (e.g. 240_000) pushed it past
 * BOTH walls so it could never fire. 40s leaves ~5s of headroom under the
 * gateway wall to abort, persist the partial turn, write the terminal event,
 * and emit a clean auto_continue so the client resumes seamlessly.
 */
export const DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS = 40_000;

/**
 * Hard ceiling for the hosted soft timeout. On a hosted runtime the
 * foreground auto_continue soft timeout can never usefully exceed this — the
 * synchronous function (~60s) wall kills the run first, so a larger configured
 * or env value just guarantees the cutoff is a hard error instead of a graceful
 * hand-off. Any resolved value above this is clamped down for hosted foreground
 * runs. Local dev (non-hosted) is left alone so long-running local turns aren't
 * chunked.
 *
 * IMPORTANT: this clamp is for the INTERACTIVE / foreground path and must NOT
 * be raised. The foreground POST still rides a synchronous serverless function
 * (~60-65s wall), so 40s remains correct there. The only sanctioned exception
 * is the opt-in `backgroundFunction` mode (see
 * `BACKGROUND_SOFT_TIMEOUT_CEILING_MS`), which runs inside a Netlify background
 * function (no ~60s wall, 15-min budget) and therefore can safely outlast 40s.
 */
export const HOSTED_SOFT_TIMEOUT_CEILING_MS = 40_000;

/**
 * Hard ceiling for the soft timeout when a run executes inside a Netlify
 * background function (any deployed function whose name ends in `-background`).
 * Background functions return 202 immediately and run detached for up to 15
 * minutes, so the ~60s synchronous function wall that 40s defends against does
 * NOT apply. 13 minutes leaves ~2 min of headroom under Netlify's 15-min hard
 * kill to abort, persist the partial turn, write the terminal event, and (for
 * the rare >13-min turn) self-fire another background continuation.
 *
 * This ceiling is used ONLY when a caller explicitly opts in with
 * `backgroundFunction: true`. It does not change the foreground/interactive
 * ceiling and does not fire unless the durable-background path dispatched the
 * run into a background function. Per the design doc Guardrail, the 40s
 * interactive clamp stays correct for every non-background run.
 */
export const BACKGROUND_SOFT_TIMEOUT_CEILING_MS = 13 * 60_000; // 780_000

/**
 * Default soft-timeout budget for a background-function run when the caller
 * does not pass an explicit `softTimeoutMs`. Same value as the ceiling — we
 * want a background turn to use nearly its whole 15-min budget before handing
 * off to a chained background continuation.
 */
export const DEFAULT_BACKGROUND_RUN_SOFT_TIMEOUT_MS =
  BACKGROUND_SOFT_TIMEOUT_CEILING_MS;

/**
 * AUTHORITATIVE no-progress backstop for a run, enforced by the run manager
 * itself (timer-driven, independent of any layer below).
 *
 * The finer-grained watchdogs inside the agent loop (model-stream and
 * action-preparation no-progress, both 90s) only guard the model event stream
 * — a stall in any segment OUTSIDE that guarded loop (engine-call
 * establishment, worker setup between continuation chunks, a wedged transport
 * that emits keepalives while the loop never runs) previously hung forever
 * with the client watching keepalives. This backstop covers every segment by
 * construction: if no REAL progress event (see `shouldBumpProgressForEvent`;
 * keepalives and zero-byte prep activity don't count) lands for this long —
 * and no tool call is in flight (tool execution legitimately emits nothing
 * for minutes and has its own 12-min timeout) — the run manager emits
 * `auto_continue { reason: "no_progress" }` and aborts the chunk, exactly
 * like the soft timeout, so the normal continuation machinery recovers it.
 *
 * This is now only the CEILING, not the value: `resolveRunNoProgressTimeoutMs`
 * clamps the foreground backstop to a fraction of the chunk's soft timeout
 * (~30s at a 40s chunk), which is BELOW the 90s in-loop watchdogs rather than
 * above them. That ordering is deliberate — the in-loop watchdogs could never
 * fire inside a hosted foreground chunk anyway, since the serverless wall
 * (~57-59s) arrives first. Proven durable-background chunks keep the full
 * `DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS` so large outputs can use the
 * background budget. Only armed when a soft-timeout regime is active (hosted
 * runs); local dev stays unbounded.
 */
export const RUN_NO_PROGRESS_HARD_TIMEOUT_MS = 150_000;

/**
 * Default no-progress window for a run executing inside a proven durable
 * background function. A background worker that is heartbeating but has no
 * real progress and no tool/A2A work in flight is still wedged; letting that
 * state outlive the client's follow budget only turns a recoverable stall into
 * a terminal timeout. In-flight work suspends this backstop, so use the same
 * server-owned 150s bound as the long foreground regime.
 */
export const DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS =
  RUN_NO_PROGRESS_HARD_TIMEOUT_MS;

/**
 * Fraction of the soft timeout a foreground no-progress backstop may consume.
 * The hosted foreground path rides a synchronous serverless function whose
 * REAL wall is ~57-59s, not the configured 75s — so every watchdog derived
 * from a fixed constant above the soft timeout (the old flat 150s backstop
 * included) was unreachable dead code. Deriving from the soft timeout keeps
 * the backstop inside the budget by construction: at a 40s chunk this is 30s,
 * comfortably under both the wall and the client-side stuck detector.
 */
const FOREGROUND_NO_PROGRESS_SOFT_TIMEOUT_FRACTION = 0.75;

/**
 * Headroom reserved between a foreground tool call's ceiling and the chunk's
 * own soft timeout. A tool given a budget at or above the soft timeout can
 * never be interrupted by its own timeout — the chunk boundary always fires
 * first — so its timeout is dead code. Callers that impose a per-tool timeout
 * must clamp to `resolveRunToolTimeoutCeilingMs`.
 */
const RUN_TOOL_TIMEOUT_HEADROOM_MS = 5_000;

/**
 * Largest per-tool timeout that can actually fire inside this run's chunk
 * budget. `0` means "no run-imposed ceiling" (local dev / unbounded runs), in
 * which case the caller keeps its own default.
 */
export function resolveRunToolTimeoutCeilingMs(softTimeoutMs: number): number {
  if (!(softTimeoutMs > 0)) return 0;
  return Math.max(1_000, softTimeoutMs - RUN_TOOL_TIMEOUT_HEADROOM_MS);
}

/**
 * Resolve the no-progress backstop for a run.
 *
 * Foreground values are clamped to a fraction of the chunk's soft timeout so a
 * template cannot configure a background-sized window (templates/analytics
 * passed 3min unconditionally) that outlives the serverless wall AND the
 * client-side watchdog — which is how the server's whole recovery ladder came
 * to never run. Background-function runs keep the full background budget and
 * take `backgroundOverrideMs` when a caller wants to tune only that regime.
 */
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

  if (backgroundFunction === true) {
    const override =
      explicit(params.backgroundOverrideMs) ?? explicit(params.overrideMs);
    if (override !== undefined) return override;
    return softTimeoutMs > 0 ? DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS : 0;
  }

  const override = explicit(params.overrideMs);
  // Local dev keeps runs unbounded unless a caller explicitly asks otherwise.
  if (!(softTimeoutMs > 0)) return override ?? 0;

  const ceiling = Math.min(
    RUN_NO_PROGRESS_HARD_TIMEOUT_MS,
    Math.floor(softTimeoutMs * FOREGROUND_NO_PROGRESS_SOFT_TIMEOUT_FRACTION),
  );
  if (override === undefined) return ceiling;
  return override === 0 ? 0 : Math.min(override, ceiling);
}

/**
 * Default SQL retention for completed run event logs (24 hours).
 *
 * Deliberately SHORTER than the errored retention below. Reading outcome rates
 * straight off `agent_runs` over any wider window therefore undercounts
 * successes — `cleanupOldRuns` rolls each pruned row into
 * `agent_run_outcome_daily` (see `getRunOutcomeCounters`) so rates stay
 * correct; use counters plus live rows, not live rows alone.
 */
export const DEFAULT_COMPLETED_RUN_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Default SQL retention for unsuccessful run event logs — errored, aborted, AND
 * truncated (7 days). Kept longer than completed runs so cut-off / failed chats
 * survive for pattern analysis (listErroredRuns): they are exactly the runs we
 * need to study to keep hardening reliability. Truncations only reach this
 * window because they are no longer filed as `completed`; while they were, the
 * most-reported failures were also the fastest-deleted evidence.
 */
export const DEFAULT_ERRORED_RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How recently a terminal run must have completed for `/runs/active` to surface
 * it. This must outlast the durable browser watchdog (13 minutes) and the
 * in-flight reader watchdog (15 minutes) so a quiet event stream can detach
 * and still replay a run that completed while the browser was waiting.
 * Reconnect after this window won't replay the run.
 */
export const TERMINAL_RUN_RECONNECT_WINDOW_MS = 20 * 60 * 1000;

/** Fast poll cadence while a SQL-backed SSE subscription is actively receiving rows. */
export const SQL_SUBSCRIPTION_ACTIVE_POLL_MS = 125;

/** Baseline SQL-backed SSE poll cadence when the run is idle. */
export const SQL_SUBSCRIPTION_IDLE_POLL_MS = 500;

/**
 * Keep briefly polling quickly after rows arrive so token streams stay smooth,
 * then back off to the idle cadence if the producer goes quiet.
 */
export const SQL_SUBSCRIPTION_ACTIVE_GRACE_MS = 2_000;

/** Keep terminal/status probes at the historical cadence to bound DB work. */
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

/**
 * Ceiling for the decayed idle cadence. Bounds the WORST-CASE added latency to
 * the next token a quiet run eventually produces; a row already waiting when the
 * timer fires is delivered immediately, so this is not added to a streaming run.
 */
export const SQL_SUBSCRIPTION_IDLE_MAX_POLL_MS = 2_000;

/**
 * Cadence for the opportunistic `reapIfStale` probe inside the SSE poll loop,
 * kept SEPARATE from (and much slower than) the status probe next to it.
 *
 * A reap can only ever act on a run whose liveness basis is older than the
 * tightest staleness window any sweep enforces — `RUN_STALE_MS`, 15s — so
 * running it on the 500ms status cadence issued ~30 rounds of
 * `reconcileTerminalRunFromEvents` + reap-eligibility queries (2-4 round trips
 * each) before the first one could possibly match a row. This cadence still
 * detects a stale producer well inside the client's own idle timeout while
 * cutting that probe traffic ~10x. `getRunById` deliberately stays on the fast
 * status cadence: it is one indexed read and it is what closes the stream on a
 * NORMAL finish, which must stay prompt.
 */
export const SQL_SUBSCRIPTION_REAP_POLL_MS = 5_000;

/** Initial retry delay after a transient cross-isolate SQL polling failure. */
export const SQL_SUBSCRIPTION_RETRY_BASE_MS = 250;

/** Bound consecutive SQL polling failures so a dead subscription fails loud. */
export const SQL_SUBSCRIPTION_MAX_CONSECUTIVE_FAILURES = 4;

/** Cap retry delay even if the failure bound changes independently. */
export const SQL_SUBSCRIPTION_RETRY_MAX_MS = 2_000;

export function resolveSqlSubscriptionPollMs(
  now: number,
  activePollUntil: number,
  consecutiveEmptyPolls = 0,
): number {
  if (now < activePollUntil) return SQL_SUBSCRIPTION_ACTIVE_POLL_MS;
  // Clamped before exponentiation: an unbounded `2 ** steps` reaches Infinity
  // and would make the cap the only thing keeping this finite.
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

/**
 * Advance the empty-poll counter that drives `resolveSqlSubscriptionPollMs`'s
 * decay.
 *
 * Only IDLE polls count. Counting the ~16 fast polls inside the active grace
 * window would push the ladder to its cap the instant the grace expired, so a
 * producer that pauses a few seconds between tokens would resume at the 2s cap
 * instead of 500ms — a visible mid-stream stutter rather than the intended
 * "this run has gone quiet" backoff.
 */
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
  // The code rides the error EVENT to the client, which decides recovery from
  // it — so an uncoded transport failure has to be classified here too, not
  // only when the run row is persisted.
  return classifyTerminalErrorCode(describeErrorWithCauses(err));
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
    // A truncated gateway stream, which the client continues. It arrived here as
    // `builder_gateway_network_error` until the engine gave it its own code, so
    // omitting it would turn a routine recovered interruption into Sentry noise.
    normalizedCode !== "builder_gateway_stream_ended" &&
    normalizedCode !== PROVIDER_NETWORK_ERROR_CODE &&
    normalizedCode !== "provider_rate_limited" &&
    normalizedCode !== "rate_limit_exceeded"
  );
}

export interface StartRunOptions {
  /** Keep a request-scoped serverless invocation alive for this run. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Optional internal run chunk budget. When reached, the framework emits an
   * auto-continuation signal instead of a user-facing timeout. Leave unset for
   * no framework-imposed run timeout. */
  softTimeoutMs?: number;
  /** Opt into the hosted/serverless default chunk budget. Only callers with
   * automatic continuation support should enable this. */
  useHostedSoftTimeoutDefault?: boolean;
  /** Stable identity for the logical assistant turn this run belongs to. A
   * turn may span several continuation runs (each chunk is its own run); they
   * share one `turnId` so the durable assistant message can be folded across
   * them instead of dropped per-run. Defaults to the runId (turn == run). */
  turnId?: string;
  /**
   * Opt into the durable-background-function soft-timeout regime for THIS run
   * only. When true, `resolveRunSoftTimeoutMs` lifts the hosted ceiling from
   * 40s to ~13min (`BACKGROUND_SOFT_TIMEOUT_CEILING_MS`) because the run is
   * executing inside a Netlify background function (no ~60s wall). Off by
   * default — the foreground/interactive path never sets this, so its 40s
   * clamp is unchanged. See the design doc + the durable-background dispatch
   * decision in production-agent.ts.
   */
  backgroundFunction?: boolean;
  /**
   * Override the run-manager-level no-progress backstop
   * (`RUN_NO_PROGRESS_HARD_TIMEOUT_MS`). `0` disables it. Defaults to the
   * backstop constant whenever a soft-timeout regime is active (hosted runs)
   * and to disabled otherwise (local dev stays unbounded).
   */
  noProgressTimeoutMs?: number;
  /**
   * Override the no-progress backstop for a `backgroundFunction` run only.
   * Exists so a template can raise the background window without also raising
   * the foreground one — `noProgressTimeoutMs` is clamped to a fraction of the
   * foreground chunk budget precisely so it can never outlive the serverless
   * wall. See `resolveRunNoProgressTimeoutMs`.
   */
  backgroundNoProgressTimeoutMs?: number;
  /**
   * Lifecycle metadata persisted to `agent_runs.dispatch_mode` and surfaced to
   * clients through `/runs/active`. This does not change run-manager behavior;
   * callers use it to describe who owns continuation at hosted chunk boundaries.
   */
  dispatchMode?: "foreground" | "foreground-self-chain" | "background";
  /**
   * Optional context forwarded onto the terminal-outcome analytics event
   * (see `emitRunTerminalTrackingEvent`) so run cutoffs can be broken down
   * by model/engine/user. Run-manager has no way to know these on its own —
   * the caller (production-agent.ts) knows them but does not thread them
   * through yet; omitted fields are simply left off the event rather than
   * defaulted to a placeholder.
   */
  model?: string;
  engineName?: string;
  userId?: string;
  /** Continuation/redispatch attempt number for this logical turn, if the
   *  caller is tracking one. */
  attemptCount?: number;
}

export interface ResolveRunSoftTimeoutOptions {
  useHostedDefault?: boolean;
  /**
   * Resolve the soft timeout for a run executing inside a Netlify background
   * function. Lifts the hosted clamp to `BACKGROUND_SOFT_TIMEOUT_CEILING_MS`
   * (~13min) for this invocation only and, when no override/env is supplied,
   * defaults to `DEFAULT_BACKGROUND_RUN_SOFT_TIMEOUT_MS`. Does NOT change the
   * foreground ceiling. Off by default.
   */
  backgroundFunction?: boolean;
}

/**
 * True on hosted/serverless runtimes where the soft-timeout regime applies
 * (see `resolveRunSoftTimeoutMs`, which resolves to 0 — disabled — off these
 * runtimes). Exported so production-agent.ts can gate its foreground
 * first-model-event cap (`FOREGROUND_FIRST_MODEL_EVENT_TIMEOUT_MS`) on the
 * SAME predicate that selects the 40s clamp: the cap only makes sense where
 * that clamp (and the platform wall behind it) exists.
 */
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
  // The interactive/foreground ceiling is 40s — the synchronous serverless
  // function wall. A background-function run (opt-in only) has no ~60s wall, so
  // it is allowed to outlast that and is clamped to the larger 13-min ceiling
  // instead. The 40s clamp for non-background hosted runs is unchanged.
  const ceiling = background
    ? BACKGROUND_SOFT_TIMEOUT_CEILING_MS
    : HOSTED_SOFT_TIMEOUT_CEILING_MS;
  // A configured/env soft timeout that exceeds the upstream walls can never
  // actually fire (the gateway/function kills the run first), so clamp it down
  // on hosted runtimes. This is what makes auto_continue reach the client
  // instead of the run dying as builder_gateway_timeout / stale_run. `0` means
  // "disabled" and is never clamped up.
  const clampHosted = (ms: number): number =>
    hosted && ms > ceiling ? ceiling : ms;

  if (typeof overrideMs === "number" && Number.isFinite(overrideMs)) {
    return clampHosted(Math.max(0, overrideMs));
  }
  const configured = getAppConfig().agent.runSoftTimeoutMs;
  if (configured !== undefined) return clampHosted(configured);
  // A background-function run uses the full background budget by default; the
  // foreground default (40s) is unchanged.
  if (background) {
    return hosted ? DEFAULT_BACKGROUND_RUN_SOFT_TIMEOUT_MS : 0;
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
 * A completed tool with no later assistant text is an unfinished turn, not a
 * successful terminal response. Keep this predicate beside the run-manager's
 * terminal synthesis so the run-manager and production continuation paths use
 * the same boundary evidence.
 */
export function endsAfterCompletedToolWithoutAssistantFinal(
  run: ActiveRun,
): boolean {
  let completedToolAfterLastAssistantText = false;
  for (const { event } of run.events) {
    if (event.type === "text" && event.text.trim().length > 0) {
      completedToolAfterLastAssistantText = false;
      continue;
    }
    if (event.type === "tool_done" && event.isError !== true) {
      completedToolAfterLastAssistantText =
        event.chatUI === undefined && event.mcpApp === undefined;
      continue;
    }
    if (
      event.type === "clear" ||
      event.type === "error" ||
      event.type === "missing_api_key" ||
      event.type === "auto_continue" ||
      event.type === "loop_limit"
    ) {
      completedToolAfterLastAssistantText = false;
    }
  }
  return completedToolAfterLastAssistantText;
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

/**
 * Emit one analytics event per terminal run — the seam that makes cutoffs
 * (`run_budget_exhausted`, `loop_limit`, aborts, `truncated` continuation
 * boundaries) queryable in the same pipeline as `$ai_generation`
 * (see observability/traces.ts). Same mechanism: dynamic import of
 * `track()` with every failure swallowed, so a missing/broken tracking
 * provider can never affect the run or its persisted status. Must be called
 * AFTER the atomic-complete SQL writes in the `.finally()` boundary above —
 * never before, and never awaited by it.
 *
 * Operational metadata only: no message content, no prompt/response text,
 * no user email. `errorDetail` carries engine/gateway error strings (e.g.
 * "context_length_exceeded"), not user-authored text.
 */
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
    dispatch_mode: args.dispatchMode ?? "foreground",
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
  // Keep the abort terminal in the replay buffer as well as sending it to
  // current subscribers. A reconnect can arrive after the live subscriber
  // was removed but while this run is still warm in memory; closing that
  // replay with no terminal frame makes the client manufacture a false
  // frozen response and retry against a run that is already done.
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

/**
 * Start a new agent run in the background.
 * `runFn` receives a `send` callback and an `AbortSignal`.
 * The run continues even if all SSE subscribers disconnect.
 *
 * Events are persisted to SQL for cross-isolate access (Cloudflare Workers).
 */
export function startRun(
  runId: string,
  threadId: string,
  runFn: (
    send: (event: AgentChatEvent) => void,
    signal: AbortSignal,
  ) => Promise<void>,
  onComplete?: (run: ActiveRun) => void | Promise<void>,
  options?: StartRunOptions,
): StartedRun {
  // If there's already a run for this thread, abort it
  const existingRunId = threadToRun.get(threadId);
  if (existingRunId) {
    abortRun(existingRunId);
  }

  const abort = new AbortController();
  let softTimedOut = false;
  let resolveFinalized: () => void = () => {};
  let rejectFinalized: (reason?: unknown) => void = () => {};
  const finalized = new Promise<void>((resolve, reject) => {
    resolveFinalized = resolve;
    rejectFinalized = reject;
  });
  // Foreground callers do not await this promise, but terminal persistence
  // failures must still be observable to background workers without creating
  // an unhandled rejection in the foreground path.
  void finalized.catch(() => {});
  const run: StartedRun = {
    runId,
    threadId,
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

  // Persist run to SQL without blocking the response. Keep the promise so
  // final status cannot race ahead of a slow initial INSERT and then get
  // overwritten by a late row stuck at status='running'.
  const insertOptions = options?.dispatchMode
    ? { dispatchMode: options.dispatchMode }
    : undefined;
  const insertRunPromise = (
    insertOptions
      ? insertRun(runId, threadId, options?.turnId, insertOptions)
      : insertRun(runId, threadId, options?.turnId)
  ).catch((error) => {
    captureRunPersistenceError(error, "insert-run");
  });

  // Per-run event persistence chain: events are chained so SQL inserts commit
  // in seq order. Without this, a fast seq=5 commit before a slow seq=4 means
  // the SQL poller advances its cursor past seq=4 (lastSeq = 5+1 = 6) and
  // reconnecting clients permanently miss that event (silent gap). Chaining
  // per run ensures order without blocking the fast in-memory SSE path.
  let persistenceChain: Promise<void> = Promise.resolve();

  // Throttle the durable progress timestamp to at most once per second so
  // a chatty token-by-token stream doesn't translate into one DB write per
  // chunk. The stuck-detector threshold is on the order of tens of seconds,
  // so 1s resolution is plenty. Keep one write in flight and coalesce a
  // trailing request: overlapping progress updates can exhaust a pooler and
  // starve the heartbeat that is supposed to prove this run is alive.
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
    // Keep every failure counted and retried, but sample the error capture so
    // a database outage does not turn one long streamed input into hundreds of
    // identical reports. The run id and event count make the sampled report
    // useful for correlating the durable clock with the event ledger.
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
      // The initial run insert is intentionally asynchronous so the fast SSE
      // path does not wait on SQL. If this first UPDATE wins the race, retry
      // after that insert commits instead of permanently losing the first
      // durable progress signal.
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
        // Retry even if no later event arrives. A transient failure must not
        // freeze the durable clock until the next user-visible event.
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

  // ── No-progress backstop (see RUN_NO_PROGRESS_HARD_TIMEOUT_MS) ──────────
  // Timer-driven and independent of the agent loop, so it fires even when the
  // stall is in a segment the in-loop watchdogs never see (engine-call
  // establishment, setup, a wedged transport emitting keepalives). Tool calls
  // and sub-agent calls in flight suspend it — tool execution legitimately
  // emits nothing for minutes and carries its own 12-min timeout.
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
    // Preserve transition order: a delayed clear must not erase the marker
    // written for the next tool that starts before the clear reaches SQL.
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
    const wasIdle = inFlightWorkCount === 0;
    if (event.type === "tool_start") {
      inFlightWorkCount += 1;
    } else if (event.type === "tool_done") {
      inFlightWorkCount = Math.max(0, inFlightWorkCount - 1);
    } else if (event.type === "agent_call") {
      if (event.status === "start") {
        inFlightWorkCount += 1;
      } else {
        inFlightWorkCount = Math.max(0, inFlightWorkCount - 1);
      }
    } else {
      return; // Not a work-tracking event — no transition possible.
    }
    // Mirror the 0<->N transition into SQL so a stale reaper running in a
    // DIFFERENT isolate (a client's SQL-subscription poll, a sibling
    // isolate's opportunistic cleanup, a fresh boot's startup sweep) can
    // grant this demonstrably-alive run a bounded grace even when THIS
    // isolate's own heartbeat write is failing (e.g. Neon pooler saturation)
    // — `inFlightWorkCount` itself is in-memory and invisible to those other
    // isolates. Fire-and-forget: never block event emission on this write, but
    // keep failures observable and preserve transition order. See
    // `setRunInFlightMarker` / `IN_FLIGHT_RUN_STALE_GRACE_MS` in run-store.ts
    // for the full reasoning and bounded-grace derivation.
    if (wasIdle && inFlightWorkCount > 0) {
      mirrorInFlightMarker(true);
    } else if (!wasIdle && inFlightWorkCount === 0) {
      mirrorInFlightMarker(false);
    }
  };
  // Make a chunk boundary durable at the instant it is decided. The terminal
  // event is otherwise only persisted after the agent loop unwinds, and
  // wind-down routinely eats the little budget left under the ~58s serverless
  // wall — the process is killed, the auto_continue is never written, and the
  // reaper records a `stale_run` lie for a run that had honestly checkpointed.
  // Written into the reserved seq band so it cannot collide with, or be
  // streamed ahead of, the events the loop is still emitting.
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

  const checkNoProgressBackstop = () => {
    if (noProgressTimeoutMs <= 0) return;
    if (run.status !== "running" || abort.signal.aborted) return;
    if (inFlightWorkCount > 0) return;
    if (Date.now() - lastRealProgressAt < noProgressTimeoutMs) return;
    console.error(
      `[run-manager] no real progress for ${noProgressTimeoutMs}ms with no tool in flight — ` +
        `checkpointing run for continuation`,
      runId,
    );
    // Mirror the soft-timeout semantics exactly: the chunk completes (not
    // aborts) at an auto_continue boundary, so the continuation machinery —
    // server-chained for background workers, client-driven for foreground —
    // recovers the turn.
    softTimedOut = true;
    const event: AgentChatEvent = {
      type: "auto_continue",
      reason: "no_progress",
    };
    send(event);
    void checkpointRunBoundary(event, "no_progress");
  };

  // Periodic SQL abort check interval (for cross-isolate abort on Workers).
  // Also self-aborts when our row is no longer status='running' — catches the
  // false-stale-reap zombie scenario where the reaper flipped the row while
  // this isolate was briefly unable to heartbeat (DB latency / GC pause).
  let lastAbortCheck = Date.now() - 3000;
  // A read failure here is not "not aborted" — but it is not grounds to kill
  // the run either. This check is only a cross-isolate backstop: the outage
  // that hides a Stop from us hides it from every other reader too, so
  // self-aborting delivers nobody's Stop any sooner while destroying in-flight
  // work in the far more common case where nobody pressed Stop at all. Fail
  // open and stay bounded by the soft timeout, no-progress backstop, and
  // iteration/token limits — none of which touch the DB. Report the outage to
  // Sentry (once at the threshold, then ~once a minute) so a long unreadable
  // window is visible and its duration is queryable instead of silent.
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
        // If the row is no longer 'running' (reaped / replaced) and we're
        // still executing, self-abort so we stop executing and don't overwrite
        // the newer state with our terminal write.
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
        // 3 ticks ≈ 9s of unreadability, then every 20 ticks ≈ 60s.
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

  // Heartbeat: bump heartbeat_at every 1.5s so watchers can detect a dead
  // producer (process crash, HMR restart, isolate eviction) quickly and
  // reap the row. Paired with RUN_STALE_MS (15s) — 10x the interval to
  // tolerate transient DB slowness without false positives.
  let consecutiveHeartbeatFailures = 0;
  // Single-flight the heartbeat write. The timer fires every 1.5s but a write
  // can take up to the DB op timeout (~8s) when the Neon pooler is saturated.
  // Firing a fresh write each tick regardless piled up ~5 concurrent writes
  // under contention, each holding a pooler connection — ADDING to the exact
  // connection-cap exhaustion that starves the heartbeat and false-reaps the
  // run as stale. Skip a tick's write while one is still outstanding so a run
  // holds at most one heartbeat connection. The abort/backstop checks below
  // still run every tick (they don't touch the DB on the hot path).
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
          // Swallow routine single-tick blips; escalate once failures approach
          // the stale window so false-positive stale_run from silent write
          // failures is diagnosable.
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
  // Armed only when a soft-timeout regime is active (hosted): local dev keeps
  // unbounded runs. For 40s foreground chunks the soft timeout always fires
  // first, so in practice this guards the long background chunks.
  const noProgressTimeoutMs = resolveRunNoProgressTimeoutMs({
    softTimeoutMs,
    backgroundFunction: options?.backgroundFunction === true,
    overrideMs: options?.noProgressTimeoutMs,
    backgroundOverrideMs: options?.backgroundNoProgressTimeoutMs,
  });
  const softTimeoutTimer =
    softTimeoutMs > 0
      ? setTimeout(() => {
          if (run.status !== "running" || abort.signal.aborted) return;
          softTimedOut = true;
          const event: AgentChatEvent = {
            type: "auto_continue",
            reason: "run_timeout",
          };
          send(event);
          void checkpointRunBoundary(event, "run_timeout");
        }, softTimeoutMs)
      : null;
  let pendingTerminalEvent: RunEvent | null = null;

  const captureRunError = (error: unknown, phase: "run" | "completion") => {
    const errorCode = getRunErrorCode(error);
    // A gateway error often arrives as one opaque user-facing sentence, so the
    // structured fields EngineError already carries are the whole diagnostic.
    // Dropping them here left operators with an error id and nothing to join on.
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

    // Notify in-memory subscribers (same isolate, fast path)
    for (const subscriber of run.subscribers) {
      try {
        subscriber(runEvent);
      } catch {
        run.subscribers.delete(subscriber);
      }
    }

    // Bump the durable progress timestamp. Distinct from the heartbeat:
    // heartbeat = "process is up", progress = "real work is happening." The
    // gap between them is what the client-side stuck-detector reads to tell
    // a hung run from a healthy one. Keepalive and zero-byte action prep are
    // liveness only; streamed input bytes, text, and tool lifecycle events are
    // real progress.
    trackInFlightWork(runEvent.event);
    if (shouldBumpProgressForEvent(runEvent.event)) {
      lastRealProgressAt = Date.now();
      bumpProgressIfDue();
    }

    // Persist event to SQL. Events are chained through persistenceChain so
    // inserts commit in seq order — an out-of-order commit would advance the
    // SQL poller's cursor past the slow row, permanently dropping it for
    // reconnecting clients. Terminal events surface persistence errors so the
    // caller can decide how to handle a failed final write.
    const thisInsert = persistenceChain.then(() =>
      insertRunEvent(runId, runEvent.seq, JSON.stringify(runEvent.event)),
    );
    persistenceChain = thisInsert.catch((error) => {
      if (!eventPersistenceErrorCaptured) {
        eventPersistenceErrorCaptured = true;
        captureRunPersistenceError(error, "insert-event", {
          seq: runEvent.seq,
          eventType: runEvent.event.type,
        });
      }
    });
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

    emitRunEvent(runEvent);
  };

  // Run in background — intentionally detached from any HTTP connection
  const runPromise = runFn(send, abort.signal)
    .then(() => {
      if (abort.signal.aborted) {
        run.status = softTimedOut ? "completed" : "aborted";
        return;
      }
      run.status = "completed";
    })
    .catch((err) => {
      // Don't surface abort errors — the run was intentionally stopped
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
        // The engine's own retry verdict, carried structurally. The client
        // decides auto-continue from this, `recoverable` and the error code, and
        // a deployment whose visitor copy replaces the message (Builder credits)
        // leaves it nothing else to read: without this a provider throttle the
        // engine marked retryable ends the turn on those sites only.
        //
        // NOT `recoverable`. That field is the server's own "this run stopped at
        // an internal continuation boundary" signal, read by
        // `isInternalContinuationError` (thread-data-builder) to drop the error
        // from the persisted turn and by `isRecoverableContinuationError`
        // (production-agent) to self-chain the next background chunk. Neither
        // lists `rate_limited` or `too_many_concurrent_requests` today, so
        // feeding them from the engine verdict would newly chain up to
        // MAX_BACKGROUND_RUN_CONTINUATIONS invocations into a live throttle — on
        // every lane, not just Builder credits.
        ...(err instanceof EngineError && err.providerRetryable === true
          ? { providerRetryable: true }
          : {}),
        // Same reasoning as `providerRetryable`: on the credits lane the message
        // is the visitor line and the code is `invalid_request_error`, so this
        // flag is the only thing left that says "trim and retry once". Dropping
        // it here turns a recoverable overflow into a terminal failure on exactly
        // the sites that cannot read the real reason.
        ...(err instanceof EngineError && err.contextOverflow === true
          ? { contextOverflow: true }
          : {}),
      });
    })
    .finally(async () => {
      // Ordering matters here — this is the atomic-complete boundary.
      // Invariant: once agent_runs.status flips to "completed"/"errored"
      // in SQL, thread_data for this turn is already durable. This lets
      // reconnecting clients trust the simple rule "status != running →
      // fetch thread_data" without polling/retrying for a race window
      // where onComplete was still pending.

      // 1. Await the completion callback (thread_data save). Heartbeat is
      //    still ticking so the run doesn't look stale to any concurrent
      //    /runs/active check while we wait for SQL writes to land.
      let completionError: unknown = null;
      let terminalPersistenceError: unknown = null;
      // Populated in step 5b for errored runs; read by the terminal tracking
      // emission below so it doesn't have to re-walk diagnosticEvents.
      let runTerminalErrorCode: string | undefined;
      let runTerminalErrorDetail: string | undefined;
      let terminalPersistenceEstablished = false;
      const resolveTerminalEventForCompletion = () => {
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
      // Runs the completion callback for EVERY terminal outcome, aborts
      // included. A no-progress abort used to skip it, which discarded the
      // whole partial turn — prod saw 1471 events, 348 of them streamed text,
      // vanish on reload. `foldAssistantTurn` in the thread_data writer is
      // keyed on turnId, so a successor chunk folding onto the same turn
      // merges rather than duplicating.
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
        } catch (err) {
          completionError = err;
          captureRunError(err, "completion");
          console.error(
            "[run-manager] onComplete callback error:",
            err instanceof Error ? err.message : err,
          );
        }
      }

      // Server-driven continuation is installed by onComplete after the
      // successor has been dispatched. Resolve the terminal event again so
      // this chunk emits auto_continue instead of a misleading done event.
      terminalEventForCompletion = resolveTerminalEventForCompletion();
      terminalEvent = terminalEventForCompletion?.event ?? null;

      // 2. Compute final status. If the completion callback threw, we'd
      //    rather mark the run errored than claim success with incomplete
      //    thread_data.
      const finalStatus =
        run.status === "aborted"
          ? "aborted"
          : run.status === "errored" ||
              completionError ||
              terminalEventForcesErroredStatus(terminalEvent)
            ? "errored"
            : "completed";
      const shouldAutoContinueAfterCompletedTool =
        finalStatus === "completed" &&
        endsAfterCompletedToolWithoutAssistantFinal(run) &&
        (!terminalEventForCompletion ||
          (terminalEventForCompletion.event.type === "done" &&
            terminalEventForCompletion.event.reason !== "user"));
      const completedToolContinuationEvent =
        shouldAutoContinueAfterCompletedTool
          ? ({
              type: "auto_continue" as const,
              reason: "stream_ended" as const,
            } satisfies Extract<AgentChatEvent, { type: "auto_continue" }>)
          : null;
      if (completedToolContinuationEvent) {
        terminalEvent = completedToolContinuationEvent;
      }
      const terminalReason = terminalReasonForRun(
        finalStatus,
        terminalEvent,
        run.abortReason,
        completionError,
      );
      // A run that stopped at a continuation boundary did not finish, so it is
      // not `completed`. Persisted directly here rather than left for
      // `setRunTerminalReason` to correct, so the row is never briefly readable
      // as a success. `finalStatus` still drives terminal-event emission and
      // error classification below — those key on "did this fail", not on
      // "did this finish".
      const persistedStatus =
        finalStatus === "completed" &&
        isContinuationTerminalReason(terminalReason)
          ? "truncated"
          : finalStatus;

      // 3. Emit the terminal event only after thread_data is durable. Live
      //    SSE clients close on this event and usually fetch thread_data
      //    immediately, so emitting it earlier recreates the final-message
      //    race this manager is meant to avoid.
      if (finalStatus === "completed" || finalStatus === "errored") {
        // Choose the terminal event payload (done / the stashed terminal /
        // a synthesized error). NOTE: the `seq` carried by
        // `pendingTerminalEvent` was captured by `send()` at stash time as
        // `run.events.length` and is NOT authoritative — if the runFn emitted
        // any more events before it actually stopped on the abort signal,
        // those events were pushed and reused that same seq. Persisting the
        // terminal event with the stale seq would collide with an
        // already-persisted streaming event and get silently dropped by
        // insertRunEvent's `ON CONFLICT (run_id, seq) DO NOTHING`, so the
        // client would never see the terminal/continuation signal. We always
        // re-stamp the seq at emit time (max-seq+1) just below.
        const terminalEventToEmit: AgentChatEvent =
          finalStatus === "completed"
            ? (completedToolContinuationEvent ??
              terminalEventForCompletion?.event ?? { type: "done" })
            : terminalEventForCompletion?.event.type === "error" ||
                terminalEventForCompletion?.event.type === "missing_api_key"
              ? terminalEventForCompletion.event
              : terminalEventForCompletion?.event.type === "auto_continue" &&
                  run.continuationTerminalEvent
                ? // The run was checkpointed at a soft-timeout/loop boundary and
                  // is recoverable: the partial turn is in agent_run_events and
                  // the handed-off continuation run will re-attempt the
                  // thread_data save.
                  // Even though the completion save failed (finalStatus stays
                  // "errored" for SQL/diagnostics), re-emit the auto_continue so
                  // the client resumes instead of seeing a dead chat. A
                  // pending auto_continue without this handoff marker is not
                  // recoverable: advertising it makes the client poll a dead
                  // run until it reports background_run_lost.
                  terminalEventForCompletion.event
                : {
                    type: "error",
                    error: completionError
                      ? "Agent response could not be saved."
                      : "Agent run ended unexpectedly",
                  };
        const last = run.events[run.events.length - 1];
        if (!last || !isTerminalRunEvent(last.event)) {
          // Assign the seq at EMIT time, not at stash time. `run.events` is a
          // contiguous 0-based log, so `run.events.length` is the next free
          // seq and can never collide with an event that was pushed after the
          // terminal event was stashed.
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
      for (const subscriber of run.subscribers) {
        run.subscribers.delete(subscriber);
      }

      // 4. Stop the heartbeat — all liveness writes are done.
      clearInterval(heartbeatTimer);
      if (softTimeoutTimer) clearTimeout(softTimeoutTimer);
      if (progressWriteTimer) clearTimeout(progressWriteTimer);
      progressWriteTimer = null;
      progressWritePending = false;
      // A tool can throw before its matching event is emitted, or the process
      // can reach terminal cleanup with an in-flight call still open. Do not
      // leave the SQL grace marker attached to a terminal run.
      if (inFlightWorkCount > 0 || inFlightMarkerSince !== null) {
        inFlightWorkCount = 0;
        mirrorInFlightMarker(false);
      }

      // 5. Persist final status to SQL. Use the conditional write so a zombie
      //    run (reaped or displaced while executing) cannot clobber the newer
      //    status written by the reaper or a replacement run.
      try {
        await insertRunPromise;
        if (!terminalPersistenceError) {
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
            terminalPersistenceEstablished = true;
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

      // 5b. Record terminal failure classification for errored runs so
      //     cut-off / failed chats are queryable for pattern analysis. Read
      //     the actual error event the run emitted (errorCode + message) so
      //     diagnostics reflect the real cause (builder_gateway_timeout,
      //     stale_run, context_length_exceeded, completion_error, …).
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
        // An engine that emitted an error event without a code has NOT told us
        // the failure is unclassifiable — it told us nothing. Recover the code
        // from the message before falling back to "unknown", which the client
        // reads as "do not attempt recovery".
        errorCode ??= classifyTerminalErrorCode(errorDetail);
        runTerminalErrorCode = errorCode ?? "unknown";
        runTerminalErrorDetail = errorDetail;
        await setRunError(runId, errorCode ?? "unknown", errorDetail);
      }

      if (terminalPersistenceError) {
        const reconciled = await reconcileTerminalRunFromEvents(runId).catch(
          () => false,
        );
        if (!reconciled) throw terminalPersistenceError;
        terminalPersistenceEstablished = true;
      }

      // 5c. Emit a terminal-outcome analytics event, reusing the same
      // best-effort tracking seam as $ai_generation (dynamic import + a
      // swallowed catch so a broken/absent provider can never affect the
      // run). Fired AFTER the atomic-complete SQL writes above so it never
      // races the thread_data-before-status invariant those steps exist to
      // protect. `persistedStatus` (not `finalStatus`) is used so a
      // continuation boundary reports as "truncated" rather than a false
      // "completed" — that distinction is the whole point of this event.
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

      // 6. Schedule in-memory cleanup + opportunistic old-run pruning.
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

  // Keep the originating request alive when its runtime supports background
  // work. The callback is passed through request context so concurrent Worker
  // requests cannot overwrite one another through a global binding.
  options?.waitUntil?.(runPromise);

  return run;
}

/**
 * Subscribe to a run's events starting from `fromSeq`.
 * Returns a ReadableStream that replays buffered events then live-tails.
 * Cancelling the stream only unsubscribes — does NOT abort the agent.
 *
 * Falls back to SQL polling when the run is not in local memory
 * (cross-isolate reconnection on Workers).
 */
export function subscribeToRun(
  runId: string,
  fromSeq: number,
): ReadableStream<Uint8Array> | null {
  const run = activeRuns.get(runId);
  if (run) {
    return subscribeInMemory(run, fromSeq);
  }
  // Not in local memory — try SQL (cross-isolate path)
  return subscribeFromSQL(runId, fromSeq);
}

/** In-memory subscription (same isolate, fast path) */
function subscribeInMemory(
  run: ActiveRun,
  fromSeq: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let subscriberRef: ((event: RunEvent) => void) | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream({
    start(controller) {
      const ping = () => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          if (subscriberRef) run.subscribers.delete(subscriberRef);
          if (pingTimer) clearInterval(pingTimer);
        }
      };
      ping();
      pingTimer = setInterval(ping, 10_000);

      // Replay buffered events from fromSeq
      for (let i = fromSeq; i < run.events.length; i++) {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ ...run.events[i].event, seq: run.events[i].seq })}\n\n`,
            ),
          );
        } catch {
          return;
        }
      }

      // If run is already done, close immediately
      if (run.status !== "running") {
        if (pingTimer) clearInterval(pingTimer);
        controller.close();
        return;
      }

      // Subscribe to live events
      subscriberRef = (event: RunEvent) => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ ...event.event, seq: event.seq })}\n\n`,
            ),
          );
          // Close stream after terminal events
          if (isTerminalRunEvent(event.event)) {
            run.subscribers.delete(subscriberRef!);
            if (pingTimer) clearInterval(pingTimer);
            controller.close();
          }
        } catch {
          run.subscribers.delete(subscriberRef!);
        }
      };

      run.subscribers.add(subscriberRef);
    },
    cancel() {
      // Only unsubscribe — do NOT abort the agent run
      if (subscriberRef) run.subscribers.delete(subscriberRef);
      if (pingTimer) clearInterval(pingTimer);
    },
  });
}

/** SQL-based subscription (cross-isolate, polling) */
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
              `data: ${JSON.stringify({ ...event, seq: lastSeq })}\n\n`,
            ),
          );
        } catch {}
        closeStream();
      };

      const poll = async () => {
        if (cancelled) return;
        try {
          // Read new events from SQL
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
            // Advance the cursor first, before any parse/enqueue branch can
            // `continue`/`return`. Otherwise a single corrupt (unparseable)
            // event row is re-fetched on every poll tick forever, wedging the
            // SSE stream open and never delivering a terminal event.
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
                  `data: ${JSON.stringify({ ...parsed, seq })}\n\n`,
                ),
              );
            } catch {
              cancelled = true;
              return;
            }

            // Close on terminal events
            if (isTerminalRunEvent(parsed)) {
              if (pingTimer) clearInterval(pingTimer);
              controller.close();
              return;
            }
          }

          // Check if run completed (no terminal event but status changed)
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
            // Opportunistically reap a stale producer before trusting SQL's
            // "running" status — otherwise a crashed server leaves us polling
            // forever. Throttled independently of the status probe below: a reap
            // cannot match a row younger than RUN_STALE_MS, so running it at the
            // status cadence was ~30 rounds of wasted round trips per run before
            // the first one could do anything. See SQL_SUBSCRIPTION_REAP_POLL_MS.
            if (now - lastReapCheckAt >= SQL_SUBSCRIPTION_REAP_POLL_MS) {
              lastReapCheckAt = now;
              await reapIfStale(runId).catch(() => {});
            }
            const run = await getRunById(runId);
            if (!run || run.status !== "running") {
              // Run ended — do one final event read, then close
              const finalEvents = await getRunEventsSince(runId, lastSeq);
              for (const { seq, eventData } of finalEvents) {
                // Advance first — see the main poll loop above for why.
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
                      `data: ${JSON.stringify({ ...parsed, seq })}\n\n`,
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
                // Same treatment as the `completed` branch below: a synthetic
                // `done` is indistinguishable from a real finish, so an abort
                // rendered as "the agent stopped without sending a final
                // message" and dropped the client out of continuation. Prefer
                // the REAL terminal event, then the reason recorded on the row.
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
                      `data: ${JSON.stringify({
                        ...terminalEvent,
                        seq: existing?.seq ?? lastSeq,
                      })}\n\n`,
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
                // A chunk boundary is status "truncated" (with a continuation
                // terminal_reason, and a chained successor run already carrying
                // the turn). Synthesizing `done` here told the client the agent
                // stopped while it was still working, which surfaced as a
                // premature "stopped without sending a final message". Prefer
                // the run's REAL terminal event, then the terminal_reason,
                // before falling back to `done`. "completed" is still checked
                // for chunk-boundary rows written before the truncated status
                // existed, which linger for one retention window.
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
                      `data: ${JSON.stringify({
                        ...terminalEvent,
                        seq: existing?.seq ?? lastSeq,
                      })}\n\n`,
                    ),
                  );
                } catch {
                  cancelled = true;
                  return;
                }
              } else if (run?.status === "errored") {
                // The run row is terminal but this subscriber's cursor is
                // already past (or never saw) the terminal event. Prefer the
                // REAL last terminal event / row error_detail over inventing
                // a stale_run card — slides prod showed Connection error.
                // rows being mislabeled as stale_run on reconnect because
                // this path always synthesized STALE_RUN_ERROR_EVENT.
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
                      `data: ${JSON.stringify({
                        ...resolved.event,
                        seq: existing?.seq ?? lastSeq,
                      })}\n\n`,
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

          // Schedule next poll
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

/** Get the active run for a thread (if any) — checks memory then SQL */
export function getActiveRunForThread(threadId: string): ActiveRun | null {
  const runId = threadToRun.get(threadId);
  if (runId) {
    const run = activeRuns.get(runId);
    if (run) return run;
  }
  return null;
}

/**
 * `/runs/active` wire compatibility for the `truncated` status.
 *
 * Shipped clients key their chunk-boundary handling off
 * `status === "completed"` plus `terminalReason`
 * (`BACKGROUND_CONTINUATION_TERMINAL_REASONS` in `client/agent-chat-adapter.ts`)
 * and would treat an unrecognized status as non-terminal, re-attaching to the
 * same finished run until a budget expires. SQL keeps the honest status for
 * retention and telemetry; only the wire reports the legacy value, and
 * `terminalReason` on the same payload still distinguishes the two.
 *
 * DELETE THIS once `client/agent-chat-adapter.ts` reads `truncated` directly —
 * that is also what lets its hand-maintained reason mirror go away.
 */
function legacyWireRunStatus(status: string): string {
  return status === "truncated" ? "completed" : status;
}

/**
 * Async version that also checks SQL — for cross-isolate access.
 * Used by the /runs/active endpoint.
 *
 * Returns `heartbeatAt` so the client can independently decide a run is
 * dead even before the server-side stale reap has fired. Returns
 * `lastProgressAt` so the client-side stuck-detector can show a
 * user-visible "this chat looks stuck" affordance when a run is alive
 * (heartbeating) but not actually emitting events. Returns
 * `awaitingRedispatch` so the client's background follow loop can tell a
 * legitimately-deferred `chainServerDrivenContinuation` successor (recovery
 * in progress server-side) apart from a genuinely dead run — see this
 * field's own doc comment below.
 */
export async function getActiveRunForThreadAsync(threadId: string): Promise<{
  runId: string;
  threadId: string;
  turnId: string;
  status: string;
  heartbeatAt: number;
  lastProgressAt: number | null;
  /** How the run was dispatched/continued (foreground, foreground-self-chain, background...). */
  dispatchMode?: string | null;
  /** Compact terminal classification, e.g. done, run_timeout, stale_run. */
  terminalReason?: string | null;
  /**
   * Last reached `_process-run` worker stage as a JSON string
   * `{stage,detail?,at}`. Surfaced so a silent background-worker death is
   * diagnosable from the client WITHOUT the unreadable bg-fn logs.
   */
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
  /**
   * True exactly when this run's `in_flight_since` marker is set — a tool
   * call or A2A `agent_call` delegation is open and has not yet resolved
   * (see `setRunInFlightMarker` / `IN_FLIGHT_RUN_STALE_GRACE_MS` in
   * run-store.ts). This is the SAME signal `reapIfStale` reads to grant its
   * bounded stale-reap grace — computed here from the identical
   * `in_flight_since` column via `getRunByThread`, never re-derived, so the
   * client and the reaper cannot disagree about what "in flight" means.
   *
   * Surfaced on `/runs/active` (agent-chat-plugin.ts) as the
   * server-authoritative alternative to the client-side proxy
   * `RunStuckBanner` currently infers from unresolved `tool-call` content
   * parts in the local message list — that proxy can go stale after a
   * reconnect or reader-mode replay; this cannot, because it is read fresh
   * from SQL on every poll.
   */
  hasInFlightWork: boolean;
} | null> {
  // Check memory first — return both running AND recently-completed runs
  // that still have events in memory. This allows sub-agent tabs to replay
  // the full conversation from completed runs via SSE.
  const memRun = getActiveRunForThread(threadId);
  if (memRun && (memRun.status === "running" || memRun.events.length > 0)) {
    const sqlSnapshot = await fetchRunThreadSnapshot(memRun.runId, threadId);

    // FIX 1 (durable-background incident): a terminal in-memory run (chunk
    // completed at a soft-timeout/no-progress/loop-limit boundary, or any
    // other terminal outcome) never clears `threadToRun` — it stays this
    // thread's resident in-memory candidate for up to CLEANUP_DELAY_MS
    // (5 min), and `fetchRunThreadSnapshot` above returns null the instant
    // SQL's newest row for the thread is no longer THIS run (i.e. a
    // successor already exists). Left alone, every poll that lands on this
    // warm isolate would keep falling back to `memRun.status` below and
    // never discover that a newer, still-running successor already exists
    // in SQL — exactly the "stale terminal run masks a live successor" bug
    // that produced the mid-sentence dead turn. Only pay for the extra SQL
    // read here, in the terminal-candidate branch; the common "still
    // running" poll (the vast majority) never reaches it.
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
          // Definitionally non-terminal and freshly read from SQL above —
          // never the stale in-memory candidate's own state.
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
      // In-memory means this isolate is the producer. By definition, the
      // heartbeat is fresh as of "now" while the run is still running. Once
      // SQL has terminal truth, prefer that timestamp so a stale in-memory
      // buffer cannot keep the browser believing a finished background run is
      // still alive.
      heartbeatAt,
      // For an in-memory run we don't have a separate "last event emit"
      // timestamp tracked in JS — the SQL bump is throttled per-second.
      // Read it back from SQL on demand. For the common case the SQL row
      // is well under 1s old; if it isn't, the stuck-detector will pick
      // it up on the next poll cycle.
      lastProgressAt: sqlSnapshot?.lastProgressAt ?? null,
      dispatchMode: sqlSnapshot?.dispatchMode ?? null,
      terminalReason: sqlSnapshot?.terminalReason ?? null,
      diagStage: sqlSnapshot?.diagStage ?? null,
      // In-memory means this isolate is the live producer — never the
      // "deferred, nobody producing" state this flag identifies.
      awaitingRedispatch: false,
      // Read from the SAME SQL snapshot the other fields above already read
      // (`fetchRunThreadSnapshot` -> `getRunByThread`) rather than the
      // producer's own in-memory `inFlightWorkCount` — this isolate IS the
      // live producer, but there is no separate in-memory channel wired for
      // that counter today, and the SQL marker is written on every 0<->N
      // transition (see run-manager's `trackInFlightWork`), so it is at most
      // one event behind here — the same tolerance `lastProgressAt` above
      // already accepts.
      hasInFlightWork: sqlSnapshot?.inFlightSince != null,
    };
  }
  // Fall back to SQL — also surface recently terminated runs so the client
  // can reconnect and replay synthesized done/error events instead of
  // retrying the original POST. Without this, a POST that fails after the
  // server already accepted (and finished) the run would re-execute the
  // turn and double-apply mutations: the in-memory branch above already
  // returns terminal runs whose events are still buffered, but the SQL
  // path is the only authority once memory has been evicted.
  try {
    const sqlRun = await getRunByThread(threadId, { includeTerminal: true });
    if (!sqlRun) return null;
    if (sqlRun.status === "running") {
      // FALLBACK HARDENING: a background-dispatched run that is still UNCLAIMED
      // (dispatch_mode === 'background', never flipped to 'background-processing')
      // past the tight grace means the bg-fn worker never started — a silent
      // async-worker death that the 202-ack inline fallback can't catch. Reap it
      // early and recoverably (background_worker_never_started) so the run no
      // longer hangs for the full 90s window. Only fires when there is provably
      // no live worker; a claimed/heartbeating run is left alone by the
      // conditional SQL.
      //
      // REDISPATCH-BOUND GUARD (must be kept in lockstep with the "Unclaimed
      // background-run sweep" in agent-chat-plugin.ts and with
      // chainServerDrivenContinuation's deferral in production-agent.ts — do NOT
      // remove this guard without reading those two sites):
      // `chainServerDrivenContinuation` now DEFERS a dispatch-failed successor
      // instead of erroring it — it leaves the row status='running',
      // dispatch_mode='background' with its dispatch_payload intact so the sweep
      // can silently redispatch it. This client poll runs every ~1s while a
      // client is connected, so without this guard it would reap that deferred
      // successor at the 25s unclaimed grace — long before the ~2-min sweep —
      // converting the intended SILENT server-side recovery into a user-visible
      // `background_worker_never_started` manual-retry error (that terminal
      // reason does NOT auto-continue in the client follow loop; only `stale_run`
      // does). While the successor is still inside its redispatch bound we skip
      // this reap and leave it for the sweep. The outer backstops still bound it:
      // `reapIfStale` below reaps a heartbeat-stale background row at 90s
      // (BACKGROUND_RUN_STALE_MS) to the recoverable `stale_run` — which the
      // follow loop AUTO-continues — and once the redispatch bound is exceeded
      // this reap fires loudly as before. So recovery stays automatic in the
      // common case and loud failure is only moved later, never removed.
      //
      // `isUnclaimedBackgroundDispatch` also becomes the `awaitingRedispatch`
      // wire field below once the still-inside-the-bound check passes — see
      // this function's doc comment and the THREE-SITE INVARIANT comment in
      // agent-chat-plugin.ts / production-agent.ts.
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
      // If the producer is dead (no recent heartbeat), reap before the
      // client can see a stale "running" status and enter a reconnect
      // loop it can never exit.
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
        // Same `in_flight_since` column `reapIfStale` (just called above,
        // and it did NOT reap this row) reads for its own grace decision —
        // one source of truth, not a second re-derived notion of "in flight".
        hasInFlightWork: sqlRun.inFlightSince != null,
      };
    }
    if (
      sqlRun.status === "completed" ||
      sqlRun.status === "truncated" ||
      sqlRun.status === "errored"
    ) {
      // Cap how far back we'll surface terminal runs as "active". The goal
      // is to catch the recently-completed-but-reconnecting case, not to
      // resurrect ancient turns when the user reopens an old thread.
      //
      // Measure age from the run's terminal timestamp, not its start. A
      // long-running task that ran 11 minutes and completed five seconds
      // ago should still be reachable — the client's disconnect happened
      // around completion, so completion time is what matters for the
      // "is the user still here waiting?" question. Fall back to the last
      // heartbeat (older deployments may have unset completed_at) and
      // finally to startedAt for ancient rows.
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
        // Terminal already — never the "still deferred, running" state.
        awaitingRedispatch: false,
        // Terminal already — no live work can still be in flight.
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
    // `getRunById` returns a narrow projection today; ask for the row via
    // the thread lookup which carries dispatch/terminal/progress fields.
    const byThread = await getRunByThread(threadId, {
      includeTerminal: true,
    });
    if (byThread && byThread.id === runId) return byThread;
    return null;
  } catch {
    return null;
  }
}

/**
 * FIX 1 (durable-background incident): find a genuinely newer, still-running
 * SQL row for the SAME turn as a terminal in-memory `ActiveRun` — used only
 * when `fetchRunThreadSnapshot` found no SQL row matching the in-memory
 * run's own id (i.e. SQL's newest row for the thread is a different run).
 * `getRunByThread` always returns the thread's newest row by `started_at`,
 * so this is the same read `fetchRunThreadSnapshot` already made; we just
 * don't throw its result away when the id doesn't match.
 *
 * Scoped to the SAME `turnId` (not just the same thread) so an unrelated,
 * later user turn on the same thread is never mistaken for a continuation
 * successor of this one.
 */
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

/** Get a run by ID */
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

/** Explicitly abort a run (e.g. Stop button). */
export function abortRun(runId: string, reason: string = "user"): boolean {
  const abortedInMemory = abortRunInMemory(runId, reason);
  // Also mark as aborted in SQL (for cross-isolate abort on Workers)
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
    // The local run is already stopped. A transient durable cleanup failure
    // must not turn the user's Stop/Retry request into a 500 after that
    // irreversible in-memory outcome. Capture it for repair/reaping and let
    // the request report the abort it did complete.
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

/**
 * Stop the whole turn `runId` belongs to, not just that run.
 *
 * A turn is executed as a chain of runs: every `loop_limit` / `auto_continue`
 * boundary and every background handoff starts a successor run with a NEW run
 * id under the same turn id. Aborting one run therefore only ends the current
 * chunk — the successor claims itself and the turn keeps going, which is what
 * users see as "Stop didn't stop it". The durable turn-abort marker is the only
 * thing the successor-claim path (`isTurnAborted`) consults.
 */
export async function abortTurnDurably(
  runId: string,
  reason: string = "user",
): Promise<void> {
  const memRun = activeRuns.get(runId);
  // In-memory first: a foreground run's SQL insert is async, so the row may not
  // exist yet when Stop lands moments after send.
  const ref = memRun
    ? { threadId: memRun.threadId, turnId: memRun.turnId }
    : await getRunTurnRef(runId).catch(() => null);
  if (!ref) return;
  try {
    await markTurnAborted(ref.threadId, ref.turnId, reason);
  } catch (error) {
    // The current run is already stopped; a failed marker write must not turn
    // Stop into a 500. Successors will keep running — capture it so that is
    // visible rather than silent.
    captureError(error, {
      route: "/_agent-native/agent-chat/runs/:id/abort",
      aiTraceId: runId,
      tags: { source: "agent-run-manager", phase: "abort-turn" },
      extra: { runId, reason, ...ref },
    });
  }
}

// Re-export so callers can avoid importing from run-store directly.
export { tryClaimRunSlot } from "./run-store.js";

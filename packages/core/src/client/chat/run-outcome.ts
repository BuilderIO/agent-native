import type { AgentError, AgentEvent } from "@agent-native/agentkit/protocol";

import { isRequestedStopAbortReason } from "../../agent/abort-reasons.js";
import {
  isTimeLimitStop,
  type AutoContinueRefusalCode,
} from "../../agent/auto-continue.js";
import { isContinuationTerminalReason } from "../../agent/types.js";
import {
  BACKGROUND_FUNCTION_WALL_HEADROOM_MS,
  BACKGROUND_FUNCTION_WALL_MS,
} from "../../app-config/run-lifecycle-invariants.js";

/**
 * Everything a user can be told about an agent run. The server owns which one
 * applies; a browser stream that closed is evidence for none of them.
 *
 * - `running`: the agent is still working (including handing off to a
 *   successor run, or still busy with an earlier message).
 * - `succeeded`: the run finished and reported its result.
 * - `stopped`: someone asked it to stop.
 * - `interrupted`: the run ended before finishing for an infrastructure reason
 *   (time budget, lost worker, cut stream). Continuing or retrying can work.
 * - `failed`: the run reported a real failure (provider, credentials, server).
 * - `unverified`: the browser cannot reach the server to find out yet.
 */
export const RUN_OUTCOMES = [
  "running",
  "succeeded",
  "stopped",
  "interrupted",
  "failed",
  "unverified",
] as const;

export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/**
 * Codes that described "the agent stopped / is stuck" one incident at a time.
 * They survive only as telemetry detail; the user sees their outcome. A new
 * code is added here with its outcome or it does not type-check.
 */
export const LEGACY_RUN_CODES = [
  "stream_ended",
  "action_not_started",
  "background_run_lost",
  "run_budget_exhausted",
  "aborted_abort_check_unavailable",
  "aborted_adapter-dispose",
  "aborted_protocol-cancel",
  "connection_error",
  "run_stream_failed",
  "run_timeout",
  "builder_gateway_stream_ended",
  "thread_not_found",
  "not_found",
  "interrupted_before_reporting",
  "run_slot_busy",
  "http_409",
  "stale_run",
  "background_worker_never_started",
  "background_worker_failed",
  "background_continuation_dispatch_failed",
  "background_continuation_dispatch_deferred",
  "turn_continuation_budget_exhausted",
  "turn_wall_clock_budget_exhausted",
  "turn_budget_unreadable",
  "run_record_missing",
  "unknown_run_status",
  "run_terminal_lookup_failed",
  "run_subscription_poll_failed",
  "run_event_persistence_failed",
  "run_missing_terminal",
  "run_terminated",
  "completion_error",
  "runtime_error",
  "loop_limit",
  "no_progress",
  "max_tokens",
  "gateway_timeout",
  "network_interrupted",
  "rate_limited",
  "missing_api_key",
  "missing_credentials",
  "run_events_unreachable",
  "run_state_unreadable",
  "auto_continue_cap_reached",
  "auto_continue_unavailable",
  "auto_continue_history_unreadable",
] as const;

export type LegacyRunCode = (typeof LEGACY_RUN_CODES)[number];

const LEGACY_RUN_CODE_OUTCOMES = {
  stream_ended: "interrupted",
  action_not_started: "interrupted",
  background_run_lost: "interrupted",
  run_budget_exhausted: "interrupted",
  aborted_abort_check_unavailable: "interrupted",
  "aborted_adapter-dispose": "interrupted",
  "aborted_protocol-cancel": "stopped",
  connection_error: "failed",
  run_stream_failed: "interrupted",
  run_timeout: "interrupted",
  builder_gateway_stream_ended: "interrupted",
  thread_not_found: "failed",
  not_found: "failed",
  interrupted_before_reporting: "interrupted",
  run_slot_busy: "running",
  http_409: "running",
  stale_run: "interrupted",
  background_worker_never_started: "interrupted",
  background_worker_failed: "interrupted",
  background_continuation_dispatch_failed: "interrupted",
  background_continuation_dispatch_deferred: "running",
  turn_continuation_budget_exhausted: "interrupted",
  turn_wall_clock_budget_exhausted: "interrupted",
  turn_budget_unreadable: "interrupted",
  run_record_missing: "interrupted",
  unknown_run_status: "interrupted",
  run_terminal_lookup_failed: "interrupted",
  run_subscription_poll_failed: "unverified",
  run_event_persistence_failed: "failed",
  run_missing_terminal: "interrupted",
  run_terminated: "interrupted",
  completion_error: "failed",
  runtime_error: "failed",
  loop_limit: "interrupted",
  no_progress: "interrupted",
  max_tokens: "interrupted",
  gateway_timeout: "interrupted",
  network_interrupted: "interrupted",
  rate_limited: "interrupted",
  missing_api_key: "failed",
  missing_credentials: "failed",
  run_events_unreachable: "unverified",
  run_state_unreadable: "unverified",
  auto_continue_cap_reached: "interrupted",
  auto_continue_unavailable: "interrupted",
  auto_continue_history_unreadable: "interrupted",
} as const satisfies Record<LegacyRunCode, RunOutcome>;

function isLegacyRunCode(code: string): code is LegacyRunCode {
  return Object.hasOwn(LEGACY_RUN_CODE_OUTCOMES, code);
}

/**
 * The user-visible outcome of a run error code. A code nobody mapped is a
 * real failure carrying the server's own message, never a quiet success.
 */
export function runOutcomeForCode(code: string | undefined): RunOutcome {
  if (!code) return "failed";
  if (isLegacyRunCode(code)) return LEGACY_RUN_CODE_OUTCOMES[code];
  if (code.startsWith("aborted_")) {
    return isRequestedStopAbortReason(code.slice("aborted_".length))
      ? "stopped"
      : "interrupted";
  }
  return "failed";
}

/** The outcome a protocol event log currently shows its reader. */
export function runOutcomeOfEvents(events: readonly AgentEvent[]): RunOutcome {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "run.completed") return "succeeded";
    if (event.type === "run.cancelled") return "stopped";
    if (event.type === "run.failed") return runOutcomeForCode(event.error.code);
  }
  return "running";
}

/**
 * Where a run's terminal event came from: the run's own stream delivered it
 * (`stream`), the browser read the server's record of the run after the stream
 * closed and ended it from that (`authority`), or a runtime with no such record
 * ended it because its stream could not be resumed (`pipe`: not verified), or
 * the person's own action ended it here (`local`: Stop, a refused connection).
 */
export type RunTerminalSource = "stream" | "authority" | "pipe" | "local";

/** One run's outcome as the browser ended it, for telemetry. */
export interface RunOutcomeReport {
  readonly runId: string;
  readonly threadId: string;
  readonly outcome: RunOutcome;
  /** The legacy code that named this outcome one incident at a time. */
  readonly code?: string;
  readonly retryable?: boolean;
  readonly terminalSource: RunTerminalSource;
  /**
   * A stream closed with no terminal event, and the outcome then came from the
   * server's own record or terminal event (never the browser's guess).
   */
  readonly verifiedAfterPipeClosed: boolean;
  /** Stream resumes tried without new events (authority-less runtimes). */
  readonly resumeAttempts: number;
  /** Authority reads that produced no new run events. */
  readonly quietReads: number;
  /** Re-reads of a finished run to receive its own terminal event. */
  readonly drainAttempts: number;
}

/** The server's record of the newest run carrying a turn. */
export type ServerRunState =
  | {
      readonly status:
        | "running"
        | "completed"
        | "truncated"
        | "errored"
        | "aborted";
      readonly runId: string;
      readonly turnId?: string;
      /** Server clock, epoch ms. */
      readonly startedAt?: number;
      readonly dispatchMode?: string;
      readonly terminalReason?: string | null;
    }
  | { readonly status: "missing" };

export type RunAuthorityRead =
  | { readonly kind: "read"; readonly state: ServerRunState }
  | { readonly kind: "unreachable"; readonly error: unknown }
  /**
   * The server answered, but not with the run's state: a definitive refusal
   * (signed out, no access) or a body nobody can read. Asking again will not
   * change it, and it says nothing about whether the run is still going.
   */
  | { readonly kind: "refused"; readonly status?: number };

/** Re-reads of a run the server already ended, to receive its own terminal event. */
export interface TerminalDrain {
  readonly runId: string;
  readonly attempts: number;
  /** A drain stream was read to its end without a connection failure. */
  readonly readToEnd: boolean;
}

export interface StreamClosedContext {
  /** The runtime run the closed stream was reading. */
  readonly runId: string;
  readonly drain?: TerminalDrain;
  /** When the current wait for a successor run began. */
  readonly waitingSinceMs?: number;
  /** Consecutive authority reads that produced no new run events. */
  readonly quietReads: number;
  /** Consecutive attempts to open the run's event stream that failed. */
  readonly subscribeFailures: number;
  readonly nowMs: number;
  /**
   * Time-limit stops this reader already asked the server to continue, with
   * the server's refusal when it refused. Absent: this reader cannot continue
   * a turn, so a time-limit stop ends as interrupted.
   */
  readonly autoContinue?: {
    readonly asked: ReadonlyMap<string, AutoContinueRefusalCode | null>;
  };
}

export type StreamClosedDecision =
  | {
      readonly type: "resubscribe";
      readonly runId: string;
      readonly turnId?: string;
      readonly delayMs: number;
      /** Re-reading a run the server already ended, to receive its own terminal event. */
      readonly drain: boolean;
    }
  | { readonly type: "wait"; readonly delayMs: number }
  /** Ask the server to continue the turn from the run it stopped at its time limit. */
  | {
      readonly type: "continue";
      readonly runId: string;
      readonly turnId: string;
    }
  | { readonly type: "terminal"; readonly outcome: "succeeded" | "stopped" }
  | {
      readonly type: "terminal";
      readonly outcome: "interrupted" | "failed" | "unverified";
      readonly error: AgentError;
    };

/** Copy for outcomes the browser ends from the server's record of a run. */
export const RUN_INTERRUPTED_MESSAGE = "The agent stopped before finishing.";
export const RUN_FAILED_MESSAGE = "The agent run failed.";
export const RUN_UNVERIFIED_MESSAGE =
  "This chat lost track of the agent, which may still be running. Reload to see its progress.";
export const RUN_SIGNED_OUT_MESSAGE =
  "You're signed out, so this chat can't follow the agent. Sign in again, then reload.";

const MAX_AUTHORITY_BACKOFF_MS = 15_000;
/**
 * Attempts to read a finished run's event stream to its end before its outcome
 * is reported from the server's record alone (the thread history still
 * carries the persisted reply).
 */
const MAX_TERMINAL_DRAIN_ATTEMPTS = 3;
/**
 * Failed attempts to open a running run's event stream (about two minutes of
 * backoff) before the browser says it can no longer follow the run. Without a
 * bound, a successor whose events endpoint keeps refusing is re-requested
 * back to back for as long as the run lives.
 */
export const MAX_SUBSCRIBE_FAILURES = 12;

export function authorityBackoffMs(quietReads: number): number {
  if (quietReads <= 0) return 0;
  return Math.min(250 * 2 ** (quietReads - 1), MAX_AUTHORITY_BACKOFF_MS);
}

function terminalCode(terminalReason: string | null | undefined): string {
  const reason = terminalReason?.trim() ?? "";
  return reason.startsWith("error:") ? reason.slice("error:".length) : reason;
}

function interruptedOrFailed(
  code: string,
  runId: string,
): StreamClosedDecision {
  const outcome = runOutcomeForCode(code);
  if (outcome === "stopped") return { type: "terminal", outcome };
  const interrupted = outcome !== "failed";
  return {
    type: "terminal",
    outcome: interrupted ? "interrupted" : "failed",
    error: {
      code,
      message: interrupted ? RUN_INTERRUPTED_MESSAGE : RUN_FAILED_MESSAGE,
      retryable: interrupted,
      details: { runId, terminalReason: code },
    },
  };
}

/** The browser cannot follow the run any more; the server may still be running it. */
function unverified(
  code: "run_events_unreachable" | "run_state_unreadable",
  runId: string,
  status?: number,
): StreamClosedDecision {
  return {
    type: "terminal",
    outcome: "unverified",
    error: {
      code,
      message: status === 401 ? RUN_SIGNED_OUT_MESSAGE : RUN_UNVERIFIED_MESSAGE,
      retryable: true,
      details: { runId, ...(status === undefined ? {} : { status }) },
    },
  };
}

/**
 * What to do after a run's event stream closed without a terminal event,
 * decided only from the server's record of the run. A closed stream is a fact
 * about the connection: it never ends the run by itself.
 */
export function decideAfterStreamClosed(
  read: RunAuthorityRead,
  context: StreamClosedContext,
): StreamClosedDecision {
  const backoff = authorityBackoffMs(context.quietReads);
  if (read.kind === "unreachable") return { type: "wait", delayMs: backoff };
  if (read.kind === "refused") {
    return unverified("run_state_unreadable", context.runId, read.status);
  }
  const state = read.state;
  if (state.status === "missing") {
    return interruptedOrFailed("run_record_missing", context.runId);
  }
  // A successor is opened at once, unless opening its stream already failed.
  const resubscribe = (
    drain: boolean,
    retries: number,
  ): StreamClosedDecision => ({
    type: "resubscribe",
    runId: state.runId,
    ...(state.turnId ? { turnId: state.turnId } : {}),
    delayMs: authorityBackoffMs(
      Math.max(
        state.runId === context.runId ? retries : 0,
        context.subscribeFailures,
      ),
    ),
    drain,
  });
  if (state.status === "running") {
    // A background run's host keeps it alive until its wall budget, so an
    // events stream that will not open is no reason to stop following it
    // before then; past it, the usual subscribe budget applies.
    const wallDeadlineMs =
      state.dispatchMode?.startsWith("background") &&
      state.startedAt !== undefined
        ? state.startedAt +
          BACKGROUND_FUNCTION_WALL_MS -
          BACKGROUND_FUNCTION_WALL_HEADROOM_MS
        : undefined;
    const withinWall =
      wallDeadlineMs !== undefined && context.nowMs < wallDeadlineMs;
    return context.subscribeFailures >= MAX_SUBSCRIBE_FAILURES && !withinWall
      ? unverified("run_events_unreachable", state.runId)
      : resubscribe(false, context.quietReads);
  }
  const drain =
    context.drain?.runId === state.runId ? context.drain : undefined;
  if (
    !drain?.readToEnd &&
    (drain?.attempts ?? 0) < MAX_TERMINAL_DRAIN_ATTEMPTS
  ) {
    return resubscribe(true, drain?.attempts ?? 0);
  }

  const reason = state.terminalReason?.trim() ?? "";
  if (state.status === "completed") {
    return { type: "terminal", outcome: "succeeded" };
  }
  const abortReason =
    state.status !== "aborted"
      ? undefined
      : reason.startsWith("aborted:")
        ? reason.slice("aborted:".length)
        : reason || "user";
  // A chunk boundary hands the turn to a successor run that the turn's newest
  // row will name once it exists; until then the turn is still continuing.
  if (
    state.status === "truncated" ||
    (abortReason !== undefined && isContinuationTerminalReason(abortReason))
  ) {
    // A time-limit stop continues in the same turn, once per stopped run; the
    // server decides whether the turn still may (its cap is durable there).
    const turnId = isTimeLimitStop(state) ? state.turnId : undefined;
    const asked = turnId ? context.autoContinue?.asked : undefined;
    const refusal = asked?.get(state.runId);
    if (refusal) return interruptedOrFailed(refusal, state.runId);
    const proceed =
      turnId && asked && !asked.has(state.runId)
        ? ({ type: "continue", runId: state.runId, turnId } as const)
        : undefined;
    // Only a background or self-chaining run can still get a server successor.
    if (proceed && state.dispatchMode === "foreground") return proceed;
    const waitingSinceMs = context.waitingSinceMs ?? context.nowMs;
    if (context.nowMs - waitingSinceMs < BACKGROUND_FUNCTION_WALL_HEADROOM_MS) {
      return { type: "wait", delayMs: backoff };
    }
    if (proceed) return proceed;
    return interruptedOrFailed(
      abortReason ?? (reason || "stream_ended"),
      state.runId,
    );
  }
  if (abortReason !== undefined) {
    return interruptedOrFailed(`aborted_${abortReason}`, state.runId);
  }
  return interruptedOrFailed(
    terminalCode(reason) || "runtime_error",
    state.runId,
  );
}

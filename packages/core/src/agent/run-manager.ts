import { captureError } from "../server/capture-error.js";
import { isLlmCredentialError } from "./engine/credential-errors.js";
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
  cleanupOldRuns,
  updateRunHeartbeat,
  bumpRunProgress,
  reapIfStale,
  reapUnclaimedBackgroundRun,
  reconcileTerminalRunFromEvents,
  ensureTerminalRunEvent,
  setRunError,
  setRunTerminalReason,
  STALE_RUN_ERROR_EVENT,
} from "./run-store.js";
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
  startedAt: number;
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

/** Default SQL retention for completed run event logs (24 hours). */
export const DEFAULT_COMPLETED_RUN_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Default SQL retention for errored/aborted run event logs (7 days). Kept
 * longer than completed runs so cut-off / failed chats survive for pattern
 * analysis (listErroredRuns) — these are rare and small, and they are exactly
 * the runs we need to study to keep hardening reliability.
 */
export const DEFAULT_ERRORED_RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How recently a terminal run must have started for `/runs/active` to surface
 * it. Reconnect after this window won't replay the run — typical real-world
 * disconnects resolve in seconds, so 10 minutes is generous while keeping us
 * from resurrecting ancient turns when the user reopens an old thread.
 */
export const TERMINAL_RUN_RECONNECT_WINDOW_MS = 10 * 60 * 1000;

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

export function resolveSqlSubscriptionPollMs(
  now: number,
  activePollUntil: number,
): number {
  return now < activePollUntil
    ? SQL_SUBSCRIPTION_ACTIVE_POLL_MS
    : SQL_SUBSCRIPTION_IDLE_POLL_MS;
}

const PROVIDER_RATE_LIMITED_ERROR_CODE = "provider_rate_limited";

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

function getEngineRunErrorCode(err: EngineError): string | undefined {
  if (err.errorCode) return err.errorCode;
  if (err.statusCode === 429) return PROVIDER_RATE_LIMITED_ERROR_CODE;
  return undefined;
}

function getEngineRunErrorDetails(err: EngineError): string | undefined {
  if (err.statusCode === 429) return err.message;
  return undefined;
}

function shouldCaptureRunError(err: unknown): boolean {
  if (!(err instanceof EngineError)) return true;
  const errorCode = getEngineRunErrorCode(err);
  if (isLlmCredentialError(err, errorCode)) return false;
  if (err.statusCode === 401 || err.statusCode === 403) return false;
  if (/^40[13] status code\b/i.test(err.message)) return false;
  if (err.message.trim().toLowerCase() === "connection error.") return false;
  if (!errorCode) return true;
  const normalizedCode = errorCode.toLowerCase();
  return (
    !normalizedCode.startsWith("credits-limit") &&
    normalizedCode !== "builder_gateway_network_error" &&
    normalizedCode !== "provider_rate_limited" &&
    normalizedCode !== "rate_limit_exceeded"
  );
}

export interface StartRunOptions {
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

function isHostedRuntime(): boolean {
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
  const envValue = process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
  if (envValue !== undefined) {
    const raw = Number(envValue);
    if (Number.isFinite(raw) && raw >= 0) return clampHosted(raw);
  }
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
  const envValue = process.env.AGENT_RUN_RETENTION_MS;
  if (envValue !== undefined) {
    const raw = Number(envValue);
    if (Number.isFinite(raw) && raw >= 0) return raw;
  }
  return DEFAULT_COMPLETED_RUN_RETENTION_MS;
}

export function resolveErroredRunRetentionMs(): number {
  const envValue = process.env.AGENT_ERRORED_RUN_RETENTION_MS;
  if (envValue !== undefined) {
    const raw = Number(envValue);
    if (Number.isFinite(raw) && raw >= 0) return raw;
  }
  return DEFAULT_ERRORED_RUN_RETENTION_MS;
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

function terminalReasonForRun(
  finalStatus: "completed" | "errored" | "aborted",
  terminalEvent: AgentChatEvent | null,
  abortReason: string | undefined,
  completionError: unknown,
): string {
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

function abortInMemoryRun(run: ActiveRun, reason: string = "user") {
  run.abortReason = reason;
  run.status = "aborted";
  if (threadToRun.get(run.threadId) === run.runId) {
    threadToRun.delete(run.threadId);
  }
  run.abort.abort(reason);
  for (const subscriber of run.subscribers) {
    try {
      subscriber({ seq: run.events.length, event: { type: "done" } });
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
): ActiveRun {
  // If there's already a run for this thread, abort it
  const existingRunId = threadToRun.get(threadId);
  if (existingRunId) {
    abortRun(existingRunId);
  }

  const abort = new AbortController();
  let softTimedOut = false;
  const run: ActiveRun = {
    runId,
    threadId,
    turnId: options?.turnId ?? runId,
    events: [],
    status: "running",
    subscribers: new Set(),
    abort,
    startedAt: Date.now(),
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
  const insertRunPromise = insertRun(runId, threadId, options?.turnId).catch(
    (error) => {
      captureRunPersistenceError(error, "insert-run");
    },
  );

  // Per-run event persistence chain: events are chained so SQL inserts commit
  // in seq order. Without this, a fast seq=5 commit before a slow seq=4 means
  // the SQL poller advances its cursor past seq=4 (lastSeq = 5+1 = 6) and
  // reconnecting clients permanently miss that event (silent gap). Chaining
  // per run ensures order without blocking the fast in-memory SSE path.
  let persistenceChain: Promise<void> = Promise.resolve();

  // Throttle the durable progress timestamp to at most once per second so
  // a chatty token-by-token stream doesn't translate into one DB write per
  // chunk. The stuck-detector threshold is on the order of tens of seconds,
  // so 1s resolution is plenty.
  let lastProgressBumpAt = 0;
  const preparingActivityBytes = new Map<string, number>();
  let eventPersistenceErrorCaptured = false;
  const bumpProgressIfDue = () => {
    const now = Date.now();
    if (now - lastProgressBumpAt < 1000) return;
    lastProgressBumpAt = now;
    bumpRunProgress(runId).catch(() => {});
  };
  const shouldBumpProgressForEvent = (event: AgentChatEvent): boolean => {
    if (event.type === "stream_keepalive") return false;
    if (event.type === "activity" && isPreparingActionActivityEvent(event)) {
      const toolKey =
        event.id?.trim() || event.tool?.trim() || event.label.trim();
      const progressBytes =
        typeof event.progressBytes === "number" &&
        Number.isFinite(event.progressBytes) &&
        event.progressBytes >= 0
          ? Math.floor(event.progressBytes)
          : undefined;
      if (progressBytes === undefined) return false;
      if (!event.id?.trim()) return progressBytes > 0;
      const previousBytes = preparingActivityBytes.get(toolKey) ?? 0;
      if (progressBytes <= previousBytes) {
        preparingActivityBytes.set(
          toolKey,
          Math.max(previousBytes, progressBytes),
        );
        return false;
      }
      preparingActivityBytes.set(toolKey, progressBytes);
      return true;
    }
    if (event.type === "tool_start" || event.type === "tool_done") {
      preparingActivityBytes.clear();
    }
    if (
      event.type === "clear" ||
      event.type === "done" ||
      event.type === "error"
    ) {
      preparingActivityBytes.clear();
    }
    return true;
  };

  // Periodic SQL abort check interval (for cross-isolate abort on Workers).
  // Also self-aborts when our row is no longer status='running' — catches the
  // false-stale-reap zombie scenario where the reaper flipped the row while
  // this isolate was briefly unable to heartbeat (DB latency / GC pause).
  let lastAbortCheck = Date.now() - 3000;
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
      .catch(() => {});
  };

  // Heartbeat: bump heartbeat_at every 1.5s so watchers can detect a dead
  // producer (process crash, HMR restart, isolate eviction) quickly and
  // reap the row. Paired with RUN_STALE_MS (6s) — 4x the interval to
  // tolerate transient DB slowness without false positives.
  const heartbeatTimer: ReturnType<typeof setInterval> = setInterval(() => {
    updateRunHeartbeat(runId).catch(() => {});
    checkSqlAbort();
  }, 1500);
  const softTimeoutMs = resolveRunSoftTimeoutMs(options?.softTimeoutMs, {
    useHostedDefault: options?.useHostedSoftTimeoutDefault === true,
    backgroundFunction: options?.backgroundFunction === true,
  });
  const softTimeoutTimer =
    softTimeoutMs > 0
      ? setTimeout(() => {
          if (run.status !== "running" || abort.signal.aborted) return;
          softTimedOut = true;
          send({
            type: "auto_continue",
            reason: "run_timeout",
          });
          abort.abort("run_timeout");
        }, softTimeoutMs)
      : null;
  let pendingTerminalEvent: RunEvent | null = null;

  const captureRunError = (error: unknown, phase: "run" | "completion") => {
    const errorCode =
      error instanceof EngineError ? getEngineRunErrorCode(error) : undefined;
    captureError(error, {
      route: "/_agent-native/agent-chat",
      tags: {
        source: "agent-run-manager",
        phase,
        runStatus: run.status,
        softTimedOut: softTimedOut ? "true" : "false",
        abortReason: run.abortReason,
        errorCode,
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
    if (shouldBumpProgressForEvent(runEvent.event)) {
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
      const errorCode =
        err instanceof EngineError ? getEngineRunErrorCode(err) : undefined;
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
      if (
        onComplete &&
        !(run.status === "aborted" && run.abortReason === "no_progress")
      ) {
        try {
          const completionRun: ActiveRun = pendingTerminalEvent
            ? { ...run, events: [...run.events, pendingTerminalEvent] }
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

      // 2. Compute final status. If the completion callback threw, we'd
      //    rather mark the run errored than claim success with incomplete
      //    thread_data.
      const finalStatus =
        run.status === "aborted"
          ? "aborted"
          : run.status === "errored" || completionError
            ? "errored"
            : "completed";
      const terminalReason = terminalReasonForRun(
        finalStatus,
        pendingTerminalEvent?.event ?? null,
        run.abortReason,
        completionError,
      );

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
        const terminalEvent: AgentChatEvent =
          finalStatus === "completed"
            ? (pendingTerminalEvent?.event ?? { type: "done" })
            : pendingTerminalEvent?.event.type === "error"
              ? pendingTerminalEvent.event
              : pendingTerminalEvent?.event.type === "auto_continue"
                ? // The run was checkpointed at a soft-timeout/loop boundary and
                  // is recoverable: the partial turn is in agent_run_events and
                  // the continuation run will re-attempt the thread_data save.
                  // Even though the completion save failed (finalStatus stays
                  // "errored" for SQL/diagnostics), re-emit the auto_continue so
                  // the client resumes instead of seeing a dead chat.
                  pendingTerminalEvent.event
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
            event: terminalEvent,
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
          }
        }
      }
      for (const subscriber of run.subscribers) {
        run.subscribers.delete(subscriber);
      }

      // 4. Stop the heartbeat — all liveness writes are done.
      clearInterval(heartbeatTimer);
      if (softTimeoutTimer) clearTimeout(softTimeoutTimer);

      // 5. Persist final status to SQL. Use the conditional write so a zombie
      //    run (reaped or displaced while executing) cannot clobber the newer
      //    status written by the reaper or a replacement run.
      try {
        await insertRunPromise;
        if (!terminalPersistenceError) {
          let statusUpdated = false;
          try {
            statusUpdated = await updateRunStatusIfRunning(runId, finalStatus);
          } catch {
            statusUpdated = false;
          }
          if (statusUpdated) {
            await setRunTerminalReason(runId, terminalReason);
          } else {
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
        for (let i = run.events.length - 1; i >= 0; i--) {
          const ev = run.events[i].event as {
            type: string;
            error?: string;
            errorCode?: string;
            details?: string;
          };
          if (ev.type === "error") {
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
        await setRunError(runId, errorCode ?? "unknown", errorDetail);
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

  // On Cloudflare Workers, keep the isolate alive for this run
  try {
    const cfCtx = globalThis.__cf_ctx;
    if (cfCtx?.waitUntil) {
      cfCtx.waitUntil(runPromise);
    }
  } catch {
    // Not on Workers — ignore
  }

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

      const poll = async () => {
        if (cancelled) return;
        try {
          // Read new events from SQL
          const events = await getRunEventsSince(runId, lastSeq);
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
                const pollMs = resolveSqlSubscriptionPollMs(
                  now,
                  activePollUntil,
                );
                pollTimer = setTimeout(poll, pollMs);
              }
              return;
            }
            lastStatusCheckAt = now;
            // Opportunistically reap a stale producer before trusting SQL's
            // "running" status — otherwise a crashed server leaves us polling
            // forever.
            await reapIfStale(runId).catch(() => {});
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
                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "done", seq: lastSeq })}\n\n`,
                    ),
                  );
                } catch {
                  cancelled = true;
                  return;
                }
              } else if (run?.status === "completed") {
                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "done", seq: lastSeq })}\n\n`,
                    ),
                  );
                } catch {
                  cancelled = true;
                  return;
                }
              } else if (run?.status === "errored") {
                // The run row was flipped to `errored` but no terminal event
                // was ever persisted — almost always means a reaper's silent
                // `appendTerminalRunEvent(...).catch(() => {})` swallowed a
                // transient DB error, so the user-facing situation is the
                // same as a stale-run reap. Send the friendly event AND try
                // to persist it so future reconnects replay it from SQL
                // rather than regenerating it (the user used to see a bare
                // "run_terminal_event_missing" debug string here).
                await ensureTerminalRunEvent(
                  runId,
                  STALE_RUN_ERROR_EVENT,
                ).catch(() => {});
                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        ...STALE_RUN_ERROR_EVENT,
                        seq: lastSeq,
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
            const pollMs = resolveSqlSubscriptionPollMs(
              Date.now(),
              activePollUntil,
            );
            pollTimer = setTimeout(poll, pollMs);
          }
        } catch {
          // SQL error — close stream
          try {
            if (pingTimer) clearInterval(pingTimer);
            controller.close();
          } catch {}
        }
      };

      // Verify run exists before starting poll
      try {
        const run = await getRunById(runId);
        if (!run) {
          if (pingTimer) clearInterval(pingTimer);
          controller.close();
          return;
        }
      } catch {
        controller.close();
        return;
      }

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
 * Async version that also checks SQL — for cross-isolate access.
 * Used by the /runs/active endpoint.
 *
 * Returns `heartbeatAt` so the client can independently decide a run is
 * dead even before the server-side stale reap has fired. Returns
 * `lastProgressAt` so the client-side stuck-detector can show a
 * user-visible "this chat looks stuck" affordance when a run is alive
 * (heartbeating) but not actually emitting events.
 */
export async function getActiveRunForThreadAsync(threadId: string): Promise<{
  runId: string;
  threadId: string;
  turnId: string;
  status: string;
  heartbeatAt: number;
  lastProgressAt: number | null;
  /** How the run was dispatched (NULL/foreground, background, background-processing). */
  dispatchMode?: string | null;
  /** Compact terminal classification, e.g. done, run_timeout, stale_run. */
  terminalReason?: string | null;
  /**
   * Last reached `_process-run` worker stage as a JSON string
   * `{stage,detail?,at}`. Surfaced so a silent background-worker death is
   * diagnosable from the client WITHOUT the unreadable bg-fn logs.
   */
  diagStage?: string | null;
} | null> {
  // Check memory first — return both running AND recently-completed runs
  // that still have events in memory. This allows sub-agent tabs to replay
  // the full conversation from completed runs via SSE.
  const memRun = getActiveRunForThread(threadId);
  if (memRun && (memRun.status === "running" || memRun.events.length > 0)) {
    return {
      runId: memRun.runId,
      threadId: memRun.threadId,
      turnId: memRun.turnId,
      status: memRun.status,
      // In-memory means this isolate is the producer. By definition, the
      // heartbeat is fresh as of "now" — the client can trust this.
      heartbeatAt: Date.now(),
      // For an in-memory run we don't have a separate "last event emit"
      // timestamp tracked in JS — the SQL bump is throttled per-second.
      // Read it back from SQL on demand. For the common case the SQL row
      // is well under 1s old; if it isn't, the stuck-detector will pick
      // it up on the next poll cycle.
      lastProgressAt: await fetchLastProgressAt(memRun.runId),
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
      // longer hangs for the full 90s window and the client's recoverable-error
      // path can re-drive the turn. Only fires when there is provably no live
      // worker; a claimed/heartbeating run is left alone by the conditional SQL.
      if (sqlRun.dispatchMode === "background") {
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
      };
    }
    if (sqlRun.status === "completed" || sqlRun.status === "errored") {
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
        status: sqlRun.status,
        heartbeatAt: sqlRun.heartbeatAt ?? sqlRun.startedAt,
        lastProgressAt: sqlRun.lastProgressAt,
        dispatchMode: sqlRun.dispatchMode,
        terminalReason: sqlRun.terminalReason,
        diagStage: sqlRun.diagStage,
      };
    }
  } catch {
    // SQL error — fall through
  }
  return null;
}

async function fetchLastProgressAt(runId: string): Promise<number | null> {
  try {
    const run = await getRunById(runId);
    if (!run) return null;
    // `getRunById` returns a narrow projection today; ask for the row via
    // the thread lookup which carries last_progress_at.
    const byThread = await getRunByThread(run.threadId, {
      includeTerminal: true,
    });
    if (byThread && byThread.id === runId) return byThread.lastProgressAt;
    return null;
  } catch {
    return null;
  }
}

/** Get a run by ID */
export function getRun(runId: string): ActiveRun | null {
  return activeRuns.get(runId) ?? null;
}

/** Explicitly abort a run (e.g. Stop button) */
export function abortRun(runId: string, reason: string = "user"): boolean {
  const run = activeRuns.get(runId);
  if (run) {
    abortInMemoryRun(run, reason);
  }
  // Also mark as aborted in SQL (for cross-isolate abort on Workers)
  markRunAborted(runId, reason).catch(() => {});
  return !!run;
}

// Re-export so callers can avoid importing from run-store directly.
export { tryClaimRunSlot } from "./run-store.js";

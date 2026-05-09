import type { AgentChatEvent, RunEvent, RunStatus } from "./types.js";
import { EngineError } from "./engine/types.js";
import { captureError } from "../server/capture-error.js";
import {
  insertRun,
  insertRunEvent,
  updateRunStatus,
  markRunAborted,
  getRunAbortState,
  getRunEventsSince,
  getRunById,
  getRunByThread,
  cleanupOldRuns,
  updateRunHeartbeat,
  bumpRunProgress,
  reapIfStale,
} from "./run-store.js";

export interface ActiveRun {
  runId: string;
  threadId: string;
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

/** Default run chunk budget for hosted/serverless deploys. */
export const DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS = 55_000;

/** Default SQL retention for completed/errored run event logs (24 hours). */
export const DEFAULT_COMPLETED_RUN_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * How recently a terminal run must have started for `/runs/active` to surface
 * it. Reconnect after this window won't replay the run — typical real-world
 * disconnects resolve in seconds, so 10 minutes is generous while keeping us
 * from resurrecting ancient turns when the user reopens an old thread.
 */
export const TERMINAL_RUN_RECONNECT_WINDOW_MS = 10 * 60 * 1000;

export interface StartRunOptions {
  /** Optional internal run chunk budget. When reached, the framework emits an
   * auto-continuation signal instead of a user-facing timeout. Leave unset for
   * no framework-imposed run timeout. */
  softTimeoutMs?: number;
  /** Opt into the hosted/serverless default chunk budget. Only callers with
   * automatic continuation support should enable this. */
  useHostedSoftTimeoutDefault?: boolean;
}

export interface ResolveRunSoftTimeoutOptions {
  useHostedDefault?: boolean;
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
  if (typeof overrideMs === "number" && Number.isFinite(overrideMs)) {
    return Math.max(0, overrideMs);
  }
  const envValue = process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
  if (envValue !== undefined) {
    const raw = Number(envValue);
    if (Number.isFinite(raw) && raw >= 0) return raw;
  }
  return options?.useHostedDefault && isHostedRuntime()
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

function isTerminalRunEvent(event: AgentChatEvent): boolean {
  return (
    event.type === "done" ||
    event.type === "error" ||
    event.type === "missing_api_key" ||
    event.type === "loop_limit" ||
    event.type === "auto_continue"
  );
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
    events: [],
    status: "running",
    subscribers: new Set(),
    abort,
    startedAt: Date.now(),
  };

  activeRuns.set(runId, run);
  threadToRun.set(threadId, runId);

  // Persist run to SQL without blocking the response. Keep the promise so
  // final status cannot race ahead of a slow initial INSERT and then get
  // overwritten by a late row stuck at status='running'.
  const insertRunPromise = insertRun(runId, threadId).catch(() => {});

  // Throttle the durable progress timestamp to at most once per second so
  // a chatty token-by-token stream doesn't translate into one DB write per
  // chunk. The stuck-detector threshold is on the order of tens of seconds,
  // so 1s resolution is plenty.
  let lastProgressBumpAt = 0;
  const bumpProgressIfDue = () => {
    const now = Date.now();
    if (now - lastProgressBumpAt < 1000) return;
    lastProgressBumpAt = now;
    bumpRunProgress(runId).catch(() => {});
  };

  // Periodic SQL abort check interval (for cross-isolate abort on Workers)
  let lastAbortCheck = Date.now() - 3000;
  const checkSqlAbort = () => {
    const now = Date.now();
    if (now - lastAbortCheck < 3000) return;
    lastAbortCheck = now;
    getRunAbortState(runId)
      .then((state) => {
        if (state.aborted && !abort.signal.aborted) {
          abortInMemoryRun(run, state.reason ?? "user");
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
          abort.abort();
        }, softTimeoutMs)
      : null;
  let pendingTerminalEvent: RunEvent | null = null;

  const captureRunError = (error: unknown, phase: "run" | "completion") => {
    captureError(error, {
      route: "/_agent-native/agent-chat",
      tags: {
        source: "agent-run-manager",
        phase,
        runStatus: run.status,
        softTimedOut: softTimedOut ? "true" : "false",
        abortReason: run.abortReason,
        errorCode: error instanceof EngineError ? error.errorCode : undefined,
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
    // a hung run from a healthy one.
    bumpProgressIfDue();

    // Persist event to SQL. Ordinary streaming events are fire-and-forget, but
    // terminal events are awaited before final status is persisted so reconnects
    // never observe status='errored' without the actual terminal error payload.
    const persistence = insertRunEvent(
      runId,
      runEvent.seq,
      JSON.stringify(runEvent.event),
    );
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
      captureRunError(err, "run");
      send({
        type: "error",
        error: err?.message ?? "Unknown error",
        ...(err instanceof EngineError && err.errorCode
          ? { errorCode: err.errorCode }
          : {}),
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

      // 3. Emit the terminal event only after thread_data is durable. Live
      //    SSE clients close on this event and usually fetch thread_data
      //    immediately, so emitting it earlier recreates the final-message
      //    race this manager is meant to avoid.
      if (finalStatus === "completed" || finalStatus === "errored") {
        const terminal: RunEvent =
          finalStatus === "completed"
            ? (pendingTerminalEvent ?? {
                seq: run.events.length,
                event: { type: "done" },
              })
            : pendingTerminalEvent?.event.type === "error"
              ? pendingTerminalEvent
              : {
                  seq: pendingTerminalEvent?.seq ?? run.events.length,
                  event: {
                    type: "error",
                    error: completionError
                      ? "Agent response could not be saved."
                      : "Agent run ended unexpectedly",
                  },
                };
        const last = run.events[run.events.length - 1];
        if (!last || !isTerminalRunEvent(last.event)) {
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

      // 5. Persist final status to SQL.
      try {
        await insertRunPromise;
        if (!terminalPersistenceError) {
          await updateRunStatus(runId, finalStatus);
        }
      } catch {
        // Best-effort — reapIfStale will eventually clean this up via
        // the heartbeat-stale path.
      }

      // 6. Schedule in-memory cleanup + opportunistic old-run pruning.
      setTimeout(() => {
        activeRuns.delete(runId);
        if (threadToRun.get(threadId) === runId) {
          threadToRun.delete(threadId);
        }
      }, CLEANUP_DELAY_MS);
      cleanupOldRuns(resolveCompletedRunRetentionMs()).catch(() => {});
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
          for (const { seq, eventData } of events) {
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
            lastSeq = seq + 1;

            // Close on terminal events
            if (isTerminalRunEvent(parsed)) {
              if (pingTimer) clearInterval(pingTimer);
              controller.close();
              return;
            }
          }

          // Check if run completed (no terminal event but status changed)
          if (events.length === 0) {
            // Opportunistically reap a stale producer before trusting SQL's
            // "running" status — otherwise a crashed server leaves us polling
            // forever.
            await reapIfStale(runId).catch(() => {});
            const run = await getRunById(runId);
            if (!run || run.status !== "running") {
              // Run ended — do one final event read, then close
              const finalEvents = await getRunEventsSince(runId, lastSeq);
              for (const { seq, eventData } of finalEvents) {
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
                lastSeq = seq + 1;
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
                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "error",
                        error:
                          "Agent run ended before its final error event was persisted.",
                        errorCode: "run_terminal_event_missing",
                        details:
                          "The persisted run status is errored, but no terminal SSE event was available during reconnect.",
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
            pollTimer = setTimeout(poll, 500);
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
  status: string;
  heartbeatAt: number;
  lastProgressAt: number | null;
} | null> {
  // Check memory first — return both running AND recently-completed runs
  // that still have events in memory. This allows sub-agent tabs to replay
  // the full conversation from completed runs via SSE.
  const memRun = getActiveRunForThread(threadId);
  if (memRun && (memRun.status === "running" || memRun.events.length > 0)) {
    return {
      runId: memRun.runId,
      threadId: memRun.threadId,
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
      // If the producer is dead (no recent heartbeat), reap before the
      // client can see a stale "running" status and enter a reconnect
      // loop it can never exit.
      const reaped = await reapIfStale(sqlRun.id).catch(() => false);
      if (reaped) return null;
      return {
        runId: sqlRun.id,
        threadId: sqlRun.threadId,
        status: sqlRun.status,
        heartbeatAt: sqlRun.heartbeatAt ?? sqlRun.startedAt,
        lastProgressAt: sqlRun.lastProgressAt,
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
        status: sqlRun.status,
        heartbeatAt: sqlRun.heartbeatAt ?? sqlRun.startedAt,
        lastProgressAt: sqlRun.lastProgressAt,
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

import type { AgentChatEvent, RunEvent, RunStatus } from "./types.js";
import { EngineError } from "./engine/types.js";
import {
  insertRun,
  insertRunEvent,
  updateRunStatus,
  markRunAborted,
  isRunAborted,
  getRunEventsSince,
  getRunById,
  getRunByThread,
  cleanupOldRuns,
  updateRunHeartbeat,
  reapIfStale,
} from "./run-store.js";

export interface ActiveRun {
  runId: string;
  threadId: string;
  events: RunEvent[];
  status: RunStatus;
  subscribers: Set<(event: RunEvent) => void>;
  abort: AbortController;
  startedAt: number;
}

const activeRuns = new Map<string, ActiveRun>();
const threadToRun = new Map<string, string>();

/** How long to keep completed runs in memory before cleanup (5 min) */
const CLEANUP_DELAY_MS = 5 * 60 * 1000;

/** Default run chunk budget for hosted/serverless deploys. */
export const DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS = 55_000;

export interface StartRunOptions {
  /** Optional internal run chunk budget. When reached, the framework emits an
   * auto-continuation signal instead of a user-facing timeout. Leave unset for
   * no framework-imposed run timeout. */
  softTimeoutMs?: number;
}

function isHostedRuntime(): boolean {
  if (process.env.NETLIFY === "true" && process.env.NETLIFY_LOCAL !== "true") {
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

export function resolveRunSoftTimeoutMs(overrideMs?: number): number {
  if (typeof overrideMs === "number" && Number.isFinite(overrideMs)) {
    return Math.max(0, overrideMs);
  }
  const envValue = process.env.AGENT_RUN_SOFT_TIMEOUT_MS;
  if (envValue !== undefined) {
    const raw = Number(envValue);
    if (Number.isFinite(raw) && raw >= 0) return raw;
  }
  return isHostedRuntime() ? DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS : 0;
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

  // Persist run to SQL (fire-and-forget — don't block the response)
  insertRun(runId, threadId).catch(() => {});

  // Heartbeat: bump heartbeat_at every 1.5s so watchers can detect a dead
  // producer (process crash, HMR restart, isolate eviction) quickly and
  // reap the row. Paired with RUN_STALE_MS (6s) — 4x the interval to
  // tolerate transient DB slowness without false positives.
  const heartbeatTimer: ReturnType<typeof setInterval> = setInterval(() => {
    updateRunHeartbeat(runId).catch(() => {});
  }, 1500);
  const softTimeoutMs = resolveRunSoftTimeoutMs(options?.softTimeoutMs);
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

  // Periodic SQL abort check interval (for cross-isolate abort on Workers)
  let lastAbortCheck = Date.now();

  const send = (event: AgentChatEvent) => {
    if (run.status === "aborted" && abort.signal.aborted) return;

    const runEvent: RunEvent = { seq: run.events.length, event };
    run.events.push(runEvent);

    // Notify in-memory subscribers (same isolate, fast path)
    for (const subscriber of run.subscribers) {
      try {
        subscriber(runEvent);
      } catch {
        run.subscribers.delete(subscriber);
      }
    }

    // Persist event to SQL (fire-and-forget)
    insertRunEvent(runId, runEvent.seq, JSON.stringify(event)).catch(() => {});

    // Check SQL for cross-isolate abort every 3 seconds
    const now = Date.now();
    if (now - lastAbortCheck > 3000) {
      lastAbortCheck = now;
      isRunAborted(runId)
        .then((aborted) => {
          if (aborted && !abort.signal.aborted) abort.abort();
        })
        .catch(() => {});
    }
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

      // 1. Emit terminal event to live subscribers + SQL event log so
      //    in-flight SSE streams close promptly. Thread-data save below
      //    runs in parallel with subscribers disconnecting.
      if (run.status === "errored" || run.status === "completed") {
        const terminal: RunEvent = {
          seq: run.events.length,
          event:
            run.status === "errored"
              ? { type: "error", error: "Agent run ended unexpectedly" }
              : { type: "done" },
        };
        const last = run.events[run.events.length - 1];
        if (!last || !isTerminalRunEvent(last.event)) {
          run.events.push(terminal);
          insertRunEvent(
            runId,
            terminal.seq,
            JSON.stringify(terminal.event),
          ).catch(() => {});
          for (const subscriber of run.subscribers) {
            try {
              subscriber(terminal);
            } catch {
              // ignore — subscriber will be cleaned up below
            }
          }
        }
      }
      for (const subscriber of run.subscribers) {
        run.subscribers.delete(subscriber);
      }

      // 2. Await the completion callback (thread_data save). Heartbeat is
      //    still ticking so the run doesn't look stale to any concurrent
      //    /runs/active check while we wait for SQL writes to land.
      let completionError: unknown = null;
      if (onComplete && run.status !== "aborted") {
        try {
          await onComplete(run);
        } catch (err) {
          completionError = err;
          console.error(
            "[run-manager] onComplete callback error:",
            err instanceof Error ? err.message : err,
          );
        }
      }

      // 3. Stop the heartbeat — all liveness writes are done.
      clearInterval(heartbeatTimer);
      if (softTimeoutTimer) clearTimeout(softTimeoutTimer);

      // 4. Persist final status to SQL. If the completion callback threw,
      //    we'd rather mark the run errored than claim success with
      //    incomplete thread_data.
      const finalStatus =
        run.status === "aborted"
          ? "aborted"
          : run.status === "errored" || completionError
            ? "errored"
            : "completed";
      try {
        await updateRunStatus(runId, finalStatus);
      } catch {
        // Best-effort — reapIfStale will eventually clean this up via
        // the heartbeat-stale path.
      }

      // 5. Schedule in-memory cleanup + opportunistic old-run pruning.
      setTimeout(() => {
        activeRuns.delete(runId);
        if (threadToRun.get(threadId) === runId) {
          threadToRun.delete(threadId);
        }
      }, CLEANUP_DELAY_MS);
      cleanupOldRuns(30 * 60 * 1000).catch(() => {});
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
            lastSeq = seq;

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
 * dead even before the server-side stale reap has fired.
 */
export async function getActiveRunForThreadAsync(threadId: string): Promise<{
  runId: string;
  threadId: string;
  status: string;
  heartbeatAt: number;
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
    };
  }
  // Fall back to SQL
  try {
    const sqlRun = await getRunByThread(threadId);
    if (sqlRun && sqlRun.status === "running") {
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
      };
    }
  } catch {
    // SQL error — fall through
  }
  return null;
}

/** Get a run by ID */
export function getRun(runId: string): ActiveRun | null {
  return activeRuns.get(runId) ?? null;
}

/** Explicitly abort a run (e.g. Stop button) */
export function abortRun(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (run) {
    run.status = "aborted";
    if (threadToRun.get(run.threadId) === runId) {
      threadToRun.delete(run.threadId);
    }
    run.abort.abort();
    for (const subscriber of run.subscribers) {
      run.subscribers.delete(subscriber);
    }
  }
  // Also mark as aborted in SQL (for cross-isolate abort on Workers)
  markRunAborted(runId).catch(() => {});
  return !!run;
}

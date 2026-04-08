import type { AgentChatEvent, RunEvent, RunStatus } from "./types.js";
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
): ActiveRun {
  // If there's already a run for this thread, abort it
  const existingRunId = threadToRun.get(threadId);
  if (existingRunId) {
    abortRun(existingRunId);
  }

  const abort = new AbortController();
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

  // Periodic SQL abort check interval (for cross-isolate abort on Workers)
  let lastAbortCheck = Date.now();

  const send = (event: AgentChatEvent) => {
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
      run.status = "completed";
    })
    .catch((err) => {
      // Don't surface abort errors — the run was intentionally stopped
      if (abort.signal.aborted) {
        run.status = "completed";
        return;
      }
      run.status = "errored";
      send({ type: "error", error: err?.message ?? "Unknown error" });
    })
    .finally(() => {
      // Send a terminal event so every subscriber's ReadableStream controller
      // gets closed.  Without this, SSE connections hang open forever when
      // the agent errors out in a way that bypasses the normal `send()` path.
      if (run.status === "errored" || run.status === "completed") {
        const terminal: RunEvent = {
          seq: run.events.length,
          event:
            run.status === "errored"
              ? { type: "error", error: "Agent run ended unexpectedly" }
              : { type: "done" },
        };
        // Only emit if the last event isn't already terminal — avoid duplicates
        const last = run.events[run.events.length - 1];
        if (
          !last ||
          (last.event.type !== "done" &&
            last.event.type !== "error" &&
            last.event.type !== "missing_api_key" &&
            last.event.type !== "usage_limit_reached" &&
            last.event.type !== "loop_limit")
        ) {
          run.events.push(terminal);
          // Persist terminal event to SQL
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
      // Clean up subscriber references
      for (const subscriber of run.subscribers) {
        run.subscribers.delete(subscriber);
      }
      // Persist final status to SQL
      updateRunStatus(
        runId,
        run.status === "errored" ? "errored" : "completed",
      ).catch(() => {});
      // Call completion callback (e.g. to save thread data).
      // onComplete may be async — handle the returned Promise so rejections
      // don't go unobserved and the callback reliably runs to completion.
      if (onComplete) {
        Promise.resolve()
          .then(() => onComplete(run))
          .catch((err) => {
            console.error(
              "[run-manager] onComplete callback error:",
              err instanceof Error ? err.message : err,
            );
          });
      }
      // Schedule in-memory cleanup
      setTimeout(() => {
        activeRuns.delete(runId);
        if (threadToRun.get(threadId) === runId) {
          threadToRun.delete(threadId);
        }
      }, CLEANUP_DELAY_MS);
      // Opportunistically clean up old SQL runs (>30 min)
      cleanupOldRuns(30 * 60 * 1000).catch(() => {});
    });

  // On Cloudflare Workers, keep the isolate alive for this run
  try {
    const cfCtx = (globalThis as any).__cf_ctx;
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

  return new ReadableStream({
    start(controller) {
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
          if (
            event.event.type === "done" ||
            event.event.type === "error" ||
            event.event.type === "missing_api_key" ||
            event.event.type === "usage_limit_reached" ||
            event.event.type === "loop_limit"
          ) {
            run.subscribers.delete(subscriberRef!);
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

  return new ReadableStream({
    async start(controller) {
      let lastSeq = fromSeq;

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
            if (
              parsed.type === "done" ||
              parsed.type === "error" ||
              parsed.type === "missing_api_key" ||
              parsed.type === "usage_limit_reached" ||
              parsed.type === "loop_limit"
            ) {
              controller.close();
              return;
            }
          }

          // Check if run completed (no terminal event but status changed)
          if (events.length === 0) {
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
            controller.close();
          } catch {}
        }
      };

      // Verify run exists before starting poll
      try {
        const run = await getRunById(runId);
        if (!run) {
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
 */
export async function getActiveRunForThreadAsync(
  threadId: string,
): Promise<{ runId: string; threadId: string; status: string } | null> {
  // Check memory first — return both running AND recently-completed runs
  // that still have events in memory. This allows sub-agent tabs to replay
  // the full conversation from completed runs via SSE.
  const memRun = getActiveRunForThread(threadId);
  if (memRun && (memRun.status === "running" || memRun.events.length > 0)) {
    return {
      runId: memRun.runId,
      threadId: memRun.threadId,
      status: memRun.status,
    };
  }
  // Fall back to SQL
  try {
    const sqlRun = await getRunByThread(threadId);
    if (sqlRun && sqlRun.status === "running") {
      return {
        runId: sqlRun.id,
        threadId: sqlRun.threadId,
        status: sqlRun.status,
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
    run.abort.abort();
  }
  // Also mark as aborted in SQL (for cross-isolate abort on Workers)
  markRunAborted(runId).catch(() => {});
  return !!run;
}

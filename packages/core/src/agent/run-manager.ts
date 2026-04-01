import type { AgentChatEvent, RunEvent, RunStatus } from "./types.js";

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
 */
export function startRun(
  runId: string,
  threadId: string,
  runFn: (
    send: (event: AgentChatEvent) => void,
    signal: AbortSignal,
  ) => Promise<void>,
  onComplete?: (run: ActiveRun) => void,
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

  const send = (event: AgentChatEvent) => {
    const runEvent: RunEvent = { seq: run.events.length, event };
    run.events.push(runEvent);
    for (const subscriber of run.subscribers) {
      try {
        subscriber(runEvent);
      } catch {
        // Subscriber errored, remove it
        run.subscribers.delete(subscriber);
      }
    }
  };

  // Run in background — intentionally detached from any HTTP connection
  runFn(send, abort.signal)
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
            last.event.type !== "loop_limit")
        ) {
          run.events.push(terminal);
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
      // Call completion callback (e.g. to save thread data)
      if (onComplete) {
        try {
          onComplete(run);
        } catch {
          // Don't let callback errors break cleanup
        }
      }
      // Schedule cleanup
      setTimeout(() => {
        activeRuns.delete(runId);
        if (threadToRun.get(threadId) === runId) {
          threadToRun.delete(threadId);
        }
      }, CLEANUP_DELAY_MS);
    });

  return run;
}

/**
 * Subscribe to a run's events starting from `fromSeq`.
 * Returns a ReadableStream that replays buffered events then live-tails.
 * Cancelling the stream only unsubscribes — does NOT abort the agent.
 */
export function subscribeToRun(
  runId: string,
  fromSeq: number,
): ReadableStream<Uint8Array> | null {
  const run = activeRuns.get(runId);
  if (!run) return null;

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

/** Get the active run for a thread (if any) */
export function getActiveRunForThread(threadId: string): ActiveRun | null {
  const runId = threadToRun.get(threadId);
  if (!runId) return null;
  const run = activeRuns.get(runId);
  if (!run) return null;
  return run;
}

/** Get a run by ID */
export function getRun(runId: string): ActiveRun | null {
  return activeRuns.get(runId) ?? null;
}

/** Explicitly abort a run (e.g. Stop button) */
export function abortRun(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (!run) return false;
  run.abort.abort();
  return true;
}

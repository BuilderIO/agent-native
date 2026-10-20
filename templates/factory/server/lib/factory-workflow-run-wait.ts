import type { RunDetail } from "../workflow-host/read-models/runs.js";

const POLL_INTERVAL_MS = 500;

/**
 * What core's scheduler writes on a manual run it refuses because another run
 * of the same job is active. It records no error code for it, so the wording is
 * the only way to tell it from any other failed tick.
 */
export const ALREADY_RUNNING_MESSAGE = "The automation is already running.";

/** How the scheduler's own history row for a queued run ended, or that it has not. */
export interface SchedulerOutcome {
  status: "running" | "success" | "error" | "interrupted" | "skipped";
  error: string | null;
  errorCode: string | null;
}

/** Every step succeeded: the definition the engine uses to record a clean dry run. */
export function runIsClean(detail: RunDetail): boolean {
  return (
    detail.run.status === "succeeded" &&
    !detail.stepsTruncated &&
    detail.steps.every((step) => step.status === "succeeded")
  );
}

function wasSkippedAsAlreadyRunning(outcome: SchedulerOutcome): boolean {
  return (
    outcome.status !== "running" &&
    (outcome.error ?? "").startsWith(ALREADY_RUNNING_MESSAGE)
  );
}

type RunWaitResult =
  | { state: "finished"; detail: RunDetail }
  | { state: "still_running"; detail: RunDetail | null }
  /** The scheduler refused the run because another one of this job was active; the workflow never started. */
  | { state: "skipped"; reason: "already_running" }
  /** The scheduler ended the run without the workflow ever starting, for a reason it recorded. */
  | { state: "not_started"; outcome: SchedulerOutcome };

/**
 * Polls until the run has ended or `waitMs` has passed, and never longer. A
 * dry run that came out clean is not finished until its verdict is recorded,
 * because that record is what lets the workflow be turned on; a run still
 * waiting for it at the limit is reported as still running, not as unclean.
 *
 * While no workflow run exists it also reads the scheduler's history row, so a
 * run the scheduler ended before the workflow started is reported at once
 * instead of as "still running" for the whole wait.
 */
export async function waitForWorkflowRun(options: {
  /** The run, or null until the scheduler starts it. */
  readRun: () => Promise<RunDetail | null>;
  /** The workflow version whose last clean dry run is recorded. */
  readCleanVersion: () => Promise<number | null>;
  /** The scheduler's row for this run, or null when it cannot be found. */
  readScheduler?: () => Promise<SchedulerOutcome | null>;
  waitMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<RunWaitResult> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + options.waitMs;
  for (;;) {
    let detail = await options.readRun();
    if (detail === null && options.readScheduler) {
      const outcome = await options.readScheduler();
      if (outcome && outcome.status !== "running") {
        // The workflow run may have been created and finished between the two reads.
        detail = await options.readRun();
        if (detail === null) {
          return wasSkippedAsAlreadyRunning(outcome)
            ? { state: "skipped", reason: "already_running" }
            : { state: "not_started", outcome };
        }
      }
    }
    if (detail && detail.run.status !== "running") {
      const verdictPending =
        detail.run.mode === "dry" &&
        runIsClean(detail) &&
        (await options.readCleanVersion()) !== detail.run.graphVersion;
      if (!verdictPending) return { state: "finished", detail };
    }
    const remaining = deadline - now();
    if (remaining <= 0) return { state: "still_running", detail };
    await sleep(Math.min(options.pollMs ?? POLL_INTERVAL_MS, remaining));
  }
}

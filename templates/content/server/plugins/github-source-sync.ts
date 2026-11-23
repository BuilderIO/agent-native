import {
  registerRecurringSweepHandler,
  shouldDisableInProcessSweeps,
  startIntervalJob,
} from "@agent-native/core/server";
import type {
  IntervalJobHandle,
  RecurringSweepContext,
} from "@agent-native/core/server";

import { runGitHubPullRequestsSweep } from "../../actions/_github-pull-requests-freshness.js";
import { runGitHubSourceSweep } from "../../actions/_github-source-freshness.js";

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_TIMEOUT_MS = 90_000;
const SWEEP_START_DELAY_MS = 30_000;

/**
 * GitHub folders and pull request collections share the sweep and its time,
 * each with its own links, so a slow one doesn't hold up the other.
 */
async function runGitHubSweeps(context: RecurringSweepContext) {
  const results = await Promise.allSettled([
    runGitHubSourceSweep(context),
    runGitHubPullRequestsSweep(context),
  ]);
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) throw failed.reason;
}

let unregisterRecurringSweepHandler: (() => void) | undefined;
let inProcessSweep: IntervalJobHandle | undefined;
let sweepStartTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Brings collections linked to GitHub folders or pull requests up to date
 * about once a minute: on the platform's scheduled sweep when deployed, and
 * on a timer in a long-running server. A sync holds a lease on its link, so
 * the two never sync the same link at once.
 */
export default function registerGitHubSourceSync(nitroApp?: any) {
  unregisterRecurringSweepHandler ??= registerRecurringSweepHandler(
    "content-github-source-sync",
    runGitHubSweeps,
  );

  if (!shouldDisableInProcessSweeps() && !inProcessSweep && !sweepStartTimer) {
    sweepStartTimer = setTimeout(() => {
      sweepStartTimer = undefined;
      inProcessSweep = startIntervalJob(
        (signal) =>
          runGitHubSweeps({
            deadlineAt: Date.now() + SWEEP_TIMEOUT_MS,
            signal,
          }),
        {
          intervalMs: SWEEP_INTERVAL_MS,
          timeoutMs: SWEEP_TIMEOUT_MS,
          leading: true,
          onError: (error) => {
            console.warn("[content-github-source-sync] sweep failed:", error);
          },
        },
      );
    }, SWEEP_START_DELAY_MS);
    sweepStartTimer.unref?.();
  }

  nitroApp?.hooks?.hook?.("close", () => {
    if (sweepStartTimer) clearTimeout(sweepStartTimer);
    sweepStartTimer = undefined;
    inProcessSweep?.stop();
    inProcessSweep = undefined;
    unregisterRecurringSweepHandler?.();
    unregisterRecurringSweepHandler = undefined;
  });
}

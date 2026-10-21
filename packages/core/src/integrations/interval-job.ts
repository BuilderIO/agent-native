import {
  startIntervalJob as startServerIntervalJob,
  type IntervalJobOptions,
} from "../server/interval-job.js";

export interface IntervalJobHandle {
  stop(): Promise<void>;
}

export function startIntervalJob(
  runOnce: (signal: AbortSignal) => Promise<void>,
  options: IntervalJobOptions,
): IntervalJobHandle {
  let stopped = false;
  let drained = Promise.resolve();
  const job = startServerIntervalJob(async (signal) => {
    if (stopped) return;

    let finish!: () => void;
    drained = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      await runOnce(signal);
    } finally {
      // Drain tracks callback settlement; the interval job owns error reporting.
      finish();
    }
  }, options);

  return {
    stop(): Promise<void> {
      if (!stopped) {
        stopped = true;
        job.stop();
      }
      return drained;
    },
  };
}

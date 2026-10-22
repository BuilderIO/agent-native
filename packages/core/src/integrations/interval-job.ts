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
  let drained: Promise<{ error: unknown } | undefined> =
    Promise.resolve(undefined);
  const job = startServerIntervalJob(async (signal) => {
    if (stopped) return;

    let finish!: (failure?: { error: unknown }) => void;
    drained = new Promise((resolve) => {
      finish = resolve;
    });
    let failure: { error: unknown } | undefined;
    try {
      await runOnce(signal);
    } catch (error) {
      if (!stopped) throw error;
      if (
        error !== signal.reason &&
        !(error instanceof Error && error.name === "AbortError")
      ) {
        failure = { error };
      }
    } finally {
      // The poll engine suppresses post-stop errors; stop() must expose them.
      finish(failure);
    }
  }, options);

  return {
    stop(): Promise<void> {
      if (!stopped) {
        stopped = true;
        job.stop();
      }
      return drained.then((failure) => {
        if (failure) throw failure.error;
      });
    },
  };
}

import { createPollEngine } from "../shared/poll-engine.js";

export interface IntervalJobOptions {
  intervalMs: number;
  timeoutMs?: number;
  timeoutFloorMs?: number;
  onError?: (err: unknown) => void;
  leading?: boolean;
}

export interface IntervalJobHandle {
  /** Stops scheduling and waits for any in-flight run to settle. */
  stop(): Promise<void>;
}

export function startIntervalJob(
  runOnce: (signal: AbortSignal) => Promise<void>,
  options: IntervalJobOptions,
): IntervalJobHandle {
  const engine = createPollEngine(runOnce, options);
  engine.start();
  return {
    stop(): Promise<void> {
      return engine.stop();
    },
  };
}

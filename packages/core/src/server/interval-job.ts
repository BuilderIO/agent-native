import { createPollEngine } from "../shared/poll-engine.js";

export interface IntervalJobOptions {
  intervalMs: number;
  timeoutMs?: number;
  timeoutFloorMs?: number;
  onError?: (err: unknown) => void;
  leading?: boolean;
}

export interface IntervalJobHandle {
  stop(): void;
}

export function startIntervalJob(
  runOnce: (signal: AbortSignal) => Promise<void>,
  options: IntervalJobOptions,
): IntervalJobHandle {
  const engine = createPollEngine(runOnce, options);
  engine.start();
  return {
    stop(): void {
      engine.stop();
    },
  };
}

import { createPollEngine } from "../shared/poll-engine.js";

export interface IntervalJobOptions {
  /** Delay in ms between runs. */
  intervalMs: number;
  /** Per-run timeout. Default: `Math.max(timeoutFloorMs, intervalMs * 4)`. */
  timeoutMs?: number;
  /** Floor used by the default `timeoutMs`. Default: 10_000. */
  timeoutFloorMs?: number;
  /** Called when a run throws or times out. Default: swallow (a background job shouldn't crash the host process). */
  onError?: (err: unknown) => void;
  /** Run immediately on start. Default: true. */
  leading?: boolean;
}

export interface IntervalJobHandle {
  stop(): void;
}

/**
 * Run a background job on a recurring interval without hand-rolling a
 * `running` overlap guard or a request timeout — see `createPollEngine` for
 * the underlying guarantees. `runOnce` keeps its normal exported signature
 * (serverless schedulers can still call it directly, bypassing the loop);
 * this only replaces the `setInterval` + module-level flag wiring around it.
 * The internal timer is `.unref()`'d so it never keeps the process alive on
 * its own.
 */
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

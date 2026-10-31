import { registerBackgroundJobStop } from "./background-jobs.js";

const SWEEP_START_DELAY_MS = 25_000;
const SWEEP_TICK_MS = 30_000;
const SWEEP_INTERVAL_MS = 2 * 60 * 1000;
/**
 * A sweep still running after this long is presumed stuck, so the next tick
 * starts another instead of leaving due executions undriven for good.
 */
const SWEEP_STALL_MS = 10 * 60 * 1000;

export interface SandboxExecutionSweepOptions {
  drain?: () => Promise<void>;
  waitForExecutions?: () => Promise<void>;
}

async function drainDueSandboxExecutions(): Promise<void> {
  const { drainDueSandboxExecutions: drain } =
    await import("../coding-tools/sandbox/background.js");
  await drain({ limit: 5 });
}

async function waitForInProcessSandboxExecutions(): Promise<void> {
  const { waitForInProcessSandboxExecutions: wait } =
    await import("../coding-tools/sandbox/background.js");
  await wait();
}

/** Lets the process exit while `timer` waits, where timers support it. */
function unrefTimer(timer: unknown): void {
  if (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof timer.unref === "function"
  ) {
    timer.unref();
  }
}

/**
 * Starts the periodic sandbox execution redrive and returns a function that
 * stops its timers. Shutdown also waits for any sweep under way (it may still
 * be starting executions), then for the executions this process started.
 */
export function startSandboxExecutionSweep({
  drain = drainDueSandboxExecutions,
  waitForExecutions = waitForInProcessSandboxExecutions,
}: SandboxExecutionSweepOptions = {}): () => void {
  let lastSweep = 0;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  const sweeps = new Set<Promise<void>>();

  const stopTimers = () => {
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  };

  startupTimer = setTimeout(() => {
    startupTimer = null;
    sweepTimer = setInterval(() => {
      const now = Date.now();
      // One sweep at a time, unless the last one has stalled.
      const wait = sweeps.size > 0 ? SWEEP_STALL_MS : SWEEP_INTERVAL_MS;
      if (now - lastSweep < wait) return;
      lastSweep = now;

      const sweep: Promise<void> = (async () => {
        await drain();
      })()
        .catch(() => {
          // best-effort — never break the server
        })
        .finally(() => {
          sweeps.delete(sweep);
        });
      sweeps.add(sweep);
    }, SWEEP_TICK_MS);
    unrefTimer(sweepTimer);
  }, SWEEP_START_DELAY_MS);
  unrefTimer(startupTimer);

  registerBackgroundJobStop(async function stopSandboxExecutions() {
    stopTimers();
    if (sweeps.size === 0) return;
    await Promise.all(sweeps);
    await waitForExecutions();
  });
  return stopTimers;
}

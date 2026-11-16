import { isMainThread } from "node:worker_threads";

type CpuUsageReader = () => NodeJS.CpuUsage;

/**
 * Picks the CPU clock for this thread. `process.cpuUsage()` counts every
 * thread in the process: under Vitest's forks pool that is one test file, but
 * in a worker thread it also counts the files running beside it, which is the
 * load a CPU budget exists to ignore.
 */
function cpuUsageReader(): CpuUsageReader {
  const threadCpuUsage = (process as { threadCpuUsage?: () => NodeJS.CpuUsage })
    .threadCpuUsage;
  if (typeof threadCpuUsage === "function") {
    return () => threadCpuUsage.call(process);
  }
  if (!isMainThread) {
    throw new Error(
      "measureCpuMs needs process.threadCpuUsage() (Node 22.19+ or 23.9+) " +
        "inside a worker thread: process.cpuUsage() there also counts every " +
        "other test running in the process.",
    );
  }
  return () => process.cpuUsage();
}

function elapsedCpuMs(read: CpuUsageReader, start: NodeJS.CpuUsage): number {
  const end = read();
  return (end.user - start.user + (end.system - start.system)) / 1_000;
}

/**
 * CPU milliseconds this thread spends running `run`, for a test that needs a
 * performance budget (a ReDoS guard, a parser's speed).
 *
 * Do not measure a budget with `Date.now()` or `performance.now()`: wall-clock
 * time also counts the time a loaded CI runner gives to other processes, so a
 * correct run crosses any fixed bound sooner or later. CPU time counts only the
 * work this thread did. Prefer a scaling check (n against 4n) when the claim is
 * "linear" rather than "fast".
 *
 * Returns a number for a synchronous `run` and a promise for an async one. An
 * async `run` is charged for whatever else runs on this thread while it awaits.
 *
 * On Node without `process.threadCpuUsage()` (before 22.19 / 23.9) the main
 * thread falls back to `process.cpuUsage()`, which also counts CPU spent by
 * worker threads in the same process, so the number is this thread's alone
 * only when no worker threads run during `run`.
 */
export function measureCpuMs(run: () => PromiseLike<unknown>): Promise<number>;
export function measureCpuMs(run: () => unknown): number;
export function measureCpuMs(run: () => unknown): number | Promise<number> {
  const read = cpuUsageReader();
  const start = read();
  const result = run();
  if (isPromiseLike(result)) {
    return Promise.resolve(result).then(() => elapsedCpuMs(read, start));
  }
  return elapsedCpuMs(read, start);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

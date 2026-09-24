import { useEffect } from "react";

/**
 * Long-running dev-mode sessions in the multi-screen overview (pan / zoom /
 * select / undo cycles across many screens) trigger a very high render rate.
 * In development builds, React and Radix UI primitives record a
 * `performance.mark` / `performance.measure` entry for large numbers of
 * component renders (visible as "Popper", "TooltipProvider", "Primitive.div",
 * etc. in `performance.getEntriesByType("measure")`). The browser's User
 * Timing buffer has no default cap, so these entries — and the strings/
 * objects the Performance panel keeps for them — accumulate for the entire
 * page lifetime. Over a long soak this dominates JS heap growth (verified via
 * heap-snapshot diffing: hundreds of thousands of retained `PerformanceMeasure`
 * native objects). Clearing the buffer once it crosses a bound keeps a long
 * session's heap flat without disabling the underlying instrumentation (a
 * fresh profiling window still fills up normally after each sweep).
 */
export const PERFORMANCE_BUFFER_CHECK_INTERVAL_MS = 15_000;
export const PERFORMANCE_BUFFER_ENTRY_LIMIT = 3_000;

export interface PerformanceBufferLike {
  getEntriesByType(type: "mark" | "measure"): { length: number };
  clearMarks?(): void;
  clearMeasures?(): void;
}

/** Pure decision function so the threshold logic is unit-testable without a
 * real Performance object. */
export function shouldClearPerformanceBuffer(
  markCount: number,
  measureCount: number,
  limit: number = PERFORMANCE_BUFFER_ENTRY_LIMIT,
): boolean {
  return markCount + measureCount > limit;
}

/** Sweeps `performance` marks/measures once if they exceed the bound. Safe to
 * call even when the Performance User Timing APIs are unavailable. */
export function sweepPerformanceBufferIfNeeded(
  perf: PerformanceBufferLike,
  limit: number = PERFORMANCE_BUFFER_ENTRY_LIMIT,
): boolean {
  if (
    typeof perf.getEntriesByType !== "function" ||
    typeof perf.clearMarks !== "function" ||
    typeof perf.clearMeasures !== "function"
  ) {
    return false;
  }
  const markCount = perf.getEntriesByType("mark").length;
  const measureCount = perf.getEntriesByType("measure").length;
  if (!shouldClearPerformanceBuffer(markCount, measureCount, limit)) {
    return false;
  }
  perf.clearMarks();
  perf.clearMeasures();
  return true;
}

/** Periodically bounds the browser's User Timing buffer for the lifetime of
 * the mounted editor. No-op on the server and in browsers without the
 * Performance User Timing APIs. */
export function usePerformanceBufferGuard(
  intervalMs: number = PERFORMANCE_BUFFER_CHECK_INTERVAL_MS,
  limit: number = PERFORMANCE_BUFFER_ENTRY_LIMIT,
): void {
  useEffect(() => {
    if (
      !import.meta.env.DEV ||
      typeof window === "undefined" ||
      typeof performance === "undefined"
    ) {
      return;
    }
    const id = window.setInterval(() => {
      sweepPerformanceBufferIfNeeded(performance, limit);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, limit]);
}

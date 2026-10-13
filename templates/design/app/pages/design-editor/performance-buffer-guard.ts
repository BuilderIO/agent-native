import { useEffect } from "react";

export const PERFORMANCE_BUFFER_CHECK_INTERVAL_MS = 15_000;
export const PERFORMANCE_BUFFER_ENTRY_LIMIT = 3_000;

export interface PerformanceBufferLike {
  getEntriesByType(type: "mark" | "measure"): { length: number };
  clearMarks?(): void;
  clearMeasures?(): void;
}

export function shouldClearPerformanceBuffer(
  markCount: number,
  measureCount: number,
  limit: number = PERFORMANCE_BUFFER_ENTRY_LIMIT,
): boolean {
  return markCount + measureCount > limit;
}

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

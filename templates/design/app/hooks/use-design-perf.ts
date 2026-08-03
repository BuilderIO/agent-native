import { useEffect, useRef } from "react";

import {
  buildPerfReport,
  createPerfRecorder,
  DESIGN_PERF_STORAGE_KEY,
  resolvePerfEnabled,
} from "@/pages/design-editor/perf-log";

/** One recorder for the whole editor so call sites can import it directly
 * without threading it through props or context. */
export const designPerf = createPerfRecorder();

const FLUSH_INTERVAL_MS = 2000;

function readStoredFlag(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DESIGN_PERF_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Session-only profiling still works when the store rejects writes. */
function writeStoredFlag(value: "1" | "0"): void {
  try {
    window.localStorage.setItem(DESIGN_PERF_STORAGE_KEY, value);
  } catch {
    return;
  }
}

function printReport(): void {
  const rows = buildPerfReport(designPerf.snapshot());
  if (rows.length === 0) return;
  designPerf.reset();
  console.table(rows);
}

/**
 * Mount once, from the editor root. Resolves the opt-in, starts the flush
 * interval, and exposes `window.__designPerf` so a profiling session can be
 * driven from the console without a reload.
 */
export function useDesignPerf(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const { enabled, source } = resolvePerfEnabled({
      search: window.location.search,
      stored: readStoredFlag(),
    });
    designPerf.setEnabled(enabled);

    const api = {
      enable: () => {
        designPerf.setEnabled(true);
        writeStoredFlag("1");
      },
      disable: () => {
        designPerf.setEnabled(false);
        writeStoredFlag("0");
      },
      report: () => buildPerfReport(designPerf.snapshot()),
      print: printReport,
      reset: () => designPerf.reset(),
    };
    (window as unknown as { __designPerf: typeof api }).__designPerf = api;

    if (!enabled) {
      if (source === "default") {
        console.info(
          "[design-perf] off — run __designPerf.enable() or add ?perf=1",
        );
      }
      return;
    }

    console.info(`[design-perf] on (${source}) — flushing every 2s`);
    const timer = window.setInterval(printReport, FLUSH_INTERVAL_MS);
    const stop: Array<() => void> = [];

    // `gap:*` cannot tell an idle editor from a blocked one. Long tasks and
    // frame deltas measure main-thread stalls directly, including the iframe
    // style/layout/raster work React never sees.
    if (typeof PerformanceObserver === "function") {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            designPerf.record("longtask", entry.duration);
          }
        });
        observer.observe({ type: "longtask", buffered: true });
        stop.push(() => observer.disconnect());
      } catch {
        designPerf.count("longtask:unsupported");
      }
    }

    let previousFrame = performance.now();
    let frameHandle = window.requestAnimationFrame(function tick() {
      const nowMs = performance.now();
      designPerf.record("frame", nowMs - previousFrame);
      previousFrame = nowMs;
      frameHandle = window.requestAnimationFrame(tick);
    });
    stop.push(() => window.cancelAnimationFrame(frameHandle));

    return () => {
      window.clearInterval(timer);
      stop.forEach((fn) => fn());
      printReport();
    };
  }, []);
}

/** Count every render of a component, and time the commit-to-commit gap. */
export function usePerfRender(label: string): void {
  designPerf.count(`render:${label}`);
  const lastCommitRef = useRef<number | null>(null);
  useEffect(() => {
    if (!designPerf.isEnabled()) return;
    const previous = lastCommitRef.current;
    const nowMs = performance.now();
    lastCommitRef.current = nowMs;
    if (previous !== null) designPerf.record(`gap:${label}`, nowMs - previous);
  });
}

/** Time an effect body. Call at the top; call the result at the end. */
export function perfSpan(label: string): () => number {
  return designPerf.start(label);
}
